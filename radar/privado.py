"""Datos privados en un repositorio público.

- La base de datos se guarda cifrada (data/radar.db.enc) con SITE_PASSWORD.
- Los datos sensibles de la empresa (socios, etc.) van en el secreto CONFIG_PRIVADA
  o en config.privada.json (este archivo NO se sube a GitHub).
"""
from __future__ import annotations

import base64
import gzip
import json
import os
from pathlib import Path

ITER = 250_000


def _clave(clave: str, sal: bytes) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITER).derive(clave.encode())


def cifrar(datos: bytes, clave: str) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    sal, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_clave(clave, sal)).encrypt(iv, datos, None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "it": ITER, "salt": b(sal), "iv": b(iv), "ct": b(ct)}


def descifrar(obj: dict, clave: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = base64.b64decode
    return AESGCM(_clave(clave, d(obj["salt"]))).decrypt(d(obj["iv"]), d(obj["ct"]), None)


def abrir_db(db: Path, clave: str | None) -> None:
    """Si solo existe la copia cifrada, la descifra para trabajar."""
    enc = db.with_suffix(".db.enc")
    if db.exists() or not enc.exists():
        return
    if not clave:
        raise SystemExit("Falta SITE_PASSWORD para abrir data/radar.db.enc")
    db.write_bytes(gzip.decompress(descifrar(json.loads(enc.read_text()), clave)))
    print(f"[db] descifrada {enc.name}")


def cerrar_db(db: Path, clave: str | None) -> None:
    """Guarda la copia cifrada que se sube al repositorio."""
    if not clave or not db.exists():
        return
    enc = db.with_suffix(".db.enc")
    enc.write_text(json.dumps(cifrar(gzip.compress(db.read_bytes(), 6), clave)))
    print(f"[db] cifrada -> {enc.name} ({enc.stat().st_size // 1024} KB)")


def _fusionar(base: dict, extra: dict) -> dict:
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _fusionar(base[k], v)
        else:
            base[k] = v
    return base


def cargar_config(raiz: Path) -> dict:
    c = json.loads((raiz / "config.json").read_text(encoding="utf-8"))
    local = raiz / "config.privada.json"
    if local.exists():
        _fusionar(c, json.loads(local.read_text(encoding="utf-8")))
    if os.environ.get("CONFIG_PRIVADA", "").strip():
        _fusionar(c, json.loads(os.environ["CONFIG_PRIVADA"]))
    return c
