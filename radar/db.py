"""Base de datos SQLite del radar."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ESQUEMA = """
CREATE TABLE IF NOT EXISTS licitaciones (
    id TEXT PRIMARY KEY,
    actualizado TEXT,
    primera_vez TEXT,
    estado TEXT,
    tipo TEXT,
    titulo TEXT,
    organo TEXT,
    expediente TEXT,
    ccaa TEXT,
    provincia TEXT,
    importe REAL,
    valor_estimado REAL,
    fecha_fin TEXT,
    procedimiento TEXT,
    armonizado INTEGER,
    peso_precio REAL,
    cpv TEXT,
    fuente TEXT,
    enlace TEXT,
    puntuacion INTEGER,
    prioridad TEXT,
    familia TEXT,
    motivos TEXT,
    data TEXT
);
CREATE INDEX IF NOT EXISTS ix_lic_estado ON licitaciones(estado, fecha_fin);
CREATE INDEX IF NOT EXISTS ix_lic_prio ON licitaciones(prioridad);

CREATE TABLE IF NOT EXISTS analisis (
    id TEXT PRIMARY KEY,
    fecha TEXT,
    modelo TEXT,
    data TEXT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS adjudicaciones (
    id TEXT,
    lote TEXT,
    fecha TEXT,
    ganador TEXT,
    ganador_nif TEXT,
    importe REAL,
    presupuesto REAL,
    baja REAL,
    ofertas REAL,
    cpv TEXT,
    familia TEXT,
    organo TEXT,
    ccaa TEXT,
    provincia TEXT,
    titulo TEXT,
    enlace TEXT,
    PRIMARY KEY (id, lote, ganador_nif)
);
CREATE INDEX IF NOT EXISTS ix_adj_fam ON adjudicaciones(familia);
CREATE INDEX IF NOT EXISTS ix_adj_nif ON adjudicaciones(ganador_nif);

CREATE TABLE IF NOT EXISTS estado (
    clave TEXT PRIMARY KEY,
    valor TEXT
);
"""


def conectar(ruta: str | Path) -> sqlite3.Connection:
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(ruta))
    con.row_factory = sqlite3.Row
    con.executescript(ESQUEMA)
    return con


def get_estado(con, clave: str, defecto: str = "") -> str:
    r = con.execute("SELECT valor FROM estado WHERE clave=?", (clave,)).fetchone()
    return r["valor"] if r else defecto


def set_estado(con, clave: str, valor: str) -> None:
    con.execute("INSERT INTO estado(clave, valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
                (clave, valor))


def guardar_licitacion(con, it: dict, puntuacion: dict, ahora: str) -> bool:
    """Inserta o actualiza. Devuelve True si es nueva."""
    previa = con.execute("SELECT primera_vez, actualizado FROM licitaciones WHERE id=?", (it["id"],)).fetchone()
    if previa and previa["actualizado"] and previa["actualizado"] >= it["actualizado"]:
        return False  # ya teníamos una versión igual o más nueva
    primera = previa["primera_vez"] if previa else ahora
    con.execute(
        """INSERT INTO licitaciones(id, actualizado, primera_vez, estado, tipo, titulo, organo, expediente, ccaa,
               provincia, importe, valor_estimado, fecha_fin, procedimiento, armonizado, peso_precio, cpv, fuente,
               enlace, puntuacion, prioridad, familia, motivos, data)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET actualizado=excluded.actualizado, estado=excluded.estado,
               tipo=excluded.tipo, titulo=excluded.titulo, organo=excluded.organo, expediente=excluded.expediente,
               ccaa=excluded.ccaa, provincia=excluded.provincia, importe=excluded.importe,
               valor_estimado=excluded.valor_estimado, fecha_fin=excluded.fecha_fin,
               procedimiento=excluded.procedimiento, armonizado=excluded.armonizado,
               peso_precio=excluded.peso_precio, cpv=excluded.cpv, fuente=excluded.fuente, enlace=excluded.enlace,
               puntuacion=excluded.puntuacion, prioridad=excluded.prioridad, familia=excluded.familia,
               motivos=excluded.motivos, data=excluded.data""",
        (it["id"], it["actualizado"], primera, it["estado"], it["tipo"], it["titulo"], it["organo"],
         it["expediente"], it["ccaa"], it["provincia"], it["importe"], it["valor_estimado"], it["fecha_fin"],
         it["procedimiento_txt"], int(it["armonizado"]), it["peso_precio"], ",".join(it["cpv"]), it["fuente"],
         it["enlace"], puntuacion["nota"], puntuacion["prioridad"], puntuacion["familia"],
         json.dumps(puntuacion["motivos"], ensure_ascii=False), json.dumps(it, ensure_ascii=False)))
    return previa is None


def guardar_adjudicaciones(con, it: dict, familia: str) -> int:
    n = 0
    presup_lote = {l["id"]: l["importe"] for l in it.get("lotes", [])}
    for r in it.get("resultados", []):
        if not r.get("ganador") or r.get("importe") is None:
            continue
        presupuesto = presup_lote.get(r.get("lote") or "", None) or it.get("importe")
        baja = None
        if presupuesto and presupuesto > 0 and r["importe"] is not None and r["importe"] <= presupuesto * 1.5:
            baja = round(100 * (1 - r["importe"] / presupuesto), 2)
        con.execute(
            """INSERT OR REPLACE INTO adjudicaciones(id, lote, fecha, ganador, ganador_nif, importe, presupuesto, baja,
                   ofertas, cpv, familia, organo, ccaa, provincia, titulo, enlace)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (it["id"], r.get("lote") or "", r.get("fecha"), r["ganador"], r.get("ganador_nif") or r["ganador"],
             r["importe"], presupuesto, baja, r.get("ofertas"), ",".join(it["cpv"][:5]), familia, it["organo"],
             it["ccaa"], it["provincia"], it["titulo"][:300], it["enlace"]))
        n += 1
    return n
