"""Radar de licitaciones BadBen23.

Uso:
  python run.py todo              -> actualiza, analiza con IA, genera la web y avisa
  python run.py actualizar        -> solo descarga novedades de la Plataforma
  python run.py analizar [N]      -> analiza con IA las N mejores pendientes
  python run.py web               -> genera los datos de la web (carpeta site/)
  python run.py avisar            -> manda el resumen por Telegram / correo
  python run.py historico 6       -> carga los últimos 6 meses (competencia)
  python run.py cargar fichero.atom
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).parent
sys.path.insert(0, str(RAIZ))

from radar import ai, notify  # noqa: E402
from radar.backfill import cargar_mes, meses_atras  # noqa: E402
from radar.db import conectar, get_estado, set_estado  # noqa: E402
from radar.docs import obtener_pliegos  # noqa: E402
from radar.export import construir  # noqa: E402
from radar.fetch import actualizar, cargar_fichero  # noqa: E402
from radar.privado import abrir_db, cargar_config, cerrar_db  # noqa: E402

DB = RAIZ / "data" / "radar.db"
SITE = RAIZ / "site"


def cfg() -> dict:
    return cargar_config(RAIZ)


def analizar(con, c: dict, n: int | None = None) -> int:
    if not ai.disponible():
        print("[IA] sin GEMINI_API_KEY ni GROQ_API_KEY: se omite el análisis")
        return 0
    n = n or c["ia"]["max_analisis_por_ejecucion"]
    hoy = dt.date.today().isoformat()
    filas = con.execute(
        """SELECT l.* FROM licitaciones l LEFT JOIN analisis a ON a.id=l.id
           WHERE l.estado='PUB' AND l.fecha_fin>=? AND l.puntuacion>=? AND (a.id IS NULL OR (a.data IS NULL AND a.fecha<?))
           ORDER BY l.puntuacion DESC, l.fecha_fin ASC LIMIT ?""",
        (hoy, c["ia"]["nota_minima_para_analizar"], hoy, n)).fetchall()
    hechos = 0
    for f in filas:
        it = json.loads(f["data"])
        print(f"[IA] {f['puntuacion']} {it['titulo'][:80]}")
        ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        try:
            pliegos = obtener_pliegos(it)
            res, modelo = ai.analizar(it, pliegos, c)
            res["_pliegos_leidos"] = [p["nombre"] for p in pliegos]
            con.execute("INSERT OR REPLACE INTO analisis(id, fecha, modelo, data, error) VALUES(?,?,?,?,NULL)",
                        (f["id"], ahora, modelo, json.dumps(res, ensure_ascii=False)))
            hechos += 1
        except Exception as ex:
            print("   error:", ex)
            con.execute("INSERT OR REPLACE INTO analisis(id, fecha, modelo, data, error) VALUES(?,?,?,NULL,?)",
                        (f["id"], ahora, "", str(ex)[:500]))
        con.commit()
        time.sleep(c["ia"]["pausa_segundos"])
    print(f"[IA] {hechos} análisis nuevos")
    return hechos


def limpiar(con, c: dict) -> None:
    """Borra lo viejo: licitaciones cerradas hace más de 60 días (salvo las analizadas con IA, que se guardan
    para el histórico) y adjudicaciones más antiguas que historico.meses_guardar."""
    hoy = dt.date.today()
    lim = (hoy - dt.timedelta(days=60)).isoformat()
    meses = c.get("historico", {}).get("meses_guardar", 24)
    lim_hist = (hoy - dt.timedelta(days=31 * meses)).isoformat()
    con.execute("""DELETE FROM licitaciones WHERE estado NOT IN ('PUB','PRE','EV','EV_PRE') AND fecha_fin<?
                   AND (id NOT IN (SELECT id FROM analisis WHERE data IS NOT NULL) OR fecha_fin<?)""", (lim, lim_hist))
    con.execute("DELETE FROM analisis WHERE id NOT IN (SELECT id FROM licitaciones)")
    con.execute("DELETE FROM adjudicaciones WHERE fecha<?", (lim_hist,))
    con.commit()
    con.execute("VACUUM")


def historico(con, c: dict, meses: int) -> None:
    for ym in meses_atras(meses):
        cargar_mes(con, c, ym)


def main(argv: list[str]) -> None:
    orden = argv[1] if len(argv) > 1 else "todo"
    c = cfg()
    clave = os.environ.get("SITE_PASSWORD") or None
    DB.parent.mkdir(exist_ok=True)
    abrir_db(DB, clave)
    con = conectar(DB)
    web_url = os.environ.get("RADAR_URL", "")
    if orden == "todo" and not con.execute("SELECT 1 FROM adjudicaciones LIMIT 1").fetchone():
        # base de datos nueva (o perdida): carga sola los últimos meses para tener histórico y abiertas
        print("[radar] base de datos vacía: cargo el histórico reciente")
        historico(con, c, c.get("historico", {}).get("meses_carga_automatica", 3))
    if orden in ("actualizar", "todo"):
        actualizar(con, c)
    if orden in ("analizar", "todo"):
        analizar(con, c, int(argv[2]) if len(argv) > 2 and orden == "analizar" else None)
    if orden == "historico":
        historico(con, c, int(argv[2]) if len(argv) > 2 else 6)
    if orden == "cargar":
        print(cargar_fichero(con, argv[2], c, argv[3] if len(argv) > 3 else "fichero"))
    if orden in ("web", "todo", "historico", "cargar"):
        construir(con, c, SITE, clave)
    if orden in ("avisar", "todo"):
        desde = get_estado(con, "ultimo_aviso") or None
        texto, n = notify.resumen(con, c, desde=desde, web=web_url)
        set_estado(con, "ultimo_aviso", dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
        con.commit()
        if n:
            if c["alertas"].get("telegram"):
                print("[aviso] telegram:", notify.telegram(texto))
            if c["alertas"].get("email"):
                print("[aviso] email:", notify.email(texto, f"Radar BadBen23: {n} licitaciones nuevas"))
        else:
            print("[aviso] nada nuevo que avisar")
    if orden in ("todo", "historico"):
        limpiar(con, c)
    con.close()
    cerrar_db(DB, clave)


if __name__ == "__main__":
    main(sys.argv)
