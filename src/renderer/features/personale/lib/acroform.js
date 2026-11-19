// Campi AcroForm con pdf-lib, senza dipendenze d'interfaccia: usabile nel Web Worker della serie.
// Stesso comportamento di fieldKind / writeValues / safeAppearances di moduli/formtools.js (che importa
// moduli d'interfaccia e quindi non può entrare nel Worker). Logica pura.
import { codificabile } from '../../moduli/lib/geom.js';

const TRUE_WORDS = /^(true|s[iì]|yes|on|1|x|v|vero|checked)$/i;
const FALSE_WORDS = /^(false|no|off|0|falso|unchecked)?$/i;

/** Testo di un nome PDF: i byte sono di solito UTF-8 (/S#C3#AC), a volte Latin-1 (/S#EC). → [testi possibili] */
function nameTexts(n) {
  let raw = '';
  try { raw = n?.decodeText?.() ?? ''; } catch { return []; }
  const out = [raw];
  if (/[\xc0-\xf4][\x80-\xbf]/.test(raw) && ![...raw].some((c) => c.charCodeAt(0) > 0xff)) {
    try { out.unshift(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))); } catch { /* */ }
  }
  return out;
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

/** Modulo del documento; i campi malformati vengono tolti dall'elenco /Fields (come fa formtools). */
export function moduloSicuro(PDFLib, pdfDoc) {
  let form;
  try { form = pdfDoc.getForm(); } catch { return null; }
  try { form.getFields(); return form; } catch { /* campi malformati */ }
  try {
    const acro = form.acroForm.dict;
    const arr = acro.lookup(PDFLib.PDFName.of('Fields'));
    if (!(arr instanceof PDFLib.PDFArray)) return form;
    const all = arr.asArray(); const good = [];
    for (const ref of all) {
      acro.set(PDFLib.PDFName.of('Fields'), pdfDoc.context.obj([ref]));
      try { form.getFields(); good.push(ref); } catch { /* */ }
    }
    acro.set(PDFLib.PDFName.of('Fields'), pdfDoc.context.obj(good));
  } catch { /* */ }
  return form;
}
export function campiSicuri(form) { if (!form) return []; try { return form.getFields(); } catch { return []; } }

/** Il testo del campo ha caratteri che il font non ha? (ok: funzione di codificabile) */
export function testoNonDisegnabile(campo, ok) {
  let t = '';
  try { t = typeof campo.getText === 'function' ? campo.getText() || '' : ''; } catch { return false; }
  return [...t].some((ch) => ch !== '\n' && ch !== '\r' && !ok(ch));
}

/** Rigenera gli aspetti dei campi modificati; se il font standard non basta lascia che sia il lettore a farlo. */
export async function rigeneraAspetti(PDFLib, pdfDoc, form, { font = null } = {}) {
  let f = font;
  if (!f) { try { f = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica); } catch { /* */ } }
  let deferred = 0;
  // pdf-lib non dà errore sui caratteri che il font non ha (li disegna come «?»): quei campi li lascia al lettore
  const ok = f ? codificabile(f) : () => false;
  for (const c of campiSicuri(form)) {
    try {
      if (!form.fieldIsDirty(c.ref)) continue;
      if (testoNonDisegnabile(c, ok)) deferred++;
      else { try { c.defaultUpdateAppearances(f); } catch { deferred++; } }
      form.markFieldAsClean(c.ref);
    } catch { /* */ }
  }
  if (deferred) { try { form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True); } catch { /* */ } }
  return deferred;
}

/** Scrive valori nei campi. → { set, missing:[], failed:[] } */
export function scriviValori(PDFLib, pdfDoc, data) {
  const form = moduloSicuro(PDFLib, pdfDoc);
  const res = { set: 0, missing: [], failed: [] };
  if (!form) { res.missing = Object.keys(data); return res; }
  const byName = new Map(campiSicuri(form).map((f) => { try { return [f.getName(), f]; } catch { return [null, null]; } }));
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
        else if (str !== 'Off' && nameTexts(f.acroField.getOnValue?.()).includes(str)) on = true;
        else if (TRUE_WORDS.test(str)) on = true;
        else if (FALSE_WORDS.test(str)) on = false;
        else throw new Error('valore non previsto');
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
