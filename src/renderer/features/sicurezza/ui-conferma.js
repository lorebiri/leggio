// Oscuramento «automatico» con conferma: trova i dati con i modelli, mostra SEMPRE l'elenco dei risultati da
// confermare (uno per uno), poi applica e verifica. Esposto come app.services.oscuraDatiPersonali.
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { buildMatchers, MODELLI } from './logica/modelli.js';
import { findInPdf, applyRedaction } from './redigi.js';
import { boxAvviso } from './comune.js';

/** Modelli cercati e quali risultati sono spuntati in partenza. */
export const CERCATI = ['cf', 'iban', 'email', 'tel', 'piva', 'nascita', 'indirizzo'];
export const SPUNTATI = new Set(['cf', 'iban', 'email', 'tel']);

/**
 * bytes → { bytes, trovati, verifica: true } ; lancia AbortError se l'utente rinuncia, Error se la verifica fallisce.
 * opts: { password, progress ({ set, signal }), models, preselected, label, doSanitize }
 */
export async function oscuraDatiPersonali(app, bytes, { password, progress, models = CERCATI, preselected = SPUNTATI, label = '', doSanitize = false } = {}) {
  const { pdfjs } = app.lib; const { h } = app.ui;
  const signal = progress?.signal;
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, ...PDFJS_ASSETS });
  const pdf = await task.promise;
  try {
    const matchers = buildMatchers({ models });
    const byLabel = new Map(MODELLI.map((m) => [m.label, m.id]));
    progress?.set?.(null, 'Ricerca dei dati personali…');
    const found = await findInPdf(pdf, matchers, { signal, OPS: pdfjs.OPS, onProgress: (f, t) => progress?.set?.(f * 0.3, t) });
    if (!found.hits.length) {
      await app.ui.dialog({ title: 'Oscura dati personali', okLabel: 'Chiudi', cancelLabel: null, body: h('div', {},
        boxAvviso(app, 'Nessun dato personale trovato con i modelli (codice fiscale, IBAN, email, telefono, partita IVA, luogo e data di nascita, indirizzo).', 'info'),
        found.textless.length ? boxAvviso(app, `${found.textless.length} pagine sono scansioni senza testo: lì i dati non si possono trovare. Esegui prima l'OCR oppure oscura a mano.`) : null) });
      return { bytes, trovati: 0, verifica: true };
    }
    // elenco da confermare
    const checks = found.hits.map((hit) => ({ hit, on: preselected.has(byLabel.get(hit.matcher)) }));
    const groups = new Map();
    for (const c of checks) { if (!groups.has(c.hit.matcher)) groups.set(c.hit.matcher, []); groups.get(c.hit.matcher).push(c); }
    const listEl = h('div', { style: { maxHeight: '46vh', overflow: 'auto' } });
    for (const [lab, items] of groups) {
      const ul = h('ul', { class: 'lg-res' });
      const boxes = items.map((c) => {
        const cb = h('input', { type: 'checkbox', checked: c.on, 'aria-label': `Oscura ${c.hit.text}`, onchange: () => { c.on = cb.checked; } });
        ul.append(h('li', { onclick: (e) => { if (e.target !== cb) { cb.checked = !cb.checked; c.on = cb.checked; } } }, cb, h('span', { class: 'ctx' }, '…' + c.hit.before, h('b', {}, c.hit.text), c.hit.after + '…'), h('span', { class: 'pg' }, `pag. ${c.hit.page + 1}`)));
        return cb;
      });
      const all = h('button', { type: 'button', class: 'btn small', onclick: () => { const v = !items.every((c) => c.on); items.forEach((c, k) => { c.on = v; boxes[k].checked = v; }); } }, 'Tutti / nessuno');
      listEl.append(h('div', { class: 'lg-group' }, `${lab} (${items.length})`, all), ul);
    }
    const ok = await app.ui.dialog({
      title: 'Conferma i dati da oscurare', okLabel: 'Oscura i dati spuntati', danger: true, width: 640,
      body: h('div', {},
        h('p', {}, `Trovati ${found.hits.length} dati. Controlla l'elenco: togli la spunta da quelli che devono restare visibili. Partite IVA, indirizzi e date di nascita non sono spuntati in partenza: spuntali se vanno oscurati.`),
        found.textless.length ? boxAvviso(app, `${found.textless.length} pagine sono scansioni senza testo: lì i dati non sono stati cercati.`) : null,
        listEl),
      validate: () => (checks.some((c) => c.on) ? null : 'Spunta almeno un dato, oppure scegli Annulla.'),
    });
    if (!ok) throw new DOMException('Annullato', 'AbortError');
    const chosen = checks.filter((c) => c.on).map((c) => c.hit);
    const kept = new Set(checks.filter((c) => !c.on).map((c) => c.hit.text.toLowerCase()));
    const byPage = new Map();
    for (const hit of chosen) { if (!byPage.has(hit.page)) byPage.set(hit.page, []); byPage.get(hit.page).push(...hit.rects); }
    const globalTerms = [...new Set(chosen.map((x) => x.text).filter((t) => !kept.has(t.toLowerCase())))];
    const r = await applyRedaction({ pdfjs, pdf, bytes, password, byPage, globalTerms, label, doSanitize, signal, onProgress: (f, t) => progress?.set?.(0.3 + f * 0.7, t) });
    if (!r.ver.ok) {
      const ex = r.ver.problems.slice(0, 3).map((x) => `${x.page ? 'pag. ' + x.page + ': ' : ''}${x.where} «${x.text}»`).join('; ');
      throw new Error(`La verifica finale ha trovato ancora dei dati oscurati (${ex}). Il documento NON è stato modificato: oscura a mano con «Cerca e oscura».`);
    }
    return { bytes: r.out, trovati: chosen.length, verifica: true, report: r };
  } finally { await task.destroy(); }
}
