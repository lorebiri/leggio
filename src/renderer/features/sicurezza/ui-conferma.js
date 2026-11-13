// Oscuramento «automatico» con conferma: trova i dati con i modelli, mostra SEMPRE l'elenco dei risultati da
// confermare (uno per uno), poi applica e verifica. Esposto come app.services.oscuraDatiPersonali.
// In cima all'elenco c'è il menu «Modello pronto» (Dati personali comuni / Incarichi e assegni…).
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { buildMatchers } from './logica/modelli.js';
import { PRESET, getPreset, preselect, FIRMA, datiEnte, isDatoEnte, presetConsigliato, profiloEnteCompilato } from './logica/preset.js';
import { findInPdf, applyRedaction } from './redigi.js';
import { boxAvviso, esclusioneEnte } from './comune.js';

/** Tutti i dati cercati (superinsieme dei modelli pronti): il modello decide solo cosa è spuntato. */
export const CERCATI = ['cf', 'iban', 'email', 'tel', 'piva', 'nascita', 'indirizzo'];

/** Menu dei modelli pronti (riusato da «Cerca e oscura»). onChange(preset) */
export function presetMenu(app, current, onChange, { conPersonalizzato = false } = {}) {
  const { h } = app.ui;
  const opts = [...(conPersonalizzato ? [{ id: '', nome: 'Scelgo io i dati' }] : []), ...PRESET];
  const sel = h('select', { class: 'input', 'aria-label': 'Modello pronto' }, opts.map((p) => h('option', { value: p.id, selected: p.id === (current || '') }, p.nome)));
  const desc = h('small', { class: 'help' });
  const fonti = h('details', { style: { fontSize: '12.5px', marginTop: '4px' } });
  const sync = () => {
    const p = getPreset(sel.value);
    desc.textContent = p ? p.descrizione : 'Spunta qui sotto i tipi di dati da cercare.';
    fonti.innerHTML = '';
    if (p?.fonti) { fonti.hidden = false; fonti.append(h('summary', {}, 'Su cosa si basa (alcune voci da verificare)'), h('ul', {}, p.fonti.map((f) => h('li', {}, f)))); } else fonti.hidden = true;
  };
  sel.addEventListener('change', () => { sync(); app.settings.set('sic.preset', sel.value); onChange?.(getPreset(sel.value)); });
  sync();
  /** Imposta il modello senza ricordarlo come scelta dell'utente (proposta automatica). */
  const set = (id) => { sel.value = id; sync(); onChange?.(getPreset(id)); };
  return { el: h('div', { class: 'field' }, h('label', {}, 'Modello pronto'), sel, desc, fonti), get: () => getPreset(sel.value), select: sel, set };
}

/**
 * bytes → { bytes, trovati, verifica: true } ; lancia AbortError se l'utente rinuncia, Error se la verifica fallisce.
 * opts: { password, progress ({ set, signal }), preset ('dati' | 'incarichi'), label, doSanitize }
 */
/** Tipo del documento nell'archivio (se il documento viene da lì). */
async function tipoArchivio(app, doc) {
  try { return doc?.path && typeof app.services?.statoArchivio === 'function' ? (await app.services.statoArchivio(doc.path))?.tipo || null : null; } catch { return null; }
}

/** Riga «Compila il Profilo dell'ente» (una volta: se l'utente rinuncia non viene più proposta). onDone() dopo il salvataggio. */
export function rigaProfiloEnte(app, onDone) {
  const { h } = app.ui;
  if (app.settings.get('sic.chiediProfiloEnte', true) === false || !app.tools.get('entity-profile')) return null;
  let profilo = {};
  try { profilo = app.services?.profiloEnte?.() || {}; } catch { /* */ }
  if (profiloEnteCompilato(profilo)) return null;
  const box = h('div', { class: 'lg-sic-avviso lg-sic-info', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { style: { flex: '1' } }, 'Compila il Profilo dell\'ente: così telefono ed email dell\'istituto restano visibili.'),
    h('button', { type: 'button', class: 'btn small', onclick: async () => {
      await app.tools.run('entity-profile');
      let p = {}; try { p = app.services?.profiloEnte?.() || {}; } catch { /* */ }
      if (profiloEnteCompilato(p)) { box.remove(); onDone?.(); }
      else { app.settings.set('sic.chiediProfiloEnte', false); box.remove(); } // ha rinunciato: non chiederlo più
    } }, 'Compila il profilo…'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { app.settings.set('sic.chiediProfiloEnte', false); box.remove(); } }, 'Non ora'));
  return box;
}

export async function oscuraDatiPersonali(app, bytes, { password, progress, preset, label = '', doSanitize = false, doc = app.activeDoc } = {}) {
  const { pdfjs } = app.lib; const { h } = app.ui;
  const signal = progress?.signal;
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, ...PDFJS_ASSETS });
  const pdf = await task.promise;
  try {
    progress?.set?.(null, 'Ricerca dei dati personali…');
    const found = await findInPdf(pdf, buildMatchers({ models: CERCATI }), { signal, OPS: pdfjs.OPS, signatures: true, exclude: esclusioneEnte(app, datiEnte, isDatoEnte), onProgress: (f, t) => progress?.set?.(f * 0.3, t) });
    // modello proposto da solo se il documento sembra un incarico, un assegno o una borsa
    const consigliato = presetConsigliato({ testo: found.testo, tipoArchivio: await tipoArchivio(app, doc) });
    let current = getPreset(preset || consigliato || app.settings.get('sic.preset', 'dati')) || PRESET[0];
    const checks = found.hits.map((hit) => ({ hit, on: preselect(current, hit) }));
    const listEl = h('div', { style: { maxHeight: '44vh', overflow: 'auto' } });
    const render = () => {
      listEl.innerHTML = '';
      if (!checks.length) { listEl.append(boxAvviso(app, 'Nessun dato personale trovato (codice fiscale, IBAN, email, telefono, partita IVA, luogo e data di nascita, indirizzo, firme come immagine).', 'info')); return; }
      const groups = new Map();
      for (const c of checks) { if (!groups.has(c.hit.matcher)) groups.set(c.hit.matcher, []); groups.get(c.hit.matcher).push(c); }
      for (const [lab, items] of groups) {
        const ul = h('ul', { class: 'lg-res' });
        const boxes = items.map((c) => {
          const cb = h('input', { type: 'checkbox', checked: c.on, 'aria-label': `Oscura ${c.hit.text}`, onchange: () => { c.on = cb.checked; } });
          ul.append(h('li', { onclick: (e) => { if (e.target !== cb) { cb.checked = !cb.checked; c.on = cb.checked; } } }, cb,
            c.hit.matcher === FIRMA ? h('span', { class: 'ctx' }, 'Riquadro dell\'immagine della firma (controlla il risultato)') : h('span', { class: 'ctx' }, '…' + c.hit.before, h('b', {}, c.hit.text), c.hit.after + '…'),
            h('span', { class: 'pg' }, `pag. ${c.hit.page + 1}`)));
          return cb;
        });
        const all = h('button', { type: 'button', class: 'btn small', onclick: () => { const v = !items.every((c) => c.on); items.forEach((c, k) => { c.on = v; boxes[k].checked = v; }); } }, 'Tutti / nessuno');
        listEl.append(h('div', { class: 'lg-group' }, `${lab} (${items.length})`, all), ul);
      }
    };
    const firmaNote = h('div');
    const syncFirma = () => {
      firmaNote.innerHTML = '';
      if (current.firma && !checks.some((c) => c.hit.matcher === FIRMA)) firmaNote.append(boxAvviso(app, 'Nessuna firma autografa riconosciuta come immagine. Se nel documento c\'è una firma (per esempio su una pagina scansionata), segnala a mano con «Oscura» › «Riquadro».'));
    };
    const menu = presetMenu(app, current.id, (p) => { current = p; for (const c of checks) c.on = preselect(p, c.hit); render(); syncFirma(); });
    render(); syncFirma();
    const perche = consigliato && current.id === consigliato && !preset ? h('p', { class: 'muted', style: { margin: '-6px 0 10px' } }, 'Proposto perché il documento sembra un incarico, un contratto di collaborazione, un assegno o una borsa.') : null;
    // profilo dell'ente vuoto: proposta in una riga; dopo la compilazione i recapiti dell'ente escono dall'elenco
    const riga = rigaProfiloEnte(app, () => {
      const escl = esclusioneEnte(app, datiEnte, isDatoEnte);
      if (!escl) return;
      for (let k = checks.length - 1; k >= 0; k--) if (escl(checks[k].hit)) checks.splice(k, 1);
      render();
    });
    const ok = await app.ui.dialog({
      title: 'Conferma i dati da oscurare', okLabel: 'Oscura i dati spuntati', danger: true, width: 660,
      body: h('div', {}, riga, menu.el, perche,
        found.hits.length ? h('p', {}, `Trovati ${found.hits.length} dati. Controlla l'elenco e togli la spunta da quelli che devono restare visibili.`) : null,
        found.textless.length ? boxAvviso(app, `${found.textless.length} pagine sono scansioni senza testo: lì i dati non sono stati cercati. Esegui prima l'OCR oppure oscura a mano.`) : null,
        firmaNote, listEl),
      validate: () => (checks.some((c) => c.on) ? null : 'Nessun dato spuntato: spunta almeno un dato, oppure scegli Annulla.'),
    });
    if (!ok) throw new DOMException('Annullato', 'AbortError');
    const chosen = checks.filter((c) => c.on).map((c) => c.hit);
    const kept = new Set(checks.filter((c) => !c.on && !c.hit.noTerm).map((c) => c.hit.text.toLowerCase()));
    const byPage = new Map();
    for (const hit of chosen) { if (!byPage.has(hit.page)) byPage.set(hit.page, []); byPage.get(hit.page).push(...hit.rects); }
    const globalTerms = [...new Set(chosen.filter((x) => !x.noTerm).map((x) => x.text).filter((t) => !kept.has(t.toLowerCase())))];
    const r = await applyRedaction({ pdfjs, pdf, bytes, password, byPage, globalTerms, label, doSanitize, signal, onProgress: (f, t) => progress?.set?.(0.3 + f * 0.7, t) });
    if (!r.ver.ok) {
      const ex = r.ver.problems.slice(0, 3).map((x) => `${x.page ? 'pag. ' + x.page + ': ' : ''}${x.where} «${x.text}»`).join('; ');
      throw new Error(`La verifica finale ha trovato ancora dei dati oscurati (${ex}). Il documento NON è stato modificato: oscura a mano con «Cerca e oscura».`);
    }
    return { bytes: r.out, trovati: chosen.length, verifica: true, modello: current.id, report: r };
  } finally { await task.destroy(); }
}
