/* ═══════════════ toast.js — avisos efímeros ═══════════════
   Sustituyen a alert(); el anfitrión #toasts vive fuera de lo que morph()
   repinta. toast('Texto', { action:'Deshacer', onAction, dur, kind }). */
'use strict';
function toast(msg, opts) {
  opts = opts || {};
  const host = document.getElementById('toasts');
  if (!host) return null;
  const dup = [...host.children].find(c => c.dataset.msg === msg);
  if (dup) { clearTimeout(dup._timer); dup._timer = setTimeout(() => dup.remove(), opts.dur || 4000); return dup; }
  while (host.children.length >= 3) host.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (opts.kind ? ' ' + opts.kind : '');
  el.dataset.msg = msg;
  el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>` + (opts.action ? `<button class="toast-act">${esc(opts.action)}</button>` : '');
  if (opts.action) el.querySelector('.toast-act').addEventListener('click', () => { el.remove(); opts.onAction && opts.onAction(); });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  el._timer = setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 220); }, opts.dur || (opts.action ? 6500 : 4000));
  return el;
}
