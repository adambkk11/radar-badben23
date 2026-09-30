"""Descarga de pliegos y extracción de texto."""
from __future__ import annotations

import html
import io
import re

import requests

from .fetch import UA

MAX_MB = 25


def _get(url: str, timeout: int = 120) -> requests.Response | None:
    try:
        r = requests.get(html.unescape(url), headers={"User-Agent": UA}, timeout=timeout)
        if r.status_code == 200 and len(r.content) <= MAX_MB * 1024 * 1024:
            return r
    except requests.RequestException as ex:
        print("   descarga fallida:", ex)
    return None


def texto_pdf(data: bytes, max_paginas: int = 80) -> str:
    try:
        from pypdf import PdfReader
        rd = PdfReader(io.BytesIO(data))
        partes = []
        for i, p in enumerate(rd.pages):
            if i >= max_paginas:
                break
            try:
                partes.append(p.extract_text() or "")
            except Exception:
                continue
        return re.sub(r"[ \t]+", " ", "\n".join(partes))
    except Exception as ex:
        print("   PDF ilegible:", ex)
        return ""


def _pscp_docs(enlace: str) -> list[dict]:
    """Documentos de la Plataforma de Contractació Pública de Catalunya."""
    m = re.search(r"detall-publicacio/([0-9a-f-]{36})/(\d+)", enlace)
    if not m:
        return []
    r = _get(f"https://contractaciopublica.cat/portal-api/detall-publicacio-expedient/{m.group(1)}/{m.group(2)}")
    if not r:
        return []
    try:
        dp = r.json()["dades"]["publicacio"].get("dadesPublicacio") or {}
    except Exception:
        return []
    out = []
    for clave, tipo in (("plecsDeClausulesAdministratives", "PCAP"), ("plecsDePrescripcionsTecniques", "PPT")):
        for d in (dp.get(clave) or {}).get("docs", []) or []:
            out.append({"tipo": tipo, "nombre": d.get("titol", ""),
                        "url": f"https://contractaciopublica.cat/portal-api/descarrega-document/{d['id']}/{d['hash']}"})
    return out


def obtener_pliegos(it: dict, max_docs: int = 4) -> list[dict]:
    """Devuelve [{tipo, nombre, url, texto, pdf(bytes|None)}] con PCAP y PPT."""
    docs = list(it.get("documentos") or [])
    if not docs and "contractaciopublica.cat" in (it.get("enlace") or ""):
        docs = _pscp_docs(it["enlace"])
    orden = {"PCAP": 0, "PPT": 1, "Otro": 2}
    docs.sort(key=lambda d: orden.get(d["tipo"], 3))
    out = []
    for d in docs[:max_docs]:
        r = _get(d["url"])
        if not r:
            continue
        data = r.content
        if data[:4] == b"%PDF":
            out.append({**d, "texto": texto_pdf(data), "pdf": data})
        else:
            txt = re.sub(r"<[^>]+>", " ", r.text)
            out.append({**d, "texto": re.sub(r"\s+", " ", html.unescape(txt))[:50000], "pdf": None})
    return out
