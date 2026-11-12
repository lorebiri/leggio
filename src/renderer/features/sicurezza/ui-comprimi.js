// Riduci dimensioni file (Comprimi PDF), anche «sotto N MB» per PEC e portali.
import { LIVELLI, SCALA, compressImages, cleanupStructure, searchUnderLimit } from './logica/comprimi.js';
import { browserCodec } from './codec.js';
import { openDecrypted } from './logica/cifratura.js';
import { st, salvaCopia, copyName, signatureCount, avvisoFirma, boxAvviso } from './comune.js';

const MB = 1024 * 1024;
const MIN_LEGIBLE = 110; // punti per pollice: sotto, il testo delle scansioni si legge male
const NITIDO = 150;
const fmt = (n) => (n < MB ? (n / 1024).toFixed(0) + ' KB' : (n / MB).toFixed(n < 10 * MB ? 2 : 1).replace('.', ',') + ' MB');

/** Comprime byte PDF con un gradino {dpi, quality}. → { bytes, size, stats } */
export async function compressBytes(bytes, { dpi, quality, gray = false, removeMetadata = false, password, signal, onProgress, codec = browserCodec } = {}) {
  const { doc } = await openDecrypted(bytes, password ?? '');
  const stats = await compressImages(doc, { dpi, quality, gray, codec, signal, onProgress });
  stats.removedObjects = cleanupStructure(doc, { removeMetadata });
  if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
  const out = await doc.save({ useObjectStreams: true, objectsPerTick: 200 });
  return { bytes: out, size: out.length, stats };
}

/** «Riduci sotto N MB». → { bytes, size, reached, step, stats } */
export async function compressUnder(bytes, limitBytes, { gray, removeMetadata, password, signal, onProgress, codec, minDpi = 0 } = {}) {
  let n = 0;
  const steps = SCALA.filter((x) => x.dpi >= minDpi);
  const r = await searchUnderLimit(steps, limitBytes, async (step) => {
    n++;
    const res = await compressBytes(bytes, { ...step, gray, removeMetadata, password, signal, codec, onProgress: (f, t) => onProgress?.(f, `Tentativo ${n} (${step.dpi} dpi): ${t}`) });
    return res;
  }, { signal });
  return { bytes: r.result.bytes, size: r.result.size, reached: r.reached, step: steps[r.index], stats: r.result.stats, attempts: n };
}

export async function compressTool(app) {
  const doc = app.activeDoc;
  const { h } = app.ui;
  const bytes = await app.currentBytes(doc);
  const nSig = signatureCount(bytes);
  const last = app.settings.get('sic.compress', { mode: 'limit', limit: 10, level: 'media', dpi: 150, quality: 72, gray: false, meta: false });
  const preset = (mb) => (e) => { const el = e.target.closest('.lg-limit')?.querySelector('input'); if (el) el.value = mb; };
  const v = await app.ui.dialog({
    title: 'Riduci dimensioni file', okLabel: 'Riduci', width: 540,
    body: h('div', {},
      h('p', {}, 'Dimensione attuale: ', h('strong', {}, fmt(bytes.length)), ` · ${doc.pageCount} pagine`),
      nSig ? boxAvviso(app, avvisoFirma(nSig, 'comprimi')) : null),
    fields: [
      { type: 'radio', name: 'mode', value: last.mode, options: [
        { value: 'limit', label: 'Riduci sotto una dimensione massima (Leggio sceglie la qualità migliore possibile)' },
        { value: 'level', label: 'Scegli il livello di compressione' },
        { value: 'custom', label: 'Personalizzato' }] },
      { type: 'custom', name: 'limit', label: 'Dimensione massima', render(c) {
        const i = h('input', { type: 'number', class: 'input', min: 0.1, step: 'any', value: last.limit, style: { width: '110px' }, 'aria-label': 'Dimensione massima in MB' });
        c.classList.add('lg-limit');
        c.append(h('div', { class: 'lg-row' }, i, h('span', {}, 'MB'),
          h('button', { type: 'button', class: 'btn small', onclick: preset(20), title: 'Molti gestori PEC accettano messaggi fino a 30 MB in totale: verifica il limite del tuo ufficio' }, 'Per PEC (20 MB)'),
          h('button', { type: 'button', class: 'btn small', onclick: preset(10) }, 'Per portale (10 MB)'),
          h('button', { type: 'button', class: 'btn small', onclick: preset(5) }, '5 MB')));
        return { get: () => Number(i.value) };
      }, help: 'Il limite reale dipende dal gestore PEC o dal portale: in caso di dubbio controlla le loro indicazioni.' },
      { type: 'select', name: 'level', label: 'Livello', value: last.level, options: LIVELLI.map((l) => ({ value: l.id, label: l.label })) },
      { type: 'number', name: 'dpi', label: 'Risoluzione massima delle immagini (punti per pollice, dpi)', value: last.dpi, min: 36, max: 600, help: '150 va bene per lo schermo e la stampa d\'ufficio; 300 per la stampa di qualità.' },
      { type: 'range', name: 'quality', label: 'Qualità delle immagini', value: last.quality, min: 20, max: 95, unit: '%' },
      { type: 'checkbox', name: 'gray', label: 'Converti le immagini in bianco e nero (scala di grigi)', value: last.gray },
      { type: 'checkbox', name: 'legible', label: 'Non scendere sotto una qualità leggibile (consigliato)', help: `Le immagini restano almeno a ${MIN_LEGIBLE} punti per pollice: sotto questo valore le scansioni diventano sfocate.`, value: last.legible ?? true },
      { type: 'checkbox', name: 'meta', label: 'Rimuovi anche metadati e dati privati dei programmi', value: last.meta },
      { type: 'radio', name: 'out', value: 'copy', options: [
        { value: 'copy', label: `Salva una copia «${copyName(doc, 'ridotto')}» (consigliato: l'originale resta intatto)` },
        { value: 'doc', label: 'Sostituisci il documento aperto (si può annullare)' }] },
    ],
    validate: (x) => (x.mode === 'limit' && !(x.limit > 0) ? 'Indica la dimensione massima in MB.' : null),
    onOpen(form) {
      // mostra solo i campi del modo scelto
      const fields = [...form.querySelectorAll('.dlg-body > .field')];
      const sync = () => {
        const m = form.querySelector('.dlg-body > .field input[type=radio]:checked')?.value;
        fields[1].hidden = m !== 'limit'; fields[2].hidden = m !== 'level'; fields[3].hidden = fields[4].hidden = m !== 'custom';
      };
      fields[0].addEventListener('change', sync); sync();
    },
  });
  if (!v) return;
  app.settings.set('sic.compress', { mode: v.mode, limit: v.limit, level: v.level, dpi: v.dpi, quality: v.quality, gray: v.gray, meta: v.meta, legible: v.legible });
  // limite in megabyte decimali (1 MB = 1.000.000 byte): il file sta sotto il limite qualunque sia la definizione usata dal portale
  const limitBytes = Math.floor(v.limit * 1e6);
  if (v.mode === 'limit' && bytes.length <= limitBytes && !v.gray && !v.meta) {
    app.ui.toast(`Il file è già sotto ${String(v.limit).replace('.', ',')} MB (${fmt(bytes.length)}): non serve ridurlo.`, { kind: 'success', timeout: 6000 });
    return;
  }
  const t0 = performance.now();
  const res = await app.ui.withProgress('Riduzione delle dimensioni…', async (p) => {
    const common = { gray: v.gray, removeMetadata: v.meta, password: doc.password, signal: p.signal, onProgress: (f, t) => p.set(f, t) };
    if (v.mode === 'limit') return compressUnder(bytes, limitBytes, { ...common, minDpi: v.legible ? MIN_LEGIBLE : 0 });
    const step = v.mode === 'level' ? LIVELLI.find((l) => l.id === v.level) : { dpi: v.dpi, quality: v.quality / 100 };
    const r = await compressBytes(bytes, { ...step, ...common });
    return { ...r, reached: true, step, attempts: 1 };
  });
  if (!res) return;
  const secs = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
  const saved = bytes.length - res.size;
  const pct = Math.round((saved / bytes.length) * 100);
  const lowRes = res.stats.changed > 0 && res.step.dpi < NITIDO;
  const skippedTot = Object.values(res.stats.skipped).reduce((a, b) => a + b, 0);
  if (saved <= 0) {
    await app.ui.dialog({ title: 'Riduci dimensioni file', cancelLabel: null, okLabel: 'Chiudi', body: boxAvviso(app, `Il documento è già ottimizzato: Leggio non è riuscito a ridurlo (${fmt(bytes.length)}). Di solito succede con documenti di solo testo o con immagini già compresse.`, 'info') });
    return;
  }
  const body = h('div', {},
    !res.reached ? boxAvviso(app, `Non è stato possibile scendere sotto ${String(v.limit).replace('.', ',')} MB senza rendere illeggibili le immagini. Il risultato più piccolo è ${fmt(res.size)}. ${v.mode === 'limit' && v.legible ? 'Puoi togliere la spunta «Non scendere sotto una qualità leggibile» (le scansioni diventeranno sfocate), ' : 'Puoi '}dividere il documento in più file (strumento «Dividi») o togliere le pagine non necessarie.`) : boxAvviso(app, v.mode === 'limit' ? `Obiettivo raggiunto: il file è sotto ${String(v.limit).replace('.', ',')} MB.` : 'Riduzione completata.', 'ok'),
    h('p', { class: 'lg-big' }, `${fmt(bytes.length)} → ${fmt(res.size)}  (−${pct}%)`),
    h('table', { class: 'lg-stats' },
      h('tr', {}, h('td', {}, 'Immagini ricompresse'), h('td', {}, `${res.stats.changed} su ${res.stats.images}`)),
      skippedTot ? h('tr', {}, h('td', {}, 'Immagini lasciate intatte'), h('td', {}, `${skippedTot} (${Object.entries(res.stats.skipped).map(([k, n]) => `${k}: ${n}`).join('; ')})`)) : null,
      h('tr', {}, h('td', {}, 'Definizione delle immagini'), h('td', {}, `${res.step.dpi} punti per pollice (${res.step.dpi >= NITIDO ? 'buona' : res.step.dpi >= MIN_LEGIBLE ? 'media' : 'bassa'})`)),
      h('tr', {}, h('td', {}, 'Tempo'), h('td', {}, `${secs} s${res.attempts > 1 ? ` (${res.attempts} tentativi)` : ''}`))),
    lowRes ? boxAvviso(app, `Per stare sotto il limite le immagini sono scese a ${res.step.dpi} punti per pollice: le scansioni potrebbero risultare poco leggibili. Controlla il risultato prima di inviarlo con il pulsante qui sotto.`)
      : h('p', { class: 'muted' }, 'Il testo scritto al computer, i link e i moduli non vengono toccati. Le immagini e le scansioni sono state ridotte mantenendo una buona definizione: controlla comunque il risultato.'),
    h('div', { class: 'lg-row' }, h('button', { type: 'button', class: lowRes ? 'btn primary' : 'btn', onclick: () => app.openBytes(res.bytes, { name: copyName(doc, 'ridotto') }) }, 'Apri il risultato in una nuova scheda per controllarlo')));
  if (v.out === 'copy') {
    const ok = await app.ui.dialog({ title: 'Riduci dimensioni file', okLabel: 'Salva la copia…', cancelLabel: 'Chiudi', body, width: 560 });
    if (ok) await salvaCopia(app, res.bytes, copyName(doc, 'ridotto'));
  } else {
    const ok = await app.ui.dialog({ title: 'Riduci dimensioni file', okLabel: 'Sostituisci nel documento', cancelLabel: 'Lascia perdere', body, width: 560 });
    if (ok) await app.applyEdit(`Dimensioni ridotte (−${pct}%)`, async () => res.bytes);
  }
  void st;
}
