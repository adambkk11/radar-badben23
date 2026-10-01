/* Radar BadBen23 – web privada de licitaciones (sin dependencias externas). */
(() => {
  'use strict';

  // ---------- utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (x) => (x || x === 0) ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(x) + ' €' : '—';
  const pct = (x) => (x || x === 0) ? `${Math.round(x)}%` : '—';
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('radar:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('radar:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem('radar:' + k); } catch { /* */ } },
  };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = (f) => { if (!f) return null; const d = new Date(f + 'T00:00:00'); return Math.round((d - hoy) / 86400000); };
  const fecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—';
  const toast = (t) => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2200); };

  // ---------- tema ----------
  const tema = store.get('tema', '');
  if (tema) document.documentElement.dataset.theme = tema;
  $('#themeBtn').onclick = () => {
    const actual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo; store.set('tema', nuevo);
  };

  // ---------- carga y descifrado ----------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function gunzip(buf) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(ds).text());
  }
  async function descifrar(enc, pwd) {
    const ck = enc.salt + '\n' + pwd;
    if (!CLAVES[ck]) CLAVES[ck] = crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey'])
      .then((km) => crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.it, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']));
    const key = await CLAVES[ck];
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    return gunzip(plano);
  }
  let ENC = null, PWD = null;
  const CLAVES = {};
  async function arrancar() {
    const t = '?t=' + Date.now();
    let r = await fetch('data.enc' + t).catch(() => null);
    if (r && r.ok) {
      ENC = await r.json();
      const guardada = store.get('pwd', null) || sessionStorage.getItem('radar:pwd');
      if (guardada) { try { const d = await descifrar(ENC, guardada); PWD = guardada; iniciar(d); return; } catch { store.del('pwd'); } }
      $('#lock').hidden = false; $('#pwd').focus();
      return;
    }
    r = await fetch('data.json.gz' + t).catch(() => null);
    if (r && r.ok) { iniciar(await gunzip(await r.arrayBuffer())); return; }
    $('#lockMsg').textContent = 'No hay datos todavía. Espera a que termine la primera actualización.';
  }
  $('#lockForm').onsubmit = async (e) => {
    e.preventDefault();
    const pwd = $('#pwd').value;
    $('#lockMsg').textContent = 'Abriendo…';
    try {
      const d = await descifrar(ENC, pwd);
      PWD = pwd;
      try { sessionStorage.setItem('radar:pwd', pwd); } catch { /* */ }
      if ($('#remember').checked) store.set('pwd', pwd);
      iniciar(d);
    } catch { $('#lockMsg').textContent = 'Contraseña incorrecta'; }
  };

  // ---------- estado ----------
  let D = null, L = [], BY = {};
  const ESTADOS = [
    ['interesa', 'Me interesa'], ['precios', 'Pidiendo precios'], ['preparando', 'Preparando oferta'],
    ['presentada', 'Presentada'], ['ganada', 'Ganada'], ['perdida', 'Perdida'], ['descartada', 'Descartada'],
  ];
  const seg = () => store.get('seguimiento', {});
  const setSeg = (id, obj) => { const s = seg(); if (obj === null) delete s[id]; else s[id] = { ...(s[id] || {}), ...obj, t: Date.now() }; store.set('seguimiento', s); };
  const F = Object.assign({ q: '', cpv: '', prio: ['A', 'B'], fam: [], ca: [], imin: '', imax: '', dmax: '', simpl: false, noarm: true, pmin: '', ai: false, rec: '', nuevas: false }, store.get('filtros', {}));
  let orden = store.get('orden', 'nota'), pagina = 1;
  const ultimaVisita = store.get('ultimaVisita', '');

  function iniciar(datos) {
    D = datos; L = datos.licitaciones; BY = Object.fromEntries(L.map((x) => [x.id, x]));
    L.forEach((x) => { x._d = dias(x.ff); if (x._d === 0 && /^\d{1,2}:\d{2}/.test(x.hf || '')) { const [hh, mm] = x.hf.split(':').map(Number), ah = new Date(); if (ah.getHours() * 60 + ah.getMinutes() > hh * 60 + mm) x._d = -1; } x._txt = norm([x.t, x.o, x.x, x.pr, x.ca, x.mu, (x.cpv || []).join(' '), (x.l || []).map((l) => l.n).join(' '), x.ai?.resumen].join(' ')); });
    $('#lock').hidden = true; $('#app').hidden = false;
    $('#updated').textContent = 'Actualizado ' + new Date(datos.generado).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    store.set('ultimaVisita', new Date().toISOString().slice(0, 10));
    $('#q').value = F.q; $('#sort').value = orden;
    window.RADAR = { D, BY, filtrar, ordenar, abrir, ir, store, esc, eur, pct, fecha, toast, seg, setSeg, ESTADOS, diasTxt, copiar };
    if (window.TRABAJO) window.TRABAJO.init(window.RADAR);
    if (window.HIST) window.HIST.init({ leer, store, esc, eur, pct, norm, fecha, toast, ir, D });
    montarFiltros(); pintarInicio(); pintarLista(); pintarTablero(); pintarCalendario(); pintarCompetencia();
    const horas = (Date.now() - new Date(datos.generado).getTime()) / 3600000;
    if (horas > 12) { $('#updated').classList.add('viejo'); $('#updated').title = 'La actualización automática puede estar fallando: revisa Actions en GitHub'; toast(`Datos de hace ${Math.round(horas)} horas`); }
    const h = location.hash.slice(1);
    if (h.startsWith('l=')) abrir(decodeURIComponent(h.slice(2)));
  }

  async function leer(f, h) {
    const r = await fetch(f + '?v=' + encodeURIComponent(h || D.generado));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return f.endsWith('.enc') ? descifrar(await r.json(), PWD) : gunzip(await r.arrayBuffer());
  }

  // ---------- pestañas ----------
  function ir(tab) {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
    window.scrollTo({ top: 0 });
    if (tab === 'historico' && window.HIST) window.HIST.mostrar();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) ir(b.dataset.tab); };

  // ---------- filtros ----------
  function filtrar() {
    const q = norm(F.q).split(/\s+/).filter(Boolean);
    const cps = String(F.cpv || '').split(/[\s,;]+/).map((c) => c.replace(/\D/g, '')).filter(Boolean);
    return L.filter((x) => {
      if (q.length && !q.every((w) => x._txt.includes(w))) return false;
      if (F.prio.length && !F.prio.includes(x.pa)) return false;
      if (F.fam.length && !F.fam.includes(x.f)) return false;
      if (F.ca.length && !F.ca.includes(x.ca || 'Sin dato')) return false;
      if (cps.length && !(x.cpv || []).some((c) => cps.some((p) => c.startsWith(p)))) return false;
      const imp = x.i || x.ve || 0;
      if (F.imin && imp < +F.imin) return false;
      if (F.imax && imp > +F.imax) return false;
      if (F.dmax && (x._d === null || x._d > +F.dmax)) return false;
      if (F.simpl && x.p !== 'Abierto simplificado') return false;
      if (F.noarm && x.a) return false;
      if (F.pmin && (x.pp === null || x.pp === undefined || x.pp < +F.pmin)) return false;
      if (F.ai && !x.ai) return false;
      if (F.rec && x.ai?.recomendacion !== F.rec) return false;
      if (F.nuevas && ultimaVisita && x.nv < ultimaVisita) return false;
      return true;
    });
  }
  function ordenar(v) {
    const k = {
      nota: (a, b) => b.n - a.n || (a._d ?? 999) - (b._d ?? 999),
      cierre: (a, b) => (a._d ?? 999) - (b._d ?? 999),
      importe: (a, b) => (b.i || b.ve || 0) - (a.i || a.ve || 0),
      nuevas: (a, b) => (b.nv || '').localeCompare(a.nv || '') || b.n - a.n,
    }[orden];
    return v.sort(k);
  }
  function montarFiltros() {
    const cnt = (fn) => { const m = {}; L.forEach((x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; }); return m; };
    const fams = cnt((x) => x.f), cas = cnt((x) => x.ca || 'Sin dato');
    const chips = (grupo, valores, etiqueta) => valores.map(([v, n]) =>
      `<button class="chip ${F[grupo].includes(v) ? 'on' : ''}" data-g="${grupo}" data-v="${esc(v)}">${esc(etiqueta(v))} <span class="muted">${n}</span></button>`).join('');
    $('#filters').innerHTML = `
      <div class="box-h"><h3>Filtros</h3><button class="btn small ghost" id="fReset">Limpiar</button></div>
      <h3>Prioridad</h3><div class="chips">${chips('prio', [['A', L.filter((x) => x.pa === 'A').length], ['B', L.filter((x) => x.pa === 'B').length], ['C', L.filter((x) => x.pa === 'C').length]], (v) => v)}</div>
      <h3>Producto</h3><div class="chips">${chips('fam', Object.entries(fams).filter(([k]) => k).sort((a, b) => b[1] - a[1]), (v) => D.familias[v]?.nombre || v)}</div>
      <h3>Comunidad</h3><div class="chips">${chips('ca', Object.entries(cas).sort((a, b) => b[1] - a[1]), (v) => v)}</div>
      <h3>CPV (empieza por)</h3><input type="text" id="fCpv" placeholder="ej. 1811 3913" value="${esc(F.cpv)}">
      <h3>Importe (sin IVA)</h3><div class="row2"><input type="number" id="fImin" placeholder="mín." value="${esc(F.imin)}"><input type="number" id="fImax" placeholder="máx." value="${esc(F.imax)}"></div>
      <h3>Cierra en</h3><select id="fDmax"><option value="">Cualquier fecha</option>${[3, 7, 14, 30].map((d) => `<option value="${d}" ${+F.dmax === d ? 'selected' : ''}>≤ ${d} días</option>`).join('')}</select>
      <h3>Condiciones</h3>
      <label><input type="checkbox" id="fNoarm" ${F.noarm ? 'checked' : ''}> Sin contratos armonizados</label>
      <label><input type="checkbox" id="fSimpl" ${F.simpl ? 'checked' : ''}> Solo abierto simplificado</label>
      <label><input type="checkbox" id="fAi" ${F.ai ? 'checked' : ''}> Solo analizadas con IA</label>
      <label><input type="checkbox" id="fNuevas" ${F.nuevas ? 'checked' : ''}> Nuevas desde mi última visita</label>
      <h3>Peso mínimo del precio</h3><select id="fPmin"><option value="">Da igual</option>${[60, 80, 100].map((p) => `<option value="${p}" ${+F.pmin === p ? 'selected' : ''}>≥ ${p}%</option>`).join('')}</select>
      <h3>Recomendación IA</h3><select id="fRec"><option value="">Todas</option><option value="presentarse" ${F.rec === 'presentarse' ? 'selected' : ''}>Presentarse</option><option value="estudiar" ${F.rec === 'estudiar' ? 'selected' : ''}>Estudiar</option><option value="descartar" ${F.rec === 'descartar' ? 'selected' : ''}>Descartar</option></select>
      <button class="btn wide only-mobile" id="fClose">Ver resultados</button>`;
  }
  $('#filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) { const g = c.dataset.g, v = c.dataset.v; F[g] = F[g].includes(v) ? F[g].filter((x) => x !== v) : [...F[g], v]; cambiar(); montarFiltros(); }
    if (e.target.id === 'fReset') { Object.assign(F, { q: '', cpv: '', prio: [], fam: [], ca: [], imin: '', imax: '', dmax: '', simpl: false, noarm: false, pmin: '', ai: false, rec: '', nuevas: false }); $('#q').value = ''; cambiar(); montarFiltros(); }
    if (e.target.id === 'fClose') $('#filters').classList.remove('open');
  });
  $('#filters').addEventListener('change', (e) => {
    const m = { fCpv: 'cpv', fImin: 'imin', fImax: 'imax', fDmax: 'dmax', fPmin: 'pmin', fRec: 'rec' };
    const c = { fNoarm: 'noarm', fSimpl: 'simpl', fAi: 'ai', fNuevas: 'nuevas' };
    if (m[e.target.id]) F[m[e.target.id]] = e.target.value;
    if (c[e.target.id]) F[c[e.target.id]] = e.target.checked;
    cambiar();
  });
  $('#filtersBtn').onclick = () => $('#filters').classList.add('open');
  let tq;
  $('#q').addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(() => { F.q = $('#q').value; cambiar(); if (F.q) ir('buscar'); }, 200); });
  $('#sort').onchange = () => { orden = $('#sort').value; store.set('orden', orden); cambiar(); };
  $('#more').onclick = () => { pagina++; pintarLista(); };
  function cambiar() { store.set('filtros', F); pagina = 1; pintarLista(); }

  // ---------- tarjetas ----------
  function etiquetas(x) {
    const t = [];
    if (x.p === 'Abierto simplificado') t.push(['good', 'Simplificado']);
    if (x.a) t.push(['bad', 'Armonizado']);
    if (x.pp !== null && x.pp !== undefined) t.push([x.pp >= 80 ? 'good' : x.pp < 50 ? 'bad' : '', `Precio ${pct(x.pp)}`]);
    if (x.s && x.s !== 'No aplica') t.push(['warn', x.s]);
    if (x.l?.length) t.push(['', `${x.l.length} lotes`]);
    if (x.ai) t.push(['ai', `IA: ${x.ai.recomendacion || 'analizada'}`]);
    if (ultimaVisita && x.nv >= ultimaVisita) t.push(['warn', 'Nueva']);
    const s = seg()[x.id]; if (s?.estado) t.push(['ai', ESTADOS.find((e) => e[0] === s.estado)?.[1] || s.estado]);
    return t.map(([c, v]) => `<span class="tag ${c}">${esc(v)}</span>`).join('');
  }
  const diasTxt = (d) => d === null ? '' : d < 0 ? 'cerrada' : d === 0 ? 'cierra hoy' : `cierra en ${d} d`;
  function card(x) {
    return `<div class="card" data-id="${esc(x.id)}">
      <div class="score ${x.pa}">${x.n}<small>${x.pa}</small></div>
      <div><h3>${esc(x.t)}</h3>
        <div class="meta"><span>${esc(x.o)}</span><span>${esc(x.pr || x.ca || '')}</span><span>${esc(D.familias[x.f]?.nombre || '')}</span></div>
        <div class="tags">${etiquetas(x)}</div></div>
      <div class="side"><div class="money">${eur(x.i || x.ve)}</div><div class="days ${x._d !== null && x._d <= 5 ? 'hot' : ''}">${diasTxt(x._d)}</div><div class="muted">${fecha(x.ff)}</div></div>
    </div>`;
  }
  function pintarLista() {
    const v = ordenar(filtrar());
    $('#count').textContent = `${v.length} licitaciones`;
    const n = pagina * 40;
    $('#list').innerHTML = v.length ? v.slice(0, n).map(card).join('') : '<div class="empty">No hay licitaciones con estos filtros.</div>';
    $('#more').hidden = v.length <= n;
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c && !e.target.closest('a,button,select,textarea,input')) abrir(c.dataset.id);
    if (e.target.closest('[data-close]')) cerrar();
    const k = e.target.closest('[data-go]');
    if (k) { Object.assign(F, JSON.parse(k.dataset.go)); montarFiltros(); cambiar(); ir('buscar'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cerrar(); $('#filters').classList.remove('open'); } });
  document.addEventListener('click', (e) => {
    const f = $('#filters');
    if (f.classList.contains('open') && !f.contains(e.target) && !e.target.closest('#filtersBtn')) { f.classList.remove('open'); e.stopPropagation(); e.preventDefault(); }
  }, true);

  // ---------- inicio ----------
  function pintarInicio() {
    const t = D.totales;
    const A = L.filter((x) => x.pa === 'A' && !x.a);
    const semana = L.filter((x) => (x.pa === 'A' || x.pa === 'B') && x._d !== null && x._d >= 0 && x._d <= 7);
    const nuevas = ultimaVisita ? L.filter((x) => x.nv >= ultimaVisita && x.pa !== 'C') : [];
    const top = [...A].sort((a, b) => b.n - a.n || (a._d ?? 99) - (b._d ?? 99)).slice(0, 8);
    const prox = [...semana].sort((a, b) => a._d - b._d).slice(0, 8);
    const fams = {}; L.filter((x) => x.pa !== 'C').forEach((x) => { fams[x.f] = (fams[x.f] || 0) + 1; });
    const maxF = Math.max(1, ...Object.values(fams));
    const reco = L.filter((x) => x.ai?.recomendacion === 'presentarse');
    $('#tab-inicio').innerHTML = `
      <div class="kpis">
        <div class="kpi" data-go='{"prio":["A"],"noarm":true}'><div class="v" style="color:var(--a)">${A.length}</div><div class="l">Encajan mucho (A)</div></div>
        <div class="kpi" data-go='{"prio":["B"]}'><div class="v" style="color:var(--b)">${t.B}</div><div class="l">Interesantes (B)</div></div>
        <div class="kpi" data-go='{"prio":["A","B"],"dmax":"7"}'><div class="v">${semana.length}</div><div class="l">Cierran en 7 días</div></div>
        <div class="kpi" data-go='{"prio":["A","B"],"nuevas":true}'><div class="v">${nuevas.length}</div><div class="l">Nuevas desde tu visita</div></div>
        <div class="kpi" data-go='{"prio":[],"rec":"presentarse"}'><div class="v" style="color:var(--accent)">${reco.length}</div><div class="l">La IA dice «presentarse»</div></div>
        <div class="kpi" data-go='{"prio":[]}'><div class="v">${t.abiertas}</div><div class="l">Suministros abiertos</div></div>
      </div>
      <div id="hoyMio"></div>
      <div class="grid2">
        <div>
          <div class="box"><div class="box-h"><h2>Las mejores para presentarse</h2><a href="#" data-go='{"prio":["A"],"noarm":true}'>ver todas</a></div>
            <div class="list">${top.map(card).join('') || '<div class="empty">Sin licitaciones A ahora mismo.</div>'}</div></div>
        </div>
        <div>
          <div class="box"><div class="box-h"><h2>Cierran pronto</h2></div>
            ${prox.map((x) => `<div class="cal-item" data-id="${esc(x.id)}"><div class="score ${x.pa}" style="width:42px;height:42px;font-size:.9rem">${x.n}</div><div><strong>${esc(x.t.slice(0, 90))}</strong><div class="meta">${esc(x.o)}</div></div><div class="days hot">${diasTxt(x._d)}</div></div>`).join('') || '<div class="empty">Nada urgente.</div>'}
          </div>
          <div class="box"><div class="box-h"><h2>Por producto (A y B)</h2></div>
            ${Object.entries(fams).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="famrow" data-go='{"fam":["${esc(k)}"],"prio":["A","B"]}'><div>${esc(D.familias[k]?.nombre || 'Otros')}<div class="bar"><span style="width:${100 * n / maxF}%"></span></div></div><div class="money" style="text-align:right">${n}</div></div>`).join('')}
          </div>
          <div class="box"><div class="muted" style="font-size:.85rem">Datos oficiales de la Plataforma de Contratación del Sector Público y plataformas autonómicas agregadas. ${t.analizadas} licitaciones analizadas con IA · ${t.adjudicaciones} adjudicaciones en el histórico.</div></div>
        </div>
      </div>`;
    if (window.TRABAJO) window.TRABAJO.inicio();
  }

  // ---------- ficha ----------
  function rfq(x) {
    const art = x.ai?.que_se_compra?.length ? x.ai.que_se_compra : (x.l?.length ? x.l.map((l) => l.n) : [x.t]);
    return `Hello,\n\nWe need your best price for the following items (public tender, Spain):\n\n${art.map((a) => '- ' + a).join('\n')}\n\nPlease include: unit price (EXW/FOB), MOQ, production time, certificates (CE / EN standards) and a photo or datasheet.\nDeadline for your quote: ${x.ff ? new Date(new Date(x.ff).getTime() - 3 * 86400000).toISOString().slice(0, 10) : 'as soon as possible'}.\n\nThank you,\nAdam Benktib\nGrupo BadBen23 S.L.`;
  }
  function abrir(id) {
    const x = BY[id]; if (!x) return;
    history.replaceState(null, '', '#l=' + encodeURIComponent(id));
    const s = seg()[id] || {};
    const ai = x.ai;
    const aiHtml = ai ? `
      <div class="box ai-box"><div class="box-h"><h2>Análisis de los pliegos (IA)</h2><span class="rec ${esc(ai.recomendacion)}">${esc(ai.recomendacion || '')}</span></div>
        <p>${esc(ai.resumen)}</p>
        ${ai.motivo ? `<p><strong>Por qué:</strong> ${esc(ai.motivo)}</p>` : ''}
        <dl class="kv">
          ${ai.que_se_compra?.length ? `<dt>Qué se compra</dt><dd><ul class="clean">${ai.que_se_compra.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></dd>` : ''}
          <dt>Peso del precio</dt><dd>${pct(ai.peso_precio ?? x.pp)} ${ai.otros_criterios ? '· ' + esc(ai.otros_criterios) : ''}</dd>
          <dt>Solvencia</dt><dd>${ai.solvencia ? `${ai.solvencia.exenta ? '<span class="tag good">Exenta</span> ' : ''}${ai.solvencia.exige_tecnica ? '<span class="tag warn">Pide técnica</span> ' : ''}${ai.solvencia.exige_economica ? '<span class="tag warn">Pide económica</span> ' : ''}<br>${esc(ai.solvencia.detalle || '')}<br><span class="muted">Empresa nueva: ${esc(ai.solvencia.admite_empresa_nueva || '—')}</span>` : '—'}</dd>
          <dt>ROLECE</dt><dd>${ai.rolece === true ? 'Sí, obligatorio' : ai.rolece === false ? 'No' : '—'}</dd>
          <dt>Entrega</dt><dd>${esc(ai.plazo_entrega || '—')} ${ai.entregas ? `· <span class="muted">${esc(ai.entregas.replace('_', ' '))}</span>` : ''}</dd>
          <dt>Duración</dt><dd>${esc(ai.duracion_contrato || x.du || '—')}</dd>
          <dt>Muestras</dt><dd>${esc(ai.muestras || 'No')}</dd>
          <dt>EPI categoría III</dt><dd>${ai.epi_categoria_iii ? '<span class="tag bad">Sí</span>' : ai.epi_categoria_iii === false ? 'No' : '—'}</dd>
          <dt>Montaje / instalación</dt><dd>${ai.montaje_instalacion ? '<span class="tag warn">Sí</span>' : ai.montaje_instalacion === false ? 'No' : '—'}</dd>
          <dt>Idioma de la oferta</dt><dd>${esc(ai.idioma_oferta || '—')}</dd>
          <dt>Garantía definitiva</dt><dd>${esc(ai.garantia_definitiva || '—')}</dd>
          <dt>Socio recomendado</dt><dd><strong>${esc(ai.socio_recomendado || D.familias[x.f]?.socio || '—')}</strong></dd>
          ${ai.puntos_fuertes?.length ? `<dt>A favor</dt><dd><ul class="clean">${ai.puntos_fuertes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></dd>` : ''}
          ${ai.riesgos?.length ? `<dt>Riesgos</dt><dd><ul class="clean">${ai.riesgos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></dd>` : ''}
        </dl>
        ${ai._pliegos_leidos?.length ? `<p class="muted" style="font-size:.8rem">Pliegos leídos: ${ai._pliegos_leidos.map(esc).join(' · ')}</p>` : ''}
      </div>` : `<div class="box"><p class="muted">Aún sin análisis de IA. Se analizan automáticamente las que mejor encajan en cada actualización.</p></div>`;
    const lotes = x.l?.length ? `<div class="box"><h3>Lotes</h3><table><tr><th>Lote</th><th>Descripción</th><th class="num">Importe</th><th class="num">Precio</th></tr>${x.l.map((l) => `<tr><td>${esc(l.id)}</td><td>${esc(l.n)}</td><td class="num">${eur(l.i)}</td><td class="num">${pct(l.pp)}</td></tr>`).join('')}</table></div>` : '';
    const crit = x.c?.length ? `<div class="box"><h3>Criterios de adjudicación</h3><table>${x.c.map((c) => `<tr><td>${esc(c.descripcion)}</td><td class="num">${c.peso ?? '—'}</td></tr>`).join('')}</table></div>` : '';
    const req = x.rq && (x.rq.tecnica?.length || x.rq.economica?.length || x.rq.otros?.length) ? `<div class="box"><h3>Requisitos publicados</h3><ul class="clean">${[...(x.rq.economica || []).map((r) => '💶 ' + r), ...(x.rq.tecnica || []).map((r) => '🛠 ' + r), ...(x.rq.otros || [])].map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : '';
    const sim = x.sim?.length ? `<div class="box"><h3>Qué pasó en contratos parecidos</h3><table><tr><th>Contrato</th><th>Ganó</th><th class="num">Adjudicado</th><th class="num">Baja</th><th class="num">Ofertas</th></tr>${x.sim.map((s) => `<tr><td>${esc(s.titulo)}<div class="muted">${esc(s.organo)} · ${esc(s.fecha || '')}</div></td><td>${esc(s.ganador)}</td><td class="num">${eur(s.importe)}</td><td class="num">${s.baja !== null ? pct(s.baja) : '—'}</td><td class="num">${s.ofertas ?? '—'}</td></tr>`).join('')}</table></div>` : '';
    const comp = D.competencia?.[x.f];
    const compHtml = comp?.n ? `<div class="box"><h3>Competencia en ${esc(comp.nombre)}</h3><p class="muted">${comp.n} adjudicaciones · baja media ${pct(comp.baja_media)} · ${comp.ofertas_media ?? '—'} ofertas de media</p>
      <p>Para ganar con precio como criterio único, piensa en una baja alrededor del <strong>${pct(comp.baja_mediana)}</strong> (mediana del histórico).</p></div>` : '';
    const docs = x.d?.length ? x.d.map((d) => `<a class="btn small" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.tipo)} · ${esc((d.nombre || '').slice(0, 40))}</a>`).join('') : '';
    $('#detail').innerHTML = `
      <div class="d-head"><div class="score ${x.pa}">${x.n}<small>${x.pa}</small></div>
        <div><h2>${esc(x.t)}</h2><div class="meta"><span>${esc(x.o)}</span><span>${esc([x.mu, x.pr, x.ca].filter(Boolean).join(', '))}</span><span>Exp. ${esc(x.x)}</span></div><div class="tags">${etiquetas(x)}</div></div>
        <button class="btn small close" data-close>✕</button></div>
      <div class="facts">
        <div class="fact"><div class="l">Presupuesto sin IVA</div><div class="v">${eur(x.i)}</div></div>
        <div class="fact"><div class="l">Valor estimado</div><div class="v">${eur(x.ve)}</div></div>
        <div class="fact"><div class="l">Fin de plazo</div><div class="v">${fecha(x.ff)} ${esc(x.hf || '')}</div><div class="muted">${diasTxt(x._d)}</div></div>
        <div class="fact"><div class="l">Procedimiento</div><div class="v">${esc(x.p)}</div><div class="muted">${esc(x.ur || '')}</div></div>
        <div class="fact"><div class="l">Peso del precio</div><div class="v">${pct(x.pp)}</div></div>
        <div class="fact"><div class="l">Producto</div><div class="v">${esc(D.familias[x.f]?.nombre || '—')}</div><div class="muted">${esc(D.familias[x.f]?.socio || '')}</div></div>
      </div>
      <div class="actions">
        <a class="btn primary" href="${esc(x.u)}" target="_blank" rel="noopener">Abrir en la plataforma oficial</a>
        <select id="dEstado"><option value="">Seguimiento…</option>${ESTADOS.map(([k, v]) => `<option value="${k}" ${s.estado === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn" id="dRfq">Copiar petición de precios</button>
        <button class="btn" id="dLink">Copiar enlace</button>
        <button class="btn" data-hgo='${esc(JSON.stringify({ cpv: (x.cpv?.[0] || '').slice(0, 5), q: '', org: '', gan: '', tipo: '1' }))}'>Histórico de este CPV</button>
        <button class="btn" data-org="${esc(x.o)}">Ficha del organismo</button>
      </div>
      ${docs ? `<div class="actions">${docs}</div>` : ''}
      ${aiHtml}
      <div class="box" id="dCalc"></div>
      <div class="box" id="dSim"></div>
      <div class="box" id="dCheck"></div>
      <div class="box"><h3>Por qué tiene esta nota</h3><ul class="clean">${(x.m || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
      ${compHtml}${sim}${lotes}${crit}${req}
      <div class="box"><h3>Mis notas</h3><textarea id="dNotas" placeholder="Proveedor, precio conseguido, dudas del pliego…">${esc(s.notas || '')}</textarea></div>`;
    $('#drawer').hidden = false; document.body.style.overflow = 'hidden';
    $('#dEstado').onchange = (e) => { setSeg(id, { estado: e.target.value || undefined }); if (!e.target.value) { const ss = seg(); if (ss[id] && !ss[id].notas) setSeg(id, null); } toast('Guardado en tu tablero'); pintarTablero(); pintarLista(); pintarInicio(); };
    $('#dNotas').oninput = (e) => setSeg(id, { notas: e.target.value });
    $('#dRfq').onclick = () => copiar(rfq(x), 'Petición de precios copiada');
    $('#dLink').onclick = () => copiar(location.href, 'Enlace copiado');
    if (window.HIST && (D.hist || []).length) window.HIST.simular(x, $('#dSim')); else $('#dSim').remove();
    if (window.TRABAJO) window.TRABAJO.ficha(x); else { $('#dCalc').remove(); $('#dCheck').remove(); }
  }
  function cerrar() { if ($('#drawer').hidden) return; $('#drawer').hidden = true; document.body.style.overflow = ''; history.replaceState(null, '', location.pathname); }
  function copiar(t, msg) { (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast(msg)).catch(() => { prompt('Copia el texto:', t); }); }

  // ---------- tablero ----------
  function pintarTablero() {
    const s = seg();
    const cols = ESTADOS.map(([k, v]) => {
      const items = Object.entries(s).filter(([, o]) => o.estado === k).map(([id]) => BY[id] || { id, t: '(ya no está abierta)', o: '', _d: null, pa: 'C', n: '' });
      return `<div class="col" data-col="${k}"><h3>${v}<span class="muted">${items.length}</span></h3>
        ${items.map((x) => `<div class="kcard" draggable="true" data-id="${esc(x.id)}"><strong>${esc((x.t || '').slice(0, 90))}</strong><div class="meta"><span>${esc(x.o || '')}</span><span class="${x._d !== null && x._d <= 5 ? 'days hot' : ''}">${diasTxt(x._d)}</span></div></div>`).join('')}</div>`;
    }).join('');
    $('#tab-tablero').innerHTML = `
      <div class="box-h"><h2>Mi tablero</h2><div class="actions" style="margin:0"><button class="btn small" id="kExp">Exportar</button><label class="btn small">Importar<input type="file" id="kImp" accept="application/json" hidden></label></div></div>
      <p class="muted">Arrastra las tarjetas entre columnas (en el móvil, cambia el estado desde la ficha). Se guarda en este dispositivo (con tus notas, calculadoras y checklists); usa Exportar/Importar para pasarlo a otro.</p>
      <div class="kanban">${cols}</div>`;
    $$('.kcard').forEach((c) => c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.dataset.id)));
    $$('.col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop'); setSeg(e.dataTransfer.getData('text/plain'), { estado: col.dataset.col }); pintarTablero(); });
    });
    $('#kExp').onclick = () => {
      const todo = { v: 2, seguimiento: seg(), calc: store.get('calc', {}), check: store.get('check', {}), hbusq: store.get('hbusq', []) };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(todo, null, 1)], { type: 'application/json' }));
      a.download = `radar-tablero-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    };
    $('#kImp').onchange = async (e) => {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        if (d && d.v === 2) {
          store.set('seguimiento', { ...seg(), ...(d.seguimiento || {}) });
          store.set('calc', { ...store.get('calc', {}), ...(d.calc || {}) });
          store.set('check', { ...store.get('check', {}), ...(d.check || {}) });
          if (Array.isArray(d.hbusq)) store.set('hbusq', d.hbusq);
        } else store.set('seguimiento', { ...seg(), ...d });
        pintarTablero(); pintarInicio(); pintarLista(); toast('Tablero importado');
      } catch { toast('Archivo no válido'); }
    };
  }

  // ---------- calendario ----------
  function pintarCalendario() {
    const s = seg();
    const v = L.filter((x) => x._d !== null && x._d >= 0 && x._d <= 45 && (x.pa !== 'C' || s[x.id])).sort((a, b) => a._d - b._d || b.n - a.n);
    const grupos = {}; v.forEach((x) => { (grupos[x.ff] = grupos[x.ff] || []).push(x); });
    $('#tab-calendario').innerHTML = `<h2>Próximos cierres</h2><p class="muted">Licitaciones A y B y las de tu tablero, por fecha de fin de plazo.</p>` +
      (Object.entries(grupos).map(([f, xs]) => `<div class="day"><h3>${new Date(f + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} · ${diasTxt(xs[0]._d)}</h3>
        ${xs.map((x) => `<div class="cal-item" data-id="${esc(x.id)}"><div class="score ${x.pa}" style="width:42px;height:42px;font-size:.9rem">${x.n}</div><div><strong>${esc(x.t.slice(0, 110))}</strong><div class="meta"><span>${esc(x.o)}</span><span>${esc(x.hf || '')}</span>${s[x.id]?.estado ? `<span class="tag ai">${esc(ESTADOS.find((e) => e[0] === s[x.id].estado)?.[1])}</span>` : ''}</div></div><div class="money">${eur(x.i || x.ve)}</div></div>`).join('')}</div>`).join('') || '<div class="empty">Sin cierres próximos.</div>');
  }

  // ---------- competencia ----------
  function pintarCompetencia() {
    const C = D.competencia || {};
    const ent = Object.entries(C).filter(([, c]) => c.n).sort((a, b) => b[1].n - a[1].n);
    $('#tab-competencia').innerHTML = `<h2>Competencia</h2><p class="muted">Quién gana y con qué baja, calculado con las adjudicaciones oficiales guardadas (${D.totales.adjudicaciones}). Cuanto más histórico cargues, más fiable.</p>
      <div class="search" style="margin:10px 0 16px"><input id="compQ" type="search" placeholder="Buscar empresa…"></div>
      <div id="compList">${ent.map(([k, c]) => `<div class="box"><div class="box-h"><h2>${esc(c.nombre)}</h2><span class="muted">${c.n} adjudicaciones</span></div>
        <div class="facts"><div class="fact"><div class="l">Baja media</div><div class="v">${pct(c.baja_media)}</div></div><div class="fact"><div class="l">Baja mediana</div><div class="v">${pct(c.baja_mediana)}</div></div><div class="fact"><div class="l">Ofertas por contrato</div><div class="v">${c.ofertas_media ?? '—'}</div></div></div>
        <table><tr><th>Empresa</th><th class="num">Ganados</th><th class="num">Importe</th><th class="num">Baja media</th><th>Zonas</th></tr>
        ${c.ganadores.map((g) => `<tr class="comp-row" data-n="${esc(norm(g.nombre + ' ' + g.nif))}"><td>${esc(g.nombre)}<div class="muted">${esc(g.nif)}</div></td><td class="num">${g.n}</td><td class="num">${eur(g.importe)}</td><td class="num">${pct(g.baja_media)}</td><td>${esc(g.ccaa.join(', '))}</td></tr>`).join('')}</table></div>`).join('') || '<div class="empty">Todavía no hay adjudicaciones. Ejecuta la carga de histórico para ver la competencia.</div>'}</div>`;
    $('#compQ').oninput = (e) => { const q = norm(e.target.value); $$('.comp-row').forEach((r) => r.hidden = q && !r.dataset.n.includes(q)); };
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  arrancar();
})();
