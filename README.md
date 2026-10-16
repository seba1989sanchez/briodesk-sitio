# briodesk.cl — sitio público

Sitio de BríoDesk: HTML, CSS y JavaScript sin frameworks ni dependencias en el navegador. Se publica como un Worker de Cloudflare (`wrangler.jsonc`) que sirve `public/` y recibe los formularios.

## Estructura

```
public/
  index.html          Landing
  ingresar.html       /ingresar: lleva al subdominio de la empresa o permite solicitar uno
  privacidad.html     /privacidad  (versión preliminar, sept. 2026)
  terminos.html       /terminos    (versión preliminar, sept. 2026)
  gracias.html        Confirmación para envíos sin JavaScript
  404.html
  assets/css/sitio.css    Tokens de marca y estilos
  assets/js/sitio.js      Rotadores, selectores, menú móvil, planes y formulario de demo
  assets/js/ingresar.js   Página Ingresar
  assets/img/             Logo (versión clara y oscura), símbolo, imagen Open Graph
src/index.js            Worker: formularios, consulta de subdominios, redirecciones y cabeceras
migraciones/            Esquema de la base D1 (briodesk-sitio-db)
pruebas/worker.mjs      Pruebas de punta a punta del Worker (npm test)
pruebas/comportamiento.cjs  Pruebas de interacción en el navegador (Playwright)
.github/workflows/desplegar.yml  Prueba en cada push; en main migra D1 y despliega
```

## Ver en local

```
npm ci
npx wrangler d1 migrations apply DB --local --env prueba
npx wrangler dev --env prueba --port 8787
```

Y abrir http://127.0.0.1:8787. El entorno `prueba` no usa el Secrets Store: sin credenciales de Gmail las solicitudes se guardan igual y el aviso queda pendiente. `SUBDOMINIOS_PRUEBA` simula qué direcciones existen.

Pruebas:

```
npm test                              # Worker de punta a punta (levanta su propio wrangler dev)
node pruebas/comportamiento.cjs       # navegador, con el wrangler dev de arriba corriendo
```

## Cómo funcionan las animaciones

Cada bloque con `data-rotador` es un `tablist` con sus paneles. Avanza solo cada `data-intervalo` ms, pero:

- corre solo mientras la sección está visible (`IntersectionObserver`);
- se pausa con el mouse encima o con foco de teclado dentro;
- se detiene cuando el visitante elige una pestaña (en «Sigue un ticket», el botón Reproducir la reanuda);
- con `prefers-reduced-motion` no rota ni anima.

Los textos que cambian con la pestaña salen de atributos de la propia pestaña (`data-titulo`, `data-url`, `data-texto`…) o de contenedores `data-por-indice` con un hijo por pestaña. Todo el contenido está en el HTML: sin JavaScript se ve la primera vista de cada bloque.

## Actualizar precios

Los precios en pesos son los oficiales y van fijos en `public/index.html`, sección `#planes`. No se calculan desde la UF. Se revisan una vez al año:

1. En cada plan, actualizar `data-mensual` y `data-anual` (precio, UF y la nota «Equivale a … al mes»). El texto visible entre etiquetas es el valor mensual, para quien no tenga JavaScript.
2. Actualizar las tablas de Brío Assets, Brío Projects y Licencias adicionales.
3. Actualizar la nota legal al pie (valor y mes de la UF de referencia).

Pago anual = 10 × mensual. Montos de oct. 2026 calculados con UF $41.065.

## Marca

- Logo, títulos y textos: **BríoDesk**.
- Productos: **Brío Desk**, **Brío Assets**, **Brío Projects**.
- Dominios y correos: `briodesk` en minúscula y sin tilde.

## Formularios (API del Worker)

| Ruta | Qué hace |
|---|---|
| `POST /api/demo` | Solicitud de demostración: nombre, empresa, correo, interés |
| `POST /api/subdominio` | Solicitud de dirección nueva; rechaza las reservadas y las que ya existen |
| `GET /api/subdominio/:nombre` | `{existe: true/false}`; lo usa /ingresar antes de redirigir |

- Aceptan JSON (desde el sitio) o formulario normal (sin JavaScript: redirige a `/gracias`).
- Cada solicitud queda en la tabla `solicitudes` de D1 y se avisa a `AVISO_A` (ventas@briodesk.cl) con «Responder a» apuntando a quien escribió. El correo sale por la API de Gmail con las mismas credenciales del ITSM y Brío Control (Secrets Store). Si falla, el cron lo reintenta cada 30 minutos, hasta 5 veces.
- Contra spam: campo trampa, descarte de envíos hechos a menos de 2,5 s de cargar la página y límite de 5 envíos por minuto por IP.
- Para saber si `xxx.briodesk.cl` existe, el Worker la consulta directamente: los dominios de cada empresa son dominios propios de Workers en la misma zona. Las direcciones internas (www, app, consola, licencias, netmon, desarrollo, *-dev…) nunca se ofrecen.

Ver solicitudes: Cloudflare → D1 → `briodesk-sitio-db` → Console, por ejemplo `SELECT * FROM solicitudes ORDER BY id DESC LIMIT 50`.

## Publicación

1. **GitHub:** este repositorio necesita los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` (los mismos de Brío Control) en el entorno `production`. Cada push a `main` corre las pruebas, aplica las migraciones y despliega.
2. **Revisión:** el Worker queda en `briodesk-sitio.<cuenta>.workers.dev` para revisarlo antes de tocar el DNS.
3. **Cambio de DNS** (cuando el sitio esté aprobado), en Cloudflare → briodesk.cl → DNS:
   - borrar los dos registros A de `briodesk.cl` (172.66.3.26 y 162.159.143.30) y los CNAME de `www` y `app` (custom-domains.chatgpt.site);
   - agregar en `wrangler.jsonc` las rutas `briodesk.cl`, `www.briodesk.cl` y `app.briodesk.cl` con `"custom_domain": true` y desplegar. El Worker redirige `www` al dominio principal y `app` a `/ingresar`;
   - después, borrar los TXT `_openai-site-verification.*` y `_cf-custom-hostname.*` y quitar el dominio en ChatGPT.
