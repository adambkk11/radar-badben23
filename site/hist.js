/* Radar BadBen23 – Histórico: buscador de adjudicaciones por CPV / palabras, análisis de precios,
   competidores, organismos, renovaciones previstas y simulador de baja. */
(() => {
  'use strict';
  let R = null;
  const S = { filas: [], cargados: new Set(), cargando: null, vista: 'buscar' };
  const H0 = { q: '', cpv: '', meses: 12, tipo: '1', ca: '', org: '', gan: '', imin: '', imax: '', ia: false, orden: 'fecha' };
  const H = { ...H0 };
  let pagina = 1, abiertoIdx = -1;

  const DIV = {
    '03': 'Agricultura, ganadería y pesca', '09': 'Combustibles y energía', '14': 'Minería y metales', '15': 'Alimentos y bebidas',
    '16': 'Maquinaria agrícola', '18': 'Ropa, calzado y accesorios', '19': 'Cuero, textil, plástico y caucho', '22': 'Impresos',
    '24': 'Productos químicos', '30': 'Oficina e informática', '31': 'Material eléctrico e iluminación', '32': 'Radio, TV y comunicaciones',
    '33': 'Material médico e higiene', '34': 'Vehículos y transporte', '35': 'Seguridad, incendios, policía y defensa',
    '37': 'Deporte, juegos, juguetes y música', '38': 'Laboratorio, óptica y precisión', '39': 'Mobiliario, hogar y limpieza',
    '41': 'Agua', '42': 'Maquinaria industrial', '43': 'Maquinaria de obra y minería', '44': 'Materiales de construcción',
    '45': 'Obras de construcción', '48': 'Software', '50': 'Reparación y mantenimiento', '51': 'Instalación', '55': 'Hostelería',
    '60': 'Transporte', '63': 'Servicios de transporte y viajes', '64': 'Correos y telecomunicaciones', '65': 'Suministros públicos',
    '66': 'Finanzas y seguros', '70': 'Inmobiliarios', '71': 'Arquitectura e ingeniería', '72': 'Servicios TI', '73': 'I+D',
    '75': 'Administración pública', '76': 'Petróleo y gas', '77': 'Agrícolas y jardinería', '79': 'Servicios a empresas',
    '80': 'Enseñanza', '85': 'Salud y servicios sociales', '90': 'Residuos, limpieza y medio ambiente', '92': 'Cultura y deporte',
    '98': 'Otros servicios',
  };
  const TIPOS = { 1: 'Suministro', 2: 'Servicio', 3: 'Obra' };
  const cpvNombre = (c) => DIV[String(c).slice(0, 2)] || '';

  // ---------- utilidades ----------
  const num = (v) => (v === '' || v === null || v === undefined) ? null : +v;
  const media = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  function pctil(v, p) {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  const bajaOk = (r) => r.b !== null && r.b >= -5 && r.b <= 90;
  const prefijos = (txt) => String(txt || '').split(/[\s,;]+/).map((c) => c.replace(/\D/g, '')).filter(Boolean);
  function terminos(q) {
    const out = { si: [], no: [] };
    String(q || '').replace(/"([^"]+)"|(\S+)/g, (_, frase, pal) => {
      let t = frase || pal;
      const neg = !frase && t.startsWith('-') && t.length > 1;
      if (neg) t = t.slice(1);
      t = R.norm(t).trim();
      if (t) (neg ? out.no : out.si).push(t);
      return '';
    });
    return out;
  }
  function sumarDias(f, meses) { const d = new Date(f + 'T00:00:00'); d.setDate(d.getDate() + Math.round(meses * 30.44)); return d; }
  const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  // ---------- carga de datos (por meses, bajo demanda) ----------
  function aObjeto(campos, f) {
    const o = {}; campos.forEach((c, i) => { o[c] = f[i]; });
    const cpv = String(o.cpv || '').split(',').filter(Boolean);
    return {
      f: o.fecha || '', t: o.titulo || '', l: o.lote || '', ln: o.lote_nombre || '', o: o.organo || '', ca: o.ccaa || '',
      pr: o.provincia || '', tp: String(o.tipo || ''), cpv, pz: o.presupuesto, im: o.importe, b: o.baja, of: o.ofertas,
      g: o.ganador || '', nif: o.ganador_nif || '', u: o.enlace || '', fam: o.familia || '', pc: o.procedimiento || '',
      ai: o.ai || null, du: o.duracion || null,
      _txt: R.norm([o.titulo, o.lote_nombre, o.organo, o.ganador, o.ganador_nif, cpv.join(' '), o.provincia].join(' ')),
      _o: R.norm(o.organo), _g: R.norm((o.ganador || '') + ' ' + (o.ganador_nif || '')),
    };
  }
  async function cargar(meses) {
    const idx = (R.D.hist || []).slice(0, meses);
    const falta = idx.filter((m) => !S.cargados.has(m.m));
    if (!falta.length) return;
    let hechos = 0;
    const aviso = (t) => { const el = document.getElementById('hLoad'); if (el) el.textContent = t; };
    aviso(`Cargando histórico… 0/${falta.length} meses`);
    const cola = [...falta];
    async function trabajador() {
      while (cola.length) {
        const m = cola.shift();
        try {
          const d = await R.leer(m.f, m.h);
          for (const f of d.filas) S.filas.push(aObjeto(d.campos, f));
          S.cargados.add(m.m);
        } catch (e) { console.warn('histórico', m.m, e); }
        aviso(`Cargando histórico… ${++hechos}/${falta.length} meses`);
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    S.filas.sort((a, b) => b.f.localeCompare(a.f));
    aviso('');
  }
  function asegurar(meses) {
    const prom = (S.cargando || Promise.resolve()).then(() => cargar(meses));
    S.cargando = prom.catch(() => {});
    return prom;
  }

  // ---------- filtros ----------
  function filtrar(base = S.filas, h = H) {
    const tq = terminos(h.q), ps = prefijos(h.cpv), org = R.norm(h.org), gan = R.norm(h.gan);
    const desde = mesesAtras(h.meses), imin = num(h.imin), imax = num(h.imax);
    return base.filter((r) => {
      if (r.f && r.f < desde) return false;
      if (h.tipo && r.tp !== h.tipo) return false;
      if (h.ca && r.ca !== h.ca) return false;
      if (ps.length && !r.cpv.some((c) => ps.some((p) => c.startsWith(p)))) return false;
      if (tq.si.length && !tq.si.every((w) => r._txt.includes(w))) return false;
      if (tq.no.length && tq.no.some((w) => r._txt.includes(w))) return false;
      if (org && !r._o.includes(org)) return false;
      if (gan && !r._g.includes(gan)) return false;
      const imp = r.pz ?? r.im ?? 0;
      if (imin !== null && imp < imin) return false;
      if (imax !== null && imp > imax) return false;
      if (h.ia && !r.ai) return false;
      return true;
    });
  }
  function mesesAtras(n) { const d = hoy(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); }
  const ORDEN = {
    fecha: (a, b) => b.f.localeCompare(a.f),
    importe: (a, b) => (b.im || 0) - (a.im || 0),
    baja: (a, b) => (b.b ?? -99) - (a.b ?? -99),
    ofertas: (a, b) => (a.of ?? 99) - (b.of ?? 99),
  };

  // ---------- análisis ----------
  function estadisticas(v) {
    const bajas = v.filter(bajaOk).map((r) => r.b), ofs = v.filter((r) => r.of > 0).map((r) => r.of);
    const contratos = new Set(v.map((r) => r.u || r.t)).size;
    return {
      n: v.length, contratos, adjudicado: v.reduce((a, r) => a + (r.im || 0), 0), presupuesto: v.reduce((a, r) => a + (r.pz || 0), 0),
      bajaMedia: media(bajas), bajaMediana: pctil(bajas, 0.5), baja25: pctil(bajas, 0.25), baja75: pctil(bajas, 0.75),
      ofertas: media(ofs), unaOferta: ofs.length ? ofs.filter((x) => x === 1).length / ofs.length : null, bajas,
    };
  }
  function agrupar(v, clave, nombre) {
    const m = new Map();
    for (const r of v) {
      const k = clave(r); if (!k) continue;
      let g = m.get(k);
      if (!g) m.set(k, g = { k, nombre: nombre(r), n: 0, importe: 0, bajas: [], ofertas: [], orgs: new Set(), gans: new Map() });
      g.n++; g.importe += r.im || 0; if (bajaOk(r)) g.bajas.push(r.b); if (r.of > 0) g.ofertas.push(r.of);
      g.orgs.add(r.o); g.gans.set(r.nif || r.g, (g.gans.get(r.nif || r.g) || 0) + 1);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.importe - a.importe);
  }
  function histograma(bajas) {
    const tramos = [[-99, 0, '<0%'], [0, 5, '0-5%'], [5, 10, '5-10%'], [10, 15, '10-15%'], [15, 20, '15-20%'], [20, 30, '20-30%'], [30, 99, '≥30%']];
    const c = tramos.map(([a, b, l]) => ({ l, n: bajas.filter((x) => x >= a && x < b).length }));
    const max = Math.max(1, ...c.map((x) => x.n));
    return `<div class="histo">${c.map((x) => `<div class="hcol" title="${x.n} adjudicaciones"><div class="hbar" style="height:${Math.round(100 * x.n / max)}%"></div><span>${x.l}</span><b>${x.n}</b></div>`).join('')}</div>`;
  }
  function porMes(v) {
    const m = {}; v.forEach((r) => { const k = r.f.slice(0, 7); if (k) m[k] = (m[k] || 0) + 1; });
    const ks = Object.keys(m).sort().slice(-24), max = Math.max(1, ...ks.map((k) => m[k]));
    return `<div class="histo meses">${ks.map((k) => `<div class="hcol" title="${k}: ${m[k]}"><div class="hbar" style="height:${Math.round(100 * m[k] / max)}%"></div><span>${k.slice(2).replace('-', '/')}</span></div>`).join('')}</div>`;
  }

  // ---------- pintar ----------
  const $ = (s) => document.querySelector(s);
  function base() {
    const cas = [...new Set(S.filas.map((r) => r.ca).filter(Boolean))].sort();
    const el = $('#tab-historico');
    el.innerHTML = `
      <div class="box-h"><h2>Histórico de adjudicaciones</h2><span class="muted" id="hLoad"></span></div>
      <div class="hsearch">
        <input id="hQ" type="search" placeholder='Palabras: uniformes policía -bomberos "ropa de trabajo"' value="${R.esc(H.q)}">
        <input id="hCpv" type="search" placeholder="CPV empieza por: 1811 18143 3913" value="${R.esc(H.cpv)}">
      </div>
      <div class="hfilters">
        <select id="hTipo"><option value="">Todos los tipos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${H.tipo === k ? 'selected' : ''}>${v}s</option>`).join('')}</select>
        <select id="hMeses">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${+H.meses === m ? 'selected' : ''}>Últimos ${m} meses</option>`).join('')}</select>
        <select id="hCa"><option value="">Toda España</option>${cas.map((c) => `<option ${H.ca === c ? 'selected' : ''}>${R.esc(c)}</option>`).join('')}</select>
        <input id="hOrg" type="search" placeholder="Organismo" value="${R.esc(H.org)}">
        <input id="hGan" type="search" placeholder="Empresa o NIF ganador" value="${R.esc(H.gan)}">
        <input id="hImin" type="number" placeholder="Presupuesto mín." value="${R.esc(H.imin)}">
        <input id="hImax" type="number" placeholder="máx." value="${R.esc(H.imax)}">
        <label class="check-inline"><input type="checkbox" id="hIa" ${H.ia ? 'checked' : ''}> Con análisis IA</label>
        <button class="btn small ghost" id="hReset">Limpiar</button>
      </div>
      <div class="subtabs" id="hVistas">
        ${[['buscar', 'Adjudicaciones y precios'], ['empresas', 'Competidores'], ['organismos', 'Organismos'], ['renovaciones', 'Próximas renovaciones']]
          .map(([k, v]) => `<button data-v="${k}" class="${S.vista === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>
      <div id="hOut"><div class="empty">Cargando…</div></div>`;
    const leer = () => {
      Object.assign(H, {
        q: $('#hQ').value, cpv: $('#hCpv').value, tipo: $('#hTipo').value, meses: +$('#hMeses').value, ca: $('#hCa').value,
        org: $('#hOrg').value, gan: $('#hGan').value, imin: $('#hImin').value, imax: $('#hImax').value, ia: $('#hIa').checked,
      });
      R.store.set('hist', H); pagina = 1; abiertoIdx = -1;
    };
    let t;
    el.querySelectorAll('.hsearch input, .hfilters input').forEach((i) => i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { leer(); pintar(); }, 250); }));
    el.querySelectorAll('.hfilters select, #hIa').forEach((i) => i.addEventListener('change', async () => { leer(); await asegurar(H.meses); pintar(); }));
    $('#hReset').onclick = () => { Object.assign(H, H0); R.store.set('hist', H); base(); pintar(); };
    $('#hVistas').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; S.vista = b.dataset.v; pagina = 1; base(); if (S.vista !== 'buscar') await asegurar(24); pintar(); };
  }

  function pintar() {
    const out = $('#hOut'); if (!out) return;
    if (!(R.D.hist || []).length) { out.innerHTML = '<div class="empty">Todavía no hay histórico. Se carga solo en la primera actualización (o lanza «historico» en GitHub).</div>'; return; }
    const v = filtrar();
    if (S.vista === 'empresas') return pintarEmpresas(out, v);
    if (S.vista === 'organismos') return pintarOrganismos(out, v);
    if (S.vista === 'renovaciones') return pintarRenovaciones(out);
    const st = estadisticas(v);
    v.sort(ORDEN[H.orden] || ORDEN.fecha);
    const n = pagina * 50;
    const gan = agrupar(v, (r) => r.nif || r.g, (r) => r.g).slice(0, 12);
    const orgs = agrupar(v, (r) => r.o, (r) => r.o).slice(0, 8);
    const cpvs = agrupar(v, (r) => (r.cpv[0] || '').slice(0, 4), (r) => (r.cpv[0] || '').slice(0, 4)).slice(0, 8);
    const objetivo = st.bajaMediana !== null ? `<div class="box consejo"><strong>Precio para ganar:</strong> en estas ${st.n} adjudicaciones la baja ganadora típica es <strong>${R.pct(st.bajaMediana)}</strong> (la mitad de los ganadores bajó entre ${R.pct(st.baja25)} y ${R.pct(st.baja75)}). ${st.unaOferta !== null ? `En el <strong>${R.pct(100 * st.unaOferta)}</strong> se presentó una sola empresa.` : ''} <span class="muted">Útil sobre todo cuando el precio pesa mucho.</span></div>` : '';
    out.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${st.n.toLocaleString('es-ES')}</div><div class="l">Adjudicaciones (lotes) · ${st.contratos.toLocaleString('es-ES')} contratos</div></div>
        <div class="kpi"><div class="v">${R.eur(st.adjudicado)}</div><div class="l">Adjudicado (sin IVA)</div></div>
        <div class="kpi"><div class="v">${R.pct(st.bajaMedia)}</div><div class="l">Baja media</div></div>
        <div class="kpi"><div class="v">${st.ofertas !== null ? st.ofertas.toFixed(1) : '—'}</div><div class="l">Ofertas por lote</div></div>
        <div class="kpi"><div class="v">${st.unaOferta !== null ? R.pct(100 * st.unaOferta) : '—'}</div><div class="l">Con una sola oferta</div></div>
      </div>
      ${objetivo}
      <div class="grid2">
        <div class="box">
          <div class="box-h"><h2>Adjudicaciones</h2>
            <div class="actions" style="margin:0"><select id="hOrden">${[['fecha', 'Más recientes'], ['importe', 'Mayor importe'], ['baja', 'Mayor baja'], ['ofertas', 'Menos competencia']].map(([k, l]) => `<option value="${k}" ${H.orden === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn small" id="hCsv">Descargar CSV</button></div></div>
          <div class="hlist">${v.slice(0, n).map((r, i) => fila(r, i)).join('') || '<div class="empty">Sin resultados. Prueba con menos palabras o un CPV más corto.</div>'}</div>
          ${v.length > n ? '<button class="btn ghost wide" id="hMas">Ver más</button>' : ''}
        </div>
        <div>
          <div class="box"><h3>Bajas ganadoras</h3>${histograma(st.bajas)}</div>
          <div class="box"><h3>Quién gana</h3><table><tr><th>Empresa</th><th class="num">Lotes</th><th class="num">Baja</th></tr>
            ${gan.map((g) => `<tr><td><a href="#" data-emp="${R.esc(g.k)}">${R.esc(g.nombre)}</a></td><td class="num">${g.n}</td><td class="num">${R.pct(media(g.bajas))}</td></tr>`).join('')}</table></div>
          <div class="box"><h3>Quién compra</h3><table><tr><th>Organismo</th><th class="num">Lotes</th><th class="num">Ofertas</th></tr>
            ${orgs.map((g) => `<tr><td><a href="#" data-org="${R.esc(g.k)}">${R.esc(g.nombre)}</a></td><td class="num">${g.n}</td><td class="num">${g.ofertas.length ? media(g.ofertas).toFixed(1) : '—'}</td></tr>`).join('')}</table></div>
          <div class="box"><h3>CPV más frecuentes</h3><table>${cpvs.map((g) => `<tr><td><a href="#" data-cpv="${g.k}">${g.k}</a> <span class="muted">${R.esc(cpvNombre(g.k))}</span></td><td class="num">${g.n}</td></tr>`).join('')}</table></div>
          <div class="box"><h3>Adjudicaciones por mes</h3>${porMes(v)}</div>
        </div>
      </div>`;
    $('#hOrden').onchange = (e) => { H.orden = e.target.value; R.store.set('hist', H); pintar(); };
    $('#hCsv').onclick = () => csv(v);
    const mas = $('#hMas'); if (mas) mas.onclick = () => { pagina++; pintar(); };
  }

  function fila(r, i) {
    const abierto = i === abiertoIdx;
    return `<div class="hrow ${abierto ? 'open' : ''}" data-i="${i}">
      <div class="hrow-main">
        <div><strong>${R.esc(r.ln || r.t)}</strong>${r.ln && r.ln !== r.t ? `<div class="muted small">${R.esc(r.t.slice(0, 160))}</div>` : ''}
          <div class="meta"><span>${R.fecha(r.f)} ${r.f.slice(0, 4)}</span><span>${R.esc(r.o)}</span><span>${R.esc(r.pr || r.ca)}</span>${r.ai ? `<span class="tag ai">IA: ${R.esc(r.ai.r || 'analizada')}</span>` : ''}</div>
          <div class="meta">Ganó <a href="#" data-emp="${R.esc(r.nif || r.g)}">${R.esc(r.g)}</a></div></div>
        <div class="side"><div class="money">${R.eur(r.im)}</div><div class="muted small">de ${R.eur(r.pz)}</div>
          <div class="small">${r.b !== null && r.b !== undefined ? `baja <strong>${R.pct(r.b)}</strong>` : ''} ${r.of ? `· ${r.of} of.` : ''}</div></div>
      </div>
      ${abierto ? `<div class="hrow-det">
        <dl class="kv">
          <dt>Tipo</dt><dd>${TIPOS[r.tp] || r.tp} · ${R.esc(r.pc || '')}</dd>
          <dt>CPV</dt><dd>${r.cpv.map((c) => `<a href="#" data-cpv="${c}">${c}</a>`).join(' ')} <span class="muted">${R.esc(cpvNombre(r.cpv[0] || ''))}</span></dd>
          <dt>Lote</dt><dd>${R.esc(r.l || 'Único')}</dd>
          <dt>Ganador</dt><dd>${R.esc(r.g)} <span class="muted">${R.esc(r.nif)}</span></dd>
          <dt>Duración</dt><dd>${r.du ? `${r.du} meses · fin previsto ${sumarDias(r.f, r.du).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}` : '—'}</dd>
          ${r.ai ? `<dt>Análisis IA</dt><dd>${R.esc(r.ai.s || '')}<br><span class="muted">${R.esc(r.ai.m || '')}</span></dd>` : ''}
        </dl>
        <div class="actions"><a class="btn small primary" href="${R.esc(r.u)}" target="_blank" rel="noopener">Ver en la plataforma oficial</a>
          <button class="btn small" data-org="${R.esc(r.o)}">Ficha del organismo</button><button class="btn small" data-emp="${R.esc(r.nif || r.g)}">Ficha del ganador</button></div>
      </div>` : ''}
    </div>`;
  }

  function pintarEmpresas(out, v) {
    const g = agrupar(v, (r) => r.nif || r.g, (r) => r.g).slice(0, 200);
    out.innerHTML = `<div class="box"><div class="box-h"><h2>Competidores</h2><span class="muted">${g.length} empresas con estos filtros</span></div>
      <table><tr><th>Empresa</th><th class="num">Lotes</th><th class="num">Adjudicado</th><th class="num">Baja media</th><th class="num">Organismos</th></tr>
      ${g.map((e) => `<tr><td><a href="#" data-emp="${R.esc(e.k)}">${R.esc(e.nombre)}</a><div class="muted small">${R.esc(e.k)}</div></td><td class="num">${e.n}</td><td class="num">${R.eur(e.importe)}</td><td class="num">${R.pct(media(e.bajas))}</td><td class="num">${e.orgs.size}</td></tr>`).join('')}</table></div>`;
  }
  function pintarOrganismos(out, v) {
    const g = agrupar(v, (r) => r.o, (r) => r.o).slice(0, 200);
    out.innerHTML = `<div class="box"><div class="box-h"><h2>Organismos</h2><span class="muted">Los de pocas ofertas y siempre el mismo ganador son oportunidades… o contratos con dueño.</span></div>
      <table><tr><th>Organismo</th><th class="num">Lotes</th><th class="num">Adjudicado</th><th class="num">Ofertas</th><th class="num">Baja</th><th>Ganador habitual</th></tr>
      ${g.map((o) => { const top = [...o.gans.entries()].sort((a, b) => b[1] - a[1])[0]; const nombre = v.find((r) => (r.nif || r.g) === top[0])?.g || top[0];
        return `<tr><td><a href="#" data-org="${R.esc(o.k)}">${R.esc(o.nombre)}</a></td><td class="num">${o.n}</td><td class="num">${R.eur(o.importe)}</td><td class="num">${o.ofertas.length ? media(o.ofertas).toFixed(1) : '—'}</td><td class="num">${R.pct(media(o.bajas))}</td><td>${R.esc(nombre)} <span class="muted">(${Math.round(100 * top[1] / o.n)}%)</span></td></tr>`; }).join('')}</table></div>`;
  }

  function renovaciones(v) {
    const h = hoy(), lim = new Date(h); lim.setDate(lim.getDate() + 240);
    const ini = new Date(h); ini.setDate(ini.getDate() - 45);
    const vistos = new Set(), out = [];
    for (const r of v) {
      if (!r.du || r.du < 6 || r.du > 60 || !r.f) continue;
      const fin = sumarDias(r.f, r.du);
      if (fin < ini || fin > lim) continue;
      const k = r.u + '|' + r.l; if (vistos.has(k)) continue; vistos.add(k);
      out.push({ ...r, fin });
    }
    return out.sort((a, b) => a.fin - b.fin);
  }
  function pintarRenovaciones(out) {
    const h = { ...H, meses: 24 };
    const v = renovaciones(filtrar(S.filas, h));
    out.innerHTML = `<div class="box consejo">Contratos adjudicados cuyo plazo termina en los próximos meses: el organismo tendrá que volver a licitarlos. <strong>Prepárate antes de que salgan</strong>: busca proveedor y precio y vigila su perfil del contratante. <span class="muted">Fecha estimada con la duración publicada; pueden prorrogarse.</span></div>
      <div class="box"><div class="box-h"><h2>Próximas renovaciones</h2><span class="muted">${v.length} contratos (usa los filtros de arriba: palabras, CPV, comunidad…)</span></div>
      <div class="hlist">${v.slice(0, 300).map((r) => `<div class="hrow"><div class="hrow-main">
        <div><strong>${R.esc(r.ln || r.t)}</strong><div class="meta"><span>${R.esc(r.o)}</span><span>${R.esc(r.pr || r.ca)}</span><span>Adjudicado ${R.fecha(r.f)} ${r.f.slice(0, 4)} · ${r.du} meses</span></div>
          <div class="meta">Lo tiene <a href="#" data-emp="${R.esc(r.nif || r.g)}">${R.esc(r.g)}</a> · <a href="${R.esc(r.u)}" target="_blank" rel="noopener">contrato actual</a> · <a href="#" data-org="${R.esc(r.o)}">ficha del organismo</a></div></div>
        <div class="side"><div class="money">${R.eur(r.im)}</div><div class="days ${r.fin < hoy() ? 'hot' : ''}">termina ${r.fin.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}</div>${r.b !== null ? `<div class="muted small">ganó con ${R.pct(r.b)} de baja</div>` : ''}</div>
      </div></div>`).join('') || '<div class="empty">Ninguna con estos filtros. Prueba con un CPV o palabra más general.</div>'}</div></div>`;
  }

  // ---------- fichas de empresa y organismo ----------
  function ficha(titulo, sub, v, tipo) {
    const st = estadisticas(v);
    const otros = tipo === 'emp' ? agrupar(v, (r) => r.o, (r) => r.o).slice(0, 10) : agrupar(v, (r) => r.nif || r.g, (r) => r.g).slice(0, 10);
    const cpvs = agrupar(v, (r) => (r.cpv[0] || '').slice(0, 4), (r) => (r.cpv[0] || '').slice(0, 4)).slice(0, 8);
    const zonas = agrupar(v, (r) => r.ca, (r) => r.ca).slice(0, 6);
    const renov = tipo === 'org' ? renovaciones(v).slice(0, 10) : [];
    const det = document.getElementById('detail');
    det.innerHTML = `
      <div class="d-head"><div><h2>${R.esc(titulo)}</h2><div class="meta">${R.esc(sub)} · últimos 24 meses</div></div><button class="btn small close" data-close>✕</button></div>
      <div class="facts">
        <div class="fact"><div class="l">Lotes adjudicados</div><div class="v">${st.n}</div><div class="muted">${st.contratos} contratos</div></div>
        <div class="fact"><div class="l">Importe</div><div class="v">${R.eur(st.adjudicado)}</div></div>
        <div class="fact"><div class="l">Baja media</div><div class="v">${R.pct(st.bajaMedia)}</div><div class="muted">mediana ${R.pct(st.bajaMediana)}</div></div>
        <div class="fact"><div class="l">Ofertas por lote</div><div class="v">${st.ofertas !== null ? st.ofertas.toFixed(1) : '—'}</div><div class="muted">${st.unaOferta !== null ? R.pct(100 * st.unaOferta) + ' con una sola' : ''}</div></div>
      </div>
      ${tipo === 'org' && otros[0] && st.n >= 3 && otros[0].n / st.n >= 0.5 ? `<div class="box consejo"><strong>Ojo:</strong> ${R.esc(otros[0].nombre)} se lleva el ${R.pct(100 * otros[0].n / st.n)} de lo que compra este organismo.</div>` : ''}
      <div class="grid2">
        <div class="box"><h3>${tipo === 'emp' ? 'Dónde gana' : 'A quién compra'}</h3><table>${otros.map((g) => `<tr><td><a href="#" data-${tipo === 'emp' ? 'org' : 'emp'}="${R.esc(g.k)}">${R.esc(g.nombre)}</a></td><td class="num">${g.n}</td><td class="num">${R.eur(g.importe)}</td><td class="num">${R.pct(media(g.bajas))}</td></tr>`).join('')}</table></div>
        <div><div class="box"><h3>Qué productos</h3><table>${cpvs.map((g) => `<tr><td>${g.k} <span class="muted">${R.esc(cpvNombre(g.k))}</span></td><td class="num">${g.n}</td></tr>`).join('')}</table></div>
          <div class="box"><h3>Bajas</h3>${histograma(st.bajas)}</div>
          ${tipo === 'emp' ? `<div class="box"><h3>Zonas</h3><table>${zonas.map((g) => `<tr><td>${R.esc(g.k)}</td><td class="num">${g.n}</td></tr>`).join('')}</table></div>` : ''}</div>
      </div>
      ${renov.length ? `<div class="box"><h3>Contratos que vencen pronto</h3><ul class="clean">${renov.map((r) => `<li>${R.esc(r.ln || r.t)} — <strong>${r.fin.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}</strong> · ${R.esc(r.g)} · ${R.eur(r.im)}</li>`).join('')}</ul></div>` : ''}
      <div class="box"><h3>Últimas adjudicaciones</h3><table><tr><th>Fecha</th><th>Contrato</th><th>${tipo === 'emp' ? 'Organismo' : 'Ganador'}</th><th class="num">Importe</th><th class="num">Baja</th><th class="num">Of.</th></tr>
        ${v.slice(0, 40).map((r) => `<tr><td>${r.f}</td><td><a href="${R.esc(r.u)}" target="_blank" rel="noopener">${R.esc((r.ln || r.t).slice(0, 110))}</a></td><td>${R.esc(tipo === 'emp' ? r.o : r.g)}</td><td class="num">${R.eur(r.im)}</td><td class="num">${R.pct(r.b)}</td><td class="num">${r.of ?? '—'}</td></tr>`).join('')}</table></div>`;
    document.getElementById('drawer').hidden = false; document.body.style.overflow = 'hidden';
    det.scrollTop = 0;
  }
  async function fichaEmpresa(k) {
    await asegurar(24);
    const v = S.filas.filter((r) => (r.nif || r.g) === k);
    ficha(v[0]?.g || k, k, v, 'emp');
  }
  async function fichaOrganismo(o) {
    await asegurar(24);
    const v = S.filas.filter((r) => r.o === o);
    ficha(o, [v[0]?.pr, v[0]?.ca].filter(Boolean).join(', '), v, 'org');
  }

  // ---------- simulador de baja para una licitación abierta ----------
  async function simular(x, el) {
    if (!el || !(R.D.hist || []).length) return;
    el.innerHTML = '<h3>Simulador de baja</h3><p class="muted">Cargando histórico…</p>';
    await asegurar(24);
    const cpv0 = (x.cpv || [])[0] || '';
    let pref = '', v = [];
    for (const n of [5, 4, 3, 2]) {
      pref = cpv0.slice(0, n);
      v = S.filas.filter((r) => r.tp === '1' && bajaOk(r) && r.cpv.some((c) => c.startsWith(pref)));
      if (v.length >= 20) break;
    }
    if (v.length < 5) { el.innerHTML = '<h3>Simulador de baja</h3><p class="muted">No hay suficientes adjudicaciones parecidas en el histórico.</p>'; return; }
    const delOrg = v.filter((r) => r.o === x.o);
    const bajas = v.map((r) => r.b).sort((a, b) => a - b);
    const prob = (b) => bajas.filter((y) => y <= b).length / bajas.length;
    const pz = x.i || x.ve;
    const filas = [0, 5, 10, 15, 20, 25, 30, 40].map((b) => `<tr><td class="num">${b}%</td><td class="num">${pz ? R.eur(pz * (1 - b / 100)) : '—'}</td><td><div class="bar"><span style="width:${Math.round(100 * prob(b))}%"></span></div></td><td class="num"><strong>${Math.round(100 * prob(b))}%</strong></td></tr>`).join('');
    const ofs = v.filter((r) => r.of > 0).map((r) => r.of);
    el.innerHTML = `<h3>Simulador de baja</h3>
      <p class="muted">Con ${v.length} adjudicaciones de suministros con CPV ${pref}* (${R.esc(cpvNombre(pref))}). Probabilidad de que tu baja hubiera igualado o superado la del ganador. Si el precio no es el único criterio, tómalo como orientación.</p>
      <table><tr><th class="num">Tu baja</th><th class="num">Tu oferta</th><th></th><th class="num">Habrías ganado</th></tr>${filas}</table>
      <p>Baja ganadora mediana: <strong>${R.pct(pctil(bajas, 0.5))}</strong> · ofertas por lote: <strong>${ofs.length ? media(ofs).toFixed(1) : '—'}</strong>${delOrg.length ? ` · en este organismo: ${delOrg.length} adjudicaciones parecidas, baja media <strong>${R.pct(media(delOrg.map((r) => r.b)))}</strong>` : ''}</p>
      <div class="actions"><button class="btn small" data-hgo='${R.esc(JSON.stringify({ cpv: pref, q: '', org: '', gan: '', tipo: '1' }))}'>Ver estas adjudicaciones</button>
        <button class="btn small" data-org="${R.esc(x.o)}">Ficha del organismo</button></div>`;
  }

  // ---------- CSV ----------
  function csv(v) {
    const cols = ['Fecha', 'Tipo', 'Contrato', 'Lote', 'Organismo', 'Comunidad', 'Provincia', 'CPV', 'Presupuesto', 'Adjudicado', 'Baja %', 'Ofertas', 'Ganador', 'NIF', 'Duración (meses)', 'Enlace'];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const n = (x) => (x === null || x === undefined) ? '' : String(x).replace('.', ',');
    const lineas = v.map((r) => [r.f, TIPOS[r.tp] || r.tp, r.t, r.ln || r.l, r.o, r.ca, r.pr, r.cpv.join(' '), n(r.pz), n(r.im), n(r.b), n(r.of), r.g, r.nif, n(r.du), r.u].map((c, i) => [8, 9, 10, 11, 14].includes(i) ? c : q(c)).join(';'));
    const blob = new Blob(['﻿' + cols.join(';') + '\n' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `historico-licitaciones-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  // ---------- eventos globales ----------
  document.addEventListener('click', (e) => {
    if (!R) return;
    const emp = e.target.closest('[data-emp]'), org = e.target.closest('[data-org]'), cpv = e.target.closest('[data-cpv]'), go = e.target.closest('[data-hgo]');
    if (emp) { e.preventDefault(); e.stopPropagation(); fichaEmpresa(emp.dataset.emp); return; }
    if (org) { e.preventDefault(); e.stopPropagation(); fichaOrganismo(org.dataset.org); return; }
    if (cpv) { e.preventDefault(); e.stopPropagation(); mostrar({ cpv: cpv.dataset.cpv, q: '' }); return; }
    if (go) { e.preventDefault(); e.stopPropagation(); mostrar(JSON.parse(go.dataset.hgo)); return; }
    const row = e.target.closest('#hOut .hrow[data-i]');
    if (row && !e.target.closest('a,button')) { const i = +row.dataset.i; abiertoIdx = abiertoIdx === i ? -1 : i; pintar(); }
  }, true);

  async function mostrar(preset) {
    if (preset) { Object.assign(H, preset); R.store.set('hist', H); pagina = 1; abiertoIdx = -1; S.vista = 'buscar'; }
    if (!document.getElementById('tab-historico').classList.contains('active')) { R.ir('historico'); return; }
    const d = document.getElementById('drawer'); if (d && !d.hidden) d.querySelector('[data-close]')?.click();
    base();
    await asegurar(Math.max(H.meses, 3));
    base(); pintar();
  }
  function init(api) {
    R = api;
    Object.assign(H, R.store.get('hist', {}));
  }
  window.HIST = { init, mostrar, simular, fichaEmpresa, fichaOrganismo };
})();
