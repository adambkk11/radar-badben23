"""Carga del histórico mensual oficial (ZIP) para tener adjudicaciones y competencia."""
from __future__ import annotations

import datetime as dt
import os
import tempfile
import zipfile

import requests

from .fetch import UA, procesar_items
from .parser import parse_feed

URLS = [
    ("estado", "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_{ym}.zip"),
    ("agregadas", "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1044/PlataformasAgregadasSinMenores_{ym}.zip"),
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


def cargar_mes(con, cfg: dict, ym: str) -> dict:
    ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    res = {}
    for nombre, patron in URLS:
        url = patron.format(ym=ym)
        print(f"[histórico] {nombre} {ym}: {url}")
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            try:
                with requests.get(url, headers={"User-Agent": UA}, stream=True, timeout=600) as r:
                    if r.status_code != 200:
                        print(f"  no disponible (HTTP {r.status_code})")
                        continue
                    for chunk in r.iter_content(1 << 20):
                        tmp.write(chunk)
            except requests.RequestException as ex:
                print("  error:", ex)
                continue
            ruta = tmp.name
        tot = [0, 0, 0]
        try:
            with zipfile.ZipFile(ruta) as z:
                for n in z.namelist():
                    if not n.endswith(".atom"):
                        continue
                    items, _, _ = parse_feed(z.read(n), nombre)
                    a, b, c = procesar_items(con, items, cfg, ahora)
                    tot = [tot[0] + a, tot[1] + b, tot[2] + c]
                    con.commit()
        finally:
            os.unlink(ruta)
        res[nombre] = {"nuevas": tot[0], "actualizadas": tot[1], "adjudicaciones": tot[2]}
        print("  ", res[nombre])
    return res
