// Worker del sitio briodesk.cl: sirve public/ y recibe los formularios.
//
//   POST /api/demo                  Solicitud de demostración
//   POST /api/subdominio            Solicitud de una dirección nueva (xxx.briodesk.cl)
//   GET  /api/subdominio/:nombre    ¿Existe xxx.briodesk.cl? → {existe: true|false}
//   GET  /api/interno/solicitudes?desde=N   Solicitudes para la bandeja de BríoDesk
//        (solo con «Authorization: Bearer <SOLICITUDES_LLAVE>»; nada se crea solo,
//        en BríoDesk una persona aprueba o rechaza cada una)
//
// La portada toma los precios de la plataforma (src/precios.js).
//
// Cada solicitud se guarda en D1 y se avisa por correo a AVISO_A (Gmail, mismas
// credenciales que el ITSM). Si el correo falla, el cron lo reintenta.

import {aplicarPrecios, preciosVigentes} from './precios.js';

const ZONA = 'briodesk.cl';
const HOST_PRINCIPAL = 'briodesk.cl';
const CORREO = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
const SUBDOMINIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.demo)?$/;
const INTERESES = ['Brío Desk', 'Brío Assets', 'Brío Projects', 'Brío InOut', 'La suite completa'];
// Direcciones de la propia infraestructura: no se ofrecen para ingresar ni para pedir.
const INTERNOS = new Set(['www', 'app', 'api', 'netmon', 'desarrollo', 'licencias', 'consola', 'soporte', 'demo',
  'admin', 'mail', 'correo', 'smtp', 'ftp', 'status', 'estado', 'ayuda', 'docs', 'blog', 'sitio', 'briodesk', 'brio']);
const ESPERA_MINIMA_MS = 2500; // menos que esto entre cargar la página y enviar: probablemente un bot
const MAX_INTENTOS = 5;

const CABECERAS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

class Problema extends Error {
  constructor(status, mensaje, campo) { super(mensaje); this.status = status; this.campo = campo; }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CABECERAS_SEGURIDAD}
});
const ahora = () => new Date().toISOString();
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function normalizarSubdominio(v) {
  let s = String(v ?? '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  return s.replace(/\.briodesk\.cl\.?$/, '');
}

export function esInterno(sub) {
  const base = sub.replace(/\.demo$/, '');
  return INTERNOS.has(base) || /-dev$/.test(base);
}

/* ---------------- Entrada ---------------- */

async function leerCuerpo(request) {
  const tipo = request.headers.get('content-type') || '';
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new Problema(413, 'La solicitud es demasiado grande.');
  if (tipo.includes('application/json')) {
    try { return {datos: await request.json(), html: false}; } catch { throw new Problema(400, 'No pudimos leer la solicitud.'); }
  }
  if (tipo.includes('application/x-www-form-urlencoded') || tipo.includes('multipart/form-data')) {
    const f = await request.formData();
    return {datos: Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''])), html: true};
  }
  throw new Problema(415, 'Formato no soportado.');
}

function validarContacto(d) {
  const nombre = texto(d.nombre, 120);
  const empresa = texto(d.empresa, 160);
  const correo = texto(d.correo, 200).toLowerCase();
  if (!nombre) throw new Problema(422, 'Escribe tu nombre.', 'nombre');
  if (!empresa) throw new Problema(422, 'Escribe el nombre de tu empresa.', 'empresa');
  if (!CORREO.test(correo)) throw new Problema(422, 'Revisa el correo: parece incompleto.', 'correo');
  return {nombre, empresa, correo};
}

// Campo trampa lleno o envío demasiado rápido: se responde como si todo saliera bien, sin guardar.
function pareceBot(d) {
  if (texto(d.sitio_web, 200)) return true;
  const espera = Number(d.espera);
  return d.espera !== undefined && d.espera !== '' && Number.isFinite(espera) && espera < ESPERA_MINIMA_MS;
}

async function limitar(limitador, clave) {
  if (!limitador) return;
  const {success} = await limitador.limit({key: clave});
  if (!success) throw new Problema(429, 'Recibimos muchas solicitudes seguidas. Espera un minuto e inténtalo de nuevo.');
}

/* ---------------- Subdominios ---------------- */

const cacheExistencia = new Map(); // por isolate; evita consultar la misma dirección a cada rato

export async function existeSubdominio(env, sub) {
  if (env.SUBDOMINIOS_PRUEBA !== undefined) return env.SUBDOMINIOS_PRUEBA.split(',').map((s) => s.trim()).includes(sub);
  const guardado = cacheExistencia.get(sub);
  if (guardado && guardado.hasta > Date.now()) return guardado.existe;
  let existe = false;
  try {
    // Los dominios de cada empresa son dominios propios de Workers en la misma zona: se pueden consultar con fetch.
    const r = await fetch(`https://${sub}.${ZONA}/`, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000)});
    existe = r.status < 520 || r.status > 530; // 52x/530: Cloudflare no encontró destino para ese nombre
  } catch {
    existe = false;
  }
  cacheExistencia.set(sub, {existe, hasta: Date.now() + (existe ? 600000 : 60000)});
  return existe;
}

/* ---------------- Correo (Gmail API) ---------------- */

async function secreto(env, nombre) {
  const b = env[nombre];
  try { return b && typeof b.get === 'function' ? String(await b.get() || '') : String(b || ''); } catch { return ''; }
}

function b64Utf8(valor) {
  const bytes = new TextEncoder().encode(valor);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}
const encabezado = (s) => `=?UTF-8?B?${b64Utf8(s)}?=`;

export async function enviarCorreo(env, {para, responderA, asunto, html}) {
  const [remitente, cliente, claveCliente, refresco] = await Promise.all(
    ['GMAIL_SENDER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].map((n) => secreto(env, n)));
  if (!remitente || !cliente || !claveCliente || !refresco) throw new Error('Correo sin configurar (credenciales de Gmail)');
  const urlToken = env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
  const urlEnvio = env.GMAIL_SEND_URL || 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const tok = await fetch(urlToken, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: cliente, client_secret: claveCliente, refresh_token: refresco, grant_type: 'refresh_token'})});
  if (!tok.ok) throw new Error(`Google rechazó las credenciales (${tok.status})`);
  const acceso = (await tok.json()).access_token;
  const lineas = [`From: ${encabezado('Sitio BríoDesk')} <${remitente}>`, `To: ${para}`];
  if (responderA && CORREO.test(responderA)) lineas.push(`Reply-To: ${responderA}`);
  lineas.push(`Subject: ${encabezado(asunto)}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', b64Utf8(html));
  const raw = b64Utf8(lineas.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch(urlEnvio, {method: 'POST', headers: {authorization: `Bearer ${acceso}`, 'content-type': 'application/json'},
    body: JSON.stringify({raw})});
  if (!r.ok) throw new Error(`Gmail no pudo enviar el correo (${r.status})`);
}

export function correoAviso(s) {
  const filas = [
    ['Nombre', s.nombre], ['Empresa', s.empresa], ['Correo', s.correo],
    ...(s.tipo === 'demo' ? [['Interés', s.interes]] : [['Dirección pedida', `${s.subdominio}.${ZONA}`]]),
    ['País (según IP)', s.pais || '—'], ['Recibida', new Date(s.creado_en).toLocaleString('es-CL', {timeZone: 'America/Santiago'})]
  ];
  const asunto = s.tipo === 'demo'
    ? `Solicitud de demo: ${s.empresa} (${s.interes})`
    : `Solicitud de dirección: ${s.subdominio}.${ZONA} (${s.empresa})`;
  const titulo = s.tipo === 'demo' ? 'Nueva solicitud de demostración' : 'Nueva solicitud de dirección';
  const html = `<div style="font-family:Arial,sans-serif;color:#0B2229;max-width:560px">
<h2 style="color:#062f3b;margin:0 0 12px">${escapar(titulo)}</h2>
<p style="margin:0 0 16px;color:#45606A">Llegó desde briodesk.cl. Puedes responder este correo para escribirle directamente.</p>
<table style="border-collapse:collapse;width:100%">${filas.map(([k, v]) =>
    `<tr><td style="padding:8px 12px 8px 0;color:#45606A;border-bottom:1px solid #E1E7E4;white-space:nowrap">${escapar(k)}</td><td style="padding:8px 0;border-bottom:1px solid #E1E7E4;font-weight:bold">${escapar(v)}</td></tr>`).join('')}</table>
<p style="margin:16px 0 0;font-size:12px;color:#45606A">Solicitud n.º ${escapar(s.id)}</p></div>`;
  return {asunto, html};
}

async function avisar(env, s) {
  try {
    const {asunto, html} = correoAviso(s);
    await enviarCorreo(env, {para: env.AVISO_A || 'ventas@briodesk.cl', responderA: s.correo, asunto, html});
    await env.DB.prepare('UPDATE solicitudes SET aviso_enviado_en=?, aviso_intentos=aviso_intentos+1, aviso_error=NULL WHERE id=?')
      .bind(ahora(), s.id).run();
  } catch (e) {
    console.error('aviso fallido', s.id, e.message);
    await env.DB.prepare('UPDATE solicitudes SET aviso_intentos=aviso_intentos+1, aviso_error=? WHERE id=?')
      .bind(texto(e.message, 300), s.id).run();
  }
}

async function guardar(env, ctx, request, s) {
  const fila = {...s, pais: request.cf?.country || null, creado_en: ahora()};
  const r = await env.DB.prepare(`INSERT INTO solicitudes (tipo,nombre,empresa,correo,interes,subdominio,pais,creado_en)
    VALUES (?,?,?,?,?,?,?,?) RETURNING id`)
    .bind(fila.tipo, fila.nombre, fila.empresa, fila.correo, fila.interes || null, fila.subdominio || null, fila.pais, fila.creado_en).first();
  ctx.waitUntil(avisar(env, {...fila, id: r.id}));
  return r.id;
}

/* ---------------- Acceso interno (BríoDesk) ---------------- */

// Compara en tiempo constante para no filtrar la llave por cuánto tarda la respuesta.
async function igualSeguro(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}
async function autorizarInterno(request, env) {
  const llave = String(env.SOLICITUDES_LLAVE || '');
  if (llave.length < 24) throw new Problema(503, 'La bandeja de BríoDesk no está configurada.');
  const dada = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!dada || !(await igualSeguro(dada, llave))) throw new Problema(401, 'No autorizado.');
}

/* ---------------- Rutas de la API ---------------- */

const respuestaOk = (html, destino) => html
  ? Response.redirect(new URL(destino, `https://${HOST_PRINCIPAL}`).toString(), 303)
  : json({ok: true});

async function api(request, env, ctx, url) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const ruta = url.pathname.replace(/\/+$/, '');

  if (ruta === '/api/demo' && request.method === 'POST') {
    await limitar(env.LIMITE_ENVIOS, `envio:${ip}`);
    const {datos, html} = await leerCuerpo(request);
    if (pareceBot(datos)) return respuestaOk(html, '/gracias');
    const contacto = validarContacto(datos);
    const interes = INTERESES.includes(texto(datos.interes, 40)) ? texto(datos.interes, 40) : 'Brío Desk';
    await guardar(env, ctx, request, {tipo: 'demo', ...contacto, interes});
    return respuestaOk(html, '/gracias');
  }

  if (ruta === '/api/subdominio' && request.method === 'POST') {
    await limitar(env.LIMITE_ENVIOS, `envio:${ip}`);
    const {datos, html} = await leerCuerpo(request);
    if (pareceBot(datos)) return respuestaOk(html, '/gracias');
    const contacto = validarContacto(datos);
    const subdominio = normalizarSubdominio(datos.subdominio).replace(/\.demo$/, '');
    if (!SUBDOMINIO.test(subdominio)) throw new Problema(422, 'La dirección solo puede tener letras, números y guiones.', 'subdominio');
    if (esInterno(subdominio)) throw new Problema(409, 'Esa dirección está reservada. Prueba con otra.', 'subdominio');
    if (await existeSubdominio(env, subdominio)) throw new Problema(409, `${subdominio}.${ZONA} ya está en uso. Prueba con otra.`, 'subdominio');
    await guardar(env, ctx, request, {tipo: 'subdominio', ...contacto, subdominio});
    return respuestaOk(html, '/gracias');
  }

  if (ruta === '/api/interno/solicitudes' && request.method === 'GET') {
    await limitar(env.LIMITE_CONSULTAS, `interno:${ip}`);
    await autorizarInterno(request, env);
    const desde = Math.max(0, Math.floor(Number(url.searchParams.get('desde')) || 0));
    const {results} = await env.DB.prepare('SELECT id,tipo,nombre,empresa,correo,interes,subdominio,pais,creado_en FROM solicitudes WHERE id>? ORDER BY id LIMIT 200').bind(desde).all();
    return json({solicitudes: results || []});
  }

  const m = ruta.match(/^\/api\/subdominio\/([^/]+)$/);
  if (m && (request.method === 'GET' || request.method === 'HEAD')) {
    await limitar(env.LIMITE_CONSULTAS, `consulta:${ip}`);
    const sub = normalizarSubdominio(decodeURIComponent(m[1]));
    const existe = SUBDOMINIO.test(sub) && !esInterno(sub) && await existeSubdominio(env, sub);
    return json({existe});
  }

  throw new Problema(404, 'No existe.');
}

async function conCabeceras(respuesta) {
  const r = new Response(respuesta.body, respuesta);
  for (const [k, v] of Object.entries(CABECERAS_SEGURIDAD)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // www.briodesk.cl → briodesk.cl ; app.briodesk.cl → briodesk.cl/ingresar
    if (url.hostname === `www.${ZONA}`) return Response.redirect(`https://${HOST_PRINCIPAL}${url.pathname}${url.search}`, 301);
    if (url.hostname === `app.${ZONA}`) return Response.redirect(`https://${HOST_PRINCIPAL}/ingresar`, 301);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, ctx, url);
      } catch (e) {
        if (e instanceof Problema) return json({ok: false, error: e.message, campo: e.campo}, e.status);
        console.error('error en la API', e);
        return json({ok: false, error: 'No pudimos procesar la solicitud.'}, 500);
      }
    }
    let respuesta = await env.ASSETS.fetch(request);
    // La portada lleva los precios vigentes de la plataforma (o los del HTML si no responde).
    if (['/', '/index.html', '/index'].includes(url.pathname) && (respuesta.headers.get('content-type') || '').includes('text/html')) {
      const precios = await preciosVigentes(env, ctx);
      respuesta = precios ? aplicarPrecios(respuesta, precios.valores) : respuesta;
      respuesta = new Response(respuesta.body, respuesta);
      respuesta.headers.set('x-precios', precios ? precios.version : 'respaldo');
    }
    return conCabeceras(respuesta);
  },

  // Reintenta los avisos que no salieron (Gmail caído, credenciales vencidas…).
  async scheduled(_evento, env) {
    const {results} = await env.DB.prepare(`SELECT * FROM solicitudes WHERE aviso_enviado_en IS NULL AND aviso_intentos < ?
      ORDER BY id LIMIT 20`).bind(MAX_INTENTOS).all();
    for (const s of results) await avisar(env, s);
  }
};
