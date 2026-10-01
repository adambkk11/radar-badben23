"""Análisis de pliegos con IA gratuita (Google Gemini, con Groq como respaldo)."""
from __future__ import annotations

import base64
import json
import os
import re
import time

import requests

PROMPT = """Eres el analista de licitaciones de {empresa}.
Modelo de negocio: {modelo}

Analiza esta licitación pública de SUMINISTRO y responde SOLO con un JSON válido (sin texto fuera del JSON) con estas claves:
{{
 "resumen": "máximo 4 frases: qué se compra, cantidades clave, cómo se adjudica y si nos conviene",
 "que_se_compra": ["artículo o lote principal con cantidad si aparece", "..."],
 "peso_precio": número 0-100 o null,
 "otros_criterios": "resto de criterios y su peso",
 "solvencia": {{
    "exige_economica": true/false/null,
    "exige_tecnica": true/false/null,
    "exenta": true/false/null,
    "admite_empresa_nueva": "sí / no / no se indica (art. 89.1 LCSP: empresas de <5 años en no armonizados)",
    "detalle": "qué piden exactamente y cifras"
 }},
 "rolece": true/false/null,
 "plazo_entrega": "texto literal resumido",
 "plazo_entrega_dias": número o null,
 "entregas": "unica" | "a_demanda" | "periodica" | "desconocido",
 "duracion_contrato": "texto",
 "muestras": "si piden muestras: cuándo, dónde y de qué; si no, null",
 "epi_categoria_iii": true/false/null,
 "montaje_instalacion": true/false/null,
 "idioma_oferta": "idiomas admitidos",
 "garantia_definitiva": "texto o null",
 "penalizaciones": "resumen o null",
 "lotes": [{{"lote": "id", "descripcion": "texto", "importe": número o null, "encaja": "sí/no/parcial"}}],
 "socio_recomendado": "uno de: {socios} / ninguno",
 "puntos_fuertes": ["..."],
 "riesgos": ["..."],
 "encaje": número 0-100 (cuánto encaja con el modelo),
 "recomendacion": "presentarse" | "estudiar" | "descartar",
 "motivo": "una frase"
}}
Sé literal con cifras y plazos; si un dato no aparece, pon null. No inventes.

DATOS DE LA LICITACIÓN:
{meta}

TEXTO DE LOS PLIEGOS (puede estar recortado):
{texto}
"""


def _meta(it: dict) -> str:
    lotes = "; ".join(f"L{l['id']}: {l['nombre']} ({l['importe'] or '?'} €)" for l in it.get("lotes", [])[:30])
    crit = "; ".join(f"{c['descripcion']}: {c['peso']}" for c in it.get("criterios", []))
    return (f"Título: {it['titulo']}\nÓrgano: {it['organo']} ({it['ccaa']} {it['provincia']})\n"
            f"Expediente: {it['expediente']}\nProcedimiento: {it['procedimiento_txt']} | Armonizado: {it['armonizado']}\n"
            f"Presupuesto sin IVA: {it['importe']} | Valor estimado: {it['valor_estimado']}\n"
            f"Fin de plazo: {it['fecha_fin']} {it['hora_fin']}\nCPV: {', '.join(it['cpv'][:8])}\n"
            f"Criterios (feed): {crit}\nLotes: {lotes}\n"
            f"Requisitos (feed): {json.dumps(it.get('requisitos', {}), ensure_ascii=False)[:1500]}")


def _json(texto: str) -> dict:
    texto = texto.strip()
    texto = re.sub(r"^```(json)?|```$", "", texto, flags=re.M).strip()
    m = re.search(r"\{.*\}", texto, re.S)
    return json.loads(m.group(0) if m else texto)


class SinIA(RuntimeError):
    """Ningún modelo de IA está disponible ahora (claves, cuota diaria agotada o modelos retirados)."""


_MUERTOS: set[str] = set()      # modelos que no sirven en esta ejecución (retirados o sin cuota hoy)
_CATALOGO: list[str] | None = None
_EXCLUIR = re.compile(r"image|tts|audio|live|embed|robotic|computer|learnlm|gemma|vision|native", re.I)


def _catalogo(clave: str) -> list[str]:
    """Modelos de Gemini que esta clave puede usar (Google retira modelos: no dependemos de nombres fijos)."""
    global _CATALOGO
    if _CATALOGO is not None:
        return _CATALOGO
    _CATALOGO = []
    tok = None
    try:
        for _ in range(5):
            params = {"pageSize": 1000}
            if tok:
                params["pageToken"] = tok
            r = requests.get("https://generativelanguage.googleapis.com/v1beta/models", params=params,
                             headers={"x-goog-api-key": clave}, timeout=60)
            if r.status_code >= 400:
                print(f"   [IA] no se pudo listar modelos de Gemini: HTTP {r.status_code}: {r.text[:200]}")
                break
            j = r.json()
            for m in j.get("models", []):
                if "generateContent" in m.get("supportedGenerationMethods", []):
                    _CATALOGO.append(m["name"].split("/", 1)[-1])
            tok = j.get("nextPageToken")
            if not tok:
                break
    except requests.RequestException as ex:
        print(f"   [IA] no se pudo listar modelos de Gemini: {ex}")
    return _CATALOGO


def _version(nombre: str) -> float:
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", nombre)
    return float(m.group(1)) if m else 0.0


def modelos_gemini(clave: str, preferidos: list[str]) -> list[str]:
    """Los preferidos que existen y, detrás, los 'flash' más nuevos del catálogo (los lite al final)."""
    cat = _catalogo(clave)
    if not cat:
        return [m for m in preferidos if m not in _MUERTOS]
    hay = set(cat)
    flash = [n for n in cat if "flash" in n and not _EXCLUIR.search(n)]
    flash.sort(key=lambda n: ("lite" in n, "preview" in n or "exp" in n, -_version(n), n))
    out = [m for m in preferidos if m in hay] + flash[:5]
    return [m for m in dict.fromkeys(out) if m not in _MUERTOS]


def _sin_cuota_hoy(texto: str) -> bool:
    t = texto.replace(" ", "")
    return "PerDay" in texto or "limit:0" in t or '"quotaValue":"0"' in t


def _espera(texto: str, defecto: int) -> int:
    m = re.search(r'"retryDelay":\s*"(\d+)', texto)
    return min(int(m.group(1)) + 2, 90) if m else defecto


def _gemini(prompt: str, pdfs: list[bytes], modelo: str, clave: str) -> dict:
    partes = [{"text": prompt}]
    for p in pdfs:
        partes.append({"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(p).decode()}})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
    body = {"contents": [{"parts": partes}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}
    ultimo = ""
    for intento in range(3):
        try:
            r = requests.post(url, json=body, headers={"x-goog-api-key": clave}, timeout=300)
        except requests.RequestException as ex:
            ultimo = str(ex)
            time.sleep(15)
            continue
        if r.status_code in (404, 403) or (r.status_code == 400 and "not found" in r.text.lower()):
            _MUERTOS.add(modelo)
            raise RuntimeError(f"HTTP {r.status_code} (modelo no disponible): {r.text[:160]}")
        if r.status_code == 429:
            ultimo = r.text
            if _sin_cuota_hoy(r.text):
                _MUERTOS.add(modelo)
                raise RuntimeError("cuota gratuita agotada hoy para este modelo")
            time.sleep(_espera(r.text, 30 * (intento + 1)))
            continue
        if r.status_code in (500, 502, 503, 504):
            ultimo = f"HTTP {r.status_code}"
            time.sleep(20 * (intento + 1))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        j = r.json()
        try:
            txt = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise RuntimeError(f"respuesta vacía: {json.dumps(j)[:200]}")
        return _json(txt)
    raise RuntimeError(f"Gemini sin respuesta tras 3 intentos: {ultimo[:200]}")


def _groq(prompt: str, modelo: str, clave: str) -> dict:
    for intento in range(2):
        r = requests.post("https://api.groq.com/openai/v1/chat/completions",
                          headers={"Authorization": f"Bearer {clave}"},
                          json={"model": modelo, "temperature": 0.2, "response_format": {"type": "json_object"},
                                "messages": [{"role": "user", "content": prompt}]}, timeout=300)
        if r.status_code in (401, 403, 404) or (r.status_code == 400 and "decommissioned" in r.text):
            _MUERTOS.add("groq:" + modelo)
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code == 429:
            if "per day" in r.text.lower() or "TPD" in r.text or "RPD" in r.text:
                _MUERTOS.add("groq:" + modelo)
                raise RuntimeError("cuota diaria de Groq agotada")
            time.sleep(30)
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        return _json(r.json()["choices"][0]["message"]["content"])
    raise RuntimeError("Groq: límite por minuto")


def _normalizar(r: dict) -> dict:
    """Asegura los tipos que espera la web aunque el modelo conteste a su manera."""
    if not isinstance(r, dict):
        raise ValueError("la IA no devolvió un objeto JSON")
    def lista(v):
        if v is None:
            return []
        if isinstance(v, str):
            return [x.strip(" -•") for x in v.replace(";", "\n").split("\n") if x.strip(" -•")]
        if isinstance(v, list):
            return [x if isinstance(x, (str, dict)) else str(x) for x in v]
        return [str(v)]
    def texto(v):
        if v is None or isinstance(v, str):
            return v
        if isinstance(v, (list, tuple)):
            return "; ".join(str(x) for x in v)
        return str(v)
    def numero(v):
        try:
            return float(str(v).replace("%", "").replace(",", ".")) if v not in (None, "") else None
        except ValueError:
            return None
    out = dict(r)
    for k in ("que_se_compra", "puntos_fuertes", "riesgos"):
        out[k] = [texto(x) if not isinstance(x, str) else x for x in lista(r.get(k))]
    out["lotes"] = [x for x in lista(r.get("lotes")) if isinstance(x, dict)]
    for k in ("resumen", "otros_criterios", "plazo_entrega", "duracion_contrato", "muestras", "idioma_oferta",
              "garantia_definitiva", "penalizaciones", "socio_recomendado", "motivo", "entregas"):
        out[k] = texto(r.get(k))
    for k in ("peso_precio", "plazo_entrega_dias", "encaje"):
        out[k] = numero(r.get(k))
    sol = r.get("solvencia")
    out["solvencia"] = sol if isinstance(sol, dict) else ({"detalle": texto(sol)} if sol else None)
    if isinstance(out.get("solvencia"), dict):
        out["solvencia"] = {k: (texto(v) if k in ("detalle", "admite_empresa_nueva") else v) for k, v in out["solvencia"].items()}
    rec = (texto(r.get("recomendacion")) or "").lower().strip()
    out["recomendacion"] = next((x for x in ("presentarse", "estudiar", "descartar") if x in rec), "estudiar")
    return out


def disponible() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GROQ_API_KEY"))


def analizar(it: dict, pliegos: list[dict], cfg: dict) -> tuple[dict, str]:
    """Devuelve (análisis, modelo usado)."""
    ia = cfg["ia"]
    maxc = ia["max_caracteres_pliego"]
    texto = ""
    pdf_escaneados = []
    for d in pliegos:
        t = (d.get("texto") or "").strip()
        if len(t) < 500 and d.get("pdf"):
            pdf_escaneados.append(d["pdf"])  # PDF escaneado: se lo pasamos a Gemini tal cual
        texto += f"\n\n===== {d['tipo']}: {d['nombre']} =====\n{t}"
    texto = texto[:maxc] if texto else "(sin pliegos accesibles: analiza solo con los datos)"
    socios = " / ".join(dict.fromkeys(f["socio"] for f in cfg["familias"].values() if f.get("socio")))
    prompt = PROMPT.format(empresa=cfg["empresa"]["nombre"], modelo=cfg["empresa"]["modelo"],
                           socios=socios, meta=_meta(it), texto=texto)
    g, q = os.environ.get("GEMINI_API_KEY"), os.environ.get("GROQ_API_KEY")
    errores = []
    lista = lambda v: v if isinstance(v, list) else [v]
    vivos = 0
    if g:
        pdfs = [p for p in pdf_escaneados if len(p) < 15 * 1024 * 1024][:2]
        for m in modelos_gemini(g, lista(ia["modelo_gemini"])):
            if m in _MUERTOS:
                continue
            vivos += 1
            try:
                return _normalizar(_gemini(prompt, pdfs, m, g)), m
            except Exception as ex:
                errores.append(f"{m}: {str(ex)[:200]}")
    if q:
        # el plan gratuito de Groq admite pocas palabras por minuto: se recorta el pliego
        corto = PROMPT.format(empresa=cfg["empresa"]["nombre"], modelo=cfg["empresa"]["modelo"],
                              socios=socios, meta=_meta(it), texto=texto[:ia.get("max_caracteres_groq", 22000)])
        for m in lista(ia["modelo_groq"]):
            if "groq:" + m in _MUERTOS:
                continue
            vivos += 1
            try:
                return _normalizar(_groq(corto, m, q)), m
            except Exception as ex:
                errores.append(f"{m}: {str(ex)[:200]}")
    if not vivos or not quedan_modelos(cfg):
        raise SinIA(" | ".join(errores) or "ningún modelo de IA disponible")
    raise RuntimeError(" | ".join(errores) or "sin clave de IA configurada")


def quedan_modelos(cfg: dict) -> bool:
    """¿Queda algún modelo utilizable en esta ejecución?"""
    g, q = os.environ.get("GEMINI_API_KEY"), os.environ.get("GROQ_API_KEY")
    lista = lambda v: v if isinstance(v, list) else [v]
    if g and modelos_gemini(g, lista(cfg["ia"]["modelo_gemini"])):
        return True
    return bool(q and any("groq:" + m not in _MUERTOS for m in lista(cfg["ia"]["modelo_groq"])))
