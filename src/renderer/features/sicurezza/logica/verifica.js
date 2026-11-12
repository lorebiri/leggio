// Verifica dell'oscuramento: riapre il PDF prodotto con pdf.js e controlla che
//  1) nelle aree oscurate non ci sia più testo estraibile;
//  2) i termini oscurati non compaiano più in nessun punto (testo, commenti, campi, segnalibri, metadati).
// Funziona sia nel browser sia in node (pdfjs-dist/legacy). Logica senza DOM.
import { itemGeometry, spanRect, intersects } from './testo.js';

const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const shrink = (r, m) => [r[0] + m, r[1] + m, r[2] - m, r[3] - m];

/**
 * pdfjs: modulo pdf.js. bytes: PDF prodotto. marks: Map(pageIndex → [rect PDF]). terms: testi da cercare ovunque.
 * opts: { password, signal, onProgress(frac), getDocumentOptions }
 * → { ok, problems: [{ page (1-based) | null, where, text }] }
 */
export async function verifyRedaction(pdfjs, bytes, marks, terms = [], { password, signal, onProgress, getDocumentOptions = {} } = {}) {
  const problems = [];
  const wanted = [...new Set(terms.map(norm).filter((t) => t.length >= 3))];
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, ...getDocumentOptions });
  const doc = await task.promise;
  try {
    const found = (text, where, page) => {
      if (!wanted.length || !text) return;
      const n = norm(text);
      for (const t of wanted) if (n.includes(t)) problems.push({ page, where, text: t });
    };
    for (let i = 0; i < doc.numPages; i++) {
      if (signal?.aborted) throw new DOMException('Verifica annullata', 'AbortError');
      const page = await doc.getPage(i + 1);
      const rects = (marks.get(i) || []).map((r) => shrink(r, 0.75));
      const tc = await page.getTextContent();
      if (rects.length) {
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const g = itemGeometry(it);
          const r = spanRect(g, 0, g.width);
          // restringe verticalmente: le righe adiacenti non devono dare falsi allarmi
          const rr = [r[0], r[1] + g.size * 0.3, r[2], r[3] - g.size * 0.3];
          if (rects.some((m) => intersects(rr, m))) problems.push({ page: i + 1, where: 'testo nell\'area oscurata', text: it.str });
        }
      }
      if (wanted.length) {
        found(tc.items.map((x) => x.str || '').join(''), 'testo della pagina', i + 1);
        const annots = await page.getAnnotations();
        for (const a of annots) {
          found([a.contentsObj?.str, a.titleObj?.str, a.fieldValue, a.alternativeText, a.url, a.richText?.str].filter((x) => typeof x === 'string').join(' '), 'commenti o campi', i + 1);
        }
      }
      page.cleanup();
      onProgress?.((i + 1) / doc.numPages);
    }
    if (wanted.length) {
      const meta = await doc.getMetadata().catch(() => null);
      if (meta) {
        found(Object.values(meta.info || {}).filter((x) => typeof x === 'string').join(' '), 'proprietà del documento', null);
        try { found(meta.metadata ? JSON.stringify([...meta.metadata]) : '', 'metadati XMP', null); } catch { /* */ }
      }
      const outline = await doc.getOutline().catch(() => null);
      const titles = [];
      const walk = (items) => { for (const o of items || []) { titles.push(o.title); walk(o.items); } };
      walk(outline);
      found(titles.join(' '), 'segnalibri', null);
      const att = await doc.getAttachments().catch(() => null);
      if (att) found((att instanceof Map ? [...att.keys()] : Object.keys(att)).join(' '), 'nomi degli allegati', null);
    }
  } finally { await task.destroy(); }
  // un problema per (pagina, luogo, testo)
  const seen = new Set();
  const unique = problems.filter((p) => { const k = `${p.page}|${p.where}|${p.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: unique.length === 0, problems: unique };
}
