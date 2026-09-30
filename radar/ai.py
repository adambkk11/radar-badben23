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


def _gemini(prompt: str, pdfs: list[bytes], modelo: str, clave: str) -> dict:
    partes = [{"text": prompt}]
    for p in pdfs:
        partes.append({"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(p).decode()}})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
    body = {"contents": [{"parts": partes}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}
    for intento in range(3):
        r = requests.post(url, json=body, headers={"x-goog-api-key": clave}, timeout=300)
        if r.status_code in (429, 503):
            time.sleep(40 * (intento + 1))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        j = r.json()
        txt = j["candidates"][0]["content"]["parts"][0]["text"]
        return _json(txt)
    raise RuntimeError("Gemini: límite de uso alcanzado")


def _groq(prompt: str, modelo: str, clave: str) -> dict:
    r = requests.post("https://api.groq.com/openai/v1/chat/completions",
                      headers={"Authorization": f"Bearer {clave}"},
                      json={"model": modelo, "temperature": 0.2, "response_format": {"type": "json_object"},
                            "messages": [{"role": "user", "content": prompt}]}, timeout=300)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    return _json(r.json()["choices"][0]["message"]["content"])


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
    if g:
        pdfs = [p for p in pdf_escaneados if len(p) < 15 * 1024 * 1024][:2]
        for m in lista(ia["modelo_gemini"]):
            try:
                return _gemini(prompt, pdfs, m, g), m
            except Exception as ex:
                errores.append(f"{m}: {ex}")
    if q:
        # el plan gratuito de Groq admite pocas palabras por minuto: se recorta el pliego
        corto = PROMPT.format(empresa=cfg["empresa"]["nombre"], modelo=cfg["empresa"]["modelo"],
                              socios=socios, meta=_meta(it), texto=texto[:ia.get("max_caracteres_groq", 22000)])
        for m in lista(ia["modelo_groq"]):
            try:
                return _groq(corto, m, q), m
            except Exception as ex:
                errores.append(f"{m}: {ex}")
    raise RuntimeError(" | ".join(errores) or "sin clave de IA configurada")
