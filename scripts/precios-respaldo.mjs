// Escribe en public/index.html los precios de respaldo (los que se ven si la
// plataforma no responde), con el mismo formato que usa el Worker.
// Uso: npm run precios:respaldo [-- archivo.json | URL]   (por defecto, la URL de producción)
import fs from 'node:fs';
import path from 'node:path';
import {PRECIOS_URL, valoresSitio} from '../src/precios.js';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const origen = process.argv[2] || PRECIOS_URL;
const lista = /^https?:/.test(origen) ? await (await fetch(origen)).json() : JSON.parse(fs.readFileSync(origen, 'utf8'));
const valores = valoresSitio(lista);
const html = path.join(raiz, 'public/index.html');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t) => esc(t).replace(/"/g, '&quot;');
let faltan = [];
const nuevo = fs.readFileSync(html, 'utf8').replace(/<(\w+)([^>]*?)\sdata-p="([^"]+)"([^>]*)>([^<]*)<\/\1>/g, (todo, tag, antes, clave, despues) => {
  const v = valores[clave];
  if (!v) { faltan.push(clave); return todo; }
  let attrs = `${antes} data-p="${clave}"${despues}`.replace(/\sdata-(mensual|anual)="[^"]*"/g, '');
  if (v.mensual !== undefined) attrs += ` data-mensual="${escAttr(v.mensual)}" data-anual="${escAttr(v.anual)}"`;
  return `<${tag}${attrs}>${esc(v.texto)}</${tag}>`;
});
if (faltan.length) { console.error('Claves sin valor en la lista:', [...new Set(faltan)].join(', ')); process.exit(1); }
fs.writeFileSync(html, nuevo);
console.log(`Precios de respaldo actualizados (versión ${lista.version}).`);
