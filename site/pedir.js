/* Radar BadBen23 – pedir precios a proveedores (lista de artículos del pliego, Excel y correo en inglés,
   precios recibidos -> calculadora) y borradores de declaración responsable y oferta económica. */
(() => {
  'use strict';
  let R = null;
  const $ = (s, el = document) => el.querySelector(s);
  const num = (v) => (window.TRABAJO ? window.TRABAJO.num(v) : parseFloat(String(v).replace(',', '.')) || 0);
  const eur2 = (v) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const limite = (x) => { if (!x.ff) return 'as soon as possible'; const d = new Date(x.ff + 'T00:00:00'); d.setDate(d.getDate() - 4); return d < new Date() ? 'as soon as possible' : d.toISOString().slice(0, 10); };

  // ---------- artículos ----------
  function articulos(x) {
    const a = x.ai?.articulos;
    if (a?.length) return a.map((r, i) => ({ ...r, _i: i }));
    return [];
  }
  const filtrados = (x, lote) => articulos(x).filter((a) => !lote || String(a.lote ?? '').replace(/^L/i, '') === String(lote).replace(/^L/i, ''));

  // ---------- XLSX mínimo (sin librerías externas) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(archivos) {
    const enc = new TextEncoder(), partes = [], central = [];
    let off = 0;
    const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF], u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
    for (const [nombre, texto] of archivos) {
      const n = enc.encode(nombre), d = enc.encode(texto), c = crc32(d);
      const cab = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0)];
      partes.push(new Uint8Array(cab), n, d);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), n);
      off += cab.length + n.length + d.length;
    }
    const tamCentral = central.reduce((a, b) => a + b.length, 0);
    const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(archivos.length), ...u16(archivos.length), ...u32(tamCentral), ...u32(off), ...u16(0)]);
    return new Blob([...partes, ...central, fin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const xesc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // filas: array de arrays; celda = string | number | {v, s} (s: 1 negrita, 2 ajustar texto)
  function xlsx(filas, anchos) {
    const celda = (v, r, c) => {
      const ref = col(c) + (r + 1);
      const o = v !== null && typeof v === 'object' ? v : { v };
      const s = o.s ? ` s="${o.s}"` : '';
      if (o.f) return `<c r="${ref}"${s}><f>${xesc(o.f)}</f></c>`;
      if (o.v === null || o.v === undefined || o.v === '') return o.s ? `<c r="${ref}"${s}/>` : '';
      if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(o.v)}</t></is></c>`;
    };
    const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => celda(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="RFQ" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ['xl/worksheets/sheet1.xml', hoja],
    ]);
  }
  function descargar(blob, nombre) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  const unidadEn = (u) => ({ uds: 'pcs', ud: 'pcs', unidades: 'pcs', unidad: 'pcs', pares: 'pairs', par: 'pair', juegos: 'sets', juego: 'set', cajas: 'boxes', caja: 'box', paquetes: 'packs', rollos: 'rolls', metros: 'm', m: 'm', kg: 'kg', litros: 'l' }[String(u || '').toLowerCase().replace(/\.$/, '')] || u || 'pcs');
  const ref = (x) => String(x.x || 'tender').replace(/[^\w.-]+/g, '_').slice(0, 40);

  function excel(x, lote) {
    const arts = filtrados(x, lote);
    const T = (v) => ({ v, s: 2 }), H = (v) => ({ v, s: 1 }), P = { v: '', s: 3 };
    const filas = [
      [{ v: 'REQUEST FOR QUOTATION', s: 1 }],
      ['Buyer', 'Grupo BadBen23 S.L. (Spain)'],
      ['Reference', `${x.x || ''}${lote ? ' – Lot ' + lote : ''}`],
      ['Quote deadline', limite(x)],
      ['Delivery', `Spain (${[x.pr, x.ca].filter(Boolean).join(', ')})`],
      ['Notes', 'Please fill in the yellow cells. Prices without VAT, per unit. Indicate Incoterm (FOB / EXW) and port. CE marking and EN standards certificates/test reports are mandatory where indicated.'],
      [],
      [H('No.'), H('Lot'), H('Item'), H('Specifications'), H('Quantity'), H('Unit'), H('Required certificates'), H('Unit price (USD)'), H('Total (USD)'), H('MOQ'), H('Production time (days)'), H('Incoterm / port'), H('Remarks')],
      ...arts.map((a, i) => [i + 1, a.lote ?? '', T(a.articulo_en || a.articulo), T(a.especificacion_en || ''), a.cantidad ?? '', unidadEn(a.unidad), T(a.certificados || ''), P, a.cantidad ? { f: `E${i + 9}*H${i + 9}`, s: 2 } : P, P, P, P, P]),
    ];
    if (!arts.length) filas.push(['', '', '(No item list available: see the tender documents)']);
    descargar(xlsx(filas, [6, 6, 34, 60, 10, 8, 26, 14, 14, 10, 14, 16, 30]), `RFQ_${ref(x)}${lote ? '_lot' + lote : ''}.xlsx`);
  }

  function correo(x, lote) {
    const arts = filtrados(x, lote);
    const lista = arts.length
      ? arts.map((a, i) => `${i + 1}. ${a.articulo_en || a.articulo}${a.cantidad ? ` – ${a.cantidad} ${unidadEn(a.unidad)}` : ''}${a.especificacion_en ? `\n   Specs: ${a.especificacion_en}` : ''}${a.certificados ? `\n   Certificates: ${a.certificados}` : ''}`).join('\n')
      : (x.ai?.que_se_compra?.length ? x.ai.que_se_compra : (x.l?.length ? x.l.map((l) => l.n) : [x.t])).map((a) => '- ' + a).join('\n');
    const yo = datosEmpresa();
    return {
      asunto: `RFQ – ${arts.length ? (arts[0].articulo_en || arts[0].articulo) + (arts.length > 1 ? ` and ${arts.length - 1} more items` : '') : 'public tender Spain'} – ref. ${x.x || ''}`,
      cuerpo: `Hello,\n\nWe are preparing an offer for a public tender in Spain and need your best price for:\n\n${lista}\n\nPlease send us (the attached Excel can be used):\n- Unit price without VAT (FOB or EXW, port of loading) for the quantities above\n- MOQ and production time\n- CE marking / EN standard certificates and test reports (issuing laboratory)\n- Sample availability and cost\n- Packing details (carton size and weight)\n\nDeadline for your quote: ${limite(x)}.\n\nThank you,\n${yo.firmante || 'Adam Benktib'}\n${yo.nombre || 'Grupo BadBen23 S.L.'}${yo.email ? '\n' + yo.email : ''}`,
    };
  }

  // ---------- precios recibidos -> coste del producto ----------
  const precios = () => R.store.get('precios', {});
  function guardarPrecios(x, obj) { const p = precios(); p[x.id] = { ...(p[x.id] || {}), ...obj }; R.store.set('precios', p); }
  function costeProducto(x, lote) {
    const p = precios()[x.id] || {}, cambio = num(p.cambio || '0,92') || 1;
    let total = 0, faltan = 0;
    for (const a of filtrados(x, lote)) {
      const u = num(p.u?.[a._i] ?? '');
      if (!u) { faltan++; continue; }
      total += u * (a.cantidad || 0) * (p.moneda === 'EUR' ? 1 : cambio);
    }
    return { total, faltan };
  }

  // ---------- lista de precios del pliego vs. precios del proveedor ----------
  // Precio del pliego: el que sacó la IA o el que tú corrijas. Coste puesto = precio proveedor (en €) + gastos de importación %.
  function comparativa(x, lote) {
    const p = precios()[x.id] || {}, cambio = num(p.cambio || '0,92') || 1, gastos = num(p.gastos ?? '') / 100, baja = num(p.baja ?? '') / 100;
    const filas = filtrados(x, lote).map((a) => {
      const pl = p.pp?.[a._i] !== undefined && p.pp[a._i] !== '' ? num(p.pp[a._i]) : (a.precio_max_unitario || 0);
      const prov = num(p.u?.[a._i] ?? '');
      const coste = prov ? prov * (p.moneda === 'EUR' ? 1 : cambio) * (1 + gastos) : 0;
      const oferta = pl ? pl * (1 - baja) : 0;
      const q = a.cantidad || 0;
      return { a, q, pl, prov, coste, oferta, margen: oferta && coste ? oferta - coste : null, editado: p.pp?.[a._i] !== undefined && p.pp[a._i] !== '' };
    });
    const sum = (f) => filas.reduce((t, r) => t + (f(r) || 0), 0);
    const completas = filas.filter((r) => r.pl && r.coste);
    const tot = {
      pliego: sum((r) => r.pl * r.q), oferta: sum((r) => r.oferta * r.q),
      coste: sum((r) => r.coste * r.q), sinPliego: filas.filter((r) => !r.pl).length, sinProv: filas.filter((r) => !r.prov).length,
      margenComp: completas.reduce((t, r) => t + (r.oferta - r.coste) * r.q, 0), ofertaComp: completas.reduce((t, r) => t + r.oferta * r.q, 0),
    };
    return { filas, tot, baja: baja * 100, gastos: gastos * 100 };
  }
  function excelComparativa(x, lote) {
    const { filas, baja, gastos } = comparativa(x, lote);
    const p = precios()[x.id] || {}, cambio = num(p.cambio || '0,92') || 1, eurF = p.moneda === 'EUR' ? 1 : cambio;
    const H = (v) => ({ v, s: 1 }), T = (v) => ({ v, s: 2 }), n0 = (v) => (v ? Math.round(v * 10000) / 10000 : '');
    const f0 = 9;  // primera fila de artículos
    const datos = filas.map((r, i) => {
      const k = i + f0;
      return [i + 1, r.a.lote ?? '', T(r.a.articulo), r.q || '', r.a.unidad || '', n0(r.pl), r.a.precio_fuente || (r.editado ? 'corregido a mano' : ''), n0(r.prov),
        { f: `IF(H${k}="","",H${k}*$C$5*(1+$C$6/100))`, s: 2 }, { f: `IF(F${k}="","",F${k}*(1-$C$4/100))`, s: 2 },
        { f: `IF(OR(I${k}="",J${k}=""),"",J${k}-I${k})`, s: 2 }, { f: `IF(OR(K${k}="",J${k}=0),"",ROUND(100*K${k}/J${k},1))`, s: 2 }, { f: `IF(K${k}="","",K${k}*D${k})`, s: 2 }];
    });
    const fin = f0 + filas.length - 1;
    const tabla = [
      [{ v: 'COMPARATIVA DE PRECIOS (uso interno)', s: 1 }],
      ['Licitación', x.t], ['Expediente', `${x.x || ''}${lote ? ' – Lote ' + lote : ''}`],
      ['Baja sobre precios del pliego (%)', '', baja], ['Cambio: 1 unidad de la moneda del proveedor =', '', eurF, '€'], ['Gastos de importación (% sobre proveedor)', '', gastos],
      [],
      [H('#'), H('Lote'), H('Artículo'), H('Cantidad'), H('Ud.'), H('Precio pliego ud (sin IVA)'), H('Fuente'), H(`Precio proveedor ud (${p.moneda === 'EUR' ? 'EUR' : 'USD'})`), H('Coste puesto ud (€)'), H('Tu precio ud (€)'), H('Margen ud (€)'), H('Margen %'), H('Margen total (€)')],
      ...datos,
      [],
      ['', '', H('TOTALES'), '', '', { f: `SUMPRODUCT(D${f0}:D${fin},F${f0}:F${fin})`, s: 1 }, '', '', { f: `SUMPRODUCT(D${f0}:D${fin},I${f0}:I${fin})`, s: 1 }, { f: `SUMPRODUCT(D${f0}:D${fin},J${f0}:J${fin})`, s: 1 }, '', '', { f: `SUM(M${f0}:M${fin})`, s: 1 }],
    ];
    descargar(xlsx(tabla, [5, 6, 40, 10, 7, 14, 22, 14, 14, 14, 13, 10, 15]), `Comparativa_precios_${ref(x)}${lote ? '_lote' + lote : ''}.xlsx`);
  }

  // ---------- datos de la empresa (para los borradores) ----------
  const CAMPOS = [['nombre', 'Razón social'], ['nif', 'NIF'], ['domicilio', 'Domicilio'], ['cp', 'Código postal'], ['municipio', 'Municipio'], ['provincia', 'Provincia'],
    ['administrador', 'Representante (nombre)'], ['dni', 'DNI del representante'], ['cargo', 'Cargo'], ['email', 'Correo para notificaciones'], ['telefono', 'Teléfono'], ['firmante', 'Firma de los correos']];
  function datosEmpresa() {
    const base = R?.D?.yo || {};
    return { ...Object.fromEntries(CAMPOS.map(([k]) => [k, base[k] || ''])), firmante: 'Adam Benktib', pyme: base.pyme || '', ...(R?.store.get('empresa', {}) || {}) };
  }
  const hueco = (v, txt) => (v ? R.esc(v) : `<span style="background:#ff0">[${txt}]</span>`);

  function doc(titulo, cuerpo) {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${R.esc(titulo)}</title>
      <style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-size:14pt;text-align:center}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:4px 6px;font-size:10pt}th{background:#eee}.nota{font-size:9pt;color:#555;border:1px solid #c90;padding:6px;margin-top:18px}</style></head><body>${cuerpo}</body></html>`;
    return new Blob(['﻿' + html], { type: 'application/msword' });
  }
  const lotesTxt = (x, lote) => (lote ? `Lote ${lote}${x.l?.find((l) => String(l.id) === String(lote)) ? ' – ' + x.l.find((l) => String(l.id) === String(lote)).n : ''}` : (x.l?.length ? 'Lote(s): [indicar]' : 'Lote único'));
  function cabecera(x, y, lote) {
    return `<p>D./Dª <b>${hueco(y.administrador, 'nombre del representante')}</b>, con DNI ${hueco(y.dni, 'DNI')}, en nombre y representación de <b>${hueco(y.nombre, 'razón social')}</b>, con NIF ${hueco(y.nif, 'NIF')} y domicilio en ${hueco(y.domicilio, 'domicilio')}, ${hueco(y.cp, 'CP')} ${hueco(y.municipio, 'municipio')} (${hueco(y.provincia, 'provincia')}), en calidad de ${hueco(y.cargo, 'cargo')},</p>
      <p>en relación con el contrato <b>${R.esc(x.t)}</b>, expediente <b>${R.esc(x.x || '')}</b>, del órgano de contratación <b>${R.esc(x.o)}</b> (${R.esc(lotesTxt(x, lote))}),</p>`;
  }
  const notaModelo = (x) => `<div class="nota"><b>BORRADOR generado por el Radar.</b> ${x.ai?.anexos_oferta ? `El pliego indica estos modelos: <i>${R.esc(x.ai.anexos_oferta)}</i>. ` : ''}Si el pliego trae su propio modelo (anexo), usa ese modelo y copia estos datos. Revisa cada punto antes de firmar con el certificado digital.</div>`;

  function declaracion(x, lote) {
    const y = datosEmpresa();
    const simpl = x.p === 'Abierto simplificado' || x.ai?.rolece;
    const puntos = [
      'Que ostenta la representación de la sociedad que presenta la oferta.',
      'Que la sociedad cuenta con capacidad de obrar, con la solvencia económica y financiera y técnica o profesional exigida en los pliegos (o, en su caso, con la clasificación correspondiente) y con las autorizaciones necesarias para ejercer la actividad.',
      'Que ni la sociedad ni sus administradores o representantes están incursos en ninguna de las prohibiciones de contratar previstas en el artículo 71 de la Ley 9/2017, de Contratos del Sector Público (LCSP).',
      'Que la sociedad se halla al corriente del cumplimiento de sus obligaciones tributarias y con la Seguridad Social impuestas por las disposiciones vigentes.',
      ...(simpl ? ['Que la sociedad está inscrita en el Registro Oficial de Licitadores y Empresas Clasificadas del Sector Público (ROLECE) o en el registro equivalente de la comunidad autónoma, en los términos del artículo 159.4 LCSP.'] : []),
      `Que la empresa ${y.pyme === 'si' ? '<b>SÍ</b>' : y.pyme === 'no' ? '<b>NO</b>' : '<span style="background:#ff0">[SÍ / NO]</span>'} tiene la condición de pequeña y mediana empresa (PYME).`,
      'Que <span style="background:#ff0">[no concurre al procedimiento ninguna otra empresa de su mismo grupo / concurren las siguientes empresas de su mismo grupo: ___]</span>.',
      `Que designa como dirección de correo electrónico para recibir notificaciones: <b>${hueco(y.email, 'correo electrónico')}</b>.`,
      'Que se compromete a acreditar ante el órgano de contratación, cuando le sea requerido y en todo caso antes de la adjudicación, la posesión y validez de los documentos exigidos.',
    ];
    const cuerpo = `<h1>DECLARACIÓN RESPONSABLE</h1><p style="text-align:center">(artículos 140${simpl ? ' y 159.4' : ''} de la LCSP)</p>
      ${cabecera(x, y, lote)}<p><b>DECLARA BAJO SU RESPONSABILIDAD:</b></p><ol>${puntos.map((p) => `<li>${p}</li>`).join('')}</ol>
      <p>En ${hueco(y.municipio, 'lugar')}, a ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
      <p>Firmado electrónicamente: ${hueco(y.administrador, 'representante')}</p>${notaModelo(x)}`;
    descargar(doc('Declaración responsable', cuerpo), `Declaracion_responsable_${ref(x)}.doc`);
  }

  function ofertaEconomica(x, lote) {
    const y = datosEmpresa();
    const filas = (lote ? x.l.filter((l) => String(l.id) === String(lote)) : (x.l?.length ? x.l : [{ id: '', n: x.t, i: x.i }]));
    const of = (l) => window.TRABAJO?.oferta(x, x.l?.length > 1 ? l.id : '') ?? (filas.length === 1 ? window.TRABAJO?.oferta(x, '') : null);
    const e2 = (v) => (v || v === 0) ? new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €' : '<span style="background:#ff0">[importe]</span>';
    const tabla = `<table><tr><th>Lote</th><th>Descripción</th><th>Presupuesto sin IVA</th><th>Oferta sin IVA</th><th>IVA (21%)</th><th>Total con IVA</th></tr>${filas.map((l) => {
      const o = of(l); return `<tr><td>${R.esc(l.id || '—')}</td><td>${R.esc(l.n || '')}</td><td>${e2(l.i)}</td><td><b>${e2(o)}</b></td><td>${o ? e2(o * 0.21) : e2(null)}</td><td>${o ? e2(o * 1.21) : e2(null)}</td></tr>`;
    }).join('')}</table>`;
    const cuerpo = `<h1>PROPOSICIÓN ECONÓMICA</h1>${cabecera(x, y, lote)}
      <p>enterado del anuncio y de las condiciones y requisitos que se exigen para la adjudicación del contrato, se compromete a ejecutarlo con estricta sujeción a los pliegos de cláusulas administrativas particulares y de prescripciones técnicas, por los siguientes importes:</p>${tabla}
      ${(() => { const cm = comparativa(x, lote); const con = cm.filas.filter((r) => r.oferta); if (!con.length) return ''; return `<p><b>Precios unitarios ofertados</b> (sin IVA${cm.baja ? `, baja del ${String(cm.baja).replace('.', ',')}% sobre los precios del pliego` : ''}):</p>
        <table><tr><th>Artículo</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th></tr>${con.map((r) => `<tr><td>${R.esc(r.a.articulo)}${r.a.lote ? ` (L${R.esc(r.a.lote)})` : ''}</td><td>${r.q || ''} ${R.esc(r.a.unidad || '')}</td><td>${e2(r.oferta)}</td><td>${r.q ? e2(r.oferta * r.q) : ''}</td></tr>`).join('')}</table>`; })()}
      <p class="muted">Comprueba el tipo de IVA aplicable y, si el pliego lo pide, el desglose por precios unitarios.</p>
      ${x.ai?.otros_criterios ? `<p>Otros criterios evaluables que hay que ofertar: <span style="background:#ff0">${R.esc(x.ai.otros_criterios)}</span></p>` : ''}
      <p>En ${hueco(y.municipio, 'lugar')}, a ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
      <p>Firmado electrónicamente: ${hueco(y.administrador, 'representante')}</p>${notaModelo(x)}`;
    descargar(doc('Proposición económica', cuerpo), `Oferta_economica_${ref(x)}.doc`);
  }

  function formEmpresa(el) {
    const y = datosEmpresa();
    el.innerHTML = `<div class="calc">${CAMPOS.map(([k, t]) => `<label>${t}<input data-emp="${k}" value="${R.esc(y[k] || '')}"></label>`).join('')}
      <label>¿Es PYME?<select data-emp="pyme"><option value="">Sin indicar</option><option value="si" ${y.pyme === 'si' ? 'selected' : ''}>Sí</option><option value="no" ${y.pyme === 'no' ? 'selected' : ''}>No</option></select></label></div>
      <p class="muted small">Se usan en la declaración responsable, la oferta económica y los correos. Se guardan en este dispositivo (y en tus otros dispositivos si activas la sincronización).</p>`;
    el.oninput = el.onchange = (e) => { const k = e.target.dataset.emp; if (!k) return; const d = R.store.get('empresa', {}); d[k] = e.target.value; R.store.set('empresa', d); };
  }

  // ---------- ficha ----------
  function ficha(x, el) {
    if (!el) return;
    const arts = articulos(x);
    const lotes = [...new Set(arts.map((a) => a.lote).filter((v) => v !== null && v !== undefined && v !== ''))];
    const p = precios()[x.id] || {};
    let lote = p.lote && lotes.includes(p.lote) ? p.lote : '';
    const sinLista = !arts.length;
    const motivo = !x.ai ? 'Cuando la IA analice esta licitación aparecerá aquí la lista de artículos con cantidades.'
      : (!x.ai._v && x.pa === 'A' ? 'Se analizó antes de esta función: se vuelve a analizar sola en las próximas horas para sacar la lista de artículos.' : 'La IA no encontró una lista de artículos en los pliegos: revisa el PPT o el anexo de precios.');
    const pintar = () => {
      const fs = filtrados(x, lote);
      const pp = precios()[x.id] || {};
      const c = costeProducto(x, lote);
      const cmp = comparativa(x, lote);
      el.innerHTML = `<div class="box-h"><h3>Pedir precios a proveedores</h3>${lotes.length > 1 ? `<select id="pLote"><option value="">Todos los lotes</option>${lotes.map((l) => `<option ${String(l) === String(lote) ? 'selected' : ''}>${R.esc(l)}</option>`).join('')}</select>` : ''}</div>
        ${sinLista ? `<p class="muted">${motivo}</p>` : `<p class="muted">${fs.length} artículos sacados del pliego por la IA. Comprueba cantidades, especificaciones y precios con el PPT y el anexo de precios: puedes corregir el precio del pliego a mano.${x.ai?.oferta_por_precios_unitarios ? ' <strong>Este pliego se oferta por precios unitarios.</strong>' : ''}</p>
        <div class="row-precios">
          <label>Moneda del proveedor <select id="pMon"><option value="USD" ${pp.moneda !== 'EUR' ? 'selected' : ''}>USD</option><option value="EUR" ${pp.moneda === 'EUR' ? 'selected' : ''}>EUR</option></select></label>
          <label>1 USD = <input id="pCambio" inputmode="decimal" value="${R.esc(pp.cambio || '0,92')}" style="width:64px"> €</label>
          <label title="Flete, seguro, arancel, aduana y transporte hasta el organismo, en % sobre el precio del proveedor">Gastos de importación <input id="pGastos" inputmode="decimal" value="${R.esc(pp.gastos ?? '')}" placeholder="0" style="width:56px"> %</label>
          <label title="Tu precio = precio del pliego menos esta baja">Baja sobre el pliego <input id="pBaja" inputmode="decimal" value="${R.esc(pp.baja ?? '')}" placeholder="0" style="width:56px"> %</label>
        </div>
        <div class="tabla-scroll"><table class="arts"><tr><th>#</th><th>Artículo</th><th class="num">Cant.</th><th class="num">Precio pliego<div class="muted small">ud, sin IVA</div></th><th class="num">Precio proveedor<div class="muted small">ud, ${pp.moneda === 'EUR' ? 'EUR' : 'USD'}</div></th><th class="num">Coste puesto<div class="muted small">ud, €</div></th><th class="num">Tu precio<div class="muted small">ud, €</div></th><th class="num">Margen</th></tr>
        ${cmp.filas.map((r, i) => { const a = r.a, mp = r.margen !== null && r.oferta ? 100 * r.margen / r.oferta : null;
          return `<tr><td class="nw">${i + 1}${a.lote ? `<div class="muted">L${R.esc(a.lote)}</div>` : ''}</td><td><strong>${R.esc(a.articulo)}</strong><div class="muted small">${R.esc(a.articulo_en || '')}${a.especificacion_en ? ' · ' + R.esc(a.especificacion_en) : ''}</div>${a.certificados ? `<div class="small">${R.esc(a.certificados)}</div>` : ''}</td>
          <td class="num nw">${a.cantidad ?? '—'} ${R.esc(a.unidad || '')}</td>
          <td class="num"><input class="pu ${r.editado ? 'editado' : ''}" inputmode="decimal" data-pp="${a._i}" value="${R.esc(pp.pp?.[a._i] ?? (a.precio_max_unitario ? String(a.precio_max_unitario).replace('.', ',') : ''))}" placeholder="—" title="${R.esc(a.precio_fuente || (a.precio_max_unitario ? 'Precio que sacó la IA del pliego' : 'El pliego no da precio para este artículo: puedes ponerlo tú'))}"></td>
          <td class="num"><input class="pu" inputmode="decimal" data-pu="${a._i}" value="${R.esc(pp.u?.[a._i] ?? '')}" placeholder="0"></td>
          <td class="num">${r.coste ? eur2(r.coste) : '—'}</td><td class="num">${r.oferta ? eur2(r.oferta) : '—'}</td>
          <td class="num nw ${r.margen === null ? '' : r.margen < 0 ? 'neg' : mp < 10 ? 'aviso' : 'ok'}">${r.margen === null ? '—' : `${eur2(r.margen)}<div class="small">${Math.round(mp)}%${r.q ? ' · ' + R.eur(r.margen * r.q) : ''}</div>`}</td></tr>`; }).join('')}
        <tr class="tot"><td></td><td><strong>Total${lote ? ' lote ' + R.esc(lote) : ''}</strong>${x.l?.length ? `<div class="muted small">Presupuesto ${lote ? 'del lote' : 'de la licitación'}: ${R.eur(lote ? x.l.find((l) => String(l.id) === String(lote))?.i : x.i)}</div>` : ''}</td><td></td>
          <td class="num"><strong>${R.eur(cmp.tot.pliego)}</strong>${cmp.tot.sinPliego ? `<div class="muted small">${cmp.tot.sinPliego} sin precio</div>` : ''}</td><td></td>
          <td class="num"><strong>${R.eur(cmp.tot.coste)}</strong>${cmp.tot.sinProv ? `<div class="muted small">${cmp.tot.sinProv} sin precio</div>` : ''}</td>
          <td class="num"><strong>${R.eur(cmp.tot.oferta)}</strong></td>
          <td class="num ${cmp.tot.margenComp < 0 ? 'neg' : 'ok'}"><strong>${cmp.tot.ofertaComp ? R.eur(cmp.tot.margenComp) : '—'}</strong>${cmp.tot.ofertaComp ? `<div class="small">${Math.round(100 * cmp.tot.margenComp / cmp.tot.ofertaComp)}%</div>` : ''}</td></tr></table></div>
        ${cmp.filas.some((r) => r.margen !== null && r.margen < 0) ? `<p class="neg small"><strong>${cmp.filas.filter((r) => r.margen !== null && r.margen < 0).length} artículo(s) dan pérdida</strong> con estos precios: busca otro proveedor o baja menos.</p>` : ''}
        <div class="row-precios"><span>Coste del producto (sin gastos): <strong>${R.eur(c.total)}</strong>${c.faltan ? ` <span class="muted">(faltan ${c.faltan} precios)</span>` : ''}</span>
          <button class="btn small" id="pUsar" ${c.total ? '' : 'disabled'}>Pasar a la calculadora</button>
          <button class="btn small" id="pComp">Excel comparativa (interno)</button></div>`}
        <div class="actions">
          <button class="btn primary" id="pXlsx">Excel para proveedores (inglés)</button>
          <button class="btn" id="pMail">Copiar correo en inglés</button>
          <a class="btn" id="pMailto" href="#">Abrir en mi correo</a>
        </div>
        <h3 style="margin-top:14px">Documentos para presentar (borradores)</h3>
        ${x.ai?.anexos_oferta ? `<p class="small">Modelos que pide el pliego: <strong>${R.esc(x.ai.anexos_oferta)}</strong></p>` : ''}
        <div class="actions">
          <button class="btn" id="pDecl">Declaración responsable (Word)</button>
          <button class="btn" id="pOf">Oferta económica (Word)</button>
          <button class="btn ghost" id="pEmp">Mis datos de empresa</button>
        </div>
        <div id="pEmpForm" hidden></div>`;
      const sel = $('#pLote', el); if (sel) sel.onchange = () => { lote = sel.value; guardarPrecios(x, { lote }); pintar(); };
      el.querySelectorAll('[data-pu]').forEach((i) => i.addEventListener('change', () => { const pr = precios()[x.id] || {}; guardarPrecios(x, { u: { ...(pr.u || {}), [i.dataset.pu]: i.value } }); pintar(); }));
      el.querySelectorAll('[data-pp]').forEach((i) => i.addEventListener('change', () => { const pr = precios()[x.id] || {}; guardarPrecios(x, { pp: { ...(pr.pp || {}), [i.dataset.pp]: i.value } }); pintar(); }));
      const gas = $('#pGastos', el); if (gas) gas.onchange = () => { guardarPrecios(x, { gastos: gas.value }); pintar(); };
      const baj = $('#pBaja', el); if (baj) baj.onchange = () => { guardarPrecios(x, { baja: baj.value }); pintar(); };
      const comp = $('#pComp', el); if (comp) comp.onclick = () => excelComparativa(x, lote);
      const mon = $('#pMon', el); if (mon) mon.onchange = () => { guardarPrecios(x, { moneda: mon.value }); pintar(); };
      const cam = $('#pCambio', el); if (cam) cam.onchange = () => { guardarPrecios(x, { cambio: cam.value }); pintar(); };
      const usar = $('#pUsar', el); if (usar) usar.onclick = () => { const k = costeProducto(x, lote); window.TRABAJO?.ponerCoste(x, x.l?.length > 1 ? lote : '', k.total); R.toast('Coste pasado a la calculadora'); document.getElementById('dCalc')?.scrollIntoView({ behavior: 'smooth' }); };
      $('#pXlsx', el).onclick = () => { excel(x, lote); if (!R.seg()[x.id]?.estado) R.setSeg(x.id, { estado: 'precios' }); };
      $('#pMail', el).onclick = () => { const m = correo(x, lote); R.copiar(`Subject: ${m.asunto}\n\n${m.cuerpo}`, 'Correo copiado'); };
      $('#pMailto', el).onclick = (e) => { e.preventDefault(); const m = correo(x, lote); location.href = `mailto:?subject=${encodeURIComponent(m.asunto)}&body=${encodeURIComponent(m.cuerpo.slice(0, 1800))}`; };
      $('#pDecl', el).onclick = () => declaracion(x, lote);
      $('#pOf', el).onclick = () => ofertaEconomica(x, lote);
      $('#pEmp', el).onclick = () => { const f = $('#pEmpForm', el); f.hidden = !f.hidden; if (!f.hidden) formEmpresa(f); };
    };
    pintar();
  }

  function init(api) { R = api; }
  window.PEDIR = { init, ficha, xlsx, articulos, costeProducto, comparativa, datosEmpresa, _hoy: hoyISO };
})();
