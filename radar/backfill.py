"""Carga del histórico mensual oficial (ZIP) para tener adjudicaciones y competencia."""
from __future__ import annotations

import datetime as dt
import os
import tempfile
import time
import zipfile

import requests

from .fetch import UA, procesar_items
from .parser import parse_feed

URLS = [
    ("estado", "https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_{ym}.zip"),
    ("agregadas", "https://contrataciondelestado.es/sindicacion/sindicacion_1044/PlataformasAgregadasSinMenores_{ym}.zip"),
]


def meses_atras(n: int, hoy: dt.date | None = None) -> list[str]:
    hoy = hoy or dt.date.today()
    y, m = hoy.year, hoy.month
    out = [f"{y}{m:02d}"]  # el mes en curso primero (licitaciones abiertas ahora)
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y}{m:02d}")
    return out


def _bajar(url: str) -> str | None:
    """Descarga el ZIP a un temporal. Devuelve la ruta o None si no está disponible o llega dañado."""
    for intento in range(3):
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            ruta = tmp.name
            try:
                with requests.get(url, headers={"User-Agent": UA}, stream=True, timeout=(30, 300)) as r:
                    if r.status_code != 200:
                        print(f"  no disponible (HTTP {r.status_code})")
                        os.unlink(ruta)
                        return None
                    for chunk in r.iter_content(1 << 20):
                        tmp.write(chunk)
            except requests.RequestException as ex:
                print(f"  error de descarga (intento {intento + 1}):", ex)
                os.unlink(ruta)
                continue
        if zipfile.is_zipfile(ruta):
            return ruta
        with open(ruta, "rb") as f:
            inicio = f.read(200)
        os.unlink(ruta)
        if b"<html" in inicio.lower() or b"<!doctype" in inicio.lower():
            print("  no disponible todavía (la Plataforma devuelve una página, no un ZIP)")
            return None
        print(f"  ZIP incompleto, reintento {intento + 1}")
    return None


def _procesar_zip(con, cfg: dict, ruta: str, nombre: str, ahora: str) -> dict:
    tot = [0, 0, 0]
    t0 = time.time()
    try:
        with zipfile.ZipFile(ruta) as z:
            atoms = [n for n in z.namelist() if n.endswith(".atom")]
            for i, n in enumerate(atoms, 1):
                items, _, _ = parse_feed(z.read(n), nombre)
                a, b, c = procesar_items(con, items, cfg, ahora)
                tot = [tot[0] + a, tot[1] + b, tot[2] + c]
                con.commit()
                if i % 25 == 0 or i == len(atoms):
                    print(f"  {i}/{len(atoms)} archivos · {time.time() - t0:.0f} s · {tot[2]} adjudicaciones")
    except zipfile.BadZipFile as ex:
        print("  ZIP dañado:", ex)
    finally:
        os.unlink(ruta)
    return {"nuevas": tot[0], "actualizadas": tot[1], "adjudicaciones": tot[2]}


def cargar_meses(con, cfg: dict, meses: list[str], paralelo: int = 4):
    """Descarga varios meses a la vez (la Plataforma sirve cada descarga despacio) y los procesa en orden.
    Devuelve {mes: {feed: resumen}}."""
    from concurrent.futures import ThreadPoolExecutor
    ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    tareas = [(ym, nombre, patron.format(ym=ym)) for ym in meses for nombre, patron in URLS]

    def bajar(t):
        t0 = time.time()
        ruta = _bajar(t[2])
        if ruta:
            print(f"[histórico] descargado {t[1]} {t[0]}: {os.path.getsize(ruta) // 1048576} MB en {time.time() - t0:.0f} s")
        else:
            print(f"[histórico] {t[1]} {t[0]}: no disponible")
        return ruta

    res: dict[str, dict] = {ym: {} for ym in meses}
    with ThreadPoolExecutor(max_workers=max(1, paralelo)) as ex:
        futuros = [(t, ex.submit(bajar, t)) for t in tareas]
        for (ym, nombre, _), fut in futuros:
            ruta = fut.result()
            if not ruta:
                continue
            print(f"[histórico] procesando {nombre} {ym}")
            res[ym][nombre] = _procesar_zip(con, cfg, ruta, nombre, ahora)
            print("  ", res[ym][nombre])
    return res


def cargar_mes(con, cfg: dict, ym: str) -> dict:
    return cargar_meses(con, cfg, [ym], paralelo=2)[ym]
