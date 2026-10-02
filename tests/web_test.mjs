// Prueba automática de la web con los datos reales generados (la lanza el workflow "Prueba completa").
import { chromium } from 'playwright';
const PWD = process.env.SITE_PASSWORD;
const fallos = [];
const b = await chromium.launch();
for (const [nombre, vp] of [['ordenador', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fallos.push(`${nombre}: error JS: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fallos.push(`${nombre}: consola: ${m.text()}`); });
  const paso = async (txt, fn) => { try { const r = await fn(); console.log(`[${nombre}] ok · ${txt}${r !== undefined ? ': ' + r : ''}`); } catch (e) { fallos.push(`${nombre}: ${txt}: ${e.message.split('\n')[0]}`); } };
  await paso('abrir y entrar', async () => {
    await p.goto('http://localhost:8765/');
    await p.fill('#pwd', PWD); await p.click('button[type=submit]');
    await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    return await p.textContent('#updated');
  });
  await paso('inicio', async () => (await p.$$eval('.kpi .v', (e) => e.map((x) => x.textContent).join(' | '))));
  await paso('lista de licitaciones', async () => { await p.click('#tabs button[data-tab=buscar]'); return await p.textContent('#count'); });
  await paso('ficha de la mejor', async () => {
    await p.click('#tabs button[data-tab=inicio]');
    const c = await p.$('#tab-inicio .card');
    if (!c) return 'sin tarjetas A';
    await c.click(); await p.waitForSelector('#detail h2', { timeout: 10000 });
    await p.waitForTimeout(3000);
    return (await p.textContent('#detail h2')).slice(0, 80);
  });
  await paso('calculadora', async () => {
    if (!(await p.$('#dCalc [data-k=coste]'))) return 'no hay ficha abierta';
    await p.fill('#dCalc [data-k=coste]', '10000'); await p.waitForTimeout(300);
    return (await p.textContent('#calcOut')).replace(/\s+/g, ' ').slice(0, 160);
  });
  await paso('pedir precios y borradores', async () => {
    if (!(await p.$('#dPedir'))) return 'sin ficha';
    const txt = (await p.textContent('#dPedir')).replace(/\s+/g, ' ').slice(0, 120);
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#pDecl')]);
    const [x] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#pXlsx')]);
    return `${txt} · ${d.suggestedFilename()} · ${x.suggestedFilename()}`;
  });
  await paso('simulador', async () => ((await p.$('#dSim')) ? (await p.textContent('#dSim')).replace(/\s+/g, ' ').slice(0, 160) : 'sin simulador'));
  await p.keyboard.press('Escape');
  await paso('histórico', async () => {
    await p.click('#tabs button[data-tab=historico]');
    await p.waitForFunction(() => document.querySelector('#hOut .kpis, #hOut .empty'), null, { timeout: 60000 });
    return (await p.textContent('#hOut')).replace(/\s+/g, ' ').slice(0, 200);
  });
  for (const v of ['empresas', 'organismos', 'renovaciones']) await paso(`histórico · ${v}`, async () => { await p.click(`#hVistas button[data-v=${v}]`); await p.waitForTimeout(800); });
  for (const t of ['tablero', 'calendario', 'competencia']) await paso(`pestaña ${t}`, async () => { await p.click(`#tabs button[data-tab=${t}]`); await p.waitForTimeout(400); });
  await paso('caja de sincronización', async () => (await p.textContent('#syncBox')).replace(/\s+/g, ' ').slice(0, 80));
  await paso('sin scroll horizontal', async () => { const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > vp.width + 2) throw new Error(`ancho ${w}`); return w; });
  await p.screenshot({ path: `captura-${nombre}.png`, fullPage: false });
  await ctx.close();
}
await b.close();
if (fallos.length) { console.log('\nFALLOS:\n- ' + fallos.join('\n- ')); process.exit(1); }
console.log('\nWEB OK: sin errores');
