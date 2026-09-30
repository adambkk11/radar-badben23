"""Inteligencia de competencia a partir de las adjudicaciones guardadas."""
from __future__ import annotations

import statistics as st


def _mediana(v):
    v = [x for x in v if x is not None]
    return round(st.median(v), 1) if v else None


def _media(v):
    v = [x for x in v if x is not None]
    return round(sum(v) / len(v), 1) if v else None


def por_familia(con, familias: dict) -> dict:
    out = {}
    for clave, fam in familias.items():
        filas = con.execute("SELECT * FROM adjudicaciones WHERE familia=? AND baja IS NOT NULL AND baja BETWEEN -5 AND 90",
                            (clave,)).fetchall()
        if not filas:
            out[clave] = {"nombre": fam["nombre"], "n": 0}
            continue
        ganadores = {}
        for f in filas:
            g = ganadores.setdefault(f["ganador_nif"], {"nombre": f["ganador"], "nif": f["ganador_nif"], "n": 0,
                                                         "importe": 0.0, "bajas": [], "ccaa": set()})
            g["n"] += 1
            g["importe"] += f["importe"] or 0
            g["bajas"].append(f["baja"])
            if f["ccaa"]:
                g["ccaa"].add(f["ccaa"])
        top = sorted(ganadores.values(), key=lambda g: (-g["n"], -g["importe"]))[:15]
        out[clave] = {
            "nombre": fam["nombre"],
            "n": len(filas),
            "baja_media": _media([f["baja"] for f in filas]),
            "baja_mediana": _mediana([f["baja"] for f in filas]),
            "ofertas_media": _media([f["ofertas"] for f in filas]),
            "ganadores": [{"nombre": g["nombre"], "nif": g["nif"], "n": g["n"], "importe": round(g["importe"]),
                           "baja_media": _media(g["bajas"]), "ccaa": sorted(g["ccaa"])[:5]} for g in top],
        }
    return out


def similares(con, it_row, limite: int = 6) -> list[dict]:
    """Adjudicaciones parecidas: mismo órgano primero, luego misma familia y comunidad."""
    res = []
    vistos = set()
    consultas = [
        ("SELECT * FROM adjudicaciones WHERE organo=? AND familia=? ORDER BY fecha DESC LIMIT ?",
         (it_row["organo"], it_row["familia"], limite)),
        ("SELECT * FROM adjudicaciones WHERE familia=? AND ccaa=? ORDER BY fecha DESC LIMIT ?",
         (it_row["familia"], it_row["ccaa"], limite)),
    ]
    for q, p in consultas:
        if not it_row["familia"]:
            break
        for f in con.execute(q, p):
            k = (f["id"], f["lote"], f["ganador_nif"])
            if k in vistos:
                continue
            vistos.add(k)
            res.append({"titulo": f["titulo"][:140], "organo": f["organo"], "ganador": f["ganador"],
                        "importe": f["importe"], "presupuesto": f["presupuesto"], "baja": f["baja"],
                        "ofertas": f["ofertas"], "fecha": f["fecha"], "enlace": f["enlace"]})
            if len(res) >= limite:
                return res
    return res


def empresa(con, nif: str) -> dict:
    filas = con.execute("SELECT * FROM adjudicaciones WHERE ganador_nif=? ORDER BY fecha DESC", (nif,)).fetchall()
    return {"n": len(filas), "importe": round(sum(f["importe"] or 0 for f in filas)),
            "baja_media": _media([f["baja"] for f in filas])}
