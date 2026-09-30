"""Puntuación automática (0-100) de cada licitación según el modelo de BadBen23."""
from __future__ import annotations

import datetime as dt
import re
import unicodedata


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _contiene(texto: str, palabra: str) -> bool:
    if len(palabra) <= 4:
        return re.search(r"\b" + re.escape(palabra) + r"\b", texto) is not None
    return palabra in texto


def detectar_familia(it: dict, cfg: dict) -> tuple[str, int, list[str]]:
    """Devuelve (clave_familia, puntos, motivos) de la familia que mejor encaja."""
    texto = _norm(it["titulo"] + " " + " ".join(l["nombre"] for l in it.get("lotes", [])))
    mejor, mejor_pts, mejor_mot = "", 0, []
    for clave, fam in cfg["familias"].items():
        pts, mot = 0, []
        cpv_hits = [c for c in it["cpv"] if any(c.startswith(p) for p in fam["cpv"])]
        principal = bool(it["cpv"]) and any(it["cpv"][0].startswith(p) for p in fam["cpv"])
        if cpv_hits:
            if principal:
                pts += fam["peso"]
                mot.append(f"CPV principal de {fam['nombre'].lower()}")
            else:
                pts += fam["peso"] // 2
                mot.append(f"algún CPV de {fam['nombre'].lower()}")
        kw = [p for p in fam["palabras"] if _contiene(texto, _norm(p))]
        if kw:
            pts += fam["peso"] if not cpv_hits else 8
            mot.append("palabras: " + ", ".join(kw[:3]))
        if pts > mejor_pts:
            mejor, mejor_pts, mejor_mot = clave, pts, mot
    return mejor, mejor_pts, mejor_mot


def puntuar(it: dict, cfg: dict, hoy: dt.date | None = None) -> dict:
    hoy = hoy or dt.date.today()
    r = cfg["reglas"]
    motivos: list[str] = []
    familia, pts, mot = detectar_familia(it, cfg)
    nota = 20 + pts
    motivos += mot
    if not familia:
        motivos.append("no encaja con ninguna familia de producto")

    cpv0 = (it.get("cpv") or [""])[0]
    todos = [p for f in cfg["familias"].values() for p in f["cpv"]]
    if cpv0 and not any(cpv0.startswith(p) for p in todos):
        for pref, pen in cfg["penalizaciones"].get("cpv_ajenos", {}).items():
            if cpv0.startswith(pref):
                nota += pen
                motivos.append(f"CPV principal {cpv0} de otro sector ({pen})")
                break

    texto = _norm(it["titulo"])
    for palabra, pen in cfg["penalizaciones"]["palabras"].items():
        if _contiene(texto, _norm(palabra)):
            nota += pen
            motivos.append(f"'{palabra}' ({pen})")

    proc = it["procedimiento_txt"]
    if proc == "Abierto simplificado":
        nota += 12
        motivos.append("simplificado (+12)")
    elif proc == "Abierto":
        nota += 3
    elif proc in ("Negociado sin publicidad", "Contrato menor", "Derivado de acuerdo marco", "Otros", "Normas internas"):
        nota -= 8
        motivos.append(f"{proc.lower()} (-8)")
    if "dinámico" in (it.get("sistema") or "").lower():
        motivos.append("sistema dinámico: alta como proveedor")

    ve = it.get("valor_estimado") or it.get("importe") or 0
    if it.get("armonizado") or ve > r["umbral_armonizado_suministros"]:
        nota -= 20
        motivos.append("armonizado/importe alto: sin excepción de empresa nueva (-20)")
    elif ve and ve <= r["valor_ideal_max"]:
        nota += 8
        motivos.append("importe asumible (+8)")
    if ve and ve < r["valor_min"]:
        nota -= 15
        motivos.append("importe muy pequeño (-15)")

    pp = it.get("peso_precio")
    if pp is not None:
        if pp >= r["peso_precio_bueno"]:
            nota += 12
            motivos.append(f"precio pesa {pp:.0f}% (+12)")
        elif pp < r["peso_precio_malo"]:
            nota -= 12
            motivos.append(f"precio solo {pp:.0f}% (-12)")

    if it.get("mixto"):
        nota -= 5
        motivos.append("contrato mixto (-5)")

    dias = None
    if it.get("fecha_fin"):
        try:
            dias = (dt.date.fromisoformat(it["fecha_fin"][:10]) - hoy).days
        except ValueError:
            pass
    if dias is not None and it["estado"] == "PUB" and dias < r["dias_minimos_para_preparar"]:
        nota -= 15
        motivos.append(f"cierra en {dias} días (-15)")

    idiomas = [i.lower() for i in it.get("idiomas") or []]
    if idiomas and "es" not in idiomas:
        nota -= 5
        motivos.append("oferta en idioma cooficial (-5)")

    nota = max(0, min(100, int(round(nota))))
    if not familia:
        nota = min(nota, 30)
    pr = "A" if nota >= cfg["prioridad"]["A"] else "B" if nota >= cfg["prioridad"]["B"] else "C"
    return {"nota": nota, "prioridad": pr, "familia": familia, "motivos": motivos, "dias": dias}
