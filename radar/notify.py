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


def nuevas(con, cfg: dict, desde: str | None = None, limite: int = 25):
    desde = desde or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=26)).isoformat(timespec="seconds")
    prios = cfg["alertas"].get("solo_prioridad", ["A"])
    return con.execute(
        f"SELECT * FROM licitaciones WHERE estado='PUB' AND primera_vez>=? AND fecha_fin>=? "
        f"AND prioridad IN ({','.join('?' * len(prios))}) ORDER BY puntuacion DESC LIMIT ?",
        (desde, dt.date.today().isoformat(), *prios, limite)).fetchall()


def resumen(con, cfg: dict, desde: str | None = None, web: str = "", limite: int = 25, titulo: str = "") -> tuple[str, int]:
    filas = nuevas(con, cfg, desde, limite)
    if not filas:
        return "", 0
    lineas = [(titulo or f"📋 Radar BadBen23 — {len(filas)} licitaciones nuevas que encajan") + "\n"]
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


def renovaciones(con, cfg: dict, dias: int = 90, web: str = "") -> tuple[str, int]:
    """Resumen semanal: contratos de tus productos que terminan pronto y se volverán a licitar."""
    hoy = dt.date.today()
    filas = con.execute(
        """SELECT *, date(fecha, '+' || CAST(ROUND(duracion_meses) AS INTEGER) || ' months') AS fin FROM adjudicaciones
           WHERE familia != '' AND duracion_meses BETWEEN 6 AND 60
             AND date(fecha, '+' || CAST(ROUND(duracion_meses) AS INTEGER) || ' months') BETWEEN ? AND ?
           ORDER BY importe DESC LIMIT 20""", (hoy.isoformat(), (hoy + dt.timedelta(days=dias)).isoformat())).fetchall()
    if not filas:
        return "", 0
    fams = cfg.get("familias", {})
    lineas = [f"🔁 Radar BadBen23 — {len(filas)} contratos de tus productos vencen en los próximos {dias} días\n"]
    for f in filas:
        lineas.append(f"• {(f['lote_nombre'] or f['titulo'])[:100]}\n   {f['organo'][:60]} · {_eur(f['importe'])} · "
                      f"lo tiene {f['ganador'][:40]} · vence {f['fin']} · {fams.get(f['familia'], {}).get('nombre', '')}\n   {f['enlace']}")
    if web:
        lineas.append(f"\nMás en el radar → Histórico → Próximas renovaciones: {web}")
    return "\n".join(lineas), len(filas)


def chat_telegram(con=None) -> str:
    """ID del chat: el secreto TELEGRAM_CHAT_ID o, si no existe, el del último que escribió al bot (se guarda)."""
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if chat:
        return chat
    if con is not None:
        from radar.db import get_estado
        chat = get_estado(con, "telegram_chat")
        if chat:
            return chat
    tok = os.environ.get("TELEGRAM_TOKEN", "").strip()
    if not tok:
        return ""
    try:
        r = requests.get(f"https://api.telegram.org/bot{tok}/getUpdates", timeout=30).json()
    except Exception as e:  # noqa: BLE001
        print(f"[aviso] Telegram getUpdates falló: {e}")
        return ""
    for u in reversed(r.get("result", [])):
        m = u.get("message") or u.get("edited_message") or {}
        if (m.get("chat") or {}).get("type") == "private":
            chat = str(m["chat"]["id"])
            break
    if not chat:
        try:
            yo = requests.get(f"https://api.telegram.org/bot{tok}/getMe", timeout=30).json()
        except Exception:  # noqa: BLE001
            yo = {}
        nombre = (yo.get("result") or {}).get("username") or f"token no válido ({yo.get('description', '?')})"
        print(f"[aviso] Telegram: bot @{nombre}; getUpdates ok={r.get('ok')} mensajes={len(r.get('result', []))} "
              f"{r.get('description', '')}")
        print("[aviso] Telegram: no encuentro tu chat. Escribe «hola» a ESE bot en Telegram y vuelve a ejecutar.")
        return ""
    if con is not None:
        from radar.db import set_estado
        set_estado(con, "telegram_chat", chat)
        con.commit()
    _enviar(tok, chat, "✅ Radar BadBen23 conectado. Aquí te llegarán las licitaciones nuevas que encajan.")
    return chat


def _enviar(tok: str, chat: str, texto: str, html: bool = False) -> bool:
    ok = True
    trozos = [texto] if html else [texto[i:i + 3800] for i in range(0, len(texto), 3800)]
    for t in trozos:
        cuerpo = {"chat_id": chat, "text": t, "disable_web_page_preview": True}
        if html:
            cuerpo["parse_mode"] = "HTML"
        r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage", json=cuerpo, timeout=60)
        if not r.ok:
            print(f"[aviso] Telegram respondió {r.status_code}: {r.text[:200]}")
            ok = False
    return ok


def _documento(tok: str, chat: str, ruta: str, nombre: str, texto: str = "") -> bool:
    with open(ruta, "rb") as fh:
        r = requests.post(f"https://api.telegram.org/bot{tok}/sendDocument", data={"chat_id": chat, "caption": texto},
                          files={"document": (nombre, fh, "application/pdf")}, timeout=120)
    if not r.ok:
        print(f"[aviso] Telegram (PDF) respondió {r.status_code}: {r.text[:200]}")
    return r.ok


def aviso_telegram(con, cfg: dict, filas, titulo: str, web: str = "") -> bool:
    """Mensaje con formato + PDF con el resumen, los precios del pliego y la competencia."""
    tok = os.environ.get("TELEGRAM_TOKEN", "").strip()
    if not (tok and filas):
        return False
    chat = chat_telegram(con)
    if not chat:
        return False
    from radar import informe
    items = informe.datos(con, filas, cfg)
    try:
        ok = all([_enviar(tok, chat, m, html=True) for m in informe.telegram(items, titulo, web)])
    except Exception as ex:  # noqa: BLE001
        print(f"[aviso] mensaje con formato falló ({ex}); envío texto simple")
        ok = False
    if not ok:  # por si Telegram rechaza el HTML: texto simple
        ok = _enviar(tok, chat, resumen_items(items, titulo, web))
    try:
        import tempfile
        nombre = f"Radar_BadBen23_{dt.date.today().isoformat()}.pdf"
        ruta = os.path.join(tempfile.gettempdir(), nombre)
        informe.pdf(items, titulo, ruta, web)
        _documento(tok, chat, ruta, nombre, f"{len(items)} licitaciones · resumen, precios del pliego y competencia")
    except Exception as ex:  # noqa: BLE001
        print(f"[aviso] no se pudo generar o enviar el PDF: {ex}")
    return ok


def resumen_items(items, titulo, web=""):
    lineas = [titulo, ""]
    for it in items:
        d = it["d"]
        lineas.append(f"• {d.get('titulo', '')[:110]}\n   {d.get('organo', '')[:60]} · {_eur(d.get('importe'))} · "
                      f"cierra {d.get('fecha_fin', '')}\n   {d.get('enlace', '')}")
    if web:
        lineas.append(f"\nAbrir el radar: {web}")
    return "\n".join(lineas)


def telegram(texto: str, con=None) -> bool:
    tok = os.environ.get("TELEGRAM_TOKEN", "").strip()
    if not (tok and texto):
        return False
    chat = chat_telegram(con)
    return bool(chat) and _enviar(tok, chat, texto)


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
