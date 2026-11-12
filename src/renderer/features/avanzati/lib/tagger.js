// «Prepara per l'accessibilità»: struttura di tag di base generata dall'analisi dei flussi di contenuto.
// Cosa fa: racchiude ogni riga di testo in un contenuto marcato con MCID, raggruppa le righe in paragrafi
// e titoli (dalla dimensione del carattere), marca le immagini come figure (con testo alternativo) o come
// decorazioni, i tracciati vettoriali come decorazioni (Artifact), e crea StructTreeRoot/ParentTree/MarkInfo.
// Limiti (onesti): l'ordine di lettura è quello del flusso di contenuto; tabelle, elenchi, note e link non
// vengono riconosciuti; il testo dentro gli XObject modulo è un unico paragrafo. Logica pura su pdf-lib.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const SHOW = new Set(['Tj', 'TJ', "'", '"']);
const PATH_PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const PATH_START = new Set(['m', 're']);

/**
 * Divide un flusso di contenuto in operazioni: [{ op, args, start, end }]
 * args: numeri, nomi ('/X'), { str: lunghezza } per le stringhe, 'array'/'dict'.
 */
export function tokenize(b) {
  const ops = []; let args = []; let argStart = -1; let i = 0; const n = b.length;
  let depth = 0; // dentro array/dizionari gli operandi sono raccolti in modo grezzo
  let arrStrLen = 0;
  const pushArg = (v, s) => { if (depth === 0) { if (argStart < 0) argStart = s; args.push(v); } };
  while (i < n) {
    const c = b[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // commento
    const s = i;
    if (c === 40) { // stringa letterale
      let lvl = 1; i++; let len = 0;
      while (i < n && lvl > 0) { const x = b[i]; if (x === 92) { i += 2; len++; continue; } if (x === 40) lvl++; else if (x === 41) { lvl--; if (!lvl) break; } i++; len++; }
      i++;
      if (depth) arrStrLen += len; else pushArg({ str: len }, s);
      continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) { if (depth === 0 && argStart < 0) argStart = s; depth++; i += 2; continue; }
      let len = 0; i++; while (i < n && b[i] !== 62) { if (!WS.has(b[i])) len++; i++; } i++;
      if (depth) arrStrLen += len / 2; else pushArg({ str: len / 2 }, s);
      continue;
    }
    if (c === 62 && b[i + 1] === 62) { depth = Math.max(0, depth - 1); i += 2; if (depth === 0) pushArg('dict', s); continue; }
    if (c === 91) { if (depth === 0) { if (argStart < 0) argStart = s; arrStrLen = 0; } depth++; i++; continue; }
    if (c === 93) { depth = Math.max(0, depth - 1); i++; if (depth === 0) pushArg({ arr: true, str: arrStrLen }, s); continue; }
    if (c === 123 || c === 125) { i++; continue; }
    if (c === 47) { i++; while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++; pushArg('/' + latin1(b, s + 1, i), s); continue; }
    // numero o parola chiave
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    const word = latin1(b, s, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { pushArg(parseFloat(word), s); continue; }
    if (depth) continue;
    if (word === 'true' || word === 'false' || word === 'null') { pushArg(word, s); continue; }
    const op = { op: word, args, start: argStart >= 0 ? argStart : s, end: i };
    if (word === 'ID') {
      // immagine in linea: dati binari fino a "EI" isolato
      let k = i + 1;
      while (k < n - 1) {
        if (b[k] === 69 && b[k + 1] === 73 && WS.has(b[k - 1]) && (k + 2 >= n || WS.has(b[k + 2]) || DELIM.has(b[k + 2]))) break;
        k++;
      }
      op.end = Math.min(n, k + 2); i = op.end;
      op.op = 'INLINE_IMAGE';
    }
    ops.push(op); args = []; argStart = -1;
  }
  return ops;
}
function latin1(b, s, e) { let out = ''; for (let k = s; k < e; k++) out += String.fromCharCode(b[k]); return out; }

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const I = [1, 0, 0, 1, 0, 0];

/**
 * Analizza le operazioni di una pagina e produce i segmenti da marcare.
 * xobj(name) → 'Image' | 'Form' | null.  → { segments: [{kind, start, end, y, size, len, invisible, area}] , hasMarked }
 * kind: 'text' (una riga) | 'image' | 'form' | 'inline' | 'path'
 */
export function analyzeOps(ops, xobj = () => null, pageArea = 1) {
  const segs = [];
  let ctm = I; const stack = [];
  let tm = I; let tlm = I; let fontSize = 12; let leading = 0; let tr = 0;
  let mc = 0; // profondità del contenuto marcato esistente
  const mcTags = []; // etichette aperte: dentro contenuti marcati diversi da /OC (livelli) non aggiungiamo tag
  const blocked = () => mcTags.some((t) => t !== '/OC');
  let hasMarked = false;
  let inText = false; let line = null; let lineStartIdx = -1; let lastShowIdx = -1;
  let path = null; // { startIdx, depth }
  const closeLine = (idx) => {
    if (line && lastShowIdx >= 0 && line.depth === mc) {
      segs.push({ kind: 'text', start: ops[line.startIdx].start, end: ops[lastShowIdx].end, y: line.y, size: line.size, len: line.len, invisible: line.invisible });
    }
    line = null; lineStartIdx = idx; lastShowIdx = -1;
  };
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k]; const a = o.args;
    switch (o.op) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || I; break;
      case 'cm': if (a.length === 6 && a.every((x) => typeof x === 'number')) ctm = mul(a, ctm); break;
      case 'BMC': case 'BDC': case 'EMC':
        if (inText && line) closeLine(k);
        if (o.op === 'EMC') { mc = Math.max(0, mc - 1); mcTags.pop(); } else { mc++; mcTags.push(typeof a[0] === 'string' ? a[0] : '?'); hasMarked = true; }
        if (inText) lineStartIdx = k + 1;
        if (path) path = null;
        break;
      case 'BT': inText = true; tm = I; tlm = I; line = null; lineStartIdx = k + 1; lastShowIdx = -1; break;
      case 'ET': closeLine(k); inText = false; break;
      case 'Tf': if (typeof a[1] === 'number') fontSize = a[1]; break;
      case 'TL': if (typeof a[0] === 'number') leading = a[0]; break;
      case 'Tr': if (typeof a[0] === 'number') tr = a[0]; break;
      case 'Tm': if (a.length === 6) { tm = tlm = a.slice(); } break;
      case 'Td': case 'TD': if (typeof a[0] === 'number' && typeof a[1] === 'number') { if (o.op === 'TD') leading = -a[1]; tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; } break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
      case 'sh': if (!inText && !blocked()) segs.push({ kind: 'path', start: o.start, end: o.end }); break;
      case 'Do': {
        const t = xobj(a[0]);
        if (!inText && !blocked()) {
          const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) / Math.max(1, pageArea);
          segs.push({ kind: t === 'Image' ? 'image' : t === 'Form' ? 'form' : 'path', start: o.start, end: o.end, area, name: a[0], w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]) });
        }
        break;
      }
      case 'INLINE_IMAGE': {
        // l'operatore BI precedente apre l'immagine: cerchiamo l'inizio
        const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) / Math.max(1, pageArea);
        let s = k; while (s > 0 && ops[s].op !== 'BI') s--;
        if (!inText && !blocked()) segs.push({ kind: 'inline', start: ops[s].start, end: o.end, area, w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]) });
        break;
      }
      default: break;
    }
    if (inText && SHOW.has(o.op) && !blocked()) {
      if (o.op === "'" || o.op === '"') { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; }
      const m = mul(tm, ctm);
      const size = Math.abs(fontSize) * Math.hypot(m[2], m[3]);
      const y = m[5];
      const len = a.reduce((s, x) => s + (x && typeof x === 'object' && 'str' in x ? x.str : 0), 0);
      if (line && Math.abs(line.y - y) > Math.max(1, 0.35 * Math.max(size, line.size)) && line.depth === mc) closeLine(lastShowIdx + 1);
      if (!line) line = { startIdx: lineStartIdx >= 0 ? lineStartIdx : k, y, size, len: 0, depth: mc, invisible: tr === 3 || tr === 7 };
      line.len += len; line.size = Math.max(line.size, size);
      if (!(tr === 3 || tr === 7)) line.invisible = false;
      lastShowIdx = k;
    }
    if (!inText) {
      if (!path && PATH_START.has(o.op) && !blocked()) path = { startIdx: k, depth: mc };
      if (path && PATH_PAINT.has(o.op)) { if (path.depth === mc) segs.push({ kind: 'path', start: ops[path.startIdx].start, end: o.end }); path = null; }
    }
  }
  return { segments: segs, hasMarked };
}

/** Dimensione del corpo del testo (mediana pesata per lunghezza). */
export function bodySize(lines) {
  const arr = lines.filter((l) => l.len > 0 && l.size > 0).map((l) => [Math.round(l.size * 10) / 10, l.len]).sort((x, y) => x[0] - y[0]);
  const total = arr.reduce((s, x) => s + x[1], 0);
  let acc = 0; for (const [sz, w] of arr) { acc += w; if (acc >= total / 2) return sz; }
  return 11;
}

/** Classifica le righe: 'H1' | 'H2' | 'P'. */
export function classify(line, body) {
  if (line.len > 160) return 'P';
  if (line.size >= body * 1.45) return 'H1';
  if (line.size >= body * 1.18) return 'H2';
  return 'P';
}

/** Inserisce i marcatori nei byte del flusso. marks: [{ start, end, open, close }] non sovrapposti. */
export function insertMarks(b, marks) {
  const enc = new TextEncoder();
  const sorted = [...marks].sort((x, y) => x.start - y.start);
  const parts = []; let pos = 0; let total = 0;
  for (const m of sorted) {
    if (m.start < pos) continue; // sicurezza: niente sovrapposizioni
    parts.push(b.subarray(pos, m.start), enc.encode('\n' + m.open + '\n'), b.subarray(m.start, m.end), enc.encode('\n' + m.close + '\n'));
    pos = m.end;
  }
  parts.push(b.subarray(pos));
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------- livello documento (pdf-lib) ----------------

function pageContentBytes(page, PDFLib) {
  const { PDFArray, PDFRawStream, PDFName, decodePDFRawStream } = PDFLib;
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return new Uint8Array(0);
  const refs = [];
  const c = page.node.context.lookup(contents);
  if (c instanceof PDFArray) for (let i = 0; i < c.size(); i++) refs.push(c.lookup(i)); else refs.push(c);
  const chunks = [];
  for (const s of refs) {
    if (!(s instanceof PDFRawStream)) { if (s?.getUnencodedContents) chunks.push(s.getUnencodedContents()); else if (s?.getContents) chunks.push(s.getContents()); chunks.push(new Uint8Array([10])); continue; }
    chunks.push(decodePDFRawStream(s).decode());
    chunks.push(new Uint8Array([10]));
  }
  const total = chunks.reduce((x, y) => x + y.length, 0);
  const out = new Uint8Array(total); let o = 0; for (const ch of chunks) { out.set(ch, o); o += ch.length; }
  return out;
}

function xobjResolver(page, PDFLib) {
  const { PDFName, PDFDict, PDFStream } = PDFLib;
  let res = null;
  try { res = page.node.Resources(); } catch {}
  const xo = res?.lookupMaybe?.(PDFName.of('XObject'), PDFDict);
  return (name) => {
    if (!xo || typeof name !== 'string') return null;
    const s = xo.lookup(PDFName.of(name.slice(1)));
    const dict = s instanceof PDFStream ? s.dict : s;
    const st = dict?.get?.(PDFName.of('Subtype'));
    return st ? st.asString().slice(1) : null;
  };
}

/** Stato di accessibilità attuale. */
export function statoAccessibilita(pdfDoc, PDFLib) {
  const { PDFName, PDFDict } = PDFLib;
  const cat = pdfDoc.catalog;
  const mark = cat.lookupMaybe(PDFName.of('MarkInfo'), PDFDict);
  const lang = cat.get(PDFName.of('Lang'));
  return {
    tagged: !!cat.get(PDFName.of('StructTreeRoot')),
    marked: !!mark && String(mark.get(PDFName.of('Marked'))) === 'true',
    lang: lang ? (lang.decodeText ? lang.decodeText() : String(lang).replace(/[()]/g, '')) : '',
    title: pdfDoc.getTitle() || '',
  };
}

/** Elenca le immagini (XObject) da descrivere. → [{ id, page (1-based), area, w, h }] */
export function elencaFigure(pdfDoc, PDFLib) {
  const out = [];
  pdfDoc.getPages().forEach((page, pi) => {
    let bytes;
    try { bytes = pageContentBytes(page, PDFLib); } catch { return; }
    const { width, height } = page.getSize();
    const { segments } = analyzeOps(tokenize(bytes), xobjResolver(page, PDFLib), width * height);
    const hasInvisible = segments.some((s) => s.kind === 'text' && s.invisible);
    let k = 0;
    for (const s of segments) {
      if (s.kind !== 'image' && s.kind !== 'inline') continue;
      k++;
      out.push({ id: `${pi}:${k}`, page: pi + 1, area: s.area, w: Math.round(s.w), h: Math.round(s.h), probabileScansione: hasInvisible && s.area > 0.6, piccola: s.w * s.h < 400 });
    }
  });
  return out;
}

/**
 * Crea la struttura di tag. opts: { lang, title, alt: { [figureId]: testo | '' (decorativa) } , signal }
 * → { pagine, paragrafi, titoli, figure, decorative, pagineSaltate: [n], senzaTesto: [n] }
 */
export function creaTag(pdfDoc, PDFLib, { lang = 'it-IT', title = '', alt = {} } = {}) {
  const { PDFName, PDFString, PDFHexString, PDFNumber } = PDFLib;
  const ctx = pdfDoc.context;
  if (pdfDoc.catalog.get(PDFName.of('StructTreeRoot'))) throw new Error('Il documento ha già una struttura di tag: Leggio non la sostituisce, per non perdere il lavoro fatto. Puoi comunque impostare titolo e lingua.');
  const pages = pdfDoc.getPages();
  const analisi = [];
  for (const [pi, page] of pages.entries()) {
    try {
      const bytes = pageContentBytes(page, PDFLib);
      const { width, height } = page.getSize();
      const { segments } = analyzeOps(tokenize(bytes), xobjResolver(page, PDFLib), width * height);
      analisi.push({ pi, page, bytes, segments });
    } catch { analisi.push({ pi, page, bytes: null, segments: [], errore: true }); }
  }
  const visibili = analisi.flatMap((a) => a.segments.filter((s) => s.kind === 'text' && !s.invisible));
  const body = bodySize(visibili.length ? visibili : analisi.flatMap((a) => a.segments.filter((s) => s.kind === 'text')));
  const rootRef = ctx.nextRef();
  const docElemRef = ctx.nextRef();
  const docKids = [];
  const nums = [];
  const report = { pagine: 0, paragrafi: 0, titoli: 0, figure: 0, decorative: 0, pagineSaltate: [], senzaTesto: [] };
  const elem = (S, pageRef, kids, extra = {}) => {
    const ref = ctx.nextRef();
    const d = ctx.obj({ Type: 'StructElem', S, P: docElemRef, Pg: pageRef, K: kids.length === 1 ? kids[0] : kids, ...extra });
    ctx.assign(ref, d); docKids.push(ref); return ref;
  };
  let structParent = 0;
  for (const a of analisi) {
    if (a.errore || !a.bytes) { report.pagineSaltate.push(a.pi + 1); continue; }
    const pageRef = a.page.ref;
    const marks = []; const mcidToElem = [];
    let mcid = 0; let cur = null; // paragrafo corrente { S, ref?, mcids, y, size }
    const pending = [];
    const flush = () => { if (cur) { pending.push(cur); cur = null; } };
    const hasInvisible = a.segments.some((s) => s.kind === 'text' && s.invisible);
    let k = 0;
    for (const s of a.segments) {
      if (s.kind === 'text') {
        const S = classify(s, body);
        const id = mcid++;
        marks.push({ start: s.start, end: s.end, open: `/${S === 'P' ? 'P' : S} <</MCID ${id}>> BDC`, close: 'EMC' });
        const gapOk = cur && cur.S === S && cur.y - s.y > -0.5 * s.size && cur.y - s.y < 2.1 * Math.max(s.size, cur.size);
        if (!gapOk) { flush(); cur = { S, mcids: [], y: s.y, size: s.size }; }
        cur.mcids.push(id); cur.y = s.y; cur.size = s.size;
      } else if (s.kind === 'image' || s.kind === 'inline') {
        flush(); k++;
        const fid = `${a.pi}:${k}`;
        const testo = alt[fid];
        const decorativa = testo === '' || testo == null && (hasInvisible && s.area > 0.6 || s.w * s.h < 400);
        if (decorativa || testo == null) { marks.push({ start: s.start, end: s.end, open: '/Artifact BMC', close: 'EMC' }); report.decorative++; }
        else { const id = mcid++; marks.push({ start: s.start, end: s.end, open: `/Figure <</MCID ${id}>> BDC`, close: 'EMC' }); pending.push({ S: 'Figure', mcids: [id], alt: testo }); }
      } else if (s.kind === 'form') {
        flush(); const id = mcid++;
        marks.push({ start: s.start, end: s.end, open: `/P <</MCID ${id}>> BDC`, close: 'EMC' });
        pending.push({ S: 'P', mcids: [id] });
      } else if (s.kind === 'path') {
        marks.push({ start: s.start, end: s.end, open: '/Artifact BMC', close: 'EMC' });
      }
    }
    flush();
    if (!pending.length) report.senzaTesto.push(a.pi + 1);
    const newBytes = insertMarks(a.bytes, marks);
    const stream = ctx.flateStream(newBytes);
    a.page.node.set(PDFName.of('Contents'), ctx.register(stream));
    for (const p of pending) {
      const extra = p.alt ? { Alt: PDFHexString.fromText(p.alt) } : {};
      const ref = elem(p.S, pageRef, p.mcids.map((x) => PDFNumber.of(x)), extra);
      for (const id of p.mcids) mcidToElem[id] = ref;
      if (p.S === 'P') report.paragrafi++; else if (p.S === 'Figure') report.figure++; else report.titoli++;
    }
    a.page.node.set(PDFName.of('StructParents'), PDFNumber.of(structParent));
    a.page.node.set(PDFName.of('Tabs'), PDFName.of('S'));
    nums.push(PDFNumber.of(structParent), ctx.obj(Array.from({ length: mcid }, (_, i) => mcidToElem[i] || PDFLib.PDFNull)));
    structParent++;
    report.pagine++;
  }
  ctx.assign(docElemRef, ctx.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: docKids }));
  const parentTree = ctx.obj({ Nums: nums });
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: docElemRef, ParentTree: ctx.register(parentTree), ParentTreeNextKey: structParent }));
  pdfDoc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  impostaBase(pdfDoc, PDFLib, { lang, title });
  void PDFString;
  return report;
}

/** Titolo, lingua, MarkInfo e visualizzazione del titolo nella barra della finestra. */
export function impostaBase(pdfDoc, PDFLib, { lang, title, marked = true }) {
  const { PDFName, PDFString, PDFBool } = PDFLib;
  if (lang) pdfDoc.catalog.set(PDFName.of('Lang'), PDFString.of(String(lang).replace(/[^A-Za-z0-9-]/g, '').slice(0, 35)));
  if (title) pdfDoc.setTitle(String(title).slice(0, 500), { showInWindowTitleBar: true });
  if (marked && pdfDoc.catalog.get(PDFName.of('StructTreeRoot'))) pdfDoc.catalog.set(PDFName.of('MarkInfo'), pdfDoc.context.obj({ Marked: PDFBool.True }));
}
