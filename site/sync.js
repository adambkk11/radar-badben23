/* Radar BadBen23 – sincronización entre dispositivos (móvil, PC…).
   Tu tablero, notas, calculadoras, checklists, precios y datos de empresa se guardan CIFRADOS con tu contraseña
   en un archivo de tu repositorio de GitHub (rama «datos-usuario»), usando un token que solo tú creas y pegas. */
(() => {
  'use strict';
  const CLAVES = ['seguimiento', 'calc', 'check', 'hbusq', 'empresa', 'precios'];
  const RAMA = 'datos-usuario', ARCHIVO = 'tablero.enc';
  const LS = (k) => 'radar:' + k;
  const get = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  const del = (k) => { try { localStorage.removeItem(LS(k)); } catch { /* */ } };
  let api = null, sha = null, ocupado = false, pendiente = false, tProg = null, ultimo = get('syncultimo', null), error = '';
  const token = () => get('ghtoken', '');
  const meta = () => get('syncmeta', {});
  const esObjeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

  // ---------- registro de cambios (lo llama store.set de app.js) ----------
  function cambio(k, viejo, nuevo) {
    if (!CLAVES.includes(k)) return;
    const m = meta(), mk = (m[k] = m[k] || {}), ahora = Date.now();
    if (esObjeto(nuevo) || (nuevo === undefined && esObjeto(viejo))) {
      const a = viejo || {}, b = nuevo || {};
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) mk[id] = ahora;
    } else if (JSON.stringify(viejo) !== JSON.stringify(nuevo)) mk['*'] = ahora;
    put('syncmeta', m);
    if (token()) programar();
  }
  // Lo que ya había antes de activar la sincronización también se sube (con fecha mínima para no pisar nada)
  function sembrar() {
    const m = meta();
    for (const k of CLAVES) {
      const v = get(k, undefined); if (v === undefined) continue;
      const mk = (m[k] = m[k] || {});
      if (esObjeto(v)) { for (const id of Object.keys(v)) if (!mk[id]) mk[id] = 1; } else if (!mk['*']) mk['*'] = 1;
    }
    put('syncmeta', m);
  }

  // ---------- fusión: gana el cambio más reciente de cada elemento ----------
  function fusionar(rem) {
    const m = meta(); let cambiado = false;
    for (const k of CLAVES) {
      const lv = get(k, undefined), rv = rem.datos?.[k], lm = (m[k] = m[k] || {}), rm = rem.meta?.[k] || {};
      if (!esObjeto(lv) && !esObjeto(rv)) {
        if ((rm['*'] || 0) > (lm['*'] || 0)) { if (rv === undefined) del(k); else put(k, rv); lm['*'] = rm['*']; cambiado = true; }
        continue;
      }
      const out = { ...(esObjeto(lv) ? lv : {}) }; let c = false;
      for (const id of new Set([...Object.keys(rm), ...Object.keys(esObjeto(rv) ? rv : {})])) {
        if ((rm[id] || 0) > (lm[id] || 0)) {
          if (esObjeto(rv) && id in rv) out[id] = rv[id]; else delete out[id];
          lm[id] = rm[id]; c = true;
        }
      }
      if (c) { put(k, out); cambiado = true; }
    }
    put('syncmeta', m);
    return cambiado;
  }
  function hayQueSubir(rem) {
    const m = meta();
    return CLAVES.some((k) => Object.entries(m[k] || {}).some(([id, t]) => t > (rem?.meta?.[k]?.[id] || 0)));
  }

  // ---------- cifrado (misma contraseña que la web) ----------
  const b64e = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const CLAVE = {};
  function derivar(sal) {
    const k = b64e(sal);
    if (!CLAVE[k]) CLAVE[k] = crypto.subtle.importKey('raw', new TextEncoder().encode(api.pwd()), 'PBKDF2', false, ['deriveKey'])
      .then((km) => crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: 250000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    return CLAVE[k];
  }
  let SAL = null;
  async function cifrar(obj) {
    SAL = SAL || crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derivar(SAL), new TextEncoder().encode(JSON.stringify(obj))));
    return { v: 1, it: 250000, salt: b64e(SAL), iv: b64e(iv), ct: b64e(ct) };
  }
  async function descifrar(enc) {
    SAL = b64d(enc.salt);
    const pl = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.iv) }, await derivar(SAL), b64d(enc.ct));
    return JSON.parse(new TextDecoder().decode(pl));
  }

  // ---------- GitHub ----------
  function repo() {
    const r = get('syncrepo', '');
    if (r) return r;
    const dueño = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
    const nombre = location.pathname.split('/').filter(Boolean)[0] || '';
    return dueño && nombre ? `${dueño}/${nombre}` : '';
  }
  async function gh(ruta, opt = {}) {
    const r = await fetch(`https://api.github.com/repos/${repo()}${ruta}`, {
      ...opt, cache: 'no-store',
      headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (r.status === 401) throw new Error('El token no es válido o ha caducado');
    if (r.status === 403) throw new Error('El token no tiene permiso de escritura en el repositorio (Contents: Read and write)');
    return r;
  }
  async function leerRemoto() {
    const r = await gh(`/contents/${ARCHIVO}?ref=${RAMA}&t=${Date.now()}`);
    if (r.status === 404) { sha = null; return null; }
    if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
    const j = await r.json(); sha = j.sha;
    const txt = new TextDecoder().decode(b64d(j.content.replace(/\s/g, '')));
    try { return await descifrar(JSON.parse(txt)); } catch { throw new Error('No se pudo descifrar la copia de GitHub (¿cambiaste la contraseña de la web?)'); }
  }
  async function crearRama() {
    const rp = await gh('');
    const base = rp.ok ? (await rp.json()).default_branch : 'main';
    const rr = await gh(`/git/ref/heads/${base}`);
    if (!rr.ok) throw new Error('No se pudo leer la rama principal');
    const s = (await rr.json()).object.sha;
    const rc = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${RAMA}`, sha: s }) });
    if (!rc.ok && rc.status !== 422) throw new Error(`No se pudo crear la rama de datos (${rc.status})`);
  }
  async function subir(reintento = true) {
    const datos = Object.fromEntries(CLAVES.map((k) => [k, get(k, undefined)]).filter(([, v]) => v !== undefined));
    const cuerpo = { v: 1, t: Date.now(), datos, meta: meta() };
    const contenido = b64e(new TextEncoder().encode(JSON.stringify(await cifrar(cuerpo))));
    const body = { message: 'Tablero sincronizado', content: contenido, branch: RAMA, ...(sha ? { sha } : {}) };
    let r = await gh(`/contents/${ARCHIVO}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 404 || (r.status === 422 && !sha && /branch|ref/i.test(await r.clone().text()))) {
      await crearRama();
      r = await gh(`/contents/${ARCHIVO}`, { method: 'PUT', body: JSON.stringify(body) });
    }
    if ((r.status === 409 || r.status === 422) && reintento) {  // otro dispositivo guardó antes: juntar y volver a guardar
      const rem = await leerRemoto(); if (rem && fusionar(rem)) api.repintar();
      return subir(false);
    }
    if (!r.ok) throw new Error(`No se pudo guardar en GitHub (${r.status})`);
    sha = (await r.json()).content?.sha || sha;
  }

  // ---------- ciclo ----------
  async function sincronizar() {
    if (!token() || !repo() || !api) return;
    if (ocupado) { pendiente = true; return; }
    ocupado = true; pintarEstado('Sincronizando…');
    try {
      const rem = await leerRemoto();
      if (rem && fusionar(rem)) api.repintar();
      if (!rem || hayQueSubir(rem)) await subir();
      ultimo = Date.now(); put('syncultimo', ultimo); error = '';
    } catch (e) { error = e.message || String(e); }
    finally { ocupado = false; pintarEstado(); if (pendiente) { pendiente = false; programar(); } }
  }
  function programar() { clearTimeout(tProg); tProg = setTimeout(sincronizar, 2500); }

  // ---------- interfaz (en «Mi tablero») ----------
  function pintarEstado(msg) {
    const el = document.getElementById('syncEstado'); if (!el) return;
    if (msg) { el.textContent = msg; el.className = 'muted'; return; }
    if (!token()) { el.textContent = 'Desactivada: el tablero solo está en este dispositivo.'; el.className = 'muted'; return; }
    el.textContent = error ? `Error: ${error}` : `Activada · última sincronización ${ultimo ? new Date(ultimo).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}`;
    el.className = error ? 'neg' : 'ok';
  }
  function pintar(el) {
    if (!el) return;
    const on = !!token();
    el.innerHTML = `<div class="box-h"><h3>Sincronizar móvil y ordenador</h3><span id="syncEstado"></span></div>
      ${on ? `<div class="actions"><button class="btn small" id="syncYa">Sincronizar ahora</button><button class="btn small ghost" id="syncOff">Desactivar en este dispositivo</button></div>`
        : `<details><summary>Cómo activarla (5 minutos, una vez por dispositivo)</summary><ol class="small">
          <li>En GitHub: tu foto → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
          <li>Nombre: «radar tablero». Caducidad: la que quieras (por ejemplo 1 año). <b>Repository access</b>: <i>Only select repositories</i> → <b>${repo() || 'tu repositorio del radar'}</b>.</li>
          <li><b>Permissions</b> → <b>Repository permissions</b> → <b>Contents</b>: <i>Read and write</i>. Nada más. Pulsa <b>Generate token</b> y cópialo.</li>
          <li>Pégalo aquí abajo y pulsa Activar. Repite en cada dispositivo (puedes usar el mismo token).</li></ol>
          <p class="small muted">El tablero se guarda cifrado con la contraseña de la web: aunque el repositorio es público, nadie puede leerlo. El token se queda solo en este navegador.</p></details>
          <div class="row-precios"><input id="syncTok" type="password" autocomplete="off" placeholder="github_pat_…" style="flex:1;min-width:200px"><button class="btn small primary" id="syncOn">Activar</button></div>`}`;
    pintarEstado();
    const on1 = document.getElementById('syncOn');
    if (on1) on1.onclick = async () => {
      const t = document.getElementById('syncTok').value.trim();
      if (!/^(github_pat_|ghp_)/.test(t)) { api.toast('Eso no parece un token de GitHub'); return; }
      put('ghtoken', t); sembrar(); pintar(el); await sincronizar();
      if (error) { api.toast(error); } else api.toast('Sincronización activada');
    };
    const ya = document.getElementById('syncYa'); if (ya) ya.onclick = () => sincronizar();
    const off = document.getElementById('syncOff'); if (off) off.onclick = () => { del('ghtoken'); error = ''; pintar(el); api.toast('Sincronización desactivada en este dispositivo'); };
  }

  function init(a) {
    api = a;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
    setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 120000);
    sincronizar();
  }
  window.SYNC = { init, cambio, pintar, sincronizar, claves: CLAVES, _fusionar: fusionar, _meta: meta };
})();
