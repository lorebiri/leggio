// Operazioni dell'area «sicurezza» per le Azioni guidate (elaborazione in blocco, area avanzati).
// Formato: { id, label, description, fields, summary(params), validate?, last?, runBytes(bytes, params, ctx) → bytes }.
// Un errore lanciato = file «non elaborato» e NON salvato (così un oscuramento non verificato non esce mai).
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { buildMatchers, MODELLI } from './logica/modelli.js';
import { PRESET, getPreset, preselect, FIRMA, datiEnte, isDatoEnte } from './logica/preset.js';
import { VOCI, sanitize } from './logica/sanifica.js';
import { LIVELLI } from './logica/comprimi.js';
import { openDecrypted, PasswordError } from './logica/cifratura.js';
import { compressBytes, compressUnder } from './ui-comprimi.js';
import { protectBytes } from './ui-protezione.js';
import { findInPdf, applyRedaction } from './redigi.js';
import { signatureCount, esclusioneEnte } from './comune.js';

const MIN_LEGIBLE = 110;
const fmt = (n) => (n < 1e6 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB');

async function apri(bytes) {
  try { return await openDecrypted(bytes, ''); }
  catch (e) {
    if (e instanceof PasswordError) throw new Error('Il file è protetto da password: aprilo e togli la protezione prima di elaborarlo.');
    throw new Error('Il file non è un PDF leggibile o è danneggiato (prova «Ripara PDF»).');
  }
}

export function operazioniSicurezza(app) {
  return [
    {
      id: 'riduci', label: 'Riduci dimensioni file (Comprimi PDF)', description: 'Ricomprime le immagini; anche «sotto N MB» per PEC e portali',
      fields: [
        { name: 'modo', label: 'Come ridurre', type: 'select', value: 'media', options: [...LIVELLI.map((l) => ({ value: l.id, label: l.label })), { value: 'limite', label: 'Sotto una dimensione massima per file' }] },
        { name: 'mb', label: 'Dimensione massima per file (MB, solo per «sotto una dimensione massima»)', type: 'number', value: 10, min: 0.1, step: 'any' },
        { name: 'leggibile', label: 'Non scendere sotto una qualità leggibile', type: 'checkbox', value: true },
        { name: 'grigi', label: 'Converti le immagini in scala di grigi', type: 'checkbox', value: false },
        { name: 'firmati', label: 'Comprimi anche i file firmati digitalmente (la firma non sarà più valida)', type: 'checkbox', value: false },
      ],
      summary: (p) => (p.modo === 'limite' ? `Riduci sotto ${p.mb} MB per file` : `Riduci dimensioni (${LIVELLI.find((l) => l.id === p.modo)?.label || p.modo})`),
      validate: (p) => (p.modo === 'limite' && !(Number(p.mb) > 0) ? 'Indica la dimensione massima in MB.' : null),
      async runBytes(bytes, p, ctx = {}) {
        if (!p.firmati && signatureCount(bytes)) throw new Error('Il file è firmato digitalmente: non è stato compresso per non invalidare la firma.');
        const opts = { gray: !!p.grigi, signal: ctx.signal };
        let r;
        if (p.modo === 'limite') {
          const lim = Math.floor(Number(p.mb) * 1e6);
          if (bytes.length <= lim && !p.grigi) { ctx.note = `già sotto ${p.mb} MB (${fmt(bytes.length)})`; return bytes; }
          r = await compressUnder(bytes, lim, { ...opts, minDpi: p.leggibile !== false ? MIN_LEGIBLE : 0 });
        } else {
          r = { ...(await compressBytes(bytes, { ...opts, ...(LIVELLI.find((l) => l.id === p.modo) || LIVELLI[1]) })), reached: true, step: LIVELLI.find((l) => l.id === p.modo) || LIVELLI[1] };
        }
        if (r.size >= bytes.length) { ctx.note = `già ottimizzato (${fmt(bytes.length)})`; return bytes; }
        const avvisi = [];
        if (!r.reached) avvisi.push(`ATTENZIONE: resta sopra ${p.mb} MB`);
        if (r.stats.changed && r.step.dpi < 150) avvisi.push(`immagini a ${r.step.dpi} punti per pollice: controllare la leggibilità`);
        ctx.note = [`${fmt(bytes.length)} → ${fmt(r.size)} (−${Math.round((1 - r.size / bytes.length) * 100)}%)`, ...avvisi].join('; ');
        return r.bytes;
      },
    },
    {
      // sostituisce l'operazione omonima delle azioni guidate: questa cifra anche le stringhe (vedi docs/aree/sicurezza.md)
      id: 'proteggi', label: 'Proteggi con password', description: 'Chiede una password per aprire il file (AES-256)', last: true,
      fields: [
        { name: 'password', label: 'Password per aprire', type: 'password', value: '', required: true },
        { name: 'stampa', label: 'Consenti la stampa', type: 'checkbox', value: true },
        { name: 'copia', label: 'Consenti di copiare il testo', type: 'checkbox', value: false },
      ],
      summary: () => 'Proteggi con password (AES-256)',
      validate: (p) => (String(p.password || '').length < 4 ? 'La password deve avere almeno 4 caratteri.' : null),
      async runBytes(bytes, p, ctx = {}) {
        let out;
        try { out = await protectBytes(bytes, { reuseKey: true, userPassword: String(p.password), permissions: { stampa: p.stampa ? 'high' : 'none', copia: !!p.copia, modifica: false, commenti: true, moduli: true, assemblaggio: false } }, ''); }
        catch (e) { if (e instanceof PasswordError) throw new Error('Il file è già protetto da un\'altra password.'); throw e; }
        ctx.note = 'protetto con password (AES-256)';
        return out;
      },
    },
    {
      id: 'sanifica', label: 'Sanifica (rimuovi informazioni nascoste)', description: 'Metadati, JavaScript, allegati, commenti, livelli nascosti, versioni precedenti',
      fields: VOCI.map((v) => ({ name: v.id, label: v.label, type: 'checkbox', value: v.def })),
      summary: (p) => `Sanifica (${VOCI.filter((v) => p[v.id] !== false).length} voci)`,
      async runBytes(bytes, p, ctx = {}) {
        const { doc } = await apri(bytes);
        const r = sanitize(doc, Object.fromEntries(VOCI.map((v) => [v.id, p[v.id] !== false])));
        const tolti = VOCI.filter((v) => r[v.id]).map((v) => `${v.id}: ${r[v.id]}`);
        ctx.note = tolti.length ? `rimossi ${tolti.join(', ')}` : 'niente da rimuovere';
        return doc.save({ useObjectStreams: true });
      },
    },
    {
      id: 'oscura-modelli', label: 'Oscura dati personali (Redazione)', description: 'Trova e oscura davvero codici fiscali, IBAN, email, telefoni… con verifica obbligatoria',
      fields: [
        { name: 'modello', label: 'Modello pronto', type: 'select', value: '', options: [{ value: '', label: 'Scelgo io i dati (caselle qui sotto)' }, ...PRESET.map((p) => ({ value: p.id, label: p.nome }))], help: 'Con un modello pronto le caselle qui sotto non contano. «Incarichi e assegni»: oscura indirizzo, telefono, email personale, nascita, codice fiscale, IBAN e firma; lascia nome, partita IVA e compenso.' },
        ...MODELLI.map((m) => ({ name: 'm_' + m.id, label: m.label, type: 'checkbox', value: ['cf', 'iban', 'email', 'tel'].includes(m.id) })),
        { name: 'parole', label: 'Altre parole da oscurare (separate da virgola, es. Mario Rossi)', type: 'text', value: '' },
        { name: 'etichetta', label: 'Testo sui riquadri (facoltativo)', type: 'text', value: '' },
        { name: 'sanifica', label: 'Rimuovi anche le informazioni nascoste', type: 'checkbox', value: true },
        { name: 'scansioni', label: 'Pagine senza testo (scansioni)', type: 'select', value: 'ocr', options: [
          { value: 'ocr', label: 'Riconosci il testo (OCR) prima di cercare' },
          { value: 'ferma', label: 'Non salvare il file e segnalarlo' },
          { value: 'ignora', label: 'Ignorale (i dati nelle scansioni restano visibili)' }] },
      ],
      summary: (p) => (getPreset(p.modello) ? `Oscura con il modello «${getPreset(p.modello).nome}»` : `Oscura: ${[...MODELLI.filter((m) => p['m_' + m.id]).map((m) => m.label), p.parole ? 'parole scelte' : null].filter(Boolean).join(', ') || 'niente'}`),
      validate: (p) => (getPreset(p.modello) || MODELLI.some((m) => p['m_' + m.id]) || String(p.parole || '').trim() ? null : 'Scegli un modello pronto, almeno un tipo di dato o una parola.'),
      async runBytes(bytes, p, ctx = {}) {
        const { pdfjs } = app.lib;
        const preset = getPreset(p.modello);
        const matchers = buildMatchers({ models: preset ? preset.cerca : MODELLI.filter((m) => p['m_' + m.id]).map((m) => m.id), terms: String(p.parole || '').split(/[,;\n]/), wholeWord: true });
        await apri(bytes); // controlla cifratura e leggibilità con messaggi chiari
        let cur = bytes; let ocrNote = '';
        const run = async (data) => {
          const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, ...PDFJS_ASSETS });
          const pdf = await task.promise;
          try {
            const found = await findInPdf(pdf, matchers, { signal: ctx.signal, OPS: pdfjs.OPS, signatures: !!preset?.firma, exclude: esclusioneEnte(app, datiEnte, isDatoEnte) });
            // senza conferma: valgono le scelte del modello (P.IVA, email istituzionali… restano visibili)
            if (preset) { found.hits = found.hits.filter((h) => preselect(preset, h) || h.matcher.startsWith('«')); found.byPage = new Map(); for (const h of found.hits) { if (!found.byPage.has(h.page)) found.byPage.set(h.page, []); found.byPage.get(h.page).push(...h.rects); } }
            return { pdf, task, found };
          } catch (e) { await task.destroy(); throw e; }
        };
        let r = await run(cur);
        if (r.found.textless.length && p.scansioni === 'ocr') {
          if (typeof app.services?.ocr !== 'function') { await r.task.destroy(); throw new Error(`${r.found.textless.length} pagine sono scansioni senza testo e l'OCR non è disponibile: file non salvato.`); }
          await r.task.destroy();
          cur = await app.services.ocr(cur, { pages: r.found.textless, progress: { set() {}, signal: ctx.signal } });
          ocrNote = `OCR su ${r.found.textless.length} pagine; `;
          r = await run(cur);
        }
        try {
          if (r.found.textless.length && p.scansioni !== 'ignora') throw new Error(`${r.found.textless.length} ${r.found.textless.length === 1 ? 'pagina non contiene' : 'pagine non contengono'} testo leggibile (scansione): i dati lì non si possono trovare. File non salvato: esegui prima l'OCR.`);
          if (!r.found.hits.length) {
            ctx.note = ocrNote + 'nessun dato da oscurare trovato' + (r.found.textless.length ? ` (${r.found.textless.length} pagine senza testo ignorate)` : '');
            if (p.sanifica) { const { doc } = await openDecrypted(cur, ''); sanitize(doc, {}); return doc.save({ useObjectStreams: true }); }
            return cur;
          }
          const terms = [...new Set(r.found.hits.filter((h) => !h.noTerm).map((h) => h.text))];
          const res = await applyRedaction({ pdfjs, pdf: r.pdf, bytes: cur, byPage: r.found.byPage, globalTerms: terms, label: String(p.etichetta || '').trim(), doSanitize: !!p.sanifica, signal: ctx.signal });
          if (!res.ver.ok) {
            const ex = res.ver.problems.slice(0, 3).map((x) => `${x.page ? 'pag. ' + x.page + ': ' : ''}${x.where} «${x.text}»`).join('; ');
            throw new Error(`Verifica NON superata, file non salvato: ${ex}`);
          }
          const per = {};
          for (const h of r.found.hits) per[h.matcher] = (per[h.matcher] || 0) + 1;
          ctx.note = ocrNote + `oscurati ${r.found.hits.length} dati (${Object.entries(per).map(([k, n]) => `${k}: ${n}`).join(', ')}) su ${res.pages} pagine; verifica superata` + (preset?.firma && !per[FIRMA] ? '; nessuna firma riconosciuta come immagine: controllare a mano' : '') + (r.found.textless.length ? `; ${r.found.textless.length} pagine senza testo ignorate` : '');
          return res.out;
        } finally { await r.task.destroy(); }
      },
    },
  ];
}
