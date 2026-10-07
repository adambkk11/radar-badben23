"""Avisos con formato: mensaje de Telegram (HTML) y PDF con el resumen, precios del pliego y competencia."""
from __future__ import annotations

import datetime as dt
import html
import re
import json
import statistics

NV = "NO VERIFICADO"


def enlace(url: str) -> str:
    """Enlace que no se rompe en Telegram/móvil: los de la Plataforma pasan por ir.html con el id en base64url."""
    import os
    m = re.search(r"idEvl=([^&]+)", url or "")
    web = os.environ.get("RADAR_URL", "").strip()
    if not (m and web):
        return url or ""
    from urllib.parse import unquote
    idb = unquote(m.group(1)).replace("+", "-").replace("/", "_").rstrip("=")
    return web.rstrip("/") + "/ir.html#" + idb


def _eur(x, dec=0):
    if x is None or x == "":
        return "—"
    s = f"{x:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} €"


def _pct(x):
    return f"{x:.1f}".replace(".", ",") + " %"


def _num(x):
    return f"{x:g}".replace(".", ",")


def _fecha(s):
    try:
        return dt.date.fromisoformat(s[:10]).strftime("%d/%m/%Y")
    except Exception:  # noqa: BLE001
        return s or "—"


def _dias(s):
    try:
        return (dt.date.fromisoformat(s[:10]) - dt.date.today()).days
    except Exception:  # noqa: BLE001
        return None


def _mercado(con, familia: str, organo: str) -> dict:
    """Bajas y nº de ofertas de los últimos 12 meses en la misma familia, y quién ganó antes en ese organismo."""
    if not familia:
        return {}
    desde = (dt.date.today() - dt.timedelta(days=365)).isoformat()
    filas = con.execute("SELECT baja, ofertas FROM adjudicaciones WHERE familia=? AND fecha>=? AND baja IS NOT NULL "
                        "AND baja BETWEEN 0 AND 80", (familia, desde)).fetchall()
    comp = [f["baja"] for f in filas if (f["ofertas"] or 0) >= 2]
    ofs = [f["ofertas"] for f in filas if f["ofertas"]]
    previas = con.execute("SELECT fecha, ganador, importe, baja, ofertas, lote_nombre, titulo FROM adjudicaciones "
                          "WHERE familia=? AND organo=? ORDER BY fecha DESC LIMIT 3", (familia, organo)).fetchall()
    return {"n": len(filas),
            "baja_med": round(statistics.median(comp), 1) if len(comp) >= 3 else None,
            "ofertas_med": round(statistics.median(ofs), 1) if len(ofs) >= 3 else None,
            "previas": [dict(p) for p in previas]}


def datos(con, filas, cfg: dict) -> list[dict]:
    fams = cfg.get("familias", {})
    out = []
    for f in filas:
        d = json.loads(f["data"])
        ai = con.execute("SELECT data FROM analisis WHERE id=?", (f["id"],)).fetchone()
        a = json.loads(ai["data"]) if ai and ai["data"] else {}
        out.append({"d": d, "ai": a, "prio": f["prioridad"], "punt": f["puntuacion"],
                    "familia": fams.get(f["familia"] or "", {}).get("nombre", ""),
                    "socio": fams.get(f["familia"] or "", {}).get("socio", ""),
                    "mercado": _mercado(con, f["familia"] or "", d.get("organo", ""))})
    return out


# ---------------- Telegram ----------------
_REC = {"presentarse": "✅ Presentarse", "estudiar": "🟡 Estudiar", "descartar": "⛔ Descartar"}


def telegram(items: list[dict], titulo: str, web: str = "") -> list[str]:
    e = html.escape
    bloques = []
    for i, it in enumerate(items, 1):
        d, a, m = it["d"], it["ai"], it["mercado"]
        dias = _dias(d.get("fecha_fin", ""))
        cierre = f"{_fecha(d.get('fecha_fin', ''))} {d.get('hora_fin') or ''}".strip()
        if dias is not None:
            cierre += f" (en {dias} d)" if dias > 0 else " (hoy)"
        lineas = [f"<b>{i}. {e(d.get('titulo', '')[:140])}</b>",
                  f"🏛 {e(d.get('organo', '')[:80])} · {e(d.get('provincia') or d.get('ccaa') or '')}",
                  f"💶 <b>{_eur(d.get('importe'))}</b> sin IVA · ⏰ {e(cierre)}",
                  f"📄 {e(d.get('procedimiento_txt') or '')}"
                  + (f" · precio {int(d['peso_precio'])}%" if d.get("peso_precio") else "")
                  + (f" · {len(d['lotes'])} lotes" if len(d.get("lotes") or []) > 1 else "")]
        if a:
            lineas.append(f"🤖 {_REC.get(a.get('recomendacion'), e(str(a.get('recomendacion') or '')))}"
                          + (f" — {e(str(a.get('motivo') or '')[:160])}" if a.get("motivo") else ""))
            con_precio = [x for x in a.get("articulos") or [] if x.get("precio_max_unitario")]
            if a.get("articulos"):
                lineas.append(f"📦 {len(a['articulos'])} artículos sacados del pliego"
                              + (f", {len(con_precio)} con precio unitario" if con_precio else ""))
        else:
            lineas.append("🤖 Pendiente de análisis IA")
        if m.get("baja_med") is not None:
            lineas.append(f"📉 Baja típica en {e(it['familia'].lower() or 'esta familia')}: {_pct(m['baja_med'])}"
                          + (f" · {_num(m['ofertas_med'])} ofertas de media" if m.get("ofertas_med") else ""))
        lineas.append(f"🔗 <a href=\"{e(enlace(d.get('enlace', '')), quote=True)}\">Ver en la Plataforma</a>")
        bloques.append("\n".join(lineas))
    cab = f"📋 <b>{e(titulo)}</b>\n<i>Resumen completo con precios del pliego en el PDF adjunto.</i>"
    pie = f"\n🔎 <a href=\"{e(web, quote=True)}\">Abrir el radar</a>" if web else ""
    mensajes, actual = [], cab
    for b in bloques:
        if len(actual) + len(b) + 2 > 3900:
            mensajes.append(actual)
            actual = b
        else:
            actual += "\n\n" + b
    mensajes.append(actual + pie)
    return mensajes


# ---------------- PDF ----------------
def pdf(items: list[dict], titulo: str, ruta, web: str = "") -> str:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                    TableStyle)

    e = lambda s: html.escape(str(s if s is not None else ""))  # noqa: E731
    ss = getSampleStyleSheet()
    H1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=17, leading=21, spaceAfter=2, alignment=0)
    H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, leading=15.5, spaceBefore=0, spaceAfter=4,
                        textColor=colors.HexColor("#0f172a"))
    H3 = ParagraphStyle("h3", parent=ss["Heading4"], fontSize=9.5, leading=12, spaceBefore=7, spaceAfter=2,
                        textColor=colors.HexColor("#1e3a8a"))
    P = ParagraphStyle("p", parent=ss["BodyText"], fontSize=8.8, leading=11.6)
    PS = ParagraphStyle("ps", parent=P, fontSize=7.6, leading=9.6, textColor=colors.HexColor("#475569"))
    PT = ParagraphStyle("pt", parent=P, fontSize=7.6, leading=9.4)
    PR = ParagraphStyle("pr", parent=PT, alignment=TA_RIGHT)
    AZUL, GRIS, BORDE = colors.HexColor("#1e3a8a"), colors.HexColor("#f1f5f9"), colors.HexColor("#cbd5e1")

    def tabla(filas, anchos, cabecera=True):
        t = Table(filas, colWidths=anchos, repeatRows=1 if cabecera else 0)
        estilo = [("GRID", (0, 0), (-1, -1), 0.4, BORDE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                  ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
        if cabecera:
            estilo += [("BACKGROUND", (0, 0), (-1, 0), AZUL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        t.setStyle(TableStyle(estilo))
        return t

    def cab(txt):
        return Paragraph(f"<b>{e(txt)}</b>", ParagraphStyle("c", parent=PT, textColor=colors.white))

    doc = SimpleDocTemplate(str(ruta), pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=13 * mm, bottomMargin=13 * mm, title=titulo, author="Radar BadBen23")
    ancho = A4[0] - 28 * mm
    try:
        from zoneinfo import ZoneInfo
        hoy = dt.datetime.now(ZoneInfo("Europe/Madrid")).strftime("%d/%m/%Y %H:%M")
    except Exception:  # noqa: BLE001
        hoy = dt.datetime.now().strftime("%d/%m/%Y %H:%M")
    st = [Paragraph(e(titulo), H1),
          Paragraph(f"Generado el {hoy} · {len(items)} licitaciones · importes sin IVA · "
                    f"los datos de la IA y los precios hay que comprobarlos en el pliego antes de ofertar", PS),
          Spacer(1, 5)]

    # índice
    filas = [[cab("#"), cab("Licitación"), cab("Importe"), cab("Cierra"), cab("IA")]]
    for i, it in enumerate(items, 1):
        d, a = it["d"], it["ai"]
        filas.append([Paragraph(str(i), PT), Paragraph(f"<b>{e(d.get('titulo', '')[:120])}</b><br/>"
                                                      f"<font color='#475569'>{e(d.get('organo', '')[:70])}</font>", PT),
                      Paragraph(_eur(d.get("importe")), PR), Paragraph(_fecha(d.get("fecha_fin", "")), PT),
                      Paragraph(e(a.get("recomendacion") or "pendiente"), PT)])
    st += [tabla(filas, [8 * mm, ancho - 78 * mm, 26 * mm, 20 * mm, 24 * mm]), PageBreak()]

    for i, it in enumerate(items, 1):
        d, a, m = it["d"], it["ai"], it["mercado"]
        bloque = [Paragraph(f"{i}. {e(d.get('titulo', ''))}", H2)]
        dias = _dias(d.get("fecha_fin", ""))
        datos_basicos = [
            ("Organismo", f"{d.get('organo', '')} ({d.get('provincia') or d.get('ccaa') or ''})"),
            ("Expediente", d.get("expediente") or NV),
            ("Presupuesto", f"{_eur(d.get('importe'))} sin IVA · valor estimado {_eur(d.get('valor_estimado'))}"),
            ("Fecha límite", f"{_fecha(d.get('fecha_fin', ''))} {d.get('hora_fin') or ''}"
                             + (f" — quedan {dias} días" if dias is not None and dias >= 0 else "")),
            ("Procedimiento", f"{d.get('procedimiento_txt') or NV}"
                              + (f" · precio {int(d['peso_precio'])}% de la nota" if d.get("peso_precio") else "")),
            ("Familia / socio", f"{it['familia'] or '—'} · {it['socio'] or '—'}"),
            ("Puntuación radar", f"{it['prio']} · {it['punt']}/100"),
        ]
        if a:
            sol = a.get("solvencia") or {}
            datos_basicos += [
                ("Recomendación IA", f"{a.get('recomendacion') or '—'} — {a.get('motivo') or ''}"),
                ("Solvencia", f"{sol.get('admite_empresa_nueva') or ''} {('· ' + sol['detalle']) if sol.get('detalle') else ''}".strip() or NV),
                ("Plazo de entrega", a.get("plazo_entrega") or NV),
                ("Duración", a.get("duracion_contrato") or NV),
                ("Muestras", a.get("muestras") or "No indicado"),
                ("Penalizaciones", a.get("penalizaciones") or "—"),
                ("Modelos a rellenar", a.get("anexos_oferta") or "—"),
            ]
        bloque.append(tabla([[Paragraph(f"<b>{e(k)}</b>", PT), Paragraph(e(v), PT)] for k, v in datos_basicos],
                            [34 * mm, ancho - 34 * mm], cabecera=False))
        st.append(KeepTogether(bloque))
        if a.get("resumen"):
            st += [Paragraph("Resumen", H3), Paragraph(e(a["resumen"]), P)]

        # lotes
        lotes = d.get("lotes") or []
        if len(lotes) > 1:
            encaje = {str(x.get("lote")): x.get("encaja", "") for x in a.get("lotes") or []}
            filas = [[cab("Lote"), cab("Descripción"), cab("Importe"), cab("Encaja")]]
            for lt in lotes[:30]:
                filas.append([Paragraph(e(lt.get("id")), PT), Paragraph(e(lt.get("nombre", ""))[:200], PT),
                              Paragraph(_eur(lt.get("importe")), PR), Paragraph(e(encaje.get(str(lt.get("id")), "")), PT)])
            st += [Paragraph("Lotes", H3), tabla(filas, [12 * mm, ancho - 62 * mm, 28 * mm, 22 * mm])]

        # artículos con precios del pliego
        arts = a.get("articulos") or []
        if arts:
            filas = [[cab("Lote"), cab("Artículo"), cab("Cant."), cab("Precio pliego ud"), cab("Total pliego")]]
            total, hay = 0.0, False
            for x in arts[:80]:
                pu, q = x.get("precio_max_unitario"), x.get("cantidad")
                tot = pu * q if pu and q else None
                if tot:
                    total += tot
                    hay = True
                filas.append([Paragraph(e(x.get("lote") or ""), PT),
                              Paragraph(f"{e(x.get('articulo'))}"
                                        + (f"<br/><font color='#475569'>{e(x.get('certificados'))}</font>" if x.get("certificados") else ""), PT),
                              Paragraph(f"{e(q if q is not None else '—')} {e(x.get('unidad') or '')}", PR),
                              Paragraph(_eur(pu, 2) if pu else "—", PR), Paragraph(_eur(tot, 2) if tot else "—", PR)])
            if hay:
                filas.append(["", Paragraph("<b>Total de los artículos con precio</b>", PT), "", "",
                              Paragraph(f"<b>{_eur(total, 2)}</b>", PR)])
            st += [Paragraph(f"Artículos y precios del pliego ({len(arts)})", H3),
                   tabla(filas, [12 * mm, ancho - 92 * mm, 22 * mm, 28 * mm, 30 * mm])]
            fuentes = sorted({x.get("precio_fuente") for x in arts if x.get("precio_fuente")})
            if fuentes:
                nota = "Fuente de los precios: " + "; ".join(fuentes)[:300] + ". Compruébalos en el pliego."
            elif hay:
                nota = "Precios sacados del pliego por la IA: compruébalos en el anexo de precios antes de ofertar."
            else:
                nota = "El pliego no trae precios unitarios por artículo (o la IA no los encontró): revisa el anexo de precios."
            st.append(Paragraph(nota, PS))
            if len(arts) > 80:
                st.append(Paragraph(f"… y {len(arts) - 80} artículos más en el radar.", PS))
        elif not a:
            st += [Paragraph("Artículos y precios", H3),
                   Paragraph("Pendiente de análisis IA: en unas horas aparecerá en el radar la lista de artículos.", PS)]

        # competencia
        if m.get("n") or m.get("previas"):
            st.append(Paragraph("Competencia y precios de mercado", H3))
            txt = []
            if m.get("baja_med") is not None:
                txt.append(f"En {it['familia'].lower() or 'esta familia'}, último año: baja típica <b>{_pct(m['baja_med'])}</b>"
                           + (f" con {_num(m['ofertas_med'])} ofertas de media" if m.get("ofertas_med") else "")
                           + f" ({m['n']} adjudicaciones). Con esa baja, el importe adjudicado rondaría "
                             f"<b>{_eur((d.get('importe') or 0) * (1 - m['baja_med'] / 100))}</b>.")
            for p in m.get("previas") or []:
                txt.append(f"Este organismo lo adjudicó el {_fecha(p['fecha'])} a <b>{e(p['ganador'])}</b> por "
                           f"{_eur(p['importe'])}" + (f" (baja {_pct(p['baja'])}" if p.get("baja") is not None else " (")
                           + (f", {int(p['ofertas'])} ofertas)" if p.get("ofertas") else ")"))
            for t in txt:
                st.append(Paragraph("• " + t, P))

        if a.get("riesgos"):
            st += [Paragraph("Riesgos", H3)] + [Paragraph("• " + e(r), P) for r in a["riesgos"][:6]]
        st.append(Paragraph(f"<link href='{e(enlace(d.get('enlace', '')))}' color='#1d4ed8'>Abrir la licitación en la Plataforma</link>"
                            f" · expediente {e(d.get('expediente') or '')}", PS))
        if i < len(items):
            st.append(PageBreak())
    if web:
        st += [Spacer(1, 8), Paragraph(f"Radar: <link href='{e(web)}' color='#1d4ed8'>{e(web)}</link>", PS)]

    def pie(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(14 * mm, 8 * mm, "Radar BadBen23 · uso interno")
        canvas.drawRightString(A4[0] - 14 * mm, 8 * mm, f"Página {doc_.page}")
        canvas.restoreState()

    doc.build(st, onFirstPage=pie, onLaterPages=pie)
    return str(ruta)
