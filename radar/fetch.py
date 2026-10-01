"""Descarga incremental de los feeds oficiales de la Plataforma de Contratación."""
from __future__ import annotations

import datetime as dt
import time

import requests

from .db import get_estado, guardar_adjudicaciones, guardar_licitacion, set_estado
from .parser import parse_feed
from .score import puntuar

ABIERTOS = {"PUB", "PRE", "EV", "EV_PRE"}


def compactar(it: dict) -> dict:
    """Versión ligera para licitaciones ya cerradas (solo lo necesario para histórico)."""
    c = dict(it)
    c["documentos"] = []
    c["requisitos"] = {}
    c["jerarquia"] = c.get("jerarquia", [])[:2]
    c["lotes"] = [{k: l[k] for k in ("id", "nombre", "importe")} for l in it.get("lotes", [])][:40]
    c["cpv"] = it["cpv"][:8]
    return c


UA = "RadarBadBen23/1.0 (+datos abiertos PLACSP; contacto oficina.badben23@gmail.com)"


def descargar(url: str, intentos: int = 4, timeout: int = 180) -> bytes:
    ultimo = None
    for i in range(intentos):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"}, timeout=timeout)
            if r.status_code == 200:
                return r.content
            ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as ex:
            ultimo = str(ex)
        espera = 10 * (i + 1)
        print(f"  reintento {i + 1} en {espera}s ({ultimo})")
        time.sleep(espera)
    raise RuntimeError(f"No se pudo descargar {url}: {ultimo}")


def procesar_items(con, items: list[dict], cfg: dict, ahora: str) -> tuple[int, int, int]:
    """Guarda licitaciones de suministro (abiertas o de nuestros productos) y TODAS las adjudicaciones
    de los tipos de contrato configurados en historico.tipos (para el buscador del histórico)."""
    nuevas = actualizadas = adjud = 0
    tipos_hist = set(cfg.get("historico", {}).get("tipos", ["1"]))
    for it in items:
        tipo = it["tipo"]
        para_hist = tipo in tipos_hist and bool(it.get("resultados"))
        para_radar = not cfg.get("solo_suministros") or tipo == "1"
        if not (para_hist or para_radar):
            continue
        p = puntuar(it, cfg)
        abierta = it["estado"] in ABIERTOS
        if para_radar and (abierta or p["familia"]):
            guardar = it if abierta else compactar(it)
            if guardar_licitacion(con, guardar, p, ahora):
                nuevas += 1
            else:
                actualizadas += 1
        if para_hist:
            adjud += guardar_adjudicaciones(con, it, p["familia"] if tipo == "1" else "")
    return nuevas, actualizadas, adjud


def actualizar(con, cfg: dict, max_paginas: int | None = None) -> dict:
    """Recorre cada feed desde lo más nuevo hasta lo último que ya teníamos."""
    ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    resumen = {}
    max_paginas = max_paginas or cfg["feeds"]["max_paginas_por_feed"]
    for nombre in ("estado", "agregadas"):
        url = cfg["feeds"][nombre]
        clave = f"ultimo_{nombre}"
        ultimo = get_estado(con, clave)
        if not ultimo:
            limite = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=cfg["feeds"]["dias_atras_primera_vez"])
            ultimo = limite.isoformat()
        mas_nuevo = None
        pag = 0
        tot = [0, 0, 0]
        vistas = set()
        while url and pag < max_paginas and url not in vistas:
            vistas.add(url)
            pag += 1
            print(f"[{nombre}] página {pag}: {url.rsplit('/', 1)[-1]}")
            items, borrados, sig = parse_feed(descargar(url), nombre)
            for b in borrados:
                con.execute("UPDATE licitaciones SET estado='ANUL' WHERE id=?", (b["id"],))
            if items:
                fechas = sorted(i["actualizado"] for i in items)
                mas_nuevo = max(mas_nuevo or "", fechas[-1])
            n, a, j = procesar_items(con, items, cfg, ahora)
            tot = [tot[0] + n, tot[1] + a, tot[2] + j]
            con.commit()
            # Paramos cuando toda la página es anterior a lo ya procesado
            if items and _comparable(min(i["actualizado"] for i in items)) <= _comparable(ultimo):
                break
            url = sig
        if mas_nuevo:
            set_estado(con, clave, mas_nuevo)
        con.commit()
        resumen[nombre] = {"paginas": pag, "nuevas": tot[0], "actualizadas": tot[1], "adjudicaciones": tot[2]}
        print(f"[{nombre}] {resumen[nombre]}")
    return resumen


def _comparable(fecha: str) -> str:
    """Normaliza a UTC ISO para poder comparar cadenas."""
    try:
        d = dt.datetime.fromisoformat(fecha.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).isoformat()
    except ValueError:
        return fecha


def cargar_fichero(con, ruta: str, cfg: dict, fuente: str = "fichero") -> tuple[int, int, int]:
    """Carga un .atom descargado a mano (histórico mensual o pruebas)."""
    ahora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with open(ruta, "rb") as f:
        items, _, _ = parse_feed(f.read(), fuente)
    r = procesar_items(con, items, cfg, ahora)
    con.commit()
    return r
