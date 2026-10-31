#!/usr/bin/env node
/* Genera los iconos de la PWA (pb_public/icons/*.png) sin dependencias: un
   PNG es zlib (que Node trae) más CRC. El dibujo es el de la app: fondo
   ámbar (el acento de HyperOS) con esquinas redondeadas, y una hoja blanca
   con tres líneas. La variante "maskable" lleva el fondo hasta el borde
   (Android la recorta en círculo); las otras dejan aire alrededor.

     node scripts/icons.js */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const AMBER = [255, 179, 0];
const WHITE = [255, 255, 255];
const LINE = [255, 196, 64];

/* Distancia con signo a un rectángulo redondeado centrado en (cx,cy). */
function sdRound(px, py, cx, cy, w, h, r) {
  const dx = Math.abs(px - cx) - (w / 2 - r), dy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}
const cover = d => Math.max(0, Math.min(1, 0.5 - d));   // antialias de 1 px

function render(size, { maskable = false, transparent = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const pad = maskable ? 0 : size * 0.08;
  const bgR = maskable ? 0 : size * 0.22;
  const bgW = size - pad * 2;
  const c = size / 2;
  // la hoja: 46% de ancho, 58% de alto, esquinas suaves
  const pw = size * 0.46, ph = size * 0.58, pr = size * 0.07;
  const lines = [0.36, 0.47, 0.58].map(f => size * f);
  const lw = size * 0.052, lh = size * 0.034, lr = lh / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const X = x + 0.5, Y = y + 0.5;
    let a = cover(sdRound(X, Y, c, c, bgW, bgW, bgR));
    let col = AMBER;
    const p = cover(sdRound(X, Y, c, c + size * 0.02, pw, ph, pr));
    if (p > 0) col = mix(col, WHITE, p);
    for (let i = 0; i < lines.length; i++) {
      const w = i === 2 ? pw * 0.42 : pw * 0.64;
      const l = cover(sdRound(X, Y, c - (pw * 0.64 - w) / 2, lines[i] + size * 0.02 + lh / 2, w, lh, lr));
      if (l > 0) col = mix(col, LINE, l * p);
    }
    const i = (y * size + x) * 4;
    if (!transparent) { a = 1; }
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = Math.round(a * 255);
  }
  return png(size, size, px);
}
function mix(a, b, t) { return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)); }

/* Codificador PNG mínimo: RGBA 8 bits, sin filtro. */
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return c ^ -1; }

const out = path.join(__dirname, '..', 'pb_public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512));
fs.writeFileSync(path.join(out, 'icon-512-maskable.png'), render(512, { maskable: true, transparent: false }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, { maskable: true, transparent: false }));
console.log('iconos en', out);
