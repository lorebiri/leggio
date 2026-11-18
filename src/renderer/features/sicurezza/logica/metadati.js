// Proprietà del documento (Info + XMP) e impostazioni di apertura (vista iniziale). Logica pura.
import { PDFArray, PDFNumber, PDFRef, PDFName, PDFDict, PDFHexString } from '@cantoo/pdf-lib';
import { N, lookupDict, lookupArray, nameOf, num } from './pdfutil.js';

export const LAYOUT = [
  { value: '', label: 'Predefinito del programma' },
  { value: 'SinglePage', label: 'Pagina singola' },
  { value: 'OneColumn', label: 'Pagina singola continua' },
  { value: 'TwoPageLeft', label: 'Due pagine affiancate' },
  { value: 'TwoColumnLeft', label: 'Due pagine affiancate continue' },
  { value: 'TwoPageRight', label: 'Due pagine (copertina separata)' },
  { value: 'TwoColumnRight', label: 'Due pagine continue (copertina separata)' },
];
export const MODE = [
  { value: 'UseNone', label: 'Solo la pagina' },
  { value: 'UseOutlines', label: 'Pannello segnalibri e pagina' },
  { value: 'UseThumbs', label: 'Pannello pagine (miniature) e pagina' },
  { value: 'UseAttachments', label: 'Pannello allegati e pagina' },
  { value: 'FullScreen', label: 'Schermo intero' },
];
export const ZOOM = [
  { value: '', label: 'Predefinito del programma' },
  { value: 'fit', label: 'Adatta pagina' },
  { value: 'fitWidth', label: 'Adatta larghezza' },
  { value: '50', label: '50%' }, { value: '75', label: '75%' }, { value: '100', label: '100%' },
  { value: '125', label: '125%' }, { value: '150', label: '150%' }, { value: '200', label: '200%' },
];

const toLocal = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

/** Legge proprietà e impostazioni di apertura. */
export function readProperties(pdfDoc) {
  const ctx = pdfDoc.context; const cat = pdfDoc.catalog;
  const vp = lookupDict(ctx, cat.get(N('ViewerPreferences')));
  const flag = (k) => !!vp && String(ctx.lookup(vp.get(N(k)))) === 'true';
  let openPage = 1; let openZoom = '';
  const oa = lookupArray(ctx, cat.get(N('OpenAction')));
  if (oa && oa.size() >= 2) {
    const target = oa.get(0);
    const idx = target instanceof PDFRef ? pdfDoc.getPages().findIndex((p) => p.ref === target || p.ref.tag === target.tag) : (target instanceof PDFNumber ? target.asNumber() : -1);
    if (idx >= 0) openPage = idx + 1;
    const kind = nameOf(ctx, oa.get(1));
    if (kind === 'Fit' || kind === 'FitB') openZoom = 'fit';
    else if (kind === 'FitH' || kind === 'FitBH') openZoom = 'fitWidth';
    else if (kind === 'XYZ') { const z = num(ctx, oa.get(4), 0); if (z > 0) openZoom = String(Math.round(z * 100)); }
  }
  const kw = safe(() => pdfDoc.getKeywords()) || '';
  return {
    title: safe(() => pdfDoc.getTitle()) || '', author: safe(() => pdfDoc.getAuthor()) || '', subject: safe(() => pdfDoc.getSubject()) || '',
    keywords: kw, creator: safe(() => pdfDoc.getCreator()) || '', producer: safe(() => pdfDoc.getProducer()) || '',
    creationDate: toLocal(safe(() => pdfDoc.getCreationDate())), modDate: toLocal(safe(() => pdfDoc.getModificationDate())),
    pageLayout: nameOf(ctx, cat.get(N('PageLayout'))) || '', pageMode: nameOf(ctx, cat.get(N('PageMode'))) || 'UseNone',
    openPage, openZoom,
    displayDocTitle: flag('DisplayDocTitle'), fitWindow: flag('FitWindow'), centerWindow: flag('CenterWindow'),
    hideToolbar: flag('HideToolbar'), hideMenubar: flag('HideMenubar'),
    hasXmp: !!cat.get(N('Metadata')),
  };
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const isoDate = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : '');

/** Pacchetto XMP coerente con le proprietà (sostituisce quello esistente, così Acrobat non mostra valori vecchi). */
export function buildXmp(v) {
  const li = (s) => `<rdf:li xml:lang="x-default">${esc(s)}</rdf:li>`;
  const parts = [];
  if (v.title) parts.push(`<dc:title><rdf:Alt>${li(v.title)}</rdf:Alt></dc:title>`);
  if (v.author) parts.push(`<dc:creator><rdf:Seq><rdf:li>${esc(v.author)}</rdf:li></rdf:Seq></dc:creator>`);
  if (v.subject) parts.push(`<dc:description><rdf:Alt>${li(v.subject)}</rdf:Alt></dc:description>`);
  if (v.keywords) parts.push(`<pdf:Keywords>${esc(v.keywords)}</pdf:Keywords>`);
  if (v.producer) parts.push(`<pdf:Producer>${esc(v.producer)}</pdf:Producer>`);
  if (v.creator) parts.push(`<xmp:CreatorTool>${esc(v.creator)}</xmp:CreatorTool>`);
  if (v.creationDate) parts.push(`<xmp:CreateDate>${isoDate(v.creationDate)}</xmp:CreateDate>`);
  if (v.modDate) parts.push(`<xmp:ModifyDate>${isoDate(v.modDate)}</xmp:ModifyDate><xmp:MetadataDate>${isoDate(v.modDate)}</xmp:MetadataDate>`);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
${parts.join('\n')}
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Scrive proprietà e impostazioni di apertura. v come readProperties (date: stringhe datetime-local o Date). */
export function writeProperties(pdfDoc, v) {
  const ctx = pdfDoc.context; const cat = pdfDoc.catalog;
  const date = (s) => (s instanceof Date ? s : s ? new Date(s) : null);
  const info = lookupDict(ctx, ctx.trailerInfo.Info) || (() => { const d = ctx.obj({}); ctx.trailerInfo.Info = ctx.register(d); return d; })();
  const setOrDelete = (key, value, setter) => { if (value) setter(value); else info.delete(N(key)); };
  setOrDelete('Title', v.title, (x) => pdfDoc.setTitle(x, { showInWindowTitleBar: !!v.displayDocTitle }));
  setOrDelete('Author', v.author, (x) => pdfDoc.setAuthor(x));
  setOrDelete('Subject', v.subject, (x) => pdfDoc.setSubject(x));
  // scritte così come sono (pdf-lib setKeywords unirebbe le parole con uno spazio, perdendo le virgole)
  setOrDelete('Keywords', v.keywords, (x) => info.set(N('Keywords'), PDFHexString.fromText(String(x))));
  setOrDelete('Creator', v.creator, (x) => pdfDoc.setCreator(x));
  setOrDelete('Producer', v.producer, (x) => pdfDoc.setProducer(x));
  const cd = date(v.creationDate); const md = date(v.modDate);
  if (cd && !isNaN(cd)) pdfDoc.setCreationDate(cd); else if (v.creationDate === '') info.delete(N('CreationDate'));
  if (md && !isNaN(md)) pdfDoc.setModificationDate(md); else if (v.modDate === '') info.delete(N('ModDate'));

  if (v.pageLayout) cat.set(N('PageLayout'), N(v.pageLayout)); else cat.delete(N('PageLayout'));
  if (v.pageMode && v.pageMode !== 'UseNone') cat.set(N('PageMode'), N(v.pageMode)); else cat.delete(N('PageMode'));

  const vp = lookupDict(ctx, cat.get(N('ViewerPreferences'))) || ctx.obj({});
  for (const [k, on] of [['DisplayDocTitle', v.displayDocTitle], ['FitWindow', v.fitWindow], ['CenterWindow', v.centerWindow], ['HideToolbar', v.hideToolbar], ['HideMenubar', v.hideMenubar]]) {
    if (on) vp.set(N(k), ctx.obj(true)); else vp.delete(N(k));
  }
  if (vp.keys().length) cat.set(N('ViewerPreferences'), vp); else cat.delete(N('ViewerPreferences'));

  const pages = pdfDoc.getPages();
  const pi = Math.max(0, Math.min(pages.length - 1, (Number(v.openPage) || 1) - 1));
  if (v.openZoom || pi > 0) {
    const ref = pages[pi].ref; const z = v.openZoom;
    const dest = z === 'fit' ? [ref, N('Fit')] : z === 'fitWidth' ? [ref, N('FitH'), null] : [ref, N('XYZ'), null, null, z ? Number(z) / 100 : null];
    cat.set(N('OpenAction'), ctx.obj(dest));
  } else {
    const oa = ctx.lookup(cat.get(N('OpenAction')));
    if (oa instanceof PDFArray) cat.delete(N('OpenAction')); // una destinazione: togli; le azioni (dizionari) restano
  }
  // XMP: se c'era, va riscritto (Acrobat dà la precedenza all'XMP se più recente)
  if (cat.get(N('Metadata')) || v.writeXmp) {
    const xml = buildXmp({ ...v, creationDate: cd, modDate: md });
    const s = ctx.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
    cat.set(N('Metadata'), ctx.register(s));
  }
}

export { PDFName, PDFDict };
