/* Pruebas de comportamiento del sitio (Playwright).
 * Corre contra el Worker en local (entorno «prueba», con la API de formularios):
 *   npx wrangler d1 migrations apply DB --local --env prueba
 *   npx wrangler dev --env prueba --port 8787
 *   node pruebas/comportamiento.cjs [carpeta-capturas] */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.clock.install();
  await p.goto(BASE + '/');
  await p.mouse.move(5, 890); // fuera del hero-grid
  const sel = async (sc) => p.$eval(`${sc} [role=tab][aria-selected=true]`, e => e.id);
  await p.clock.runFor(7300);
  assert(await sel('.hero-demo') === 't-assets', 'hero rota a Assets a los 7 s');
  assert(await p.$eval('.palabra span:not([hidden])', e => e.textContent) === 'activos.', 'palabra del título sincronizada');
  assert(await p.$eval('[data-texto-tab=titulo]', e => e.textContent) === 'Inventario de activos', 'título de la vista cambia');
  // hover pausa
  await p.hover('.mock'); await p.clock.runFor(8000);
  assert(await sel('.hero-demo') === 't-assets', 'hover pausa el hero');
  await p.mouse.move(5, 890); await p.clock.runFor(7300);
  assert(await sel('.hero-demo') === 't-projects', 'al salir el mouse sigue rotando');
  // clic detiene
  await p.click('#t-desk'); await p.mouse.move(5, 890); await p.clock.runFor(15000);
  assert(await sel('.hero-demo') === 't-desk', 'clic en pestaña detiene la rotación');
  // teclado
  await p.focus('#t-desk'); await p.keyboard.press('ArrowRight');
  assert(await sel('.hero-demo') === 't-assets' && await p.evaluate(() => document.activeElement.id) === 't-assets', 'flecha derecha cambia y mueve foco');
  // áreas fuera de pantalla no rota
  const areaAntes = await sel('#areas');
  await p.clock.runFor(7000);
  assert(await sel('#areas') === areaAntes, 'áreas no rota fuera de pantalla');
  await p.$eval('#areas', e => e.scrollIntoView({behavior:'instant'})); await p.mouse.move(5, 5);
  await p.clock.runFor(6500);
  assert(await sel('#areas') === 't-personas', 'áreas rota visible (6 s)');
  // recorrido
  await p.$eval('#recorrido', e => e.scrollIntoView({ block: 'start', behavior: 'instant' })); await p.mouse.move(1270, 5);
  await p.click('#t-e1'); await p.click('[data-play]'); await p.clock.runFor(6300);
  assert(await sel('.pista') === 't-e2', 'recorrido avanza a etapa 2 a los 6 s');
  assert(await p.$eval('[data-chip]', e => e.style.left) === '25%', 'chip #4821 se desliza');
  await p.click('[data-siguiente]');
  assert(await sel('.pista') === 't-e3', 'Siguiente avanza');
  assert(await p.$eval('[data-play]', e => e.getAttribute('aria-pressed')) === 'false', 'Siguiente pausa el recorrido');
  await p.clock.runFor(7000);
  assert(await sel('.pista') === 't-e3', 'pausado no avanza');
  await p.click('[data-play]'); await p.clock.runFor(6300);
  assert(await sel('.pista') === 't-e4', 'Reproducir reanuda aunque el mouse siga encima');
  assert(await p.$eval('.ticket dl div:nth-child(1) dd span:not([hidden])', e => e.textContent) === 'En curso', 'ficha muestra estado de la etapa 4');
  // plataforma
  await p.click('#t-tablero');
  assert(await p.$eval('.url', e => e.textContent) === 'tuempresa.briodesk.cl/tablero', 'URL cambia con la pantalla');
  assert(await p.$eval('[data-menu-lateral] span.activo', e => e.textContent) === 'Tablero', 'menú lateral marca Tablero');
  // planes
  await p.click('#t-anual');
  const txt = await p.$eval('#planes', e => e.innerText);
  assert(txt.includes('$4.490.000') && txt.includes('112,5 UF al año') && txt.includes('Equivale a $374.167 al mes'), 'anual: Suites con precio anual');
  assert(txt.includes('$990.000') && txt.includes('/año') && txt.includes('Equivale a $82.500 al mes') && txt.includes('70 UF al año'), 'anual: planes de Desk con precio anual');
  await p.click('#t-mensual');
  const mes = await p.$eval('#planes', e => e.innerText);
  assert(mes.includes('$449.000') && mes.includes('$279.000') && mes.includes('Ahorras $88.800 al mes'), 'vuelve a mensual');
  // formulario
  await p.fill('[name=nombre]', 'Ana'); await p.fill('[name=empresa]', 'Acme'); await p.fill('[name=correo]', 'ana@acme');
  await p.click('#form-demo button[type=submit]');
  assert((await p.textContent('#e-correo')).includes('incompleto'), 'valida correo');
  await p.fill('[name=correo]', 'ana@acme.cl');
  await p.click('#form-demo button[type=submit]');
  await p.clock.runFor(500); await p.waitForTimeout(300);
  assert(await p.isVisible('#demo-ok') && !(await p.isVisible('#form-demo')), 'envío exitoso muestra la confirmación');
  // plan preselecciona interés (con el formulario de nuevo visible)
  await p.$eval('#form-demo', (f) => { f.hidden = false; });
  await p.click('.plan:nth-child(3) .btn');
  assert(await p.$eval('[name=interes]', e => e.value) === 'La suite completa', 'Hablar con ventas preselecciona interés');
  assert(errs.length === 0, 'sin errores JS ' + errs.join('|'));

  // movimiento reducido
  const c2 = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const q = await c2.newPage(); await q.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await q.clock.install(); await q.goto(BASE + '/'); await q.mouse.move(5, 890);
  await q.clock.runFor(20000);
  assert(await q.$eval('.hero-demo [role=tab][aria-selected=true]', e => e.id) === 't-desk', 'reduced-motion: no rota');
  assert(await q.$eval('[data-play] span', e => e.textContent) === 'Reproducir recorrido', 'reduced-motion: recorrido en pausa');

  // menú móvil
  const c3 = await b.newContext({ viewport: { width: 360, height: 760 } });
  const m = await c3.newPage(); await m.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await m.goto(BASE + '/');
  assert(!(await m.isVisible('#nav-menu')), 'menú móvil cerrado');
  await m.click('.nav-toggle');
  assert(await m.isVisible('#nav-menu a[href="#planes"]'), 'menú móvil abre');
  await m.screenshot({ path: (process.argv[2] || '.') + '/menu-360.png' });
  await m.click('#nav-menu a[href="#planes"]');
  assert(!(await m.isVisible('#nav-menu')), 'menú se cierra al elegir');

  // ingresar
  const g = await c3.newPage(); await g.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await g.route(/acme\.briodesk\.cl/, r => r.fulfill({ body: 'ok' }));
  await g.goto(BASE + '/ingresar');
  await g.fill('#subdominio', 'mal dominio!');
  await g.click('#form-ingresar button');
  assert((await g.textContent('#sub-error')).includes('letras'), 'ingresar valida subdominio');
  await g.fill('#subdominio', 'zzz');
  await g.click('#form-ingresar button');
  await g.waitForFunction(() => document.querySelector('#sub-error').textContent.includes('No encontramos'));
  assert(true, 'dirección inexistente muestra aviso');
  await g.click('#sub-error a[href="#solicitar"]');
  assert(await g.inputValue('#form-subdominio [name=subdominio]') === 'zzz', 'el enlace propone la misma dirección para solicitarla');
  await g.fill('#form-subdominio [name=empresa]', 'Zeta'); await g.fill('#form-subdominio [name=nombre]', 'Zoe');
  await g.fill('#form-subdominio [name=correo]', 'zoe@zeta.cl');
  await g.waitForTimeout(2600);
  await g.click('#form-subdominio button[type=submit]');
  await g.waitForSelector('#subdominio-ok:not([hidden])');
  assert(true, 'solicitud de dirección enviada');
  await g.goto(BASE + '/ingresar');
  await g.fill('#form-subdominio [name=empresa]', 'Acme'); await g.fill('#form-subdominio [name=nombre]', 'Ana');
  await g.fill('#form-subdominio [name=correo]', 'ana@acme.cl'); await g.fill('#form-subdominio [name=subdominio]', 'acme');
  await g.waitForTimeout(2600);
  await g.click('#form-subdominio button[type=submit]');
  await g.waitForFunction(() => document.querySelector('#form-subdominio .error-claro').textContent.includes('ya está en uso'));
  assert(true, 'dirección ocupada muestra el mensaje del servidor');
  await g.fill('#subdominio', 'https://ACME.briodesk.cl/login');
  await Promise.all([g.waitForURL(/acme\.briodesk\.cl/), g.click('#form-ingresar button')]);
  assert(g.url() === 'https://acme.briodesk.cl/', 'normaliza y redirige a acme.briodesk.cl');
  await g.goto(BASE + '/ingresar');
  await g.screenshot({ path: (process.argv[2] || '.') + '/ingresar-360.png', fullPage: true });
  await b.close();
})();
