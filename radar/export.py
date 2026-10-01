"""Genera los datos (cifrados) que lee la web."""
from __future__ import annotations

import datetime as dt
import gzip
import json
from pathlib import Path

from .competencia import por_familia, similares

ABIERTOS = ("PUB", "PRE", "EV", "EV_PRE")


HIST_CAMPOS = ["fecha", "titulo", "lote", "lote_nombre", "organo", "ccaa", "provincia", "tipo", "cpv", "presupuesto",
               "importe", "baja", "ofertas", "ganador", "ganador_nif", "enlace", "familia", "procedimiento", "ai", "duracion"]


def _escribir(ruta: Path, obj, cif) -> int:
    """Guarda obj comprimido (y cifrado si hay contraseña). Devuelve bytes escritos."""
    crudo = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode())
    if cif:
        ruta = ruta.with_suffix(".enc")
        ruta.write_text(json.dumps(cif.cifrar(crudo)))
    else:
        ruta = ruta.with_suffix(".json.gz")
        ruta.write_bytes(crudo)
    return ruta.stat().st_size


def _historico(con, cfg: dict, destino: Path, cif, analisis: dict) -> list[dict]:
    """Un archivo por mes con todas las adjudicaciones (el navegador solo baja los meses que pides)."""
    carpeta = destino / "hist"
    carpeta.mkdir(exist_ok=True)
    for viejo in carpeta.glob("*"):
        viejo.unlink()
    meses = cfg.get("historico", {}).get("meses_web", 24)
    desde = (dt.date.today().replace(day=1) - dt.timedelta(days=31 * meses)).isoformat()
    filas = con.execute("SELECT * FROM adjudicaciones WHERE fecha>=? ORDER BY fecha DESC", (desde,)).fetchall()
    por_mes: dict[str, list] = {}
    for f in filas:
        a = analisis.get(f["id"])
        ia = {"r": a.get("recomendacion"), "s": a.get("resumen"), "m": a.get("motivo")} if a else None
        fila = [f["fecha"], f["titulo"], f["lote"], f["lote_nombre"], f["organo"], f["ccaa"], f["provincia"], f["tipo"],
                f["cpv"], f["presupuesto"], f["importe"], f["baja"], f["ofertas"], f["ganador"], f["ganador_nif"],
                f["enlace"], f["familia"], f["procedimiento"], ia, f["duracion_meses"]]
        por_mes.setdefault(f["fecha"][:7], []).append(fila)
    indice, total = [], 0
    for mes, lista in sorted(por_mes.items(), reverse=True):
        if len(mes) != 7:
            continue
        total += _escribir(carpeta / mes, {"campos": HIST_CAMPOS, "filas": lista}, cif)
        indice.append({"m": mes, "n": len(lista), "f": f"hist/{mes}{'.enc' if cif else '.json.gz'}"})
    print(f"[web] histórico: {len(filas)} adjudicaciones en {len(indice)} meses ({total // 1024} KB)")
    return indice


def construir(con, cfg: dict, destino: str | Path, clave: str | None) -> dict:
    from .privado import Cifrador
    destino = Path(destino)
    destino.mkdir(parents=True, exist_ok=True)
    cif = Cifrador(clave) if clave else None
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
        "hist": _historico(con, cfg, destino, cif, analisis),
        "totales": {
            "abiertas": len(lic),
            "A": sum(1 for x in lic if x["pa"] == "A"),
            "B": sum(1 for x in lic if x["pa"] == "B"),
            "analizadas": sum(1 for x in lic if x["ai"]),
            "adjudicaciones": con.execute("SELECT COUNT(*) FROM adjudicaciones").fetchone()[0],
        },
    }
    (destino / "data.enc").unlink(missing_ok=True)
    (destino / "data.json.gz").unlink(missing_ok=True)
    tam = _escribir(destino / "data", datos, cif)
    print(f"[web] {len(lic)} licitaciones abiertas exportadas ({tam // 1024} KB){' cifradas' if cif else ' SIN cifrar'}")
    return datos["totales"]
