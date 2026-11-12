// PDF/A (conservazione a lungo termine): conversione in PDF/A-2b o 3b e verifica preliminare (preflight).
// Lavora su un PDFDocument di pdf-lib; nessun accesso al DOM (testabile in Node).

// ---------- profilo colore sRGB (ICC v2, matrice + curve) generato nel codice ----------
export function profiloSRGB() {
  const tags = [];
  const s15 = (v) => { const n = Math.round(v * 65536); const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); return b; };
  const xyz = (x, y, z) => { const b = new Uint8Array(20); b.set([0x58, 0x59, 0x5a, 0x20]); b.set(s15(x), 8); b.set(s15(y), 12); b.set(s15(z), 16); return b; };
  const ascii = (s) => new TextEncoder().encode(s);
  const desc = (s) => { // textDescriptionType
    const a = ascii(s); const b = new Uint8Array(12 + a.length + 1 + 4 + 4 + 2 + 1 + 67);
    const dv = new DataView(b.buffer);
    b.set(ascii('desc')); dv.setUint32(8, a.length + 1); b.set(a, 12);
    return b;
  };
  const text = (s) => { const a = ascii(s); const b = new Uint8Array(8 + a.length + 1); b.set(ascii('text')); b.set(a, 8); return b; };
  const curv = () => {
    const n = 1024; const b = new Uint8Array(12 + n * 2); const dv = new DataView(b.buffer);
    b.set(ascii('curv')); dv.setUint32(8, n);
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1);
      const lin = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      dv.setUint16(12 + i * 2, Math.round(lin * 65535));
    }
    return b;
  };
  const trc = curv();
  tags.push(['desc', desc('sRGB IEC61966-2.1')], ['cprt', text('Pubblico dominio (generato da Leggio)')], ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc]);
  // tabella dei tag; le curve identiche condividono i dati
  const headerLen = 128; const tableLen = 4 + tags.length * 12;
  let off = headerLen + tableLen;
  const placed = new Map(); const entries = [];
  const chunks = [];
  for (const [sig, data] of tags) {
    if (placed.has(data)) { entries.push([sig, placed.get(data), data.length]); continue; }
    while (off % 4) { off++; chunks.push(new Uint8Array(1)); }
    placed.set(data, off); entries.push([sig, off, data.length]); chunks.push(data); off += data.length;
  }
  const size = off;
  const out = new Uint8Array(size); const dv = new DataView(out.buffer);
  dv.setUint32(0, size); out.set(ascii('lcms'), 4); dv.setUint32(8, 0x02100000);
  out.set(ascii('mntr'), 12); out.set(ascii('RGB '), 16); out.set(ascii('XYZ '), 20);
  dv.setUint16(24, 2026); dv.setUint16(26, 1); dv.setUint16(28, 1);
  out.set(ascii('acsp'), 36); out.set(ascii('APPL'), 40);
  out.set(s15(0.9642), 68); out.set(s15(1.0), 72); out.set(s15(0.8249), 76);
  out.set(ascii('lgio'), 80);
  dv.setUint32(128, tags.length);
  entries.forEach(([sig, o, len], i) => { out.set(ascii(sig), 132 + i * 12); dv.setUint32(136 + i * 12, o); dv.setUint32(140 + i * 12, len); });
  let p = headerLen + tableLen;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

// ---------- metadati XMP ----------
const escXml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export const dataXmp = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function xmpPdfa({ part = 2, conformance = 'B', title, author, subject, keywords, producer = 'Leggio', creatorTool, createDate, modifyDate, lang = 'x-default' } = {}) {
  const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${escXml(v)}</rdf:li></rdf:Alt>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdfaid:part>${part}</pdfaid:part>
<pdfaid:conformance>${conformance}</pdfaid:conformance>
<dc:format>application/pdf</dc:format>
${title ? `<dc:title>${alt(title)}</dc:title>` : ''}
${author ? `<dc:creator><rdf:Seq><rdf:li>${escXml(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
${subject ? `<dc:description>${alt(subject)}</dc:description>` : ''}
${createDate ? `<xmp:CreateDate>${dataXmp(createDate)}</xmp:CreateDate>` : ''}
${modifyDate ? `<xmp:ModifyDate>${dataXmp(modifyDate)}</xmp:ModifyDate><xmp:MetadataDate>${dataXmp(modifyDate)}</xmp:MetadataDate>` : ''}
${creatorTool ? `<xmp:CreatorTool>${escXml(creatorTool)}</xmp:CreatorTool>` : ''}
<pdf:Producer>${escXml(producer)}</pdf:Producer>
${keywords ? `<pdf:Keywords>${escXml(keywords)}</pdf:Keywords>` : ''}
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
${' '.repeat(100)}
<?xpacket end="w"?>`.replace(/\n\n+/g, '\n');
}

// ---------- utilità pdf-lib ----------
function nomeDi(v) { return v && typeof v.asString === 'function' ? v.asString().replace(/^\//, '') : v?.decodeText ? v.decodeText() : v?.toString?.().replace(/^\//, ''); }

function* tuttiGliOggetti(ctx) {
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) yield [ref, obj];
}

function dictDi(obj, PDFLib) {
  if (obj instanceof PDFLib.PDFDict) return obj;
  if (obj && obj.dict instanceof PDFLib.PDFDict) return obj.dict; // stream
  return null;
}

const STANDARD14 = /^(Helvetica|Arial|Times|Courier|Symbol|ZapfDingbats)/i;
const SANS = /^(Helvetica|Arial)(MT)?(-|,)?(Bold)?(Italic|Oblique)?(MT)?$/i;

/** Tabella WinAnsi (cp1252) codice → Unicode. */
export function winAnsiUnicode(code) {
  const m = { 128: 0x20ac, 130: 0x201a, 131: 0x192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x2c6, 137: 0x2030, 138: 0x160, 139: 0x2039, 140: 0x152, 142: 0x17d, 145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x2dc, 153: 0x2122, 154: 0x161, 155: 0x203a, 156: 0x153, 158: 0x17e, 159: 0x178 };
  if (m[code]) return m[code];
  if (code >= 128 && code <= 159) return null;
  return code;
}

/** Informazioni sui font del documento. → [{ ref, nome, tipo, incorporato, dict }] */
export function elencoFont(pdfDoc, PDFLib) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const ctx = pdfDoc.context;
  const out = [];
  for (const [ref, obj] of tuttiGliOggetti(ctx)) {
    if (!(obj instanceof PDFDict)) continue;
    if (nomeDi(obj.get(PDFName.of('Type'))) !== 'Font') continue;
    const sub = nomeDi(obj.get(PDFName.of('Subtype')));
    if (sub === 'CIDFontType0' || sub === 'CIDFontType2') continue; // valutati tramite il Type0 padre
    let desc = obj.lookup(PDFName.of('FontDescriptor'));
    if (sub === 'Type0') {
      const d = obj.lookup(PDFName.of('DescendantFonts'));
      const child = d instanceof PDFArray ? d.lookup(0) : null;
      desc = child?.lookup?.(PDFName.of('FontDescriptor'));
    }
    const embedded = sub === 'Type3' || !!(desc instanceof PDFDict && (desc.get(PDFName.of('FontFile')) || desc.get(PDFName.of('FontFile2')) || desc.get(PDFName.of('FontFile3'))));
    out.push({ ref, nome: (nomeDi(obj.get(PDFName.of('BaseFont'))) || '(senza nome)').replace(/^[A-Z]{6}\+/, ''), tipo: sub, incorporato: embedded, dict: obj });
  }
  return out;
}

/**
 * Sostituisce i font standard sans (Helvetica/Arial non incorporati) con Liberation Sans incorporato,
 * metricamente compatibile. fonts: { regular, bold, italic, boldItalic } → Uint8Array TTF; fontkit: istanza.
 * → numero di font corretti
 */
export function incorporaFontSans(pdfDoc, PDFLib, fonts, fontkit) {
  const { PDFName, PDFNumber } = PDFLib;
  const ctx = pdfDoc.context;
  const cache = {};
  let n = 0;
  for (const f of elencoFont(pdfDoc, PDFLib)) {
    if (f.incorporato || (f.tipo !== 'Type1' && f.tipo !== 'TrueType')) continue;
    const m = f.nome.match(SANS);
    if (!m) continue;
    const enc = f.dict.get(PDFName.of('Encoding'));
    // solo codifiche semplici e conosciute (WinAnsi o assente); con Differences si lascia stare
    if (enc && nomeDi(enc) !== 'WinAnsiEncoding' && nomeDi(enc) !== 'StandardEncoding') continue;
    const bold = /bold/i.test(f.nome); const italic = /italic|oblique/i.test(f.nome);
    const key = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    const bytes = fonts[key]; if (!bytes) continue;
    if (!cache[key]) {
      const font = fontkit.create(bytes);
      const upm = font.unitsPerEm; const k = 1000 / upm;
      const widths = [];
      for (let c = 32; c <= 255; c++) {
        const u = winAnsiUnicode(c);
        const g = u != null ? font.glyphForCodePoint(u) : null;
        widths.push(PDFNumber.of(Math.round((g && g.id ? g.advanceWidth : font.glyphForCodePoint(0x20).advanceWidth) * k)));
      }
      const file = ctx.flateStream(bytes, { Length1: bytes.length });
      const fileRef = ctx.register(file);
      const bb = font.bbox;
      const psName = (font.postscriptName || 'LiberationSans').replace(/[^A-Za-z0-9-]/g, '');
      const desc = ctx.obj({
        Type: 'FontDescriptor', FontName: psName, Flags: 32 + (italic ? 64 : 0),
        FontBBox: [Math.round(bb.minX * k), Math.round(bb.minY * k), Math.round(bb.maxX * k), Math.round(bb.maxY * k)],
        ItalicAngle: font.italicAngle || 0, Ascent: Math.round(font.ascent * k), Descent: Math.round(font.descent * k),
        CapHeight: Math.round((font.capHeight || font.ascent * 0.7) * k), StemV: bold ? 120 : 80, FontFile2: fileRef,
      });
      cache[key] = { psName, descRef: ctx.register(desc), widths: ctx.obj(widths) };
    }
    const c = cache[key];
    const d = f.dict;
    d.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
    d.set(PDFName.of('BaseFont'), PDFName.of(c.psName));
    d.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
    d.set(PDFName.of('FirstChar'), PDFNumber.of(32));
    d.set(PDFName.of('LastChar'), PDFNumber.of(255));
    d.set(PDFName.of('Widths'), c.widths);
    d.set(PDFName.of('FontDescriptor'), c.descRef);
    n++;
  }
  return n;
}

function infoData(pdfDoc) {
  const get = (fn) => { try { return pdfDoc[fn](); } catch { return undefined; } };
  return { title: get('getTitle'), author: get('getAuthor'), subject: get('getSubject'), keywords: get('getKeywords'), creator: get('getCreator'), creationDate: get('getCreationDate') };
}

/**
 * Converte in PDF/A (b). opts: { part: 2|3, title, lang, now: Date }
 * → { azioni: [testo], avvisi: [testo] }  (i problemi residui li elenca preflight)
 */
export function convertiPdfA(pdfDoc, PDFLib, opts = {}) {
  const { PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber, PDFString } = PDFLib;
  const ctx = pdfDoc.context;
  const cat = pdfDoc.catalog;
  const azioni = []; const avvisi = [];
  const now = opts.now || new Date();
  const part = opts.part === 3 ? 3 : 2;

  // 1. JavaScript e azioni automatiche
  const names = cat.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict && names.get(PDFName.of('JavaScript'))) { names.delete(PDFName.of('JavaScript')); azioni.push('Rimossi gli script (JavaScript) del documento'); }
  const oa = cat.lookup(PDFName.of('OpenAction'));
  if (oa instanceof PDFDict && nomeDi(oa.get(PDFName.of('S'))) === 'JavaScript') { cat.delete(PDFName.of('OpenAction')); azioni.push('Rimossa l’azione automatica all’apertura'); }
  if (cat.get(PDFName.of('AA'))) { cat.delete(PDFName.of('AA')); azioni.push('Rimosse le azioni automatiche del documento'); }
  // file allegati: in PDF/A-2 ammessi solo se a loro volta PDF/A (non verificabile qui)
  if (names instanceof PDFDict && names.get(PDFName.of('EmbeddedFiles')) && part === 2) avvisi.push('Il documento contiene file allegati: PDF/A-2 li ammette solo se sono anch’essi PDF/A. Se servono, scegli PDF/A-3.');

  // 2. pagine e annotazioni
  let annotCorrette = 0; let jsRimossi = 0;
  for (const page of pdfDoc.getPages()) {
    const node = page.node;
    if (node.get(PDFName.of('AA'))) { node.delete(PDFName.of('AA')); jsRimossi++; }
    const annots = node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const sub = nomeDi(a.get(PDFName.of('Subtype')));
      const f = a.lookup(PDFName.of('F'));
      const flags = f instanceof PDFNumber ? f.asNumber() : 0;
      const nuovi = (flags | 4) & ~(1 | 2 | 32 | 256);
      if (sub !== 'Popup' && nuovi !== flags) { a.set(PDFName.of('F'), PDFNumber.of(nuovi)); annotCorrette++; }
      const act = a.lookup(PDFName.of('A'));
      if (act instanceof PDFDict && /JavaScript|Launch|Sound|Movie|ResetForm|ImportData|Hide|SetOCGState|Rendition|Trans|GoTo3DView/.test(nomeDi(act.get(PDFName.of('S'))) || '')) { a.delete(PDFName.of('A')); jsRimossi++; }
      if (a.get(PDFName.of('AA'))) { a.delete(PDFName.of('AA')); jsRimossi++; }
    }
  }
  if (annotCorrette) azioni.push(`${annotCorrette} annotazioni rese stampabili e visibili (obbligatorio in PDF/A)`);
  if (jsRimossi) azioni.push(`Rimosse ${jsRimossi} azioni non ammesse (script, avvio programmi, suoni)`);
  // moduli: niente calcoli automatici in PDF/A
  const acro = cat.lookup(PDFName.of('AcroForm'));
  if (acro instanceof PDFDict) {
    if (acro.get(PDFName.of('NeedAppearances'))) { acro.delete(PDFName.of('NeedAppearances')); azioni.push('Moduli: disattivata la rigenerazione automatica dell’aspetto'); }
    if (acro.get(PDFName.of('XFA'))) { acro.delete(PDFName.of('XFA')); azioni.push('Moduli: rimossa la parte XFA (non ammessa)'); }
  }

  // 3. metadati (Info e XMP coerenti)
  const info = infoData(pdfDoc);
  const title = opts.title ?? info.title;
  if (title) pdfDoc.setTitle(title);
  const created = info.creationDate || now;
  pdfDoc.setCreationDate(created);
  pdfDoc.setModificationDate(now);
  pdfDoc.setProducer('Leggio');
  if (!info.creator) pdfDoc.setCreator('Leggio');
  const xmp = xmpPdfa({ part, conformance: 'B', title, author: info.author, subject: info.subject, keywords: info.keywords, producer: 'Leggio', creatorTool: info.creator || 'Leggio', createDate: created, modifyDate: now });
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  cat.set(PDFName.of('Metadata'), ctx.register(meta));
  azioni.push(`Aggiunti i metadati PDF/A-${part}b (XMP)`);
  if (opts.lang) { cat.set(PDFName.of('Lang'), PDFString.of(opts.lang)); }

  // 4. profilo colore di uscita (OutputIntent sRGB)
  const icc = ctx.flateStream(profiloSRGB(), { N: 3 });
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), RegistryName: PDFString.of('http://www.color.org'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: ctx.register(icc) });
  cat.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));
  azioni.push('Aggiunto il profilo colore sRGB');

  // 5. identificativo del file
  if (!ctx.trailerInfo.ID) {
    const rnd = () => { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return PDFHexString.of([...b].map((x) => x.toString(16).padStart(2, '0')).join('')); };
    const id = rnd();
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }
  // 6. niente cifratura nel risultato
  if (ctx.trailerInfo.Encrypt) { ctx.trailerInfo.Encrypt = undefined; azioni.push('Rimossa la cifratura'); }
  return { azioni, avvisi };
}

/**
 * Verifica preliminare PDF/A (controlli principali, non sostituisce un validatore completo come veraPDF).
 * → [{ id, ok, titolo, dettaglio, correggibile }]
 */
export function preflightPdfA(pdfDoc, PDFLib, { decode } = {}) {
  const { PDFName, PDFDict, PDFArray, PDFRawStream } = PDFLib;
  const ctx = pdfDoc.context;
  const cat = pdfDoc.catalog;
  const res = [];
  const add = (id, ok, titolo, dettaglio = '', correggibile = false) => res.push({ id, ok, titolo, dettaglio, correggibile });

  // identificazione
  let xmp = '';
  const mref = cat.get(PDFName.of('Metadata'));
  const mstream = mref ? ctx.lookup(mref) : null;
  if (mstream instanceof PDFRawStream) {
    try { xmp = new TextDecoder().decode(decode ? decode(mstream) : mstream.contents); } catch { xmp = ''; }
  } else if (mstream?.getContentsString) xmp = mstream.getContentsString();
  const part = xmp.match(/pdfaid:part(?:>|=")(\d)/)?.[1];
  const conf = xmp.match(/pdfaid:conformance(?:>|=")([ABU])/i)?.[1];
  add('identificazione', !!part, part ? `Dichiarato PDF/A-${part}${(conf || '').toLowerCase()}` : 'Il file non si dichiara PDF/A', part ? '' : 'Mancano i metadati XMP con l’identificazione PDF/A.', true);

  // cifratura
  add('cifratura', !ctx.trailerInfo.Encrypt, ctx.trailerInfo.Encrypt ? 'Il file è protetto da cifratura' : 'Nessuna cifratura', ctx.trailerInfo.Encrypt ? 'PDF/A non ammette la protezione con password: rimuovila.' : '', true);

  // profilo colore
  const oi = cat.lookup(PDFName.of('OutputIntents'));
  let hasOI = false; let oiCMYK = false;
  if (oi instanceof PDFArray) {
    for (let i = 0; i < oi.size(); i++) {
      const d = oi.lookup(i);
      if (d instanceof PDFDict && nomeDi(d.get(PDFName.of('S'))) === 'GTS_PDFA1' && d.get(PDFName.of('DestOutputProfile'))) {
        hasOI = true;
        const prof = d.lookup(PDFName.of('DestOutputProfile'));
        if (prof?.dict?.lookup(PDFName.of('N'))?.asNumber?.() === 4) oiCMYK = true;
      }
    }
  }
  add('colore', hasOI, hasOI ? 'Profilo colore di uscita presente' : 'Manca il profilo colore di uscita (OutputIntent)', hasOI ? '' : 'Serve per rendere i colori indipendenti dal dispositivo.', true);

  // font
  const fonts = elencoFont(pdfDoc, PDFLib);
  const nonInc = fonts.filter((f) => !f.incorporato);
  const nomi = [...new Set(nonInc.map((f) => f.nome))];
  add('font', !nonInc.length, nonInc.length ? `${nomi.length} ${nomi.length === 1 ? 'font non incorporato' : 'font non incorporati'}` : `Tutti i font sono incorporati (${fonts.length})`,
    nonInc.length ? `${nomi.slice(0, 8).join(', ')}${nomi.length > 8 ? '…' : ''}. ${nomi.every((n) => SANS.test(n)) ? 'Leggio li può incorporare con un carattere equivalente (Liberation Sans).' : 'Per i font diversi da Helvetica/Arial serve rigenerare il PDF dal programma d’origine con i font incorporati, oppure stampare in PDF.'}` : '', nomi.every((n) => SANS.test(n)));

  // script
  const names = cat.lookup(PDFName.of('Names'));
  const js = (names instanceof PDFDict && names.get(PDFName.of('JavaScript'))) || cat.get(PDFName.of('AA'));
  add('script', !js, js ? 'Il documento contiene script o azioni automatiche' : 'Nessuno script', js ? 'Non ammessi in PDF/A: verranno rimossi.' : '', true);

  // annotazioni
  let annotNo = 0; let senzaAspetto = 0;
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const sub = nomeDi(a.get(PDFName.of('Subtype')));
      if (sub === 'Popup') continue;
      const f = a.lookup(PDFName.of('F'))?.asNumber?.() || 0;
      if (!(f & 4) || (f & (1 | 2 | 32 | 256))) annotNo++;
      const rect = a.lookup(PDFName.of('Rect'));
      const zero = rect instanceof PDFArray && rect.size() === 4 && rect.lookup(0)?.asNumber?.() === rect.lookup(2)?.asNumber?.();
      if (sub !== 'Link' && !zero && !a.get(PDFName.of('AP'))) senzaAspetto++;
    }
  }
  add('annotazioni', !annotNo, annotNo ? `${annotNo} annotazioni non stampabili o nascoste` : 'Annotazioni conformi', annotNo ? 'In PDF/A le annotazioni devono essere stampabili.' : '', true);
  if (senzaAspetto) add('aspetto', false, `${senzaAspetto} annotazioni o campi senza aspetto grafico`, 'Potrebbero non essere accettati da un validatore: rendi definitivi i commenti e i moduli (Appiattisci) prima della conversione.');

  // CMYK senza profilo di stampa, filtri non ammessi, allegati
  let cmyk = false; let lzw = false; let trasparenzaSenzaSpazio = false;
  for (const [, obj] of tuttiGliOggetti(ctx)) {
    const d = dictDi(obj, PDFLib);
    if (!d) continue;
    const cs = nomeDi(d.get(PDFName.of('ColorSpace')));
    if (cs === 'DeviceCMYK') cmyk = true;
    const filt = d.get(PDFName.of('Filter'));
    const fs = filt instanceof PDFArray ? Array.from({ length: filt.size() }, (_, i) => nomeDi(filt.get(i))) : [nomeDi(filt)];
    if (fs.includes('LZWDecode')) lzw = true;
    if (nomeDi(d.get(PDFName.of('S'))) === 'Transparency' && nomeDi(d.get(PDFName.of('Type'))) === 'Group' && !d.get(PDFName.of('CS')) && !hasOI) trasparenzaSenzaSpazio = true;
  }
  if (cmyk && !oiCMYK) add('cmyk', false, 'Immagini a colori CMYK (da stampa) con profilo sRGB', 'Un validatore severo potrebbe segnalarlo: per i documenti da tipografia rigenera il PDF con profilo di stampa.');
  if (lzw) add('lzw', false, 'Compressione LZW non ammessa in PDF/A-2', 'Rigenera o comprimi di nuovo il PDF.');
  if (trasparenzaSenzaSpazio) add('trasparenza', false, 'Trasparenze senza profilo colore', 'Si risolve con il profilo colore di uscita.', true);
  const ef = names instanceof PDFDict && names.get(PDFName.of('EmbeddedFiles'));
  if (ef && part !== '3') add('allegati', false, 'File allegati', 'PDF/A-2 ammette solo allegati PDF/A; con allegati di altro tipo usa PDF/A-3.');

  // identificativo
  add('id', !!ctx.trailerInfo.ID, ctx.trailerInfo.ID ? 'Identificativo del file presente' : 'Manca l’identificativo del file', '', true);
  return res;
}
