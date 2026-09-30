"""Avisos por Telegram y correo."""
from __future__ import annotations

import datetime as dt
import json
import os
import smtplib
from email.mime.text import MIMEText

import requests


def _eur(x):
    return f"{x:,.0f} €".replace(",", ".") if x else "?"


def resumen(con, cfg: dict, desde: str | None = None, web: str = "") -> tuple[str, int]:
    desde = desde or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=26)).isoformat(timespec="seconds")
    prios = cfg["alertas"].get("solo_prioridad", ["A"])
    filas = con.execute(
        f"SELECT * FROM licitaciones WHERE estado='PUB' AND primera_vez>=? AND prioridad IN ({','.join('?' * len(prios))}) "
        "ORDER BY puntuacion DESC LIMIT 25", (desde, *prios)).fetchall()
    if not filas:
        return "", 0
    lineas = [f"📋 Radar BadBen23 — {len(filas)} licitaciones nuevas que encajan\n"]
    for f in filas:
        d = json.loads(f["data"])
        ai = con.execute("SELECT data FROM analisis WHERE id=?", (f["id"],)).fetchone()
        rec = ""
        if ai and ai["data"]:
            a = json.loads(ai["data"])
            rec = f"\n   IA: {a.get('recomendacion', '')} — {a.get('motivo', '')}"
        lineas.append(
            f"• [{f['prioridad']} {f['puntuacion']}] {d['titulo'][:110]}\n"
            f"   {d['organo'][:60]} ({d['provincia'] or d['ccaa']}) · {_eur(d['importe'])} · cierra {d['fecha_fin']} "
            f"· {d['procedimiento_txt']}{rec}\n   {d['enlace']}")
    if web:
        lineas.append(f"\nAbrir el radar: {web}")
    return "\n".join(lineas), len(filas)


def telegram(texto: str) -> bool:
    tok, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (tok and chat and texto):
        return False
    for i in range(0, len(texto), 3800):
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      json={"chat_id": chat, "text": texto[i:i + 3800], "disable_web_page_preview": True}, timeout=60)
    return True


def email(texto: str, asunto: str) -> bool:
    user, pwd, to = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD"), os.environ.get("ALERT_EMAIL")
    if not (user and pwd and to and texto):
        return False
    msg = MIMEText(texto, "plain", "utf-8")
    msg["Subject"], msg["From"], msg["To"] = asunto, user, to
    with smtplib.SMTP_SSL(os.environ.get("SMTP_HOST", "smtp.gmail.com"), 465) as s:
        s.login(user, pwd)
        s.send_message(msg)
    return True
