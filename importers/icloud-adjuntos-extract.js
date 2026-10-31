/* ═══════════ importers/icloud-adjuntos-extract.js — bajar los adjuntos de icloud.com ═══════════

   Segunda pasada de la migración, después de `icloud-extract.js`. Se pega en
   la consola del navegador con la sesión abierta en https://www.icloud.com/notes/.

   Los adjuntos no están en el modelo de la nota (solo su id y su UTI): son
   registros `Attachment` de CloudKit en la zona "Notes", que apuntan a un
   registro `Media` con el archivo original (`Asset`, nombre en
   `FilenameEncrypted`, base64) o llevan vistas previas (`PreviewImages`) y,
   en los dibujos, un `FallbackImage` PNG a tamaño completo. La app carga el
   CloudKit JS oficial (`window.CloudKit` dentro del iframe), y con él
   `fetchRecordZoneChanges` recorre la zona entera (notas, carpetas, adjuntos,
   medios, etiquetas…). Los `downloadURL` admiten CORS, así que `fetch` los
   baja desde la propia página.

   La página no puede hablar con localhost (CSP) ni abrir ventanas útiles, así
   que todo se junta en un Blob y se descarga como `icloud-adjuntos.bin`
   (formato en `icloud-adjuntos.mjs`, que lo desempaqueta). Para unas 300
   imágenes son ~280 MB y menos de un minuto.

   Qué se baja por tipo: fotos (jpeg/png/webp/gif) el original; HEIC la vista
   previa PNG más grande (los navegadores no pintan HEIC) y aparte el original;
   dibujos el `FallbackImage`; escaneos y PDF la vista previa y el PDF; vídeos
   y galerías solo la vista previa; enlaces nada (la URL va en la cabecera);
   tablas e inline (etiquetas, cálculos) nada.

   Progreso en `window.__adj` ({done, total, bytes, failed, finished}). Al
   terminar deja el Blob en `window.__adjBundle` y lanza la descarga. */
(async function () {
  const frame = document.querySelector('iframe');
  const w = frame && frame.contentWindow && frame.contentWindow.NotesApp ? frame.contentWindow : window;
  if (!w.NotesApp || !w.CloudKit) { console.error('No encuentro NotesApp/CloudKit: ¿estás en icloud.com/notes con la sesión abierta?'); return; }
  const db = w.CloudKit.getDefaultContainer().privateCloudDatabase;

  /* 1. toda la zona "Notes", página a página */
  const all = []; let token;
  for (let page = 0; page < 500; page++) {
    const r = await db.fetchRecordZoneChanges({ zoneID: { zoneName: 'Notes' }, resultsLimit: 200, syncToken: token });
    if (r.hasErrors) throw new Error(r.errors.map(e => e.ckErrorCode + ' ' + e.reason).join('; '));
    const z = r.zones[0]; all.push(...z.records); token = z.syncToken;
    if (!z.moreComing) break;
  }
  const att = all.filter(x => x.recordType === 'Attachment' && !x.deleted);
  const media = new Map(all.filter(x => x.recordType === 'Media' && !x.deleted).map(m => [m.recordName, m]));
  const b64 = v => { try { return decodeURIComponent(escape(atob(v))); } catch (e) { return ''; } };
  const largest = list => (list && list.length ? list.reduce((a, b) => (b.size > a.size ? b : a)) : null);

  /* 2. plan: qué archivo bajar por adjunto */
  const jobs = [];
  for (const a of att) {
    const f = a.fields, uti = f.UTI ? f.UTI.value : '', id = a.recordName;
    const m = f.Media ? media.get(f.Media.value.recordName) : null;
    const asset = m && m.fields.Asset ? m.fields.Asset.value : null;
    const base = { id, uti, note: f.Note ? f.Note.value.recordName : '', width: f.Width ? Math.round(f.Width.value) : 0, height: f.Height ? Math.round(f.Height.value) : 0, name: m && m.fields.FilenameEncrypted ? b64(m.fields.FilenameEncrypted.value) : (f.TitleEncrypted ? b64(f.TitleEncrypted.value) : ''), url: f.URLStringEncrypted ? b64(f.URLStringEncrypted.value) : '' };
    const prev = largest(f.PreviewImages && f.PreviewImages.value);
    const push = (kind, as) => jobs.push({ ...base, kind, src: as.downloadURL, size: as.size });
    if (/^(public\.jpeg|public\.png|org\.webmproject\.webp|public\.gif)$/.test(uti) && asset) push('original', asset);
    else if (uti === 'public.heic' && prev) { push('preview', prev); if (asset) push('heic-original', asset); }
    else if (/^com\.apple\.(paper|drawing\.2)$/.test(uti)) { if (f.FallbackImage) push('fallback', f.FallbackImage.value); else if (prev) push('preview', prev); else jobs.push({ ...base, kind: 'none' }); }
    else if (/^(com\.apple\.paper\.doc\.(scan|pdf)|com\.adobe\.pdf)$/.test(uti)) { if (prev) push('preview', prev); const pdf = f.FallbackPDF ? f.FallbackPDF.value : asset; if (pdf) push('pdf', pdf); }
    else if (uti === 'public.mpeg-4' || uti === 'com.apple.notes.gallery') { if (prev) push('preview', prev); else jobs.push({ ...base, kind: 'none' }); }
    else jobs.push({ ...base, kind: 'none' });
  }
  const st = window.__adj = { jobs, done: 0, total: jobs.filter(j => j.src).length, bytes: 0, failed: [], finished: false };
  console.log(`${att.length} adjuntos, ${st.total} archivos por bajar`);

  /* 3. descarga en paralelo, con el tipo real por los primeros bytes */
  const sniff = u => (u[0] === 0x89 && u[1] === 0x50 ? 'image/png' : u[0] === 0xFF && u[1] === 0xD8 ? 'image/jpeg' : u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57 ? 'image/webp' : u[0] === 0x25 && u[1] === 0x50 ? 'application/pdf' : u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70 ? 'image/heic' : u[0] === 0x47 && u[1] === 0x49 ? 'image/gif' : 'application/octet-stream');
  const q = jobs.filter(j => j.src); let i = 0;
  async function worker() {
    while (i < q.length) {
      const j = q[i++];
      for (let t = 0; t < 3; t++) {
        try { const r = await fetch(j.src); if (!r.ok) throw new Error('HTTP ' + r.status); j.data = await r.arrayBuffer(); j.mime = sniff(new Uint8Array(j.data.slice(0, 12))); j.size = j.data.byteLength; st.bytes += j.size; st.done++; break; }
        catch (e) { if (t === 2) st.failed.push({ id: j.id, kind: j.kind, err: String(e.message || e) }); else await new Promise(r => setTimeout(r, 800)); }
      }
    }
  }
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));

  /* 4. medidas reales (las de Apple son del original, no de la vista previa) y paquete */
  for (const j of jobs) if (j.data && /^image\/(png|jpeg|webp|gif)$/.test(j.mime)) { try { const bm = await createImageBitmap(new Blob([j.data], { type: j.mime })); j.width = bm.width; j.height = bm.height; bm.close(); } catch (e) { /* se queda con la de Apple */ } }
  const entries = [], parts = []; let off = 0;
  for (const j of jobs) {
    entries.push({ id: j.id, uti: j.uti, kind: j.kind, name: j.name || '', url: j.url || '', note: j.note, mime: j.mime || '', width: j.width || 0, height: j.height || 0, offset: j.data ? off : -1, size: j.data ? j.data.byteLength : 0 });
    if (j.data) { parts.push(j.data); off += j.data.byteLength; }
  }
  const hb = new TextEncoder().encode(JSON.stringify({ format: 'icloud-adjuntos-1', exported: new Date().toISOString(), entries }));
  const bundle = window.__adjBundle = new Blob([new TextEncoder().encode(String(hb.byteLength).padStart(16, '0')), hb, ...parts], { type: 'application/octet-stream' });
  st.finished = true;
  console.log(`listo: ${st.done} archivos, ${(bundle.size / 1048576).toFixed(1)} MB, ${st.failed.length} fallos`);
  const a = document.createElement('a'); a.href = URL.createObjectURL(bundle); a.download = 'icloud-adjuntos.bin'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 60000);
})();
