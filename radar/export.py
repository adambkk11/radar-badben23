"""Genera los datos (cifrados) que lee la web."""
from __future__ import annotations

import base64
import datetime as dt
import gzip
import json
import os
from pathlib import Path

from .competencia import por_familia, similares

ABIERTOS = ("PUB", "PRE", "EV", "EV_PRE")


def _cifrar(datos: bytes, clave: str) -> dict:
    from .privado import cifrar
    return cifrar(datos, clave)


def construir(con, cfg: dict, destino: str | Path, clave: str | None) -> dict:
    destino = Path(destino)
    destino.mkdir(parents=True, exist_ok=True)
    hoy = dt.date.today().isoformat()
    analisis = {r["id"]: json.loads(r["data"]) for r in con.execute("SELECT id, data FROM analisis WHERE data IS NOT NULL")}

    filas = con.execute(
        f"SELECT * FROM licitaciones WHERE estado IN ({','.join('?' * len(ABIERTOS))}) AND (fecha_fin IS NULL OR fecha_fin='' OR fecha_fin>=?)",
        (*ABIERTOS, hoy)).fetchall()
    lic = []
    for f in filas:
        d = json.loads(f["data"])
        lic.append({
            "id": f["id"], "t": d["titulo"], "o": d["organo"], "x": d["expediente"], "e": d["estado"],
            "ca": d["ccaa"], "pr": d["provincia"], "mu": d.get("municipio", ""),
            "i": d["importe"], "ve": d["valor_estimado"], "ff": d["fecha_fin"], "hf": d["hora_fin"],
            "p": d["procedimiento_txt"], "s": d.get("sistema", ""), "a": d["armonizado"], "pp": d["peso_precio"],
            "cpv": d["cpv"][:6], "f": f["familia"], "n": f["puntuacion"], "pa": f["prioridad"],
            "m": json.loads(f["motivos"] or "[]"), "u": d["enlace"], "pf": d.get("perfil", ""),
            "l": [{"id": l["id"], "n": l["nombre"], "i": l["importe"], "pp": l.get("peso_precio")} for l in d.get("lotes", [])][:60],
            "c": d.get("criterios", [])[:12], "rq": d.get("requisitos", {}), "d": d.get("documentos", [])[:8],
            "du": d.get("duracion", ""), "mx": d.get("mixto", False), "ur": d.get("urgencia", ""),
            "id1": d.get("idiomas", []), "nv": f["primera_vez"][:10] if f["primera_vez"] else "",
            "ai": analisis.get(f["id"]), "sim": similares(con, f) if f["familia"] and f["prioridad"] in ("A", "B") else [],
        })
    lic.sort(key=lambda x: (-x["n"], x["ff"] or "9999"))

    fams = {k: {"nombre": v["nombre"], "socio": v.get("socio", "")} for k, v in cfg["familias"].items()}
    datos = {
        "generado": dt.datetime.now().isoformat(timespec="minutes"),
        "empresa": cfg["empresa"]["nombre"],
        "familias": fams,
        "licitaciones": lic,
        "competencia": por_familia(con, cfg["familias"]),
        "totales": {
            "abiertas": len(lic),
            "A": sum(1 for x in lic if x["pa"] == "A"),
            "B": sum(1 for x in lic if x["pa"] == "B"),
            "analizadas": sum(1 for x in lic if x["ai"]),
            "adjudicaciones": con.execute("SELECT COUNT(*) FROM adjudicaciones").fetchone()[0],
        },
    }
    crudo = gzip.compress(json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode())
    if clave:
        (destino / "data.enc").write_text(json.dumps(_cifrar(crudo, clave)))
        (destino / "data.json.gz").unlink(missing_ok=True)
    else:
        (destino / "data.json.gz").write_bytes(crudo)
        (destino / "data.enc").unlink(missing_ok=True)
    print(f"[web] {len(lic)} licitaciones abiertas exportadas ({len(crudo) // 1024} KB comprimido)"
          f"{' cifradas' if clave else ' SIN cifrar'}")
    return datos["totales"]
