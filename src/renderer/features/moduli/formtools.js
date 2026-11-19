// Operazioni sui moduli compilabili: lettura/scrittura valori, appiattisci, reimposta, esporta/importa dati,
// compila con i dati personali, esporta più moduli in un unico CSV, barra informativa.
import { serialize, parseAny, textToBytes, bytesToText, toCSV } from './lib/formdata.js';
import { todayIt } from './lib/geom.js';
import { editProfileDialog } from './profile.js';
import { apriArchivio, nomeContatto } from './personale.js';
import { scegliContatto } from '../personale/ui/scegli.js';
import { datiDaContatto, datiDaProfilo, proponiCompilazione, etichettaCampo, chiavePerCampo } from '../personale/lib/campi.js';
import { modelloPerDocumento, corrispondenzeModello, compilaConModello, valoreChiave } from '../personale/lib/modelli.js';
import { validaCodiceFiscale } from '../personale/lib/validatori.js';

const TRUE_WORDS = /^(true|s[iì]|yes|on|1|x|v|vero|checked)$/i;
const FALSE_WORDS = /^(false|no|off|0|falso|unchecked)?$/i;

/** Testo di un nome PDF: i byte sono di solito UTF-8 (/S#C3#AC), a volte Latin-1 (/S#EC). → [testi possibili] */
function nameTexts(n) {
  let raw = '';
  try { raw = n?.decodeText?.() ?? ''; } catch { return []; }
  const out = [raw];
  if (/[\xc0-\xf4][\x80-\xbf]/.test(raw) && ![...raw].some((c) => c.charCodeAt(0) > 0xff)) {
    try { out.unshift(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))); } catch {}
  }
  return out;
}
/** Valore «attivo» di una casella → { pdf: '/S#EC', text: 'Sì' } | null (null se è il normale /Yes). */
function checkboxOnValue(f) {
  try {
    const n = f.acroField.getOnValue?.();
    if (!n) return null;
    const text = nameTexts(n)[0];
    return text && text !== 'Yes' ? { pdf: n.toString(), text } : null;
  } catch { return null; }
}

/** Tipo di un campo pdf-lib. */
export function fieldKind(PDFLib, f) {
  if (f instanceof PDFLib.PDFTextField) return 'text';
  if (f instanceof PDFLib.PDFCheckBox) return 'checkbox';
  if (f instanceof PDFLib.PDFRadioGroup) return 'radio';
  if (f instanceof PDFLib.PDFDropdown) return 'dropdown';
  if (f instanceof PDFLib.PDFOptionList) return 'listbox';
  if (f instanceof PDFLib.PDFButton) return 'button';
  if (f instanceof PDFLib.PDFSignature) return 'signature';
  return 'other';
}

function safeGetForm(pdfDoc) {
  let form;
  try { form = pdfDoc.getForm(); } catch { return null; }
  try { form.getFields(); return form; } catch { /* campi malformati: si scartano dall'elenco quelli illeggibili */ }
  try {
    const { PDFName, PDFArray } = pdfDocLib();
    const acro = form.acroForm.dict;
    const arr = acro.lookup(PDFName.of('Fields'));
    if (!(arr instanceof PDFArray)) return form;
    const all = arr.asArray(); const good = [];
    for (const ref of all) {
      acro.set(PDFName.of('Fields'), pdfDoc.context.obj([ref]));
      try { form.getFields(); good.push(ref); } catch {}
    }
    acro.set(PDFName.of('Fields'), pdfDoc.context.obj(good));
    form.skippedBroken = all.length - good.length;
  } catch {}
  return form;
}
// classi di pdf-lib ricavate dal documento (evita di importare la libreria qui: la passa il chiamante)
let LIB = null;
export function setPdfLib(lib) { LIB = lib; }
function pdfDocLib() { if (!LIB) throw new Error('pdf-lib non impostata'); return LIB; }
function safeFields(form) {
  if (!form) return [];
  try { return form.getFields(); } catch { return []; }
}

/** Valori correnti dei campi → { nome: valore }. Campi malformati saltati (contati in skipped). */
export function readValues(PDFLib, pdfDoc) {
  LIB ||= PDFLib;
  const out = {}; let skipped = 0; const onValues = {};
  const form = safeGetForm(pdfDoc);
  for (const f of safeFields(form)) {
    try {
      const name = f.getName();
      switch (fieldKind(PDFLib, f)) {
        case 'text': out[name] = f.getText() ?? ''; break;
        case 'checkbox': { out[name] = f.isChecked(); const on = checkboxOnValue(f); if (on) onValues[name] = on; break; }
        case 'radio': out[name] = f.getSelected() ?? ''; break;
        case 'dropdown': case 'listbox': { const s = f.getSelected() || []; out[name] = s.length > 1 ? s : s[0] ?? ''; break; }
        default: break;
      }
    } catch { skipped++; }
  }
  // onValues: valori «attivi» delle caselle diversi da /Yes, per esportare in FDF/XFDF quelli veri
  return { values: out, skipped: skipped + (form?.skippedBroken || 0), onValues };
}

/** Rigenera gli aspetti dei campi modificati; se un campo non è disegnabile col font standard lascia che sia il lettore a farlo. */
export async function safeAppearances(PDFLib, pdfDoc, form) {
  let font = null;
  try { font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica); } catch {}
  let deferred = 0;
  for (const f of safeFields(form)) {
    try {
      if (!form.fieldIsDirty(f.ref)) continue;
      try { f.defaultUpdateAppearances(font); }
      catch { deferred++; }
      form.markFieldAsClean(f.ref);
    } catch {}
  }
  if (deferred) { try { form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True); } catch {} }
  return deferred;
}

/** Scrive valori nei campi. → { set, missing:[], failed:[] } */
export function writeValues(PDFLib, pdfDoc, data) {
  LIB ||= PDFLib;
  const form = safeGetForm(pdfDoc);
  const res = { set: 0, missing: [], failed: [] };
  if (!form) { res.missing = Object.keys(data); return res; }
  const byName = new Map(safeFields(form).map((f) => { try { return [f.getName(), f]; } catch { return [null, null]; } }));
  for (const [name, raw] of Object.entries(data)) {
    const f = byName.get(name);
    if (!f) { res.missing.push(name); continue; }
    try {
      const kind = fieldKind(PDFLib, f);
      if (kind === 'text') {
        let s = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'boolean' ? (raw ? 'Sì' : '') : String(raw ?? '');
        const max = f.getMaxLength(); if (max && s.length > max) s = s.slice(0, max);
        if (!f.isMultiline()) s = s.replace(/\r?\n/g, ' ');
        f.setText(s);
      } else if (kind === 'checkbox') {
        const str = String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim();
        let on;
        if (typeof raw === 'boolean') on = raw;
        else if (str !== 'Off' && nameTexts(f.acroField.getOnValue?.()).includes(str)) on = true; // valore vero del campo
        else if (TRUE_WORDS.test(str)) on = true;
        else if (FALSE_WORDS.test(str)) on = false;
        else throw new Error('valore non previsto'); // né attivo né spento: non si finge di averlo applicato
        on ? f.check() : f.uncheck();
      } else if (kind === 'radio') {
        const v = String(Array.isArray(raw) ? raw[0] : raw ?? '');
        if (!v || v === 'Off') f.clear();
        else if (f.getOptions().includes(v)) f.select(v);
        else throw new Error('valore non previsto');
      } else if (kind === 'dropdown' || kind === 'listbox') {
        const vals = (Array.isArray(raw) ? raw : String(raw ?? '').split('|')).map(String).filter(Boolean);
        if (!vals.length) f.clear();
        else {
          const opts = f.getOptions();
          const ok = vals.filter((v) => opts.includes(v) || (kind === 'dropdown' && f.isEditable()));
          if (!ok.length) throw new Error('valore non previsto');
          f.select(kind === 'listbox' ? ok : ok[0]);
        }
      } else { res.failed.push(name); continue; }
      res.set++;
    } catch { res.failed.push(name); }
  }
  return res;
}

function docBase(doc) { return (doc?.name || 'modulo').replace(/\.pdf$/i, ''); }

export function registerFormTools(app, store) {
  const fmtOptions = [
    { value: 'csv', label: 'Excel (CSV con punto e virgola)' },
    { value: 'json', label: 'JSON' },
    { value: 'xfdf', label: 'XFDF (Acrobat, XML)' },
    { value: 'fdf', label: 'FDF (Acrobat)' },
  ];

  app.registerTool({
    id: 'flatten-form', name: 'Appiattisci modulo', category: 'moduli', icon: 'layers',
    description: 'Rende definitivi i valori compilati: i campi diventano testo normale, non più modificabile',
    keywords: 'appiattisci flatten rendi definitivo campi moduli blocca',
    async run() {
      const doc = app.activeDoc;
      const ok = await app.ui.confirm('I campi del modulo diventeranno testo fisso della pagina e non si potranno più modificare. Puoi comunque annullare finché non chiudi il documento.', { title: 'Appiattisci modulo', okLabel: 'Appiattisci' });
      if (!ok) return;
      let kept = 0; let none = false;
      await app.editWithPdfLib('Modulo appiattito', async (pdfDoc, PDFLib) => {
        const form = safeGetForm(pdfDoc);
        const fields = safeFields(form);
        if (!fields.length) { none = true; return false; }
        fields.forEach((f) => { try { form.markFieldAsDirty(f.ref); } catch {} });
        await safeAppearances(PDFLib, pdfDoc, form);
        // i campi che non si riescono ad appiattire vengono staccati e poi rimessi (restano compilabili)
        const fieldsArr = form.acroForm.getFields ? null : null; void fieldsArr;
        const bad = [];
        for (const f of fields) {
          try { for (const w of f.acroField.getWidgets()) { if (!w.getNormalAppearance()) throw new Error('senza aspetto'); } }
          catch { bad.push(f); }
        }
        for (const f of bad) { try { form.acroForm.removeField(f.acroField); } catch {} }
        try { form.flatten({ updateFieldAppearances: false }); }
        catch (e) { throw new Error('Il modulo contiene campi danneggiati che impediscono l\'appiattimento (' + (e.message || e) + ').'); }
        for (const f of bad) { try { form.acroForm.addField(f.ref); } catch {} }
        kept = bad.length;
      }, doc);
      if (none) app.ui.toast('Questo documento non contiene campi compilabili.', { kind: 'warning' });
      else if (kept) app.ui.toast(`${kept} campi danneggiati sono rimasti compilabili.`, { kind: 'warning', timeout: 6000 });
    },
  });

  app.registerTool({
    id: 'reset-form', name: 'Reimposta modulo', category: 'moduli', icon: 'undo',
    description: 'Svuota i campi compilati (o rimette i valori predefiniti)', keywords: 'reimposta reset svuota cancella campi azzera',
    async run() {
      if (!(await app.ui.confirm('Tutti i campi torneranno vuoti o al valore predefinito.', { title: 'Reimposta modulo', okLabel: 'Reimposta' }))) return;
      let none = false;
      await app.editWithPdfLib('Modulo reimpostato', async (pdfDoc, PDFLib) => {
        const form = safeGetForm(pdfDoc); const fields = safeFields(form);
        if (!fields.length) { none = true; return false; }
        const { PDFName } = PDFLib;
        for (const f of fields) {
          try {
            const dv = f.acroField.dict.lookup(PDFName.of('DV'));
            const dvText = dv?.decodeText ? dv.decodeText() : dv?.asString ? dv.asString() : dv?.decodeText?.() ?? (dv ? String(dv).replace(/^\//, '') : '');
            switch (fieldKind(PDFLib, f)) {
              case 'text': f.setText(dvText || ''); break;
              case 'checkbox': dvText && dvText !== 'Off' ? f.check() : f.uncheck(); break;
              case 'radio': dvText && f.getOptions().includes(dvText) ? f.select(dvText) : f.clear(); break;
              case 'dropdown': case 'listbox': dvText && f.getOptions().includes(dvText) ? f.select(dvText) : f.clear(); break;
              default: break;
            }
          } catch {}
        }
        await safeAppearances(PDFLib, pdfDoc, form);
      });
      if (none) app.ui.toast('Questo documento non contiene campi compilabili.', { kind: 'warning' });
    },
  });

  app.registerTool({
    id: 'export-form-data', name: 'Esporta dati modulo', category: 'moduli', icon: 'export',
    description: 'Salva i valori compilati in un file per Excel (CSV), JSON, XFDF o FDF', keywords: 'esporta dati modulo csv excel fdf xfdf json',
    async run() {
      const doc = app.activeDoc;
      const v = await app.ui.dialog({ title: 'Esporta dati modulo', fields: [{ name: 'fmt', label: 'Formato', type: 'radio', value: store.getPref('exportFmt', 'csv'), options: fmtOptions }], okLabel: 'Esporta…' });
      if (!v) return;
      store.setPref('exportFmt', v.fmt);
      const bytes = await app.currentBytes(doc);
      const pdfDoc = await app.lib.openPdfLib(bytes, doc.password);
      const { values, skipped, onValues } = readValues(app.lib.PDFLib, pdfDoc);
      if (!Object.keys(values).length) { app.ui.toast('Questo documento non contiene campi compilabili.', { kind: 'warning' }); return; }
      const text = serialize(v.fmt, values, doc.name, onValues);
      const out = v.fmt === 'csv' ? new Uint8Array([0xef, 0xbb, 0xbf, ...textToBytes(text, 'csv')]) : textToBytes(text, v.fmt);
      const r = await app.exportFile(out, `${docBase(doc)}_dati.${v.fmt}`, [{ name: fmtOptions.find((o) => o.value === v.fmt).label, extensions: [v.fmt] }]);
      if (r) app.ui.toast(`Dati esportati (${Object.keys(values).length} campi)` + (skipped ? `; ${skipped} campi illeggibili saltati` : ''), { kind: 'success' });
    },
  });

  app.registerTool({
    id: 'import-form-data', name: 'Importa dati modulo', category: 'moduli', icon: 'open',
    description: 'Compila il modulo da un file CSV, JSON, XFDF o FDF', keywords: 'importa dati modulo csv excel fdf xfdf json compila',
    async run() {
      const files = await app.platform.openFiles({ filters: [{ name: 'Dati del modulo', extensions: ['csv', 'json', 'xfdf', 'fdf', 'txt'] }], raw: true, title: 'Scegli il file dei dati' });
      const f = files?.[0]; if (!f) return;
      let parsed;
      try { parsed = parseAny(bytesToText(f.bytes), f.name); }
      catch (e) { app.ui.toast(e.message, { kind: 'error', timeout: 7000 }); return; }
      let res;
      await app.editWithPdfLib('Dati del modulo importati', async (pdfDoc, PDFLib) => {
        res = writeValues(PDFLib, pdfDoc, parsed.data);
        if (!res.set) return false;
        await safeAppearances(PDFLib, pdfDoc, safeGetForm(pdfDoc));
      });
      if (!res?.set) { app.ui.toast('Nessun campo del file corrisponde ai campi di questo modulo.', { kind: 'warning', timeout: 6000 }); return; }
      const notes = [];
      if (res.missing.length) notes.push(`${res.missing.length} valori senza campo corrispondente`);
      if (res.failed.length) notes.push(`${res.failed.length} non applicabili (${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? '…' : ''})`);
      app.ui.toast(`Compilati ${res.set} campi` + (notes.length ? ' · ' + notes.join(' · ') : ''), { kind: notes.length ? 'warning' : 'success', timeout: 6000 });
    },
  });

  app.registerTool({
    id: 'autofill-profile', name: 'Compila a nome di…', category: 'moduli', icon: 'sparkles',
    acrobatName: 'Compilazione automatica',
    description: 'Scegli te stesso o un contatto della rubrica: i campi riconosciuti (nome, codice fiscale, IBAN, data…) si riempiono, con anteprima e correzione prima di applicare',
    keywords: 'compila automaticamente profilo dati personali autocompletamento riempi rubrica contatto a nome di per conto di miei dati',
    run: () => compilaANomeDi(app, store),
  });

  app.registerTool({
    id: 'export-forms-csv', name: 'Esporta dati di più moduli', category: 'moduli', icon: 'export', needsDoc: false,
    description: 'Raccoglie i dati di tanti moduli compilati in un unico file per Excel: una riga per modulo',
    keywords: 'unisci dati moduli excel csv raccogli più file tabella',
    async run() {
      const files = await app.platform.openFiles({ multiple: true, raw: true, title: 'Scegli i moduli compilati', filters: [{ name: 'Documenti PDF', extensions: ['pdf'] }] });
      if (!files?.length) return;
      const rows = []; const cols = new Set(['File']); const errors = [];
      await app.ui.withProgress('Lettura dei moduli', async (p) => {
        for (let i = 0; i < files.length; i++) {
          if (p.cancelled) return;
          p.set(i / files.length, files[i].name);
          try {
            const d = await app.lib.openPdfLib(files[i].bytes);
            const { values } = readValues(app.lib.PDFLib, d);
            const row = { File: files[i].name };
            for (const [k, v] of Object.entries(values)) { cols.add(k); row[k] = typeof v === 'boolean' ? (v ? 'Sì' : 'No') : Array.isArray(v) ? v.join('|') : v; }
            rows.push(row);
          } catch { errors.push(files[i].name); }
          await new Promise((r) => setTimeout(r, 0));
        }
      });
      if (!rows.length) { app.ui.toast('Nessun modulo leggibile.', { kind: 'error' }); return; }
      const header = [...cols];
      // CSV con più righe: riuso di toCSV per l'intestazione e l'escape
      const lines = [toCSV(Object.fromEntries(header.map((c) => [c, c]))).split('\r\n')[0]];
      for (const r of rows) lines.push(toCSV(Object.fromEntries(header.map((c) => [c, r[c] ?? '']))).split('\r\n')[1]);
      const out = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(lines.join('\r\n') + '\r\n')]);
      const saved = await app.exportFile(out, 'dati_moduli.csv', [{ name: 'Excel (CSV)', extensions: ['csv'] }]);
      if (saved) app.ui.toast(`Esportati ${rows.length} moduli` + (errors.length ? `; non leggibili: ${errors.join(', ')}` : ''), { kind: errors.length ? 'warning' : 'success', timeout: 6000 });
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// Barra informativa ed evidenziazione dei campi
// ---------------------------------------------------------------------------------------------------
/** Conta le firme cercando i dizionari /ByteRange nei byte (non stanno mai negli object stream). */
export function countSignatures(bytes) {
  if (!bytes?.length) return 0;
  const pat = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  let n = 0; let i = bytes.indexOf(0x2f);
  while (i >= 0 && i < bytes.length - pat.length) {
    let ok = true; for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) { ok = false; break; }
    if (ok) n++;
    i = bytes.indexOf(0x2f, i + 1);
  }
  return n;
}

/** Campi compilabili delle prime pagine (per i documenti enormi non si leggono tutte le pagine). */
async function scanFields(doc, maxPages = 30) {
  const n = Math.min(doc.pageCount, maxPages); let fillable = 0; let sigFields = 0;
  for (let i = 0; i < n; i++) {
    try {
      const page = await doc.pdf.getPage(i + 1);
      for (const a of await page.getAnnotations({ intent: 'display' })) {
        if (a.subtype !== 'Widget') continue;
        if (a.fieldType === 'Sig') sigFields++; else if (!a.pushButton) fillable++;
      }
    } catch {}
  }
  return { fillable, sigFields, partial: doc.pageCount > maxPages };
}

export function installInfoBar(app, { onVerify }) {
  const { h } = app.ui;
  const bar = h('div', { class: 'mod-infobar', hidden: true, role: 'status' });
  const center = app.el.main?.parentElement;
  if (center) center.insertBefore(bar, app.el.main);
  let token = 0;
  const highlighted = () => app.el.viewerContainer.classList.contains('mod-highlight');

  async function update() {
    const doc = app.activeDoc; const my = ++token;
    bar.hidden = true; bar.textContent = '';
    if (!doc?.pdf) return;
    let isXfa = false; let acro = false;
    try { const info = (await doc.pdf.getMetadata().catch(() => ({ info: {} }))).info || {}; isXfa = !!doc.pdf.isPureXfa || !!info.IsXFAPresent; acro = !!info.IsAcroFormPresent; } catch {}
    const scan = acro ? await scanFields(doc) : { fillable: 0, sigFields: 0, partial: false };
    const signedCount = countSignatures(doc.bytes);
    if (my !== token || doc !== app.activeDoc) return;
    const sigs = { length: Math.max(signedCount, 0) };
    const fillable = { length: scan.fillable, partial: scan.partial };
    const parts = [];
    if (sigs.length) {
      parts.push(h('span', { class: 'mod-ib-item mod-ib-sig' }, h('strong', {}, sigs.length === 1 ? 'Documento firmato digitalmente.' : `Documento con ${sigs.length} firme digitali.`), ' Se lo modifichi le firme non saranno più valide: per aggiunte usa «Salva con nome».'),
        h('button', { class: 'btn small', onclick: () => onVerify() }, 'Pannello firme'));
    }
    if (fillable.length) {
      const btn = h('button', { class: 'btn small' + (highlighted() ? ' on' : ''), 'aria-pressed': String(highlighted()), onclick: () => {
        const on = app.el.viewerContainer.classList.toggle('mod-highlight');
        btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); app.settings.set('moduli.highlight', on);
      } }, 'Evidenzia campi');
      parts.push(h('span', { class: 'mod-ib-item' }, isXfa ? 'Questo è un modulo XFA: si può compilare, ma alcune funzioni (Prepara modulo, appiattisci) non sono disponibili.' : fillable.partial ? 'Questo documento contiene campi compilabili.' : `Questo documento contiene campi compilabili (${fillable.length}).`), btn,
        sigs.length ? null : h('button', { class: 'btn small', onclick: () => app.tools.run('autofill-profile') }, 'Compila a nome di…'));
    } else if (isXfa) parts.push(h('span', { class: 'mod-ib-item' }, 'Modulo XFA (formato Adobe dinamico): la visualizzazione può essere incompleta.'));
    if (!parts.length) return;
    bar.append(h('span', { class: 'mod-ib-icon', 'aria-hidden': 'true' }, sigs.length ? '✔' : '✎'), ...parts,
      h('button', { class: 'icon-btn mod-ib-close', 'aria-label': 'Chiudi la barra', title: 'Chiudi', onclick: () => { bar.hidden = true; } }, '×'));
    bar.classList.toggle('signed', sigs.length > 0);
    bar.hidden = false;
  }
  if (app.settings.get('moduli.highlight', false)) app.el.viewerContainer.classList.add('mod-highlight');
  app.bus.on('document:activated', update);
  app.bus.on('document:changed', update);
  app.bus.on('document:closed', () => { if (!app.activeDoc) { bar.hidden = true; } });
  return { update, el: bar };
}

/**
 * «Compila a nome di»: scegli «io» o un contatto della rubrica, Leggio propone i valori per i campi
 * riconosciuti (o quelli di un modello salvato per questo modulo), li fai correggere e poi li scrive.
 */
export async function compilaANomeDi(app, store, { persona = null } = {}) {
  const a = await apriArchivio(app); if (!a) return;
  const doc = app.activeDoc;
  const bytes = await app.currentBytes(doc);
  const pdfDoc = await app.lib.openPdfLib(bytes, doc.password);
  const PDFLib = app.lib.PDFLib;
  const { values } = readValues(PDFLib, pdfDoc);
  const modello = await modelloPerDocumento(a, bytes, { PDFLib, pdfDoc }).catch(() => null);
  const zone = modello?.tipo === 'zone';
  if (!Object.keys(values).length && !zone) {
    app.ui.toast('Questo documento non contiene campi compilabili: usa «Compila e firma» → «Dati», oppure definisci le zone da compilare e salvalo come modello.', { kind: 'warning', timeout: 8000 });
    return;
  }
  let scelta = persona;
  if (!scelta) {
    const last = store.getPref('compilaPersona', 'io');
    scelta = await scegliContatto(app, a, { titolo: 'Compila a nome di…', messaggio: `Di chi sono i dati da mettere nel modulo «${doc.name}»?`, consentiIo: true, testoIo: 'Io (i miei dati personali)', preselezione: last });
    if (!scelta) return;
  }
  const contatto = scelta === 'io' ? null : scelta;
  store.setPref('compilaPersona', contatto ? contatto.id : 'io');
  let dati = contatto ? datiDaContatto(contatto) : datiDaProfilo(a.profilo());
  if (!contatto && !Object.keys(dati).length) {
    const p = await editProfileDialog(app, store); if (!p) return;
    dati = datiDaProfilo(p);
  }
  const chi = contatto ? nomeContatto(contatto) : 'i tuoi dati';
  const oggi = todayIt();
  // proposte: campi vuoti del modulo (o zone del modello)
  let proposte;
  if (zone) {
    proposte = (modello.zone || []).map((z, i) => ({ campo: z.etichetta || etichettaCampo(z.chiave) || 'Zona ' + (i + 1), zona: z, key: z.chiave, value: valoreChiave(z.chiave, dati, oggi) || '', origine: 'modello' })).filter((p) => p.key && !p.key.startsWith('colonna:'));
  } else {
    const corr = modello ? corrispondenzeModello(modello) : null;
    proposte = proponiCompilazione(Object.keys(values), dati, { oggi, corrispondenze: corr, soloVuoti: (n) => typeof values[n] === 'string' && !values[n].trim() });
    // campi riconosciuti ma senza dato: mostrati vuoti, così si possono completare a mano
    for (const n of Object.keys(values)) {
      if (typeof values[n] !== 'string' || values[n].trim() || proposte.some((p) => p.campo === n)) continue;
      const k = corr && Object.prototype.hasOwnProperty.call(corr, n) ? corr[n] : chiavePerCampo(n);
      if (k && !k.startsWith('fisso:') && !k.startsWith('colonna:')) proposte.push({ campo: n, key: k, value: '', origine: corr && n in corr ? 'modello' : 'automatico' });
    }
  }
  if (!proposte.length) {
    app.ui.toast(Object.keys(values).length ? 'Nessun campo vuoto riconosciuto: i campi sono già compilati o hanno nomi che Leggio non riconosce (puoi salvare il modulo come modello e abbinarli a mano).' : 'Nessun campo da compilare.', { kind: 'warning', timeout: 8000 });
    return;
  }
  const { h } = app.ui;
  const righe = proposte.map((p) => {
    const c = h('input', { type: 'checkbox', checked: !!p.value, 'aria-label': 'Compila ' + p.campo });
    const inp = h('input', { type: 'text', class: 'mod-af-input', value: p.value, 'aria-label': `Valore per «${p.campo}»`, oninput: () => { c.checked = !!inp.value.trim(); avviso(); } });
    const nota = h('small', { class: 'mod-af-warn', role: 'status' });
    const avviso = () => { nota.textContent = p.key === 'codiceFiscale' && inp.value.trim() ? (validaCodiceFiscale(inp.value).avviso || '') : ''; };
    avviso();
    return { p, c, inp, el: h('label', { class: 'mod-autofill-row' }, c, h('span', { class: 'mod-af-name', title: p.campo }, p.campo, h('small', {}, etichettaCampo(p.key) + (p.origine === 'modello' ? ' · dal modello' : ''))), h('span', { class: 'mod-af-val' }, inp, nota)) };
  });
  const body = h('div', { class: 'mod-autofill' },
    modello ? h('p', { class: 'muted' }, `Modulo riconosciuto: modello «${modello.nome}».`) : null,
    righe.map((r) => r.el));
  const ok = await app.ui.dialog({ title: 'Compila a nome di: ' + chi, message: 'Controlla e correggi i valori; togli la spunta a quelli da lasciare vuoti. Niente viene scritto finché non premi «Compila».', body, okLabel: 'Compila', width: 640 });
  if (!ok) return;
  const scelti = righe.filter((r) => r.c.checked && r.inp.value.trim());
  if (!scelti.length) return;
  if (modello) a.usaModello(modello.id);
  await app.editWithPdfLib('Compilato a nome di ' + (contatto ? nomeContatto(contatto) : 'me'), async (pdfDoc2, Lib) => {
    if (zone) {
      // ogni zona riceve il valore corretto dall'utente
      const m2 = { ...modello, zone: scelti.map((r) => ({ ...r.p.zona, chiave: 'fisso:' + r.inp.value.trim() })), firma: null, timbro: null };
      await compilaConModello(Lib, pdfDoc2, m2, {}, { oggi });
      return;
    }
    const res = writeValues(Lib, pdfDoc2, Object.fromEntries(scelti.map((r) => [r.p.campo, r.inp.value.trim()])));
    if (!res.set) return false;
    await safeAppearances(Lib, pdfDoc2, safeGetForm(pdfDoc2));
  });
  app.ui.toast(`Compilati ${scelti.length} campi a nome di ${contatto ? nomeContatto(contatto) : 'te'}`, { kind: 'success' });
}
