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
import signal
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).parent
sys.path.insert(0, str(RAIZ))

from radar import ai, notify  # noqa: E402
from radar.backfill import cargar_meses, meses_atras  # noqa: E402
from radar.db import conectar, get_estado, set_estado  # noqa: E402
from radar.docs import obtener_pliegos  # noqa: E402
from radar.export import construir  # noqa: E402
from radar.fetch import actualizar, cargar_fichero  # noqa: E402
from radar.privado import abrir_db, cargar_config, cerrar_db  # noqa: E402

INICIO = time.time()  # para no pasarnos del tiempo máximo de GitHub (330 min) y publicar siempre la web

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
    # los fallos se reintentan pasadas 6 horas
    reintento = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).isoformat(timespec="seconds")
    filas = con.execute(
        """SELECT l.* FROM licitaciones l LEFT JOIN analisis a ON a.id=l.id
           WHERE l.estado='PUB' AND l.fecha_fin>=? AND l.puntuacion>=? AND (a.id IS NULL OR (a.data IS NULL AND (a.fecha<? OR a.error LIKE '%no longer available%' OR a.error LIKE '%límite de uso%')))
           ORDER BY l.puntuacion DESC, l.fecha_fin ASC LIMIT ?""",
        (hoy, c["ia"]["nota_minima_para_analizar"], reintento, n)).fetchall()
    # Las A abiertas analizadas con la versión anterior (sin lista de artículos) se repasan poco a poco
    # (se reservan unos huecos en cada ejecución para que no esperen a que se acaben las nuevas)
    hueco = min(c["ia"].get("reanalizar_por_ejecucion", 6), n)
    if hueco > 0:
        repaso = con.execute(
            """SELECT l.* FROM licitaciones l JOIN analisis a ON a.id=l.id
               WHERE l.estado='PUB' AND l.fecha_fin>=? AND l.prioridad='A' AND a.data IS NOT NULL
                 AND IFNULL(json_extract(a.data, '$._v'), 0) < 3
               ORDER BY l.puntuacion DESC, l.fecha_fin ASC LIMIT ?""", (hoy, hueco)).fetchall()
        filas = list(filas)[:n - len(repaso)] + repaso
    # Analizar (o repetir) una licitación concreta: LICITACION = enlace o número del expediente/identificador
    pedida = os.environ.get("LICITACION", "").strip()
    if pedida:
        cola = pedida.rstrip("/").rsplit("/", 1)[-1]
        filas = con.execute("SELECT * FROM licitaciones WHERE id=? OR expediente=? OR (length(?)>=6 AND id LIKE ?) LIMIT 3",
                            (pedida, pedida, cola, "%/" + cola)).fetchall()
        print(f"[IA] licitación pedida: {pedida} -> {len(filas)} encontrada(s)")
    hechos = 0
    t0 = time.time()
    max_min = c["ia"].get("minutos_max", 45)
    for f in filas:
        if (time.time() - t0) / 60 > max_min or (time.time() - INICIO) / 60 > 280:
            print(f"[IA] tiempo máximo alcanzado: sigo en la próxima ejecución")
            break
        it = json.loads(f["data"])
        print(f"[IA] {f['puntuacion']} {it['titulo'][:80]}")
        ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        try:
            pliegos = obtener_pliegos(it)
            res, modelo = ai.analizar(it, pliegos, c)
            res["_pliegos_leidos"] = [p["nombre"] for p in pliegos]
            if pedida:  # en una prueba se enseña el análisis completo en el registro
                print(json.dumps({"modelo": modelo, **res}, ensure_ascii=False, indent=1)[:6000])
            con.execute("INSERT OR REPLACE INTO analisis(id, fecha, modelo, data, error) VALUES(?,?,?,?,NULL)",
                        (f["id"], ahora, modelo, json.dumps(res, ensure_ascii=False)))
            hechos += 1
        except ai.SinIA as ex:
            # sin modelos disponibles (cuota diaria agotada, claves...): no marcamos la licitación, se reintenta luego
            print("   [IA] ningún modelo disponible ahora; se reintenta en la próxima ejecución:", str(ex)[:300])
            break
        except Exception as ex:
            print("   error:", str(ex)[:400])
            con.execute("INSERT OR REPLACE INTO analisis(id, fecha, modelo, data, error) VALUES(?,?,?,NULL,?)",
                        (f["id"], ahora, "", str(ex)[:500]))
        con.commit()
        time.sleep(c["ia"]["pausa_segundos"])
    print(f"[IA] {hechos} análisis nuevos")
    return hechos


def limpiar(con, c: dict) -> None:
    """Borra lo viejo: licitaciones cerradas hace más de 60 días (las A/B se guardan 8 meses para saber quién las
    ganó; las analizadas con IA, todo el histórico) y adjudicaciones más antiguas que historico.meses_guardar."""
    hoy = dt.date.today()
    lim = (hoy - dt.timedelta(days=60)).isoformat()
    lim_ab = (hoy - dt.timedelta(days=240)).isoformat()
    meses = c.get("historico", {}).get("meses_guardar", 24)
    lim_hist = (hoy - dt.timedelta(days=31 * meses)).isoformat()
    con.execute("""DELETE FROM licitaciones WHERE estado NOT IN ('PUB','PRE','EV','EV_PRE') AND fecha_fin<?
                   AND (prioridad NOT IN ('A','B') OR fecha_fin<?)
                   AND (id NOT IN (SELECT id FROM analisis WHERE data IS NOT NULL) OR fecha_fin<?)""", (lim, lim_ab, lim_hist))
    con.execute("DELETE FROM analisis WHERE id NOT IN (SELECT id FROM licitaciones)")
    con.execute("DELETE FROM adjudicaciones WHERE fecha<?", (lim_hist,))
    con.commit()
    con.execute("VACUUM")


def historico(con, c: dict, meses: int, max_meses: int | None = None, incluir_actual: bool = True,
              limite_min: float | None = None) -> int:
    """Carga los meses del histórico oficial que falten, del más reciente al más antiguo.
    Los meses ya completos se recuerdan y no se vuelven a descargar."""
    hechos = set(json.loads(get_estado(con, "hist_cargados") or "[]"))
    actual = dt.date.today().strftime("%Y%m")
    inicio, n = time.time(), 0
    pendientes = [ym for ym in meses_atras(meses)
                  if not (ym == actual and not incluir_actual) and not (ym in hechos and ym != actual)]
    if max_meses is not None:
        pendientes = pendientes[:max_meses]
    lote = c.get("historico", {}).get("descargas_simultaneas", 4)
    for i in range(0, len(pendientes), lote):
        if limite_min and (time.time() - inicio) / 60 > limite_min:
            print("[histórico] se acaba el tiempo de esta ejecución; seguirá en la próxima")
            break
        grupo = pendientes[i:i + lote]
        for ym, res in cargar_meses(con, c, grupo, paralelo=lote).items():
            n += 1 if res else 0
            if ym != actual and "estado" in res:
                hechos.add(ym)
        set_estado(con, "hist_cargados", json.dumps(sorted(hechos)))
        con.commit()
    print(f"[histórico] {n} meses cargados; completos: {len(hechos)}")
    return n


def main(argv: list[str]) -> int:
    orden = argv[1] if len(argv) > 1 else "todo"
    c = cfg()
    clave = os.environ.get("SITE_PASSWORD") or None
    DB.parent.mkdir(exist_ok=True)
    abrir_db(DB, clave)
    con = conectar(DB)
    web_url = os.environ.get("RADAR_URL", "")
    h = c.get("historico", {})
    errores: list[str] = []

    def fase(nombre: str, fn, *a, **k):
        """Ejecuta una fase; si falla, lo apunta y sigue (no se pierde lo ya hecho)."""
        t0 = time.time()
        try:
            r = fn(*a, **k)
            print(f"[radar] {nombre}: ok ({time.time() - t0:.0f} s)", flush=True)
            return r
        except Exception as ex:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            con.rollback()
            errores.append(f"{nombre}: {type(ex).__name__}: {ex}")
            print(f"::warning::{nombre} falló: {ex}", flush=True)
            return None

    def punto_de_guardado():
        """Copia cifrada intermedia: si la ejecución se corta después, no se pierde lo descargado."""
        try:
            con.commit()
            cerrar_db(DB, clave)
        except Exception as ex:  # noqa: BLE001
            print(f"::warning::no se pudo guardar la copia intermedia: {ex}", flush=True)

    # GitHub corta con SIGTERM al pasarse del tiempo o al cancelar: lo tratamos como Ctrl+C para cerrar bien
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))

    try:
        if orden == "todo" and not con.execute("SELECT 1 FROM licitaciones LIMIT 1").fetchone():
            # base de datos nueva (o perdida): el mes en curso trae las licitaciones abiertas
            print("[radar] base de datos vacía: cargo el mes en curso")
            fase("histórico (mes en curso)", historico, con, c, 0)
        if orden in ("actualizar", "todo"):
            fase("novedades de la Plataforma", actualizar, con, c)
            punto_de_guardado()
        if orden == "todo":
            # el histórico se completa solo, poco a poco (un mes pasado por ejecución)
            fase("histórico (un mes más)", historico, con, c, h.get("meses_guardar", 24),
                 max_meses=h.get("meses_por_ejecucion", 1), incluir_actual=False)
            punto_de_guardado()
        if orden in ("analizar", "todo"):
            fase("análisis IA", analizar, con, c, int(argv[2]) if len(argv) > 2 and orden == "analizar" else None)
        if orden == "historico":
            fase("histórico", historico, con, c, int(argv[2]) if len(argv) > 2 else 12,
                 limite_min=h.get("minutos_max_historico", 230))
            punto_de_guardado()
        if orden == "cargar":
            print(cargar_fichero(con, argv[2], c, argv[3] if len(argv) > 3 else "fichero"))
        if orden in ("todo", "historico"):
            fase("limpieza", limpiar, con, c)
        if orden in ("web", "todo", "historico", "cargar", "actualizar", "analizar"):
            fase("web", construir, con, c, SITE, clave)
        if orden in ("avisar", "todo"):
            fase("avisos", avisar, con, c, web_url)
    finally:
        con.close()
        cerrar_db(DB, clave)
    if errores:
        print("[radar] terminado con errores:\n  - " + "\n  - ".join(errores))
        return 1
    print("[radar] terminado sin errores")
    return 0


def avisar(con, c: dict, web_url: str) -> None:
    if c["alertas"].get("telegram"):
        notify.chat_telegram(con)  # la primera vez detecta tu chat y te manda un mensaje de bienvenida
    desde = get_estado(con, "ultimo_aviso") or None
    texto, n = notify.resumen(con, c, desde=desde, web=web_url)
    if n:
        if c["alertas"].get("telegram"):
            print("[aviso] telegram:", "enviado" if notify.telegram(texto, con) else "no enviado (¿falta TELEGRAM_TOKEN o escribir «hola» al bot?)")
        if c["alertas"].get("email"):
            print("[aviso] email:", notify.email(texto, f"Radar BadBen23: {n} licitaciones nuevas"))
    else:
        print("[aviso] nada nuevo que avisar")
    set_estado(con, "ultimo_aviso", dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    con.commit()
    semana = dt.date.today().strftime("%G-%V")
    if dt.date.today().weekday() == 0 and get_estado(con, "aviso_renovaciones") != semana:
        texto, n = notify.renovaciones(con, c, web=web_url)
        if n and c["alertas"].get("telegram"):
            print("[aviso] renovaciones telegram:", notify.telegram(texto, con))
        if n and c["alertas"].get("email"):
            print("[aviso] renovaciones email:", notify.email(texto, f"Radar BadBen23: {n} contratos vencen pronto"))
        set_estado(con, "aviso_renovaciones", semana)
        con.commit()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
