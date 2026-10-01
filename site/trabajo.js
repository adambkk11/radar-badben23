/* Radar BadBen23 – herramientas de trabajo diario: calculadora de oferta, checklist de presentación,
   "Mi trabajo" en Inicio, compartir una licitación y exportar la lista a Excel. */
(() => {
  'use strict';
  let R = null;
  const $ = (s, el = document) => el.querySelector(s);
  const num = (v) => {
    let t = String(v ?? '').trim().replace(/[\s€]/g, '');
    if (!t) return 0;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');          // 1.234,56
    else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, ''); // 12.500
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
  };

  // ---------- checklist de presentación ----------
  function pasos(x) {
    const ai = x.ai || {};
    const l = [
      ['leer', 'Leer PCAP y PPT (criterios, solvencia, plazos)'],
      ['precio', 'Pedir precio y plazo al proveedor'],
    ];
    if (ai.muestras) l.push(['muestras', 'Preparar y enviar muestras']);
    if (x.p === 'Abierto simplificado' || ai.rolece) l.push(['rolece', 'Inscripción en ROLECE vigente']);
    l.push(['deuc', 'DEUC / declaración responsable']);
    if ((x.pp ?? 100) < 100) l.push(['tecnica', 'Memoria o documentación técnica (criterios no precio)']);
    l.push(['oferta', 'Oferta económica en el modelo del pliego'], ['firma', 'Firmar con certificado digital'],
      ['presentar', `Presentar en la plataforma antes del ${x.ff || 'plazo'} ${x.hf || ''}`.trim()], ['justificante', 'Guardar el justificante de presentación']);
    return l;
  }
  function progreso(x) {
    const c = R.store.get('check', {})[x.id] || {};
    const l = pasos(x);
    return { hechos: l.filter(([k]) => c[k]).length, total: l.length };
  }
  function pintarCheck(x, el) {
    const c = R.store.get('check', {})[x.id] || {};
    const l = pasos(x);
    const n = l.filter(([k]) => c[k]).length;
    el.innerHTML = `<div class="box-h"><h3>Checklist para presentar</h3><span class="muted">${n}/${l.length}</span></div>
      <div class="bar" style="margin-bottom:10px"><span style="width:${Math.round(100 * n / l.length)}%"></span></div>
      ${l.map(([k, t]) => `<label class="check-row"><input type="checkbox" data-ck="${k}" ${c[k] ? 'checked' : ''}> <span>${R.esc(t)}</span></label>`).join('')}`;
    el.onchange = (e) => {
      const k = e.target.dataset.ck; if (!k) return;
      const todo = R.store.get('check', {}); todo[x.id] = { ...(todo[x.id] || {}), [k]: e.target.checked };
      R.store.set('check', todo);
      if (e.target.checked && !R.seg()[x.id]?.estado) R.setSeg(x.id, { estado: 'preparando' });
      pintarCheck(x, el); inicio();
    };
  }

  // ---------- calculadora de oferta ----------
  async function pintarCalc(x, el) {
    const pz = x.i || x.ve || 0;
    const g = R.store.get('calc', {})[x.id] || { coste: '', flete: '', arancel: '0', entrega: '', otros: '', margen: '25' };
    el.innerHTML = `<h3>Calculadora de oferta</h3>
      <p class="muted">Pon tus costes sin IVA (totales para todo el contrato o el lote que vayas a ofertar). Se guarda en este dispositivo.</p>
      <div class="calc">
        <label>Coste del producto (proveedor)<input inputmode="decimal" data-k="coste" value="${R.esc(g.coste)}" placeholder="0"></label>
        <label>Flete y seguro<input inputmode="decimal" data-k="flete" value="${R.esc(g.flete)}" placeholder="0"></label>
        <label>Arancel (%)<input inputmode="decimal" data-k="arancel" value="${R.esc(g.arancel)}" placeholder="0"></label>
        <label>Entrega y transporte en España<input inputmode="decimal" data-k="entrega" value="${R.esc(g.entrega)}" placeholder="0"></label>
        <label>Otros (muestras, embalaje, gestión…)<input inputmode="decimal" data-k="otros" value="${R.esc(g.otros)}" placeholder="0"></label>
        <label>Margen que quieres (%)<input inputmode="decimal" data-k="margen" value="${R.esc(g.margen)}" placeholder="25"></label>
      </div>
      <div id="calcOut" class="calc-out"></div>`;
    const p = window.HIST ? await window.HIST.parecidas(x).catch(() => null) : null;
    const calcular = () => {
      const v = {}; el.querySelectorAll('[data-k]').forEach((i) => { v[i.dataset.k] = i.value; });
      const todo = R.store.get('calc', {}); todo[x.id] = v; R.store.set('calc', todo);
      const coste = num(v.coste) * (1 + num(v.arancel) / 100) + num(v.flete) + num(v.entrega) + num(v.otros);
      const out = $('#calcOut', el);
      if (!coste) { out.innerHTML = '<p class="muted">Introduce al menos el coste del producto.</p>'; return; }
      const oferta = coste * (1 + num(v.margen) / 100);
      const baja = pz ? 100 * (1 - oferta / pz) : null;
      const prob = p && baja !== null ? Math.round(100 * window.HIST.probGanar(p.bajas, baja)) : null;
      const filas = p && pz ? [0.3, 0.5, 0.7].map((q) => {
        const b = p.bajas[Math.min(p.bajas.length - 1, Math.floor(q * p.bajas.length))];
        const precio = pz * (1 - b / 100), margen = 100 * (precio / coste - 1);
        return `<tr><td>${Math.round(q * 100)}%</td><td class="num">${R.pct(b)}</td><td class="num">${R.eur(precio)}</td><td class="num ${margen < 0 ? 'neg' : ''}">${R.pct(margen)}</td><td class="num ${margen < 0 ? 'neg' : ''}">${R.eur(precio - coste)}</td></tr>`;
      }).join('') : '';
      out.innerHTML = `
        <div class="facts">
          <div class="fact"><div class="l">Coste total</div><div class="v">${R.eur(coste)}</div></div>
          <div class="fact"><div class="l">Tu oferta (sin IVA)</div><div class="v">${R.eur(oferta)}</div><div class="muted">beneficio ${R.eur(oferta - coste)}</div></div>
          <div class="fact"><div class="l">Baja sobre presupuesto</div><div class="v ${baja !== null && baja < 0 ? 'neg' : ''}">${baja !== null ? R.pct(baja) : '—'}</div><div class="muted">${pz ? 'de ' + R.eur(pz) : 'sin presupuesto'}</div></div>
          <div class="fact"><div class="l">Probabilidad (histórico)</div><div class="v">${prob !== null ? prob + '%' : '—'}</div><div class="muted">${p ? `${p.v.length} contratos CPV ${p.pref}*` : 'sin datos parecidos'}</div></div>
        </div>
        ${baja !== null && baja < 0 ? '<p class="neg"><strong>Tu oferta supera el presupuesto: quedaría excluida.</strong></p>' : ''}
        ${filas ? `<p class="muted" style="margin-bottom:4px">Qué precio necesitas según la probabilidad de ganar que quieras (solo precio):</p>
        <table><tr><th>Ganar en</th><th class="num">Baja</th><th class="num">Precio</th><th class="num">Tu margen</th><th class="num">Beneficio</th></tr>${filas}</table>` : ''}
        <p class="muted small">La garantía definitiva (normalmente 5%) es un depósito que se recupera; no es coste. Revisa en el pliego penalizaciones y plazos de pago.</p>`;
    };
    el.oninput = calcular;
    calcular();
  }

  // ---------- compartir ----------
  function texto(x) {
    const ai = x.ai || {};
    return [`${x.t}`, `${x.o} (${[x.pr, x.ca].filter(Boolean).join(', ')})`,
      `Importe: ${R.eur(x.i || x.ve)} · Cierra: ${x.ff || '—'} ${x.hf || ''} · ${x.p || ''}`,
      ai.recomendacion ? `IA: ${ai.recomendacion} — ${ai.motivo || ''}` : '',
      ai.que_se_compra?.length ? 'Qué se compra: ' + ai.que_se_compra.slice(0, 6).join('; ') : '',
      `Enlace oficial: ${x.u}`].filter(Boolean).join('\n');
  }

  // ---------- ficha ----------
  function ficha(x) {
    const calc = document.getElementById('dCalc'), chk = document.getElementById('dCheck'), acc = document.querySelector('#detail .actions');
    if (calc) pintarCalc(x, calc);
    if (chk) pintarCheck(x, chk);
    if (acc && !acc.querySelector('#dShare')) {
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'dShare'; b.textContent = 'Compartir';
      b.onclick = async () => {
        const t = texto(x);
        if (navigator.share) { try { await navigator.share({ title: x.t, text: t }); return; } catch { /* cancelado */ } }
        R.copiar(t, 'Resumen copiado: pégalo en WhatsApp o en un correo');
      };
      acc.appendChild(b);
    }
  }

  // ---------- Inicio: mi trabajo ----------
  function inicio() {
    const el = document.getElementById('hoyMio'); if (!el || !R) return;
    const s = R.seg();
    const activos = Object.entries(s).filter(([, o]) => ['interesa', 'precios', 'preparando'].includes(o.estado))
      .map(([id, o]) => ({ x: R.BY[id], o })).filter((a) => a.x && (a.x._d === null || a.x._d >= 0))
      .sort((a, b) => (a.x._d ?? 999) - (b.x._d ?? 999));
    const nombre = Object.fromEntries(R.ESTADOS);
    el.innerHTML = `<div class="box"><div class="box-h"><h2>Mi trabajo</h2><a href="#" data-tab-go="tablero">tablero</a></div>
      ${activos.length ? activos.slice(0, 10).map(({ x, o }) => { const pr = progreso(x);
        return `<div class="cal-item" data-id="${R.esc(x.id)}"><div class="score ${x.pa}" style="width:42px;height:42px;font-size:.9rem">${x.n}</div>
          <div><strong>${R.esc(x.t.slice(0, 80))}</strong><div class="meta"><span class="tag ai">${R.esc(nombre[o.estado] || o.estado)}</span><span>checklist ${pr.hechos}/${pr.total}</span></div></div>
          <div class="days ${x._d !== null && x._d <= 3 ? 'hot' : ''}">${R.diasTxt(x._d)}</div></div>`; }).join('')
        : '<div class="muted">Marca licitaciones como «Me interesa» desde su ficha y aparecerán aquí con sus plazos y su checklist.</div>'}</div>`;
    el.onclick = (e) => { const t = e.target.closest('[data-tab-go]'); if (t) { e.preventDefault(); R.ir(t.dataset.tabGo); } };
  }

  // ---------- exportar licitaciones a Excel ----------
  function exportar() {
    const v = R.ordenar(R.filtrar());
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const n = (x) => (x === null || x === undefined) ? '' : String(x).replace('.', ',');
    const s = R.seg();
    const cab = ['Nota', 'Prioridad', 'Título', 'Organismo', 'Provincia', 'Comunidad', 'Presupuesto sin IVA', 'Valor estimado', 'Fin de plazo', 'Hora', 'Procedimiento', 'Peso precio %', 'Producto', 'Recomendación IA', 'Seguimiento', 'CPV', 'Enlace oficial'];
    const filas = v.map((x) => [n(x.n), x.pa, q(x.t), q(x.o), q(x.pr), q(x.ca), n(x.i), n(x.ve), x.ff, x.hf, q(x.p), n(x.pp), q(R.D.familias[x.f]?.nombre || ''), q(x.ai?.recomendacion || ''), q(s[x.id]?.estado || ''), q((x.cpv || []).join(' ')), q(x.u)].join(';'));
    const blob = new Blob(['﻿' + cab.join(';') + '\n' + filas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `licitaciones-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  function init(api) {
    R = api;
    const bar = document.querySelector('.results-bar');
    if (bar && !document.getElementById('csvLic')) {
      const b = document.createElement('button'); b.className = 'btn small ghost'; b.id = 'csvLic'; b.textContent = 'Excel'; b.title = 'Descargar la lista filtrada';
      b.onclick = exportar; bar.insertBefore(b, document.getElementById('sort'));
    }
  }
  window.TRABAJO = { init, ficha, inicio, progreso };
})();
