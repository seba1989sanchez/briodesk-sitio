# briodesk.cl — sitio público

Sitio de BríoDesk: HTML, CSS y JavaScript sin frameworks ni dependencias. Se publica como un Worker de Cloudflare con archivos estáticos (`wrangler.jsonc`).

## Estructura

```
public/
  index.html          Landing
  ingresar.html       /ingresar: lleva al subdominio de la empresa o permite solicitar uno
  privacidad.html     /privacidad  (texto pendiente de traspaso desde el sitio anterior)
  terminos.html       /terminos    (texto pendiente de traspaso desde el sitio anterior)
  404.html
  assets/css/sitio.css    Tokens de marca y estilos
  assets/js/sitio.js      Rotadores, selectores, menú móvil, planes y formulario de demo
  assets/js/ingresar.js   Página Ingresar
  assets/img/             Logo (versión clara y oscura), símbolo, imagen Open Graph
pruebas/comportamiento.cjs  Pruebas de interacción con Playwright
```

## Ver en local

```
npx http-server public -p 8787 -e html -c-1
```

Y abrir http://127.0.0.1:8787. Para correr las pruebas, con el servidor arriba:

```
node pruebas/comportamiento.cjs
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

## Publicación

Pendiente (etapa 4): Worker con `/api/demo`, `/api/subdominio` y `/api/subdominio/:nombre`, base D1 y aviso por correo a ventas@briodesk.cl. El cambio de DNS de briodesk.cl (hoy apunta al alojamiento de ChatGPT) se hace al final, cuando el sitio esté aprobado.
