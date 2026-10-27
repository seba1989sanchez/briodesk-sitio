// Prueba de punta a punta del Worker en local: wrangler dev (entorno «prueba»),
// D1 local y un Gmail simulado. Uso: npm test
import {spawn, execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-sitio-'));
const estado = path.join(tmp, 'state');
const PORT = 8797, GPORT = 8798, BASE = `http://127.0.0.1:${PORT}`;

/* ---------- Gmail simulado ---------- */
const correos = [];
let gmailFalla = false;
// Lista de precios simulada de la plataforma (GET /api/pricing): 'ok', 'cambio', 'caida' o 'invalida'.
const LISTA = JSON.parse(fs.readFileSync(path.join(root, 'pruebas/pricing.json'), 'utf8'));
let precios = 'ok';
const gmail = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (d) => { cuerpo += d; });
  req.on('end', () => {
    if (req.url === '/pricing') {
      if (precios === 'caida') { res.writeHead(503); return res.end('{}'); }
      if (precios === 'invalida') { res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"version":"x"}'); }
      const lista = structuredClone(LISTA);
      if (precios === 'cambio') { lista.version = '2027-01'; lista.desk.planes.equipo.precio = 299000; }
      res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify(lista));
    }
    if (req.url === '/token') { res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"access_token":"tok"}'); }
    if (req.url === '/send') {
      if (gmailFalla) { res.writeHead(503); return res.end('{}'); }
      const raw = Buffer.from(JSON.parse(cuerpo).raw, 'base64url').toString('utf8');
      const [cab, cuerpoB64] = raw.split('\r\n\r\n');
      const h = Object.fromEntries(cab.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
      const dec = (v) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
      correos.push({to: h.to, replyTo: h['reply-to'], from: dec(h.from), subject: dec(h.subject), html: Buffer.from(cuerpoB64, 'base64').toString('utf8')});
      res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"id":"x"}');
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => gmail.listen(GPORT, '127.0.0.1', r));

fs.writeFileSync(path.join(tmp, '.dev.vars'), [
  'GMAIL_SENDER="avisos@briodesk.cl"', 'GMAIL_CLIENT_ID="id"', 'GMAIL_CLIENT_SECRET="secreto"', 'GMAIL_REFRESH_TOKEN="refresco"',
  `GOOGLE_TOKEN_URL="http://127.0.0.1:${GPORT}/token"`, `GMAIL_SEND_URL="http://127.0.0.1:${GPORT}/send"`, `PRECIOS_URL="http://127.0.0.1:${GPORT}/pricing"`, 'SOLICITUDES_LLAVE="llave-de-prueba-para-la-bandeja-1234"', ''].join('\n'));

// Los precios de respaldo del HTML deben ser los de la lista (npm run precios:respaldo).
{
  const {valoresSitio} = await import('../src/precios.js');
  const valores = valoresSitio(LISTA), html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const des = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let n = 0;
  for (const m of html.matchAll(/data-p="([^"]+)"[^>]*>([^<]*)</g)) {
    assert.ok(valores[m[1]], `clave sin valor: ${m[1]}`);
    assert.equal(des(m[2]), valores[m[1]].texto, `respaldo desactualizado en ${m[1]}: corre npm run precios:respaldo`);
    n++;
  }
  assert.ok(n > 40, 'faltan precios marcados con data-p');
  console.log(`  ✓ los ${n} precios de respaldo del HTML coinciden con la lista`);
}

const wr = (args) => execFileSync('npx', ['wrangler', ...args], {cwd: root, encoding: 'utf8', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
wr(['d1', 'migrations', 'apply', 'DB', '--local', '--env', 'prueba', '--persist-to', estado]);
// Asíncrono: un execFileSync bloquearía el proceso (y el Gmail simulado) mientras corre la consulta.
const ejecutar = promisify(execFile);
const sql = async (q) => JSON.parse((await ejecutar('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--env', 'prueba', '--persist-to', estado, '--json', '--command', q],
  {cwd: root, env: {...process.env, WRANGLER_SEND_METRICS: 'false'}})).stdout)[0].results;

const dev = spawn('npx', ['wrangler', 'dev', '--env', 'prueba', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', estado,
  '--env-file', path.join(tmp, '.dev.vars'), '--test-scheduled', '--show-interactive-dev-session=false'],
{cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
let logs = '';
dev.stdout.on('data', (d) => { logs += d; });
dev.stderr.on('data', (d) => { logs += d; });
const cerrar = () => { try { process.kill(-dev.pid); } catch {} gmail.close(); };

let ip = 1;
async function post(ruta, cuerpo, {ipFija, form} = {}) {
  const headers = {'cf-connecting-ip': ipFija || `10.0.0.${ip++}`};
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(cuerpo).toString(); }
  else { headers['content-type'] = 'application/json'; body = JSON.stringify(cuerpo); }
  const r = await fetch(BASE + ruta, {method: 'POST', headers, body, redirect: 'manual'});
  const t = await r.text();
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return {status: r.status, data, headers: r.headers};
}
const get = async (ruta) => { const r = await fetch(BASE + ruta, {redirect: 'manual'}); return {status: r.status, text: await r.text(), headers: r.headers}; };
const esperar = async (cond, ms = 5000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

const demo = {nombre: 'Ana Pérez', empresa: 'Acme SpA', correo: 'ana@acme.cl', interes: 'Brío Assets', espera: 8000};
let pasadas = 0;
async function paso(nombre, fn) { await fn(); pasadas++; console.log(`  ✓ ${nombre}`); }

try {
  assert.ok(await esperar(async () => { try { return (await fetch(BASE + '/')).ok; } catch { return false; } }, 60000), 'wrangler dev no arrancó:\n' + logs);

  await paso('sirve la landing con cabeceras de seguridad', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.text, /Pon en orden/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  await paso('sirve /ingresar, /privacidad, /gracias y 404', async () => {
    for (const p of ['/ingresar', '/privacidad', '/terminos', '/gracias']) assert.equal((await get(p)).status, 200, p);
    const r = await get('/no-existe');
    assert.equal(r.status, 404);
    assert.match(r.text, /No encontramos esta página/);
  });

  await paso('solicitud de demo: se guarda y avisa a ventas con Reply-To', async () => {
    const r = await post('/api/demo', demo);
    assert.equal(r.status, 200); assert.equal(r.data.ok, true);
    assert.ok(await esperar(() => correos.length === 1), 'no llegó el correo');
    const c = correos[0];
    assert.equal(c.to, 'ventas@briodesk.cl');
    assert.equal(c.replyTo, 'ana@acme.cl');
    assert.equal(c.subject, 'Solicitud de demo: Acme SpA (Brío Assets)');
    assert.match(c.from, /Sitio BríoDesk/);
    assert.match(c.html, /Ana Pérez/);
    assert.ok(await esperar(async () => (await sql('SELECT aviso_enviado_en FROM solicitudes WHERE id=1'))[0].aviso_enviado_en !== null));
  });

  await paso('bandeja de BríoDesk: solo con la llave, y desde un id', async () => {
    const pedir = (q, llave) => fetch(`${BASE}/api/interno/solicitudes${q}`, {headers: llave ? {authorization: `Bearer ${llave}`} : {}});
    assert.equal((await pedir('', '')).status, 401);
    assert.equal((await pedir('', 'otra-llave-cualquiera-de-prueba-xyz')).status, 401);
    let r = await pedir('', 'llave-de-prueba-para-la-bandeja-1234');
    assert.equal(r.status, 200);
    const {solicitudes} = await r.json();
    assert.equal(solicitudes.length, 1);
    assert.deepEqual({id: solicitudes[0].id, tipo: solicitudes[0].tipo, correo: solicitudes[0].correo, interes: solicitudes[0].interes}, {id: 1, tipo: 'demo', correo: 'ana@acme.cl', interes: 'Brío Assets'});
    r = await pedir('?desde=1', 'llave-de-prueba-para-la-bandeja-1234');
    assert.deepEqual((await r.json()).solicitudes, []);
  });

  await paso('valida los campos en el servidor', async () => {
    let r = await post('/api/demo', {...demo, correo: 'ana@acme'});
    assert.equal(r.status, 422); assert.equal(r.data.campo, 'correo');
    r = await post('/api/demo', {...demo, nombre: '  '});
    assert.equal(r.status, 422); assert.equal(r.data.campo, 'nombre');
    r = await post('/api/demo', {...demo, correo: 'ana@acme.cl\r\nBcc: otro@x.cl'});
    assert.equal(r.status, 422, 'no permite inyectar cabeceras de correo');
  });

  await paso('interés desconocido cae en Brío Desk y el HTML del aviso va escapado', async () => {
    const antes = correos.length;
    const r = await post('/api/demo', {...demo, nombre: '<script>alert(1)</script>', interes: 'Otra cosa'});
    assert.equal(r.status, 200);
    assert.ok(await esperar(() => correos.length === antes + 1));
    const c = correos.at(-1);
    assert.match(c.subject, /\(Brío Desk\)$/);
    assert.ok(!c.html.includes('<script>') && c.html.includes('&lt;script&gt;'));
  });

  await paso('campo trampa y envíos instantáneos se descartan en silencio', async () => {
    const filas = (await sql('SELECT COUNT(*) n FROM solicitudes'))[0].n;
    let r = await post('/api/demo', {...demo, sitio_web: 'http://spam'});
    assert.equal(r.status, 200);
    r = await post('/api/demo', {...demo, espera: 300});
    assert.equal(r.status, 200);
    assert.equal((await sql('SELECT COUNT(*) n FROM solicitudes'))[0].n, filas);
  });

  await paso('formulario sin JavaScript redirige a /gracias', async () => {
    const r = await post('/api/demo', {nombre: 'Luis', empresa: 'Beta', correo: 'luis@beta.cl', interes: 'Brío Desk'}, {form: true});
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /\/gracias$/);
  });

  await paso('consulta de subdominio', async () => {
    const existe = async (s) => (await fetch(`${BASE}/api/subdominio/${encodeURIComponent(s)}`).then((r) => r.json())).existe;
    assert.equal(await existe('acme'), true);
    assert.equal(await existe('ACME.briodesk.cl'), true);
    assert.equal(await existe('acme.demo'), true);
    assert.equal(await existe('zzz'), false);
    assert.equal(await existe('www'), false, 'las direcciones internas no se ofrecen');
    assert.equal(await existe('a b'), false);
  });

  await paso('solicitud de subdominio: valida, rechaza ocupados y reservados, avisa', async () => {
    const base = {nombre: 'Ana', empresa: 'Nueva Empresa', correo: 'ana@nueva.cl', espera: 5000};
    let r = await post('/api/subdominio', {...base, subdominio: 'acme'});
    assert.equal(r.status, 409); assert.match(r.data.error, /ya está en uso/);
    r = await post('/api/subdominio', {...base, subdominio: 'consola'});
    assert.equal(r.status, 409); assert.match(r.data.error, /reservada/);
    r = await post('/api/subdominio', {...base, subdominio: 'mi empresa'});
    assert.equal(r.status, 422); assert.equal(r.data.campo, 'subdominio');
    const antes = correos.length;
    r = await post('/api/subdominio', {...base, subdominio: 'https://Nueva-Empresa.briodesk.cl'});
    assert.equal(r.status, 200);
    assert.ok(await esperar(() => correos.length === antes + 1));
    assert.equal(correos.at(-1).subject, 'Solicitud de dirección: nueva-empresa.briodesk.cl (Nueva Empresa)');
    assert.equal((await sql("SELECT subdominio FROM solicitudes WHERE tipo='subdominio'"))[0].subdominio, 'nueva-empresa');
  });

  await paso('si Gmail falla, la solicitud queda guardada y el cron reintenta', async () => {
    gmailFalla = true;
    const r = await post('/api/demo', {...demo, empresa: 'Gamma'});
    assert.equal(r.status, 200);
    const fila = async () => (await sql("SELECT aviso_enviado_en, aviso_intentos, aviso_error FROM solicitudes WHERE empresa='Gamma'"))[0];
    assert.ok(await esperar(async () => (await fila()).aviso_intentos === 1));
    const f = await fila();
    assert.equal(f.aviso_enviado_en, null);
    assert.match(f.aviso_error, /Gmail/);
    gmailFalla = false;
    const antes = correos.length;
    assert.equal((await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('*/30 * * * *')}`)).status, 200);
    assert.ok(await esperar(() => correos.length === antes + 1));
    assert.ok(await esperar(async () => (await fila()).aviso_enviado_en !== null));
  });

  await paso('limita envíos repetidos desde la misma IP', async () => {
    const estados = [];
    for (let i = 0; i < 8; i++) estados.push((await post('/api/demo', {...demo, correo: 'x@acme.cl', sitio_web: 'trampa'}, {ipFija: '10.9.9.9'})).status);
    assert.ok(estados.includes(429), `esperaba un 429: ${estados}`);
  });

  await paso('la portada muestra los precios vigentes de la plataforma', async () => {
    precios = 'ok';
    let r = await get('/');
    assert.equal(r.headers.get('x-precios'), '2026-10');
    assert.match(r.text, /data-p="desk\.equipo\.precio" data-mensual="\$279\.000" data-anual="\$2\.790\.000">\$279\.000</);
    assert.match(r.text, /data-p="suite\.equipo\.precio"[^>]*>\$449\.000</);
    // Un cambio en la lista de la plataforma se ve en el sitio sin tocar el HTML.
    precios = 'cambio';
    r = await get('/');
    assert.equal(r.headers.get('x-precios'), '2027-01');
    assert.match(r.text, /data-p="desk\.equipo\.precio" data-mensual="\$299\.000" data-anual="\$2\.990\.000">\$299\.000</);
  });

  await paso('si la plataforma falla o responde algo inválido, quedan los precios del HTML', async () => {
    for (const estado of ['caida', 'invalida']) {
      precios = estado;
      const r = await get('/');
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-precios'), 'respaldo', estado);
      assert.match(r.text, /data-p="desk\.equipo\.precio"[^>]*>\$279\.000</);
    }
    precios = 'ok';
    // Las demás páginas no consultan precios.
    assert.equal((await get('/ingresar')).headers.get('x-precios'), null);
  });

  console.log(`\n${pasadas} pruebas pasaron.`);
} catch (e) {
  console.error('\n✗', e.stack, '\n--- logs de wrangler ---\n', logs.slice(-3000));
  process.exitCode = 1;
} finally {
  cerrar();
}
