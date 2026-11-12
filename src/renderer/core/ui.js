// Componenti d'interfaccia condivisi: dialoghi, moduli, notifiche, avanzamento, menu.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const layer = () => document.getElementById('overlay-root');

/**
 * Dialogo modale con modulo. Restituisce i valori (oggetto) o null se annullato.
 * fields: [{ name, label, type: text|password|number|select|checkbox|color|textarea|range|radio|pages|info|custom,
 *            value, options:[{value,label}] | ['a','b'], min, max, step, placeholder, help, required, render(container) }]
 * validate(values) → stringa d'errore o null.
 */
export function dialog({ title, message, fields = [], okLabel = 'OK', cancelLabel = 'Lascia perdere', danger = false, width, validate, body, onOpen } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const form = h('form', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialogo', style: width ? { width: width + 'px' } : null });
    const err = h('div', { class: 'dlg-error', role: 'alert' });
    const inputs = {};
    form.append(h('header', { class: 'dlg-head' }, h('h2', {}, title || ''), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', onclick: () => done(null), html: icon('close') })));
    const content = h('div', { class: 'dlg-body' });
    if (message) content.append(h('p', { class: 'dlg-msg' }, message));
    if (body) content.append(typeof body === 'function' ? body() : body);
    for (const f of fields) content.append(renderField(f, inputs));
    content.append(err);
    form.append(content);
    const okBtn = h('button', { type: 'submit', class: danger ? 'btn danger' : 'btn primary' }, okLabel);
    const foot = h('footer', { class: 'dlg-foot' });
    if (cancelLabel) foot.append(h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, cancelLabel));
    if (okLabel) foot.append(okBtn);
    form.append(foot);
    const back = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === back) done(null); } }, form);
    function values() {
      const out = {};
      for (const [name, get] of Object.entries(inputs)) out[name] = get();
      return out;
    }
    function done(v) {
      back.classList.add('closing');
      setTimeout(() => back.remove(), 120);
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); } }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = values();
      for (const f of fields) if (f.required && (v[f.name] === '' || v[f.name] == null)) { err.textContent = `Compila «${f.label}».`; return; }
      const msg = validate?.(v);
      if (msg) { err.textContent = msg; return; }
      done(v);
    });
    document.addEventListener('keydown', onKey, true);
    layer().append(back);
    const first = form.querySelector('input:not([type=hidden]),select,textarea');
    (first || okBtn).focus();
    onOpen?.(form, inputs);
  });
}

function renderField(f, inputs) {
  const id = 'f_' + Math.random().toString(36).slice(2);
  const wrap = h('div', { class: 'field field-' + (f.type || 'text') });
  const label = f.label ? h('label', { for: id }, f.label) : null;
  let input;
  const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  switch (f.type) {
    case 'info':
      wrap.append(h('div', { class: 'field-info', html: f.html || '' }, f.text || ''));
      return wrap;
    case 'custom': {
      const c = h('div', { class: 'field-custom' });
      if (label) wrap.append(label);
      wrap.append(c);
      const api = f.render(c) || {};
      inputs[f.name] = api.get || (() => undefined);
      if (f.help) wrap.append(h('small', { class: 'help' }, f.help));
      return wrap;
    }
    case 'select':
      input = h('select', { id }, opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      inputs[f.name] = () => input.value;
      break;
    case 'radio': {
      input = h('div', { class: 'radio-group', role: 'radiogroup' }, opts.map((o) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: id, value: o.value, checked: String(o.value) === String(f.value ?? opts[0]?.value) }), h('span', {}, o.label))));
      inputs[f.name] = () => input.querySelector('input:checked')?.value;
      break;
    }
    case 'checkbox':
      input = h('input', { id, type: 'checkbox', checked: !!f.value });
      inputs[f.name] = () => input.checked;
      wrap.classList.add('inline');
      wrap.append(input, label);
      if (f.help) wrap.append(h('small', { class: 'help' }, f.help));
      return wrap;
    case 'textarea':
      input = h('textarea', { id, rows: f.rows || 4, placeholder: f.placeholder || '' });
      input.value = f.value ?? '';
      inputs[f.name] = () => input.value;
      break;
    case 'range': {
      input = h('input', { id, type: 'range', min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, value: f.value ?? 50 });
      const out = h('output', {}, String(input.value) + (f.unit || ''));
      input.addEventListener('input', () => { out.textContent = input.value + (f.unit || ''); });
      inputs[f.name] = () => Number(input.value);
      if (label) wrap.append(label);
      wrap.append(h('div', { class: 'range-row' }, input, out));
      if (f.help) wrap.append(h('small', { class: 'help' }, f.help));
      return wrap;
    }
    case 'number':
      input = h('input', { id, type: 'number', min: f.min, max: f.max, step: f.step ?? 'any', value: f.value ?? '' });
      inputs[f.name] = () => (input.value === '' ? null : Number(input.value));
      break;
    case 'color':
      input = h('input', { id, type: 'color', value: f.value || '#000000' });
      inputs[f.name] = () => input.value;
      break;
    case 'pages':
      // intervalli di pagine tipo "1-3, 5, 8-"
      input = h('input', { id, type: 'text', value: f.value ?? '', placeholder: f.placeholder || 'es. 1-3, 5, 8-10 (vuoto = tutte)' });
      inputs[f.name] = () => input.value;
      break;
    default:
      input = h('input', { id, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      inputs[f.name] = () => input.value;
  }
  if (label) wrap.append(label);
  wrap.append(input);
  if (f.help) wrap.append(h('small', { class: 'help' }, f.help));
  return wrap;
}

/** Converte "1-3, 5, 8-" in indici 0-based (ordinati, unici). Vuoto = tutte le pagine. */
export function parsePageRanges(str, pageCount) {
  const s = (str || '').trim();
  if (!s) return [...Array(pageCount).keys()];
  const out = new Set();
  for (const part of s.split(/[,;]+/)) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    if (p === 'pari' || p === 'even') { for (let i = 1; i < pageCount; i += 2) out.add(i); continue; }
    if (p === 'dispari' || p === 'odd') { for (let i = 0; i < pageCount; i += 2) out.add(i); continue; }
    const m = p.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : pageCount;
      if (a < 1 || b > pageCount || a > b) throw new Error(`Intervallo non valido: «${part.trim()}» (il documento ha ${pageCount} pagine)`);
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n < 1 || n > pageCount) throw new Error(`Pagina inesistente: ${n} (il documento ha ${pageCount} pagine)`);
      out.add(n - 1);
    } else throw new Error(`Non capisco «${part.trim()}». Usa per esempio 1-3, 5, 8-`);
  }
  return [...out].sort((a, b) => a - b);
}

export function confirm(message, { title = 'Conferma', okLabel = 'Continua', danger = false } = {}) {
  return dialog({ title, message, okLabel, danger }).then((v) => v !== null);
}
export function prompt(label, value = '', { title = '', type = 'text', okLabel = 'OK' } = {}) {
  return dialog({ title: title || label, fields: [{ name: 'v', label, type, value }], okLabel }).then((v) => (v ? v.v : null));
}
export function alertDialog(message, title = 'Leggio') { return dialog({ title, message, cancelLabel: null }); }

/**
 * Notifica temporanea. kind: info|success|error|warning. action: {label, run}
 * Con un'azione (es. «Annulla») resta almeno 10 secondi; il tempo si ferma mentre il mouse è sopra.
 */
export function toast(message, { kind = 'info', timeout = 3800, action } = {}) {
  const root = document.getElementById('toast-root');
  // lo stesso avviso già visibile (es. «Niente da annullare» due volte): si rinnova invece di raddoppiarlo
  if (!action) for (const old of root.children) if (!old.classList.contains('closing') && old.dataset.msg === String(message)) { old.__rearm?.(); return old; }
  const t = h('div', { class: 'toast toast-' + kind, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { html: icon(kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'info', 16) }),
    h('span', { class: 'toast-msg' }, message));
  if (action) {
    timeout = Math.max(timeout, 10000);
    t.append(h('button', { class: 'btn small', onclick: () => { action.run(); close(); } }, action.label));
  }
  t.append(h('button', { class: 'toast-x', 'aria-label': 'Chiudi avviso', title: 'Chiudi', onclick: () => close(), html: icon('close', 14) }));
  t.dataset.msg = String(message);
  root.append(t);
  let timer = null; let closed = false;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); t.classList.add('closing'); setTimeout(() => t.remove(), 200); };
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, timeout); };
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', arm);
  arm();
  t.__rearm = arm;
  // compatibilità: chi chiamava t.remove() continua a funzionare
  return t;
}

/**
 * Domanda con pulsanti a parole (es. «Salva / Non salvare / Annulla»). → value del pulsante, o null (Esc).
 * buttons: [{ value, label, primary, danger, left }] nell'ordine in cui appaiono.
 */
export function choice({ title, message, body, buttons, width } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const box = h('div', { class: 'dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title || 'Domanda', style: width ? { width: width + 'px' } : null });
    const content = h('div', { class: 'dlg-body' });
    if (message) content.append(h('p', { class: 'dlg-msg' }, message));
    if (body) content.append(typeof body === 'function' ? body() : body);
    const foot = h('footer', { class: 'dlg-foot' });
    let primary = null;
    for (const b of buttons || [{ value: 'ok', label: 'OK', primary: true }]) {
      const el = h('button', { type: 'button', class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '') + (b.left ? ' spacer-left' : ''), onclick: () => done(b.value) }, b.label);
      if (b.primary) primary = el;
      foot.append(el);
    }
    box.append(h('header', { class: 'dlg-head' }, h('h2', {}, title || ''), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', onclick: () => done(null), html: icon('close') })), content, foot);
    const back = h('div', { class: 'backdrop' }, box);
    function done(v) { back.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); resolve(v); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); } }
    document.addEventListener('keydown', onKey, true);
    layer().append(back);
    (primary || foot.querySelector('button'))?.focus();
  });
}

/** Barra di avanzamento modale annullabile. → { set(frac 0..1, testo), cancelled, signal, close() } */
export function progress(title, { cancellable = true } = {}) {
  const ctrl = new AbortController();
  const bar = h('div', { class: 'progress-fill' });
  const text = h('div', { class: 'progress-text' }, 'Preparazione…');
  const box = h('div', { class: 'dlg progress-dlg', role: 'dialog', 'aria-label': title },
    h('header', { class: 'dlg-head' }, h('h2', {}, title)),
    h('div', { class: 'dlg-body' }, h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), text),
    cancellable ? h('footer', { class: 'dlg-foot' }, h('button', { class: 'btn', onclick: () => { ctrl.abort(); text.textContent = 'Interruzione…'; } }, 'Interrompi')) : null);
  const back = h('div', { class: 'backdrop' }, box);
  layer().append(back);
  return {
    set(frac, msg) {
      if (frac == null) bar.classList.add('indeterminate');
      else { bar.classList.remove('indeterminate'); bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; box.querySelector('.progress').setAttribute('aria-valuenow', Math.round(frac * 100)); }
      if (msg) text.textContent = msg;
    },
    get cancelled() { return ctrl.signal.aborted; },
    signal: ctrl.signal,
    close() { back.remove(); },
  };
}

/** Esegue un'operazione lunga mostrando l'avanzamento; gestisce errori e annullamento. */
export async function withProgress(title, fn, opts) {
  const p = progress(title, opts);
  try { return await fn(p); }
  catch (err) {
    if (p.cancelled || err?.name === 'AbortError') { toast('Operazione interrotta'); return undefined; }
    throw err;
  } finally { p.close(); }
}

/** Menu contestuale. items: [{label, icon, run, disabled, danger} | '-'] */
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  // #overlay-root può essere ingrandito (zoom dell'interfaccia): le coordinate vanno divise per lo zoom
  const z = parseFloat(getComputedStyle(layer()).zoom) || 1;
  x /= z; y /= z;
  const menu = h('div', { class: 'ctx-menu', role: 'menu', style: { left: x + 'px', top: y + 'px' } },
    items.map((it) => it === '-' ? h('hr') : h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', disabled: it.disabled, onclick: () => { menu.remove(); it.run?.(); } }, it.icon ? h('span', { html: icon(it.icon, 16) }) : h('span'), it.label, it.hint ? h('kbd', {}, it.hint) : null)));
  layer().append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = Math.max(4, (innerWidth - r.width) / z - 4) + 'px';
  if (r.bottom > innerHeight) menu.style.top = Math.max(4, (innerHeight - r.height) / z - 4) + 'px';
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true));
  menu.querySelector('button:not([disabled])')?.focus();
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('button:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') menu.remove();
  });
  return menu;
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function formatBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' KB'; return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
export function baseName(name) { return (name || 'documento').replace(/\.pdf$/i, ''); }
