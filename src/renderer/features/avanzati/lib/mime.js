// Messaggi di posta (.eml) e PEC: lettore MIME minimale e lettura di daticert.xml. Logica pura, senza rete.
import { base64ToBytes } from './cades.js';
import { parseXml, txt, el, els } from './xml.js';

const latin1 = new TextDecoder('latin1');
export const MAX_EML = 200 * 1024 * 1024;

function findHeaderEnd(b, from) {
  for (let i = from; i < b.length - 1; i++) {
    if (b[i] === 10 && b[i + 1] === 10) return { end: i, body: i + 2 };
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return { end: i, body: i + 4 };
  }
  return { end: b.length, body: b.length };
}

export function parseHeaders(text) {
  const out = {};
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (!(k in out)) out[k] = v; else out[k] += ', ' + v;
  }
  return out;
}

/** Decodifica le parole codificate RFC 2047 (=?utf-8?B?...?= / Q). */
export function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs, enc, data) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') bytes = base64ToBytes(data);
      else { const t = data.replace(/_/g, ' '); bytes = qpBytes(t); }
      return new TextDecoder(normCharset(cs)).decode(bytes);
    } catch { return data; }
  });
}
function normCharset(cs) { const c = String(cs || 'utf-8').toLowerCase().replace(/^"|"$/g, ''); return c === 'utf8' ? 'utf-8' : c; }
function qpBytes(t) {
  const out = []; for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else if (c === '=' && (t[i + 1] === '\n' || t[i + 1] === '\r')) { i += t[i + 1] === '\r' && t[i + 2] === '\n' ? 2 : 1; }
    else out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** Valore principale e parametri di un'intestazione (Content-Type, Content-Disposition), con RFC 2231. */
export function headerParams(v) {
  const parts = String(v || '').split(';');
  const value = parts.shift().trim().toLowerCase();
  const params = {}; const cont = {};
  for (const p of parts) {
    const i = p.indexOf('='); if (i < 0) continue;
    let k = p.slice(0, i).trim().toLowerCase(); let val = p.slice(i + 1).trim().replace(/^"|"$/g, '');
    const m = k.match(/^([^*]+)\*(\d+)?(\*)?$/);
    if (m) {
      if (m[3] || (!m[2] && k.endsWith('*'))) { const q = val.match(/^([^']*)'[^']*'(.*)$/); try { val = q ? new TextDecoder(normCharset(q[1] || 'utf-8')).decode(qpBytes(q[2].replace(/%([0-9A-Fa-f]{2})/g, '=$1'))) : decodeURIComponent(val); } catch {} }
      if (m[2] != null) { (cont[m[1]] ||= [])[+m[2]] = val; continue; }
      k = m[1];
    }
    params[k] = decodeWords(val);
  }
  for (const [k, arr] of Object.entries(cont)) params[k] = arr.join('');
  return { value, params };
}

/**
 * Analizza un messaggio. → { headers, contentType, params, filename, disposition, body: Uint8Array (decodificato), parts: [], message (se message/rfc822) }
 */
export function parseMime(b, { depth = 0 } = {}) {
  if (depth > 12) throw new Error('Messaggio annidato troppe volte.');
  const { end, body } = findHeaderEnd(b, 0);
  const headers = parseHeaders(latin1.decode(b.subarray(0, end)));
  const ct = headerParams(headers['content-type'] || 'text/plain; charset=us-ascii');
  const cd = headerParams(headers['content-disposition'] || '');
  const enc = String(headers['content-transfer-encoding'] || '7bit').toLowerCase().trim();
  const raw = b.subarray(body);
  const node = { headers, contentType: ct.value, params: ct.params, disposition: cd.value, filename: cd.params.filename || ct.params.name || '', parts: [], body: null, message: null };
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const delim = '--' + ct.params.boundary;
    const text = latin1.decode(raw);
    let pos = text.indexOf(delim);
    while (pos >= 0) {
      let start = pos + delim.length;
      if (text.startsWith('--', start)) break;
      if (text[start] === '\r') start++; if (text[start] === '\n') start++;
      let next = text.indexOf('\n' + delim, start);
      if (next < 0) next = text.length;
      let stop = next; if (text[stop - 1] === '\r') stop--;
      if (node.parts.length < 500) node.parts.push(parseMime(raw.subarray(start, Math.max(start, stop)), { depth: depth + 1 }));
      pos = next < text.length ? next + 1 : -1;
    }
    return node;
  }
  let data;
  if (enc === 'base64') { try { data = base64ToBytes(latin1.decode(raw)); } catch { data = raw; } }
  else if (enc === 'quoted-printable') data = qpBytes(latin1.decode(raw));
  else data = raw;
  node.body = data;
  if (ct.value === 'message/rfc822') node.message = parseMime(data, { depth: depth + 1 });
  return node;
}

/** Testo di una parte. */
export function partText(p) {
  if (!p?.body) return '';
  try { return new TextDecoder(normCharset(p.params.charset)).decode(p.body); } catch { return latin1.decode(p.body); }
}

/** Corpo leggibile del messaggio: text/plain, altrimenti text/html ripulito. */
export function bodyText(node) {
  const plain = []; const html = [];
  const walk = (n) => {
    if (n.disposition === 'attachment') return;
    if (n.parts.length) { n.parts.forEach(walk); return; }
    if (n.contentType === 'text/plain' && !n.filename) plain.push(partText(n));
    else if (n.contentType === 'text/html' && !n.filename) html.push(partText(n));
  };
  walk(node);
  if (plain.length) return plain.join('\n\n').trim();
  return html.join('\n').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

/** Allegati (anche dentro i messaggi inoltrati). → [{ name, contentType, bytes, nested (bool) }] */
export function attachments(node, out = [], nested = false) {
  for (const p of node.parts) {
    if (p.parts.length) { attachments(p, out, nested); continue; }
    if (p.contentType === 'message/rfc822') { out.push({ name: p.filename || 'messaggio.eml', contentType: p.contentType, bytes: p.body, nested }); continue; }
    if (p.filename || p.disposition === 'attachment' || /^application\/(pkcs7-signature|x-pkcs7-signature)/.test(p.contentType)) out.push({ name: decodeWords(p.filename) || 'allegato', contentType: p.contentType, bytes: p.body, nested });
  }
  return out;
}

export function summary(node) {
  const h = node.headers;
  return { da: decodeWords(h.from || ''), a: decodeWords(h.to || ''), cc: decodeWords(h.cc || ''), oggetto: decodeWords(h.subject || ''), data: h.date || '', id: h['message-id'] || '' };
}

export const TIPI_PEC = {
  'posta-certificata': 'Messaggio di posta certificata', accettazione: 'Ricevuta di accettazione', 'non-accettazione': 'Avviso di NON accettazione',
  'presa-in-carico': 'Ricevuta di presa in carico', 'avvenuta-consegna': 'Ricevuta di avvenuta consegna', 'posta-certificata-previa-consegna': 'Ricevuta di avvenuta consegna',
  'errore-consegna': 'Avviso di mancata consegna', 'preavviso-errore-consegna': 'Preavviso di mancata consegna', 'rilevazione-virus': 'Rilevazione di virus',
};

/** Legge daticert.xml. */
export function parseDaticert(bytes) {
  const r = parseXml(bytes);
  const int = el(r, 'intestazione'); const dati = el(r, 'dati');
  const dataEl = el(dati, 'data');
  return {
    tipo: r.attrs.tipo || '', tipoLabel: TIPI_PEC[r.attrs.tipo] || r.attrs.tipo || 'Ricevuta PEC', errore: r.attrs.errore || 'nessuno',
    mittente: txt(int, 'mittente'), destinatari: els(int, 'destinatari').map((d) => `${d.text.trim()}${d.attrs.tipo ? ` (${d.attrs.tipo === 'certificato' ? 'PEC' : 'posta ordinaria'})` : ''}`),
    oggetto: txt(int, 'oggetto'), rispondiA: txt(int, 'risposte'),
    gestore: txt(dati, 'gestore-emittente'), data: dataEl ? `${txt(dataEl, 'giorno')} ${txt(dataEl, 'ora')}${dataEl.attrs.zona ? ' (' + dataEl.attrs.zona + ')' : ''}` : '',
    identificativo: txt(dati, 'identificativo'), msgid: txt(dati, 'msgid'), ricevuta: el(dati, 'ricevuta')?.attrs.tipo || '', consegna: txt(dati, 'consegna'), erroreEsteso: txt(dati, 'errore-esteso'),
  };
}
