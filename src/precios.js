// Precios del sitio desde la lista única de BríoDesk (GET /api/pricing de la
// plataforma, lib/pricing.ts). El Worker la lee con caché y reemplaza los
// precios en el HTML antes de enviarlo; si la plataforma no responde o la
// respuesta no es válida, quedan los valores escritos en public/index.html.
//
// Cada elemento con data-p="clave" recibe el texto de esa clave. Si la clave
// tiene versión mensual y anual, también recibe data-mensual y data-anual (el
// selector Mensual / Anual de la página las usa). Los valores de respaldo del
// HTML se generan con esta misma función: npm run precios:respaldo.

export const PRECIOS_URL = 'https://consola.briodesk.cl/api/pricing';

const num = (v, ruta) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Lista de precios inválida: falta ${ruta}`);
  return v;
};
export const clp = (n) => '$' + Math.round(n).toLocaleString('es-CL');
export const uf = (n) => (Math.round(n * 100) / 100).toLocaleString('es-CL', {maximumFractionDigits: 2}) + ' UF';
const miles = (n) => n.toLocaleString('es-CL');

/** Textos del sitio a partir de la lista de precios. Lanza un error si falta algo. */
export function valoresSitio(p) {
  if (!p || p.moneda !== 'CLP' || typeof p.version !== 'string') throw new Error('Lista de precios inválida');
  const meses = num(p.pagoAnual?.mesesPagados, 'pagoAnual.mesesPagados');
  const v = {};
  const texto = (k, t) => { v[k] = {texto: t}; };
  const periodo = (k, mensual, anual) => { v[k] = {texto: mensual, mensual, anual}; };
  // Precio con su UF y la nota del pago anual (12 meses pagando N).
  const plan = (k, m, ruta) => {
    const precio = num(m?.precio, ruta + '.precio'), u = num(m?.uf, ruta + '.uf');
    periodo(`${k}.precio`, clp(precio), clp(precio * meses));
    periodo(`${k}.uf`, `${uf(u)} al mes`, `${uf(u * meses)} al año`);
    periodo(`${k}.nota`, '', `Equivale a ${clp((precio * meses) / 12)} al mes`);
  };
  const mensual = (k, m, ruta) => {
    texto(`${k}.precio`, `${clp(num(m?.precio, ruta + '.precio'))} /mes`);
    texto(`${k}.uf`, m?.uf === undefined ? '' : uf(num(m.uf, ruta + '.uf')));
  };

  // Brío Desk
  const D = p.desk?.planes || {};
  for (const id of ['basico', 'equipo', 'empresa']) plan(`desk.${id}`, D[id], `desk.planes.${id}`);
  texto('desk.basico.nominales', `${num(D.basico.nominales, 'desk.planes.basico.nominales')} licencias nominales incluidas`);
  texto('desk.basico.max', `Ampliable hasta ${num(D.basico.nominalesMax, 'desk.planes.basico.nominalesMax')} licencias nominales`);
  texto('desk.equipo.nominales', `${num(D.equipo.nominales, 'desk.planes.equipo.nominales')} licencias nominales incluidas`);
  texto('desk.equipo.concurrentes', `${num(D.equipo.concurrentes, 'desk.planes.equipo.concurrentes')} licencias concurrentes incluidas`);
  const I = p.desk.incluye || {};
  texto('incluye.activos', `Activos básico: hasta ${num(I.activosBasico?.bienes, 'desk.incluye.activosBasico.bienes')} bienes`);
  texto('incluye.projects', `Projects básico: ${num(I.projectsBasico?.proyectosActivos, 'desk.incluye.projectsBasico.proyectosActivos')} proyectos activos`);
  texto('incluye.inout', `InOut básico: ${num(I.inoutBasico?.proveedores, 'desk.incluye.inoutBasico.proveedores')} proveedores y ${num(I.inoutBasico?.contratosConAlertas, 'desk.incluye.inoutBasico.contratosConAlertas')} contratos con alertas`);
  mensual('licencia.nominal', p.desk.adicionales?.nominal, 'desk.adicionales.nominal');
  mensual('licencia.concurrente', p.desk.adicionales?.concurrente, 'desk.adicionales.concurrente');

  // Suites: precio, tramo de Assets incluido y ahorro frente a los módulos con Desk.
  const S = p.suites?.planes || {};
  const tramo = (id) => (p.assets?.tramos || []).find((t) => t.id === id);
  for (const id of ['basica', 'equipo']) {
    const s = S[id];
    plan(`suite.${id}`, s, `suites.planes.${id}`);
    const t = tramo(s.assets), desk = s.desk;
    if (!t) throw new Error(`Lista de precios inválida: tramo ${s.assets}`);
    texto(`suite.${id}.assets`, `Brío Assets hasta ${miles(num(t.hasta, 'assets.tramos.hasta'))} activos`);
    const suma = num(D[desk]?.precio, `desk.planes.${desk}.precio`) + num(t.conDesk?.precio, 'assets.tramos.conDesk.precio')
      + num(p.projects?.conDesk?.[desk]?.precio, `projects.conDesk.${desk}.precio`) + num(p.inout?.conDesk?.[desk]?.precio, `inout.conDesk.${desk}.precio`);
    texto(`suite.${id}.ahorro`, `Ahorras ${clp(suma - s.precio)} al mes frente a contratar cada módulo`);
  }

  // Brío Assets (con Desk / solo)
  for (const t of p.assets?.tramos || []) {
    texto(`assets.${t.id}.hasta`, `Hasta ${miles(num(t.hasta, 'assets.tramos.hasta'))} activos`);
    mensual(`assets.${t.id}.conDesk`, t.conDesk, `assets.tramos.${t.id}.conDesk`);
    mensual(`assets.${t.id}.solo`, t.solo, `assets.tramos.${t.id}.solo`);
  }
  const AS = p.assets?.solo || {};
  texto('assets.solo.incluye', `Solo Assets incluye ${num(AS.gestoresIncluidos, 'assets.solo.gestoresIncluidos')} gestores de activos y el portal «${AS.portal}». Gestor adicional: ${clp(num(AS.gestorAdicional?.precio, 'assets.solo.gestorAdicional.precio'))} /mes.`);

  // Brío Projects e InOut
  const pct = (x, ruta) => `${num(x?.pctMin, ruta + '.pctMin')} % a ${num(x?.pctMax, ruta + '.pctMax')} % del plan Empresa`;
  for (const prod of ['projects', 'inout']) {
    const X = p[prod] || {};
    mensual(`${prod}.basico`, X.conDesk?.basico, `${prod}.conDesk.basico`);
    mensual(`${prod}.equipo`, X.conDesk?.equipo, `${prod}.conDesk.equipo`);
    texto(`${prod}.empresa`, pct(X.conDesk?.empresa, `${prod}.conDesk.empresa`));
    for (const s of X.solo || []) {
      mensual(`${prod}.solo${s.id}`, s, `${prod}.solo.${s.id}`);
      texto(`${prod}.solo${s.id}.label`, prod === 'projects'
        ? `Solo Projects · hasta ${num(s.jefesProyecto, 'projects.solo.jefesProyecto')} jefes de proyecto`
        : `Solo InOut · hasta ${num(s.usuarios, 'inout.solo.usuarios')} usuarios${s.conectoresIncluidos ? ` + ${s.conectoresIncluidos} conector` : ''}`);
    }
  }
  const C = p.inout?.conector || {};
  texto('inout.conector', `Conector con tu sistema de facturación (${(C.sistemas || []).join(', ').replace(/, Otro$/, ' u otro')}): incluido desde Desk Equipo; con Desk Básico o sin Desk, ${clp(num(C.mensual?.precio, 'inout.conector.mensual.precio'))} /mes por conector. Configuración: ${clp(num(C.configuracion?.precio, 'inout.conector.configuracion.precio'))} por conector, pago único.`);

  // Condiciones
  texto('implementacion', `Implementación desde ${clp(num(p.implementacion?.precio, 'implementacion.precio'))}, pago único`);
  texto('prueba', `Prueba de ${num(p.prueba?.dias, 'prueba.dias')} días con todo incluido`);
  texto('limites', `Límites blandos: avisamos al ${num(p.limites?.avisoPct, 'limites.avisoPct')} % y el servicio no se corta`);
  texto('nota', `Valores en pesos chilenos, más IVA. La equivalencia en UF es solo referencial. Precios fijos por 12 meses desde la contratación; reajuste ${p.reajuste}. Pago anual: ${num(p.pagoAnual.mesesServicio, 'pagoAnual.mesesServicio')} meses de servicio pagando ${meses}.`);
  return v;
}

/* ---------- Lectura con caché ---------- */

let memoria = null; // {precios: {version, valores} | null, hasta}
const MEMORIA_OK_MS = 5 * 60 * 1000, MEMORIA_ERROR_MS = 60 * 1000, CACHE_S = 3600;

/** Precios vigentes, o null si no se pudieron leer (se usan los del HTML). */
export async function preciosVigentes(env, ctx) {
  const url = env.PRECIOS_URL ?? PRECIOS_URL;
  if (!url) return null;
  // PRECIOS_SIN_CACHE=1 (solo pruebas): lee siempre de nuevo.
  const sinCache = env.PRECIOS_SIN_CACHE === '1';
  if (!sinCache && memoria && memoria.url === url && memoria.hasta > Date.now()) return memoria.precios;
  let precios = null;
  try {
    const cache = !sinCache && typeof caches !== 'undefined' ? caches.default : null, clave = new Request(url);
    let r = cache ? await cache.match(clave) : null;
    if (!r) {
      r = await fetch(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(2500)});
      if (!r.ok) throw new Error(`La lista de precios respondió ${r.status}`);
      if (cache) {
        const copia = new Response(r.clone().body, r);
        copia.headers.set('cache-control', `public, max-age=${CACHE_S}`);
        ctx?.waitUntil?.(cache.put(clave, copia));
      }
    }
    const lista = await r.json();
    precios = {version: lista.version, valores: valoresSitio(lista)};
  } catch (e) {
    console.error('precios: se usan los del HTML', e.message);
  }
  memoria = {url, precios, hasta: Date.now() + (precios ? MEMORIA_OK_MS : MEMORIA_ERROR_MS)};
  return precios;
}

/** Reemplaza los precios marcados con data-p en una respuesta HTML. */
export function aplicarPrecios(respuesta, valores) {
  return new HTMLRewriter().on('[data-p]', {
    element(el) {
      const v = valores[el.getAttribute('data-p')];
      if (!v) return;
      if (v.mensual !== undefined) { el.setAttribute('data-mensual', v.mensual); el.setAttribute('data-anual', v.anual); }
      el.setInnerContent(v.texto);
    },
  }).transform(respuesta);
}

/** Solo para las pruebas: olvida lo leído. */
export function olvidarPrecios() { memoria = null; }
