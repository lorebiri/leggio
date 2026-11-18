// Parser XML minimale e sicuro (nessuna entità esterna, nessun DTD eseguito), senza DOM.
// Produce un albero { name (senza prefisso), qname, attrs, children, text }.
// Pensato per FatturaPA e daticert.xml: veloce anche con allegati base64 di molti MB.

export class XmlError extends Error {}

/** Decodifica i byte rispettando BOM e dichiarazione encoding. */
export function decodeXml(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const m = head.match(/encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/);
  let enc = m ? m[1].toLowerCase() : 'utf-8';
  // iso-8859-15 resta tale: TextDecoder lo conosce (0xA4 = €); forzarlo a iso-8859-1 lo trasformava in ¤
  if (enc === 'iso8859-1' || enc === 'latin1') enc = 'iso-8859-1';
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e] ?? m;
  });
}

const local = (q) => { const i = q.indexOf(':'); return i < 0 ? q : q.slice(i + 1); };

export function parseXml(input, { maxDepth = 200 } = {}) {
  const s = typeof input === 'string' ? input : decodeXml(input);
  const root = { name: '#document', qname: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { addText(stack, s.slice(i)); break; }
    if (lt > i) addText(stack, s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); if (e < 0) throw new XmlError('Commento non chiuso'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); if (e < 0) throw new XmlError('Sezione CDATA non chiusa'); stack[stack.length - 1].text += s.slice(lt + 9, e); i = e + 3; continue; } // CDATA: testo letterale, niente entità
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); if (e < 0) throw new XmlError('Istruzione non chiusa'); i = e + 2; continue; }
    if (s.startsWith('<!', lt)) {
      // DOCTYPE (eventualmente con sottoinsieme interno [...]): ignorato, nessuna entità definita viene espansa
      let depth = 0; let k = lt + 2;
      for (; k < n; k++) { const c = s[k]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = k + 1; continue;
    }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt);
      if (e < 0) throw new XmlError('Tag non chiuso');
      const qn = s.slice(lt + 2, e).trim();
      const top = stack.pop();
      if (!top || top === root || top.qname !== qn) throw new XmlError(`Chiusura inattesa </${qn}>`);
      i = e + 1; continue;
    }
    // tag di apertura
    let k = lt + 1; let quote = null;
    for (; k < n; k++) { const c = s[k]; if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break; }
    if (k >= n) throw new XmlError('Tag non chiuso');
    let body = s.slice(lt + 1, k);
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const m = body.match(/^([^\s/>]+)/);
    if (!m) throw new XmlError('Tag senza nome');
    const qname = m[1];
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
    const rest = body.slice(qname.length);
    while ((a = re.exec(rest))) attrs[local(a[1])] = unescapeXml(a[3] ?? a[4] ?? '');
    const el = { name: local(qname), qname, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) { stack.push(el); if (stack.length > maxDepth) throw new XmlError('Documento troppo annidato'); }
    i = k + 1;
  }
  if (stack.length > 1) throw new XmlError(`Elemento <${stack[stack.length - 1].qname}> non chiuso: il file è incompleto`);
  const docEl = root.children[0];
  if (!docEl) throw new XmlError('Documento XML vuoto');
  return docEl;
}

// le entità si sciolgono pezzo per pezzo sul testo normale (mai dentro le sezioni CDATA)
function addText(stack, t) { const top = stack[stack.length - 1]; if (top.qname !== '#document') top.text += unescapeXml(t); }

// --- interrogazione ---
/** Primo figlio diretto con quel nome locale. */
export function el(node, name) { return node?.children.find((c) => c.name === name) || null; }
/** Tutti i figli diretti con quel nome. */
export function els(node, name) { return node ? node.children.filter((c) => c.name === name) : []; }
/** Percorso "A/B/C" → nodo. */
export function at(node, path) { let x = node; for (const p of path.split('/')) { x = el(x, p); if (!x) return null; } return x; }
/** Percorso → testo pulito ('' se assente). */
export function txt(node, path) { const x = path ? at(node, path) : node; return x ? x.text.trim() : ''; }
/** Tutti i discendenti con quel nome. */
export function findAll(node, name, out = []) { for (const c of node?.children || []) { if (c.name === name) out.push(c); findAll(c, name, out); } return out; }
