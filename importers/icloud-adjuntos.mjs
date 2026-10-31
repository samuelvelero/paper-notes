#!/usr/bin/env node
/* ═══════════ importers/icloud-adjuntos.mjs — desempaqueta los adjuntos de iCloud ═══════════

   Los adjuntos de Apple Notes viven en CloudKit como registros `Attachment`
   (uno por imagen, dibujo, escaneo, PDF, vídeo o enlace) que apuntan a un
   registro `Media` con el archivo original, o llevan ellos mismos las vistas
   previas (`PreviewImages`) y, en los dibujos, un `FallbackImage` en PNG.
   Desde la pestaña de icloud.com se pueden leer con el CloudKit JS que la
   propia app carga (`fetchRecordZoneChanges` sobre la zona "Notes") y bajar
   cada archivo con `fetch` (los `downloadURL` admiten CORS). Como esa página
   no puede hablar con localhost (CSP), el script del navegador junta todo en
   un solo archivo que se descarga: `icloud-adjuntos.bin`, con este formato

     16 bytes ASCII: longitud N de la cabecera, con ceros a la izquierda
     N bytes: JSON { format: 'icloud-adjuntos-1', entries: [...] }
     el resto: los archivos, uno detrás de otro (`offset` y `size` en cada entrada)

   Qué archivo se guarda por cada tipo (Apple pone el UTI en el adjunto):
     jpeg / png / webp / gif  → el original (`Media.Asset`)
     heic                     → la vista previa PNG (los navegadores no pintan
                                HEIC) y, aparte, el original .heic
     com.apple.paper (dibujo) → `FallbackImage` (PNG a tamaño completo)
     escaneo / PDF            → la vista previa de la primera página y el PDF
     vídeo / galería          → solo la vista previa
     enlace (public.url)      → la URL (va en `index.json`, no hay archivo)
     tablas, inline, otros    → nada

   Este script escribe `<carpeta>/index.json` y un archivo por adjunto
   (`<id>.<ext>`); `importers/icloud.mjs` lee esa carpeta (`adjuntos/`, junto
   a `notas/`) y sube las imágenes a la colección `attachments`.

     node importers/icloud-adjuntos.mjs <icloud-adjuntos.bin> <carpeta-salida> */

import fs from 'node:fs';
import path from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('uso: node importers/icloud-adjuntos.mjs <icloud-adjuntos.bin> <carpeta-salida>'); process.exit(2); }

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const DISPLAY = new Set(['original', 'preview', 'fallback']);   // lo que se enseña en la nota

const fd = fs.openSync(src, 'r');
const lenBuf = Buffer.alloc(16);
fs.readSync(fd, lenBuf, 0, 16, 0);
const hlen = parseInt(lenBuf.toString('ascii'), 10);
if (!hlen) { console.error('cabecera ilegible'); process.exit(1); }
const hbuf = Buffer.alloc(hlen);
fs.readSync(fd, hbuf, 0, hlen, 16);
const header = JSON.parse(hbuf.toString('utf8'));
if (header.format !== 'icloud-adjuntos-1') { console.error('formato desconocido:', header.format); process.exit(1); }
const base = 16 + hlen;

fs.mkdirSync(out, { recursive: true });
const index = {};
let files = 0;
for (const e of header.entries) {
  const it = index[e.id] = index[e.id] || { uti: e.uti, name: e.name, url: e.url, note: e.note, image: null, extras: [] };
  if (e.offset < 0 || !e.size) continue;
  const ext = EXT[e.mime] || 'bin';
  const file = `${e.id}${DISPLAY.has(e.kind) ? '' : '.' + e.kind}.${ext}`;
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, base + e.offset);
  fs.writeFileSync(path.join(out, file), buf);
  files++;
  const info = { file, mime: e.mime, width: e.width, height: e.height, size: e.size, kind: e.kind };
  if (DISPLAY.has(e.kind) && /^image\/(png|jpeg|webp|gif)$/.test(e.mime)) it.image = info; else it.extras.push(info);
}
fs.closeSync(fd);
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ exported: header.exported, adjuntos: index }, null, 1));
const conImagen = Object.values(index).filter(x => x.image).length;
console.log(`${Object.keys(index).length} adjuntos, ${files} archivos, ${conImagen} con imagen para la nota → ${out}`);
