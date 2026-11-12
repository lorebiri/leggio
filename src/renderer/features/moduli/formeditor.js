// «Prepara modulo»: crea, sposta, ridimensiona, elimina e configura campi AcroForm; riconoscimento automatico dei campi.
import { Board } from './board.js';
import { detectFields, textItemsFromPdfjs, slugName } from './lib/detect.js';
import { safeAppearances } from './formtools.js';

export const TYPES = {
  text: { label: 'Testo', icon: 'Ab', size: [160, 20] },
  checkbox: { label: 'Casella di controllo', icon: '☑', size: [14, 14] },
  radio: { label: 'Pulsante di opzione', icon: '◉', size: [14, 14] },
  dropdown: { label: 'Elenco a discesa', icon: '▾', size: [140, 20] },
  listbox: { label: 'Casella di riepilogo', icon: '☰', size: [140, 60] },
  button: { label: 'Pulsante', icon: '▭', size: [90, 24] },
  signature: { label: 'Campo firma', icon: '✍', size: [180, 50] },
};
const FONTS = { Helv: ['Helvetica', 'Helvetica'], TiRo: ['Times', 'TimesRoman'], Cour: ['Courier', 'Courier'] };
const FORMAT_JS = {
  number: { K: 'AFNumber_Keystroke(2, 2, 0, 0, "", true);', F: 'AFNumber_Format(2, 2, 0, 0, "", true);' },
  integer: { K: 'AFNumber_Keystroke(0, 2, 0, 0, "", true);', F: 'AFNumber_Format(0, 2, 0, 0, "", true);' },
  date: { K: 'AFDate_KeystrokeEx("dd/mm/yyyy");', F: 'AFDate_FormatEx("dd/mm/yyyy");' },
  email: { V: 'if (event.value && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(event.value)) { app.alert("Indirizzo email non valido"); event.rc = false; }' },
};

function parseId(id) { const m = /^(\d+)R(\d*)$/.exec(String(id || '')); return m ? { num: +m[1], gen: m[2] ? +m[2] : 0 } : null; }

/** Modello di un campo esistente letto da pdf.js. */
function itemFromAnnotation(a, pageIndex) {
  if (a.subtype !== 'Widget' || !a.fieldName && a.fieldType !== 'Sig') return null;
  let kind = 'text';
  if (a.fieldType === 'Btn') kind = a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : 'button';
  else if (a.fieldType === 'Ch') kind = a.combo ? 'dropdown' : 'listbox';
  else if (a.fieldType === 'Sig') kind = 'signature';
  const flags = a.fieldFlags || 0;
  const r = a.rect || [0, 0, 0, 0];
  return {
    kind, pageIndex, rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])],
    name: a.fieldName || '', origName: a.fieldName || '',
    existing: parseId(a.id), annotId: a.id, dirty: false,
    props: {
      required: !!(flags & 2), readOnly: !!(flags & 1) || !!a.readOnly,
      multiline: !!a.multiLine, maxLen: a.maxLen || 0, align: a.textAlignment || 0,
      fontSize: a.defaultAppearanceData?.fontSize || 0, font: /Ti|Times/i.test(a.defaultAppearanceData?.fontName || '') ? 'TiRo' : /Co|Courier/i.test(a.defaultAppearanceData?.fontName || '') ? 'Cour' : 'Helv',
      defaultValue: Array.isArray(a.defaultFieldValue) ? a.defaultFieldValue.join('|') : a.defaultFieldValue ?? '',
      options: (a.options || []).map((o) => o.displayValue ?? o.exportValue).filter((x) => x != null),
      exportValue: a.buttonValue || a.exportValue || 'Sì', label: a.alternativeText || '', format: 'none',
    },
  };
}

export class FormEditor {
  constructor(app, store) {
    this.app = app; this.store = store;
    this.doc = app.activeDoc;
    this.tool = 'select';
    this.loaded = new Map(); // pageIndex → Promise
    this.deleted = [];
    this.board = new Board(app, {
      className: 'mod-form',
      minSize: 6,
      renderItem: (el, item) => this.#render(el, item),
      onEmptyPointer: (pi, pt) => this.#place(pi, pt),
      onSelect: (item) => this.#showProps(item),
      onChange: (item) => { item.dirty = true; this.changed = true; },
      onDelete: (item) => { if (item.existing) this.deleted.push(item); this.changed = true; },
      pageBox: (pi) => { const vp = app.viewer.getViewport(pi); return vp ? vp.viewBox : null; },
    });
  }

  activate(optionsEl) {
    this.optionsEl = optionsEl;
    if (this.doc?.pdf?.isPureXfa) {
      this.app.ui.toast('Questo è un modulo XFA: «Prepara modulo» funziona solo con i moduli PDF normali (AcroForm).', { kind: 'warning', timeout: 7000 });
    }
    this.app.viewer.setMode('tool', 'default');
    this.app.el.viewerContainer.classList.add('mod-editing');
    this.board.attach();
    this.offR = this.app.bus.on('page:rendered', ({ pageIndex }) => this.#ensurePage(pageIndex));
    this.offDoc = this.app.bus.on('document:activated', () => this.app.tools.deactivate());
    this.board.redrawAll();
    const pv = this.app.viewer.pdfViewer;
    for (let i = 0; i < (pv.pagesCount || 0); i++) { const v = pv.getPageView(i); if (v?.div?.querySelector('canvas')) this.#ensurePage(i); }
    this.#buildBar();
  }

  async deactivate() {
    this.offR?.(); this.offDoc?.();
    this.board.detach();
    this.app.el.viewerContainer.classList.remove('mod-editing');
    this.app.closeRightPanel();
    if (!this.changed || !this.app.docs.includes(this.doc)) return;
    const pending = this.board.items.filter((i) => !i.existing || i.dirty).length + this.deleted.length;
    if (!pending) return;
    const ok = await this.app.ui.dialog({ title: 'Prepara modulo', message: `Applicare le modifiche ai campi (${pending})?`, okLabel: 'Applica', cancelLabel: 'Scarta le modifiche' });
    if (ok) await this.apply().catch((err) => this.app.reportError(err, 'Campi non salvati'));
  }

  #buildBar() {
    const { h } = this.app.ui;
    const el = this.optionsEl; el.textContent = '';
    const typeBtn = (k) => h('button', { type: 'button', class: 'btn small mod-tbtn', 'data-tool': k, title: `${TYPES[k].label}: fai clic sulla pagina per aggiungerlo`, onclick: () => this.setTool(this.tool === k ? 'select' : k) }, TYPES[k].icon + ' ' + TYPES[k].label);
    el.append(
      ...Object.keys(TYPES).map(typeBtn),
      h('span', { class: 'tb-sep' }),
      h('button', { type: 'button', class: 'btn small', title: 'Analizza il testo delle pagine (righe ____, caselle ☐, «Nome:», «Data:», «Firma:») e propone i campi', onclick: () => this.detect() }, '✨ Riconosci campi'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => this.apply().catch((err) => this.app.reportError(err, 'Campi non salvati')) }, 'Salva campi'),
    );
  }
  setTool(k) {
    this.tool = k;
    this.optionsEl.querySelectorAll('.mod-tbtn').forEach((b) => b.classList.toggle('on', b.dataset.tool === k));
    this.app.viewer.setMode('tool', k === 'select' ? 'default' : 'crosshair');
  }

  async #ensurePage(pi) {
    if (this.loaded.has(pi)) return this.loaded.get(pi);
    const p = (async () => {
      try {
        const page = await this.doc.pdf.getPage(pi + 1);
        const annots = await page.getAnnotations({ intent: 'display' });
        const items = annots.map((a) => { try { return itemFromAnnotation(a, pi); } catch { return null; } }).filter(Boolean);
        for (const it of items) this.board.add(it, { select: false });
      } catch (err) { console.warn('[moduli] campi della pagina', pi + 1, err); }
    })();
    this.loaded.set(pi, p);
    return p;
  }

  #usedNames() { return new Set(this.board.items.map((i) => i.name)); }
  uniqueName(base) {
    const used = this.#usedNames(); let n = slugName(base) || 'campo'; let k = 2; const b = n;
    while (used.has(n)) n = `${b}_${k++}`;
    return n;
  }

  #place(pi, pt) {
    if (this.tool === 'select') return false;
    const [w, hgt] = TYPES[this.tool].size;
    const kind = this.tool;
    let name; let exportValue = 'Sì';
    if (kind === 'radio') {
      // gruppo: lo stesso dell'ultimo pulsante di opzione, così più clic creano le alternative dello stesso gruppo
      const last = [...this.board.items].reverse().find((i) => i.kind === 'radio' && !i.existing);
      name = last ? last.name : this.uniqueName('scelta');
      const n = this.board.items.filter((i) => i.kind === 'radio' && i.name === name).length;
      exportValue = 'Opzione ' + (n + 1);
    } else name = this.uniqueName({ text: 'testo', checkbox: 'casella', dropdown: 'elenco', listbox: 'riepilogo', button: 'pulsante', signature: 'firma' }[kind]);
    const item = {
      kind, pageIndex: pi, rect: [pt[0], pt[1] - hgt, pt[0] + w, pt[1]], name, existing: null, dirty: true,
      props: { required: false, readOnly: false, multiline: false, maxLen: 0, align: 0, fontSize: 0, font: 'Helv', defaultValue: '', options: kind === 'dropdown' || kind === 'listbox' ? ['Prima scelta', 'Seconda scelta'] : [], exportValue, label: kind === 'button' ? 'Pulsante' : '', format: 'none' },
    };
    this.board.add(item); this.changed = true;
    if (kind !== 'radio' && kind !== 'checkbox') this.setTool('select');
    return true;
  }

  #render(el, item) {
    el.classList.add('mod-field', 'k-' + item.kind);
    if (item.proposed) el.classList.add('proposed');
    if (item.props?.required) el.classList.add('required');
    const lab = document.createElement('span');
    lab.className = 'mod-field-label';
    lab.textContent = (TYPES[item.kind]?.icon || '') + ' ' + item.name + (item.kind === 'radio' ? ` = ${item.props.exportValue}` : '');
    el.title = `${TYPES[item.kind]?.label || 'Campo'}: ${item.name}${item.proposed ? ' (proposto)' : ''}`;
    el.append(lab);
  }

  // ------------------------------------------------------------------ pannello proprietà
  #showProps(item) {
    const { h } = this.app.ui;
    if (!item) { this.app.closeRightPanel(); return; }
    const c = this.app.openRightPanel('Proprietà del campo');
    const upd = (fn) => (e) => { fn(e.target); item.dirty = true; item.proposed = false; this.changed = true; this.board.update(item); };
    const row = (label, input, help) => h('div', { class: 'field' }, h('label', {}, label), input, help ? h('small', { class: 'help' }, help) : null);
    const chk = (label, key) => h('div', { class: 'field inline' }, h('input', { type: 'checkbox', checked: !!item.props[key], onchange: upd((t) => { item.props[key] = t.checked; }) }), h('label', {}, label));
    const nameIn = h('input', { type: 'text', value: item.name, maxlength: 120 });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim();
      if (!v) { nameIn.value = item.name; return; }
      const clash = this.board.items.some((i) => i !== item && i.name === v && !(item.kind === 'radio' && i.kind === 'radio'));
      if (clash) { this.app.ui.toast('Esiste già un campo con questo nome.', { kind: 'warning' }); nameIn.value = item.name; return; }
      item.name = v; item.dirty = true; item.proposed = false; this.changed = true; this.board.update(item);
    });
    const p = item.props;
    const parts = [
      h('p', { class: 'muted' }, TYPES[item.kind]?.label + (item.existing ? ' (esistente)' : ' (nuovo)') + ` — pagina ${item.pageIndex + 1}`),
      row('Nome', nameIn, item.kind === 'radio' ? 'I pulsanti di opzione con lo stesso nome formano un gruppo: se ne sceglie uno solo.' : 'Serve per riconoscere il campo nei dati esportati.'),
    ];
    if (item.kind !== 'button' && item.kind !== 'signature') parts.push(chk('Obbligatorio', 'required'));
    if (item.kind !== 'signature') parts.push(chk('Sola lettura', 'readOnly'));
    if (item.kind === 'text') {
      parts.push(chk('Più righe', 'multiline'),
        row('Valore predefinito', h('input', { type: 'text', value: p.defaultValue, onchange: upd((t) => { p.defaultValue = t.value; }) })),
        row('Formato', h('select', { onchange: upd((t) => { p.format = t.value; }) }, [['none', 'Nessuno'], ['number', 'Importo (1.234,56)'], ['integer', 'Numero intero'], ['date', 'Data (gg/mm/aaaa)'], ['email', 'Email']].map(([v, l]) => h('option', { value: v, selected: p.format === v }, l))), item.existing ? 'Per i campi esistenti il formato si aggiunge a quello che hanno già.' : null),
        row('Numero massimo di caratteri', h('input', { type: 'number', min: 0, max: 10000, value: p.maxLen || '', placeholder: 'Nessun limite', onchange: upd((t) => { p.maxLen = Math.max(0, Math.min(10000, parseInt(t.value, 10) || 0)); }) })),
        row('Allineamento', h('select', { onchange: upd((t) => { p.align = +t.value; }) }, [[0, 'Sinistra'], [1, 'Centro'], [2, 'Destra']].map(([v, l]) => h('option', { value: v, selected: p.align === v }, l)))));
    }
    if (['text', 'dropdown', 'listbox', 'button'].includes(item.kind)) {
      parts.push(row('Carattere', h('select', { onchange: upd((t) => { p.font = t.value; }) }, Object.entries(FONTS).map(([k, [l]]) => h('option', { value: k, selected: p.font === k }, l)))),
        row('Dimensione', h('select', { onchange: upd((t) => { p.fontSize = +t.value; }) }, [0, 8, 9, 10, 11, 12, 14, 16, 18, 24].map((v) => h('option', { value: v, selected: p.fontSize === v }, v ? v + ' pt' : 'Automatica')))));
    }
    if (item.kind === 'dropdown' || item.kind === 'listbox') {
      const ta = h('textarea', { rows: 5, onchange: upd((t) => { p.options = t.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 500); }) }); ta.value = p.options.join('\n');
      parts.push(row('Voci (una per riga)', ta), row('Valore predefinito', h('input', { type: 'text', value: p.defaultValue, onchange: upd((t) => { p.defaultValue = t.value; }) })));
    }
    if (item.kind === 'checkbox') parts.push(h('div', { class: 'field inline' }, h('input', { type: 'checkbox', checked: p.defaultValue === 'on', onchange: upd((t) => { p.defaultValue = t.checked ? 'on' : ''; }) }), h('label', {}, 'Selezionata in partenza')));
    if (item.kind === 'radio' && !item.existing) parts.push(row('Valore di questa opzione', h('input', { type: 'text', value: p.exportValue, onchange: upd((t) => { p.exportValue = t.value.trim() || p.exportValue; }) })));
    if (item.kind === 'button' && !item.existing) parts.push(row('Scritta', h('input', { type: 'text', value: p.label, onchange: upd((t) => { p.label = t.value; }) })));
    parts.push(h('div', { class: 'mod-prop-actions' },
      h('button', { class: 'btn small', onclick: () => { const copy = structuredClone({ ...item, id: undefined, existing: null, annotId: null, dirty: true }); copy.rect = [item.rect[0], item.rect[1] - (item.rect[3] - item.rect[1]) - 6, item.rect[2], item.rect[1] - 6]; if (copy.kind !== 'radio') copy.name = this.uniqueName(item.name); else copy.props.exportValue = 'Opzione ' + (this.board.items.filter((i) => i.name === item.name).length + 1); this.board.add(copy); this.changed = true; } }, 'Duplica sotto'),
      h('button', { class: 'btn small danger', onclick: () => this.board.remove(item) }, 'Elimina campo')));
    c.append(h('div', { class: 'pad mod-props' }, ...parts));
  }

  // ------------------------------------------------------------------ riconoscimento automatico
  async detect() {
    const doc = this.doc; const n = doc.pageCount;
    let added = 0;
    await this.app.ui.withProgress('Riconoscimento dei campi', async (prog) => {
      for (let i = 0; i < n; i++) {
        if (prog.cancelled) break;
        prog.set(i / n, `Pagina ${i + 1} di ${n}`);
        await this.#ensurePage(i);
        try {
          const page = await doc.pdf.getPage(i + 1);
          const vb = page.view; // [x1,y1,x2,y2]
          const items = textItemsFromPdfjs(await page.getTextContent());
          const existing = this.board.items.filter((it) => it.pageIndex === i).map((it) => it.rect);
          const found = detectFields(items, { width: vb[2] - vb[0], height: vb[3] - vb[1], x0: vb[0] }, { existing, maxFields: 200 });
          for (const f of found) {
            const kind = f.type === 'checkbox' ? 'checkbox' : f.type === 'signature' ? 'signature' : 'text';
            this.board.add({
              kind, pageIndex: i, rect: f.rect, name: this.uniqueName(f.name), existing: null, dirty: true, proposed: true,
              props: { required: false, readOnly: false, multiline: false, maxLen: 0, align: 0, fontSize: 0, font: 'Helv', defaultValue: '', options: [], exportValue: 'Sì', label: f.label, format: f.format || 'none' },
            }, { select: false });
            added++;
          }
          page.cleanup();
        } catch (err) { console.warn('[moduli] riconoscimento pagina', i + 1, err); }
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
      }
    });
    if (added) { this.changed = true; this.app.ui.toast(`Proposti ${added} campi (in arancione): controllali, elimina quelli che non servono, poi «Salva campi».`, { kind: 'success', timeout: 8000 }); }
    else this.app.ui.toast('Nessun nuovo campo riconosciuto. Puoi aggiungerli a mano con i pulsanti in alto.', { timeout: 6000 });
  }

  // ------------------------------------------------------------------ scrittura nel PDF
  async apply() {
    const items = this.board.items.filter((i) => !i.existing || i.dirty);
    const deleted = this.deleted.slice();
    if (!items.length && !deleted.length) { this.app.ui.toast('Nessuna modifica ai campi da salvare.'); return; }
    let report = null;
    const ok = await this.app.editWithPdfLib('Campi del modulo aggiornati', async (pdfDoc, PDFLib) => {
      report = await applyFormChanges(PDFLib, pdfDoc, items, deleted);
      if (!report.changed) return false;
    }, this.doc);
    if (ok) {
      this.changed = false; this.deleted = [];
      // il documento è stato ricaricato: si rilegge il modello
      this.loaded.clear(); this.board.clear(); this.doc = this.app.activeDoc;
      this.board.redrawAll();
      const pv = this.app.viewer.pdfViewer;
      for (let i = 0; i < (pv.pagesCount || 0); i++) { const v = pv.getPageView(i); if (v?.div?.querySelector('canvas')) this.#ensurePage(i); }
      if (report?.problems.length) this.app.ui.toast(report.problems.slice(0, 3).join(' · '), { kind: 'warning', timeout: 8000 });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Operazioni di basso livello sui campi (testabili con pdf-lib senza interfaccia)
// ---------------------------------------------------------------------------------------------------
function lookupDict(ctx, PDFLib, ref) { try { const o = ctx.lookup(ref); return o instanceof PDFLib.PDFDict ? o : null; } catch { return null; } }
function refOf(PDFLib, e) { return PDFLib.PDFRef.of(e.num, e.gen); }

/** Dizionario del campo (terminale con /T) per un widget. */
function fieldDictOf(ctx, PDFLib, wdict) {
  const { PDFName } = PDFLib;
  if (wdict.get(PDFName.of('T'))) return wdict;
  const p = wdict.get(PDFName.of('Parent'));
  return p ? lookupDict(ctx, PDFLib, p) : wdict;
}

function removeFromArray(ctx, PDFLib, holder, key, ref) {
  const { PDFName, PDFArray, PDFRef } = PDFLib;
  const raw = holder.get(PDFName.of(key));
  const arr = raw instanceof PDFRef ? ctx.lookupMaybe(raw, PDFArray) : raw instanceof PDFArray ? raw : null;
  if (!arr) return false;
  for (let i = arr.size() - 1; i >= 0; i--) { const r = arr.get(i); if (r instanceof PDFRef && r.objectNumber === ref.objectNumber && r.generationNumber === ref.generationNumber) arr.remove(i); }
  return arr.size();
}

/** Elimina un widget (e il campo, se non ha altri widget). */
export function removeWidget(PDFLib, pdfDoc, existing, pageIndex) {
  const { PDFName, PDFRef } = PDFLib;
  const ctx = pdfDoc.context; const wref = refOf(PDFLib, existing);
  const w = lookupDict(ctx, PDFLib, wref); if (!w) return false;
  const page = pdfDoc.getPages()[pageIndex];
  if (page) removeFromArray(ctx, PDFLib, page.node, 'Annots', wref);
  const acro = pdfDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFLib.PDFDict);
  if (w.get(PDFName.of('T'))) {
    // il widget è anche il campo: va tolto dal genitore o dall'elenco dei campi
    const parent = w.get(PDFName.of('Parent'));
    if (parent instanceof PDFRef) { const pd = lookupDict(ctx, PDFLib, parent); if (pd) removeFromArray(ctx, PDFLib, pd, 'Kids', wref); }
    else if (acro) removeFromArray(ctx, PDFLib, acro, 'Fields', wref);
  } else {
    const parent = w.get(PDFName.of('Parent'));
    const pd = parent instanceof PDFRef ? lookupDict(ctx, PDFLib, parent) : null;
    if (pd) {
      const left = removeFromArray(ctx, PDFLib, pd, 'Kids', wref);
      if (left === 0) {
        const gp = pd.get(PDFName.of('Parent'));
        if (gp instanceof PDFRef) { const gd = lookupDict(ctx, PDFLib, gp); if (gd) removeFromArray(ctx, PDFLib, gd, 'Kids', parent); }
        else if (acro) removeFromArray(ctx, PDFLib, acro, 'Fields', parent);
      }
    }
  }
  return true;
}

function setJsActions(PDFLib, ctx, dict, format) {
  const js = FORMAT_JS[format]; if (!js) return;
  const { PDFName, PDFDict, PDFString } = PDFLib;
  let aa = dict.lookupMaybe(PDFName.of('AA'), PDFDict);
  if (!aa) { aa = ctx.obj({}); dict.set(PDFName.of('AA'), aa); }
  for (const [k, code] of Object.entries(js)) aa.set(PDFName.of(k), ctx.obj({ S: 'JavaScript', JS: PDFString.of(code) }));
}

/** Applica il modello del redattore al documento. → { changed, problems[] } */
export async function applyFormChanges(PDFLib, pdfDoc, items, deleted) {
  const { PDFName, PDFNumber, PDFString, PDFHexString, PDFDict, PDFArray, TextAlignment } = PDFLib;
  const ctx = pdfDoc.context; const problems = []; let changed = false;
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const fonts = {};
  const fontFor = async (k) => (fonts[k] ||= await pdfDoc.embedFont(PDFLib.StandardFonts[FONTS[k]?.[1] || 'Helvetica']));
  const text = (s) => (/^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s));
  // risorse del modulo: i caratteri usati nel /DA devono esistere in /DR
  const ensureDR = async (key) => {
    const acro = form.acroForm.dict;
    let dr = acro.lookupMaybe(PDFName.of('DR'), PDFDict); if (!dr) { dr = ctx.obj({}); acro.set(PDFName.of('DR'), dr); }
    let fd = dr.lookupMaybe(PDFName.of('Font'), PDFDict); if (!fd) { fd = ctx.obj({}); dr.set(PDFName.of('Font'), fd); }
    if (!fd.get(PDFName.of(key))) fd.set(PDFName.of(key), (await fontFor(key)).ref);
  };

  // 1) eliminazioni
  for (const d of deleted) {
    try { if (removeWidget(PDFLib, pdfDoc, d.existing, d.pageIndex)) changed = true; }
    catch (e) { problems.push(`Campo «${d.name}» non eliminato`); }
  }

  // 2) campi esistenti modificati
  const fieldsByRef = new Map();
  try { for (const f of form.getFields()) fieldsByRef.set(f.ref.toString(), f); } catch {}
  for (const it of items.filter((i) => i.existing)) {
    try {
      const wref = refOf(PDFLib, it.existing);
      const w = lookupDict(ctx, PDFLib, wref); if (!w) { problems.push(`Campo «${it.name}» non trovato`); continue; }
      const [x1, y1, x2, y2] = it.rect;
      w.set(PDFName.of('Rect'), ctx.obj([x1, y1, x2, y2].map((v) => Math.round(v * 100) / 100)));
      const fd = fieldDictOf(ctx, PDFLib, w) || w;
      const p = it.props;
      if (it.name !== it.origName && it.kind !== 'radio') { const last = it.name.split('.').pop(); fd.set(PDFName.of('T'), text(last)); }
      let ff = fd.lookupMaybe(PDFName.of('Ff'), PDFNumber)?.asNumber() || 0;
      ff = p.readOnly ? ff | 1 : ff & ~1; ff = p.required ? ff | 2 : ff & ~2;
      if (it.kind === 'text') ff = p.multiline ? ff | 4096 : ff & ~4096;
      fd.set(PDFName.of('Ff'), PDFNumber.of(ff));
      if (it.kind === 'text') {
        if (p.maxLen) fd.set(PDFName.of('MaxLen'), PDFNumber.of(p.maxLen)); else fd.delete(PDFName.of('MaxLen'));
        fd.set(PDFName.of('Q'), PDFNumber.of(p.align || 0));
        if (p.defaultValue) fd.set(PDFName.of('DV'), text(p.defaultValue));
        if (p.format && p.format !== 'none') setJsActions(PDFLib, ctx, fd, p.format);
      }
      if (['text', 'dropdown', 'listbox', 'button'].includes(it.kind)) {
        await ensureDR(p.font || 'Helv');
        fd.set(PDFName.of('DA'), PDFString.of(`/${p.font || 'Helv'} ${p.fontSize || 0} Tf 0 g`));
      }
      if ((it.kind === 'dropdown' || it.kind === 'listbox') && p.options?.length) fd.set(PDFName.of('Opt'), ctx.obj(p.options.map(text)));
      const fref = fd === w ? wref : (w.get(PDFName.of('Parent')) || wref);
      const pf = fieldsByRef.get(fref.toString());
      if (pf) { try { form.markFieldAsDirty(pf.ref); if (p.font && p.font !== 'Helv' && pf.updateAppearances) { pf.updateAppearances(await fontFor(p.font)); form.markFieldAsClean(pf.ref); } } catch {} }
      changed = true;
    } catch (e) { problems.push(`Campo «${it.name}»: ${e.message || e}`); }
  }

  // 3) campi nuovi
  const groups = new Map();
  const nameTaken = (n) => { try { return !!form.getFieldMaybe(n); } catch { return false; } };
  const freeName = (n) => { let k = 2; let x = n; while (nameTaken(x)) x = `${n}_${k++}`; return x; };
  for (const it of items.filter((i) => !i.existing)) {
    try {
      const page = pages[it.pageIndex]; if (!page) continue;
      const [x1, y1, x2, y2] = it.rect;
      const opts = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderWidth: 1, borderColor: PDFLib.rgb(0.55, 0.55, 0.6), backgroundColor: undefined };
      const p = it.props;
      const font = await fontFor(p.font || 'Helv');
      let field;
      switch (it.kind) {
        case 'text': {
          field = form.createTextField(freeName(it.name));
          if (p.multiline) field.enableMultiline();
          if (p.maxLen) field.setMaxLength(p.maxLen);
          field.setAlignment([TextAlignment.Left, TextAlignment.Center, TextAlignment.Right][p.align || 0]);
          if (p.defaultValue) { field.setText(p.maxLen ? p.defaultValue.slice(0, p.maxLen) : p.defaultValue); field.acroField.dict.set(PDFName.of('DV'), text(p.defaultValue)); }
          field.addToPage(page, { ...opts, font });
          if (p.fontSize) field.setFontSize(p.fontSize);
          if (p.format && p.format !== 'none') setJsActions(PDFLib, ctx, field.acroField.dict, p.format);
          break;
        }
        case 'checkbox':
          field = form.createCheckBox(freeName(it.name));
          field.addToPage(page, opts);
          if (p.defaultValue === 'on') field.check();
          break;
        case 'radio': {
          let g = groups.get(it.name);
          if (!g) { g = form.getFieldMaybe(it.name) instanceof PDFLib.PDFRadioGroup ? form.getRadioGroup(it.name) : form.createRadioGroup(freeName(it.name)); groups.set(it.name, g); }
          g.addOptionToPage(p.exportValue || 'Opzione', page, opts);
          field = g;
          break;
        }
        case 'dropdown': case 'listbox': {
          field = it.kind === 'dropdown' ? form.createDropdown(freeName(it.name)) : form.createOptionList(freeName(it.name));
          field.setOptions(p.options?.length ? p.options : ['']);
          if (p.defaultValue && p.options.includes(p.defaultValue)) { field.select(p.defaultValue); field.acroField.dict.set(PDFName.of('DV'), text(p.defaultValue)); }
          field.addToPage(page, { ...opts, font });
          if (p.fontSize) field.setFontSize(p.fontSize);
          break;
        }
        case 'button':
          field = form.createButton(freeName(it.name));
          field.addToPage(p.label || 'Pulsante', page, { ...opts, font, backgroundColor: PDFLib.rgb(0.92, 0.92, 0.94) });
          break;
        case 'signature': {
          const wd = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: text(freeName(it.name)), Rect: [x1, y1, x2, y2], F: 4, P: page.ref, MK: { BC: [0.55, 0.55, 0.6] } });
          const wref = ctx.register(wd);
          let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
          if (!annots) { annots = ctx.obj([]); page.node.set(PDFName.of('Annots'), annots); }
          annots.push(wref);
          form.acroForm.addField(wref);
          break;
        }
        default: break;
      }
      if (field && it.kind !== 'radio') {
        if (p.required && field.enableRequired) field.enableRequired();
        if (p.readOnly && field.enableReadOnly) field.enableReadOnly();
      } else if (field && it.kind === 'radio') {
        if (p.required) field.enableRequired();
        if (p.readOnly) field.enableReadOnly();
      }
      changed = true;
    } catch (e) { problems.push(`Campo «${it.name}» non creato: ${e.message || e}`); }
  }
  await safeAppearances(PDFLib, pdfDoc, form);
  return { changed, problems };
}
