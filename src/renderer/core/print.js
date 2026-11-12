// Stampa da ufficio: stampante, copie, fronte/retro, colore, più file in una volta, timbro «COPIA»
// solo sulla stampa (il file non viene toccato), scelte ricordate. Nell'app desktop la stampa passa
// dal main (webContents.print con le opzioni): se la stampante è già scelta non si apre la finestra
// di sistema. Nel browser si usa window.print() (le opzioni si scelgono nella finestra del browser).
import { h, dialog, withProgress, toast, parsePageRanges } from './ui.js';
import { openPdfJs, destroyPdf, renderPageToCanvas, pdfjs } from './pdf.js';
import { platform } from './platform.js';
import { normalizePreset, planPrintJobs, MAX_PAGES_PER_JOB } from './printplan.js';
import { cleanIpcMessage } from './errors.js';

const DUPLEX = [
  { value: 'simplex', label: 'Solo fronte' },
  { value: 'longEdge', label: 'Fronte/retro (rilegatura sul lato lungo)' },
  { value: 'shortEdge', label: 'Fronte/retro (rilegatura sul lato corto)' },
];

/** Disegna il timbro «COPIA» in diagonale, semitrasparente. */
function stampCopy(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: hgt } = canvas;
  ctx.save();
  ctx.translate(w / 2, hgt / 2);
  ctx.rotate(-Math.atan2(hgt, w));
  const size = Math.round(Math.min(w, hgt) * 0.22);
  ctx.font = `700 ${size}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 30);
  ctx.strokeStyle = 'rgba(180, 35, 24, 0.55)';
  ctx.fillStyle = 'rgba(180, 35, 24, 0.16)';
  ctx.fillText('COPIA', 0, 0);
  ctx.strokeText('COPIA', 0, 0);
  ctx.restore();
}

/**
 * Stampa uno o più documenti.
 * sources: Doc aperti oppure { name, bytes, password } oppure { path } (solo app).
 * opts: { preset } per stampare senza dialogo (es. dall'archivio con le scelte già fatte).
 */
export async function printSources(app, sources, { preset: given } = {}) {
  sources = (sources || []).filter(Boolean);
  if (!sources.length) return false;
  const single = sources.length === 1;
  let preset = normalizePreset(given || app.settings.get('printPreset', {}));
  let pageSpec = '';
  if (!given) {
    const printers = platform.isElectron ? await platform.printers().catch(() => []) : [];
    const printerOpts = [{ value: '', label: 'Scegli nella finestra di stampa del sistema' },
      ...printers.map((p) => ({ value: p.name, label: (p.displayName || p.name) + (p.isDefault ? ' (predefinita)' : '') }))];
    if (preset.printer && !printers.some((p) => p.name === preset.printer)) preset.printer = '';
    const names = sources.map((s) => s.name || (s.path || '').split(/[\\/]/).pop() || 'documento.pdf');
    const v = await dialog({
      title: single ? `Stampa «${names[0]}»` : `Stampa ${sources.length} documenti`, width: 520,
      body: single ? null : h('ul', { class: 'print-list' }, names.slice(0, 12).map((n) => h('li', {}, n)), names.length > 12 ? h('li', {}, `… e altri ${names.length - 12}`) : null),
      fields: [
        ...(platform.isElectron ? [{ name: 'printer', label: 'Stampante', type: 'select', value: preset.printer, options: printerOpts }] : []),
        { name: 'copies', label: 'Copie', type: 'number', value: preset.copies, min: 1, max: 99 },
        ...(platform.isElectron ? [{ name: 'duplex', label: 'Fronte/retro', type: 'select', value: preset.duplex, options: DUPLEX },
          { name: 'color', label: 'Colori', type: 'select', value: preset.color ? '1' : '0', options: [{ value: '1', label: 'A colori' }, { value: '0', label: 'Bianco e nero' }] }] : []),
        ...(single ? [{ name: 'pages', label: 'Pagine (vuoto = tutte)', type: 'pages', value: '' }] : []),
        { name: 'quality', label: 'Qualità', type: 'select', value: preset.quality, options: [{ value: '96', label: 'Bozza (più veloce)' }, { value: '150', label: 'Normale' }, { value: '300', label: 'Alta qualità (firme e timbri piccoli)' }] },
        { name: 'annots', label: 'Stampa commenti e moduli compilati', type: 'checkbox', value: preset.annots },
        { name: 'copyStamp', label: 'Timbro «COPIA» sulla stampa (il file non cambia)', type: 'checkbox', value: preset.copyStamp },
        { name: 'remember', label: 'Ricorda queste scelte', type: 'checkbox', value: true },
        ...(platform.isElectron ? [] : [{ name: 'info', type: 'info', text: 'Stampante, fronte/retro e colori si scelgono nella finestra di stampa del browser.' }]),
      ],
      okLabel: 'Stampa',
      validate: (x) => { if (single && sources[0].pageCount) { try { parsePageRanges(x.pages, sources[0].pageCount); } catch (e) { return e.message; } } },
    });
    if (!v) return false;
    preset = normalizePreset({ ...preset, ...v, color: v.color == null ? preset.color : v.color === '1' });
    pageSpec = v.pages || '';
    if (v.remember) app.settings.set('printPreset', preset);
  }

  const root = document.getElementById('print-root');
  const urls = [];
  const opened = []; // documenti pdf.js aperti per la stampa (da liberare)
  try {
    // 1. apertura dei file (copie indipendenti: i documenti a schermo non vengono toccati)
    const files = await withProgress(single ? 'Preparazione della stampa' : `Preparazione di ${sources.length} documenti`, async (p) => {
      const out = [];
      for (let i = 0; i < sources.length; i++) {
        if (p.cancelled) return null;
        const s = sources[i];
        p.set(i / sources.length, `Apertura ${i + 1} di ${sources.length}: ${s.name || ''}`);
        let bytes = s.bytes; let password = s.password; let name = s.name;
        if (s.queue && s.pdf) { bytes = await app.currentBytes(s); }                       // Doc aperto
        else if (!bytes && s.path) { const f = await platform.readFile(s.path); bytes = f.bytes; name = f.name; }
        try {
          const { pdf } = await openPdfJs(bytes, { password });
          opened.push(pdf);
          const pages = single && pageSpec ? parsePageRanges(pageSpec, pdf.numPages) : [...Array(pdf.numPages).keys()];
          out.push({ name, pdf, pages });
        } catch (err) {
          toast(`«${name}» non può essere stampato: ${err?.message || err}`, { kind: 'error', timeout: 8000 });
        }
      }
      return out;
    });
    if (!files?.length) return false;
    const jobs = planPrintJobs(files, { duplex: preset.duplex });
    const total = jobs.reduce((t, j) => t + j.length, 0);
    if (jobs.length > 1) toast(`${total} pagine: la stampa viene divisa in ${jobs.length} invii da al massimo ${MAX_PAGES_PER_JOB} pagine.`, { timeout: 8000 });
    // 2. per ogni lavoro: pagine come immagini, poi stampa
    let done = 0;
    for (let j = 0; j < jobs.length; j++) {
      root.innerHTML = '';
      const ok = await withProgress(jobs.length > 1 ? `Stampa: invio ${j + 1} di ${jobs.length}` : 'Preparazione della stampa', async (p) => {
        for (const item of jobs[j]) {
          if (p.cancelled) return false;
          p.set(done / total, `Pagina ${done + 1} di ${total}`);
          done++;
          if (item.blank) { root.append(h('div', { class: 'print-page print-blank' })); continue; }
          const f = files[item.file];
          const cv = await renderPageToCanvas(f.pdf, item.page, +preset.quality / 72, {
            annotationMode: preset.annots ? pdfjs.AnnotationMode.ENABLE_STORAGE : pdfjs.AnnotationMode.DISABLE, background: '#fff',
          });
          if (preset.copyStamp) stampCopy(cv);
          const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
          cv.width = 0; cv.height = 0;
          const url = URL.createObjectURL(blob); urls.push(url);
          const img = new Image(); img.src = url;
          await img.decode();
          root.append(h('div', { class: 'print-page' }, img));
        }
        return true;
      });
      if (!ok) return false;
      const r = await sendToPrinter(preset);
      if (!r.ok) {
        if (r.cancelled) { toast('Stampa annullata dalla finestra di stampa'); return false; }
        throw new Error(r.message);
      }
      root.innerHTML = '';
      for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    }
    toast(single ? 'Inviato alla stampa' : `Inviati alla stampa ${files.length} documenti (${total} pagine)`, { kind: 'success' });
    app.log?.('info', 'stampa', { files: files.length, pages: total, copies: preset.copies, duplex: preset.duplex, printer: preset.printer ? 'scelta' : 'dialogo' });
    return true;
  } finally {
    root.innerHTML = '';
    for (const u of urls) URL.revokeObjectURL(u);
    for (const pdf of opened) destroyPdf(pdf);
  }
}

async function sendToPrinter(preset) {
  document.body.classList.add('printing');
  try {
    if (platform.isElectron) {
      const r = await platform.print({
        printer: preset.printer, copies: preset.copies, duplex: preset.duplex, color: preset.color,
      });
      if (r?.ok) return { ok: true };
      const err = String(r?.err || '');
      if (/cancel/i.test(err)) return { ok: false, cancelled: true };
      return { ok: false, message: preset.printer ? `La stampante «${preset.printer}» non ha accettato la stampa (${err || 'errore sconosciuto'}). Controlla che sia accesa e collegata, o scegline un'altra.` : `Stampa non riuscita: ${err || 'errore sconosciuto'}` };
    }
    window.print();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: cleanIpcMessage(err?.message || err) };
  } finally { document.body.classList.remove('printing'); }
}
