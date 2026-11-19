// Lettura di file vCard (.vcf) 2.1, 3.0 e 4.0 → contatti della rubrica. Logica pura, senza DOM.
// Gestisce più schede nello stesso file, righe piegate, QUOTED-PRINTABLE (con le righe spezzate da «=»),
// CHARSET per proprietà, gruppi «item1.EMAIL», valori con escape (\n \, \; \\) e i tipi PEC.

const MAX_FILE = 20 * 1024 * 1024;
const SEMBRA_PEC = /@([a-z0-9.-]*\.)?(pec|legalmail|postacert|arubapec|cert|sicurezzapostale|gigapec|mypec|ticertifica|casellapec)[a-z0-9.-]*\.[a-z]{2,}$/i;

/** Byte o testo → stringa «binaria» (un carattere per byte), per poter decodificare per proprietà. */
function binario(input) {
  if (typeof input === 'string') input = new TextEncoder().encode(input);
  if (!(input instanceof Uint8Array)) throw new Error('File vCard non leggibile.');
  if (input.length > MAX_FILE) throw new Error('Il file vCard è troppo grande (oltre 20 MB).');
  // UTF-16 (alcuni telefoni e Outlook): si converte in UTF-8
  if ((input[0] === 0xff && input[1] === 0xfe) || (input[0] === 0xfe && input[1] === 0xff)) {
    input = new TextEncoder().encode(new TextDecoder(input[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(input));
  }
  let s = '';
  for (let i = 0; i < input.length; i += 0x8000) s += String.fromCharCode.apply(null, input.subarray(i, i + 0x8000));
  return s.replace(/^\xef\xbb\xbf/, '');
}
const byteDi = (bin) => { const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i) & 0xff; return u; };
function decodifica(bin, charset) {
  const bytes = byteDi(bin);
  const cs = String(charset || '').toLowerCase();
  if (cs && !/^utf-?8$/.test(cs)) {
    try { return new TextDecoder(cs === 'iso-8859-1' || cs === 'latin1' ? 'windows-1252' : cs).decode(bytes); } catch { /* charset sconosciuto */ }
  }
  const s = new TextDecoder('utf-8').decode(bytes);
  if (s.includes('�')) { try { return new TextDecoder('windows-1252').decode(bytes); } catch { /* */ } }
  return s;
}
function quotedPrintable(bin) {
  return bin.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Divide su un separatore non preceduto da «\». */
function dividi(s, sep) {
  const out = []; let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
    if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
const togliEscape = (s) => s.replace(/\\([nN,;:\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** Righe logiche (piegature e QP spezzato ricomposti). → [{ nome, params:{TYPE:[..],…}, valore (binario) }] */
function proprieta(bin) {
  const righe = bin.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i < righe.length; i++) {
    let r = righe[i];
    // piegatura: riga che inizia con spazio o tabulazione
    while (i + 1 < righe.length && /^[ \t]/.test(righe[i + 1])) { r += righe[i + 1].slice(1); i++; }
    if (!r.trim()) continue;
    // valore QUOTED-PRINTABLE con «=» finale: continua nella riga dopo
    if (/QUOTED-PRINTABLE/i.test(r.split(':')[0])) {
      while (/=$/.test(r) && i + 1 < righe.length) { r = r.slice(0, -1) + righe[i + 1].replace(/^[ \t]/, ''); i++; }
    }
    // separa nome;parametri da valore (primo «:» fuori dalle virgolette)
    let q = false; let k = -1;
    for (let j = 0; j < r.length; j++) { if (r[j] === '"') q = !q; else if (r[j] === ':' && !q) { k = j; break; } }
    if (k < 0) continue;
    const testa = r.slice(0, k); const valore = r.slice(k + 1);
    const parti = dividi(testa, ';');
    const nome = parti.shift().replace(/^[^.]*\./, '').trim().toUpperCase();
    const params = {};
    for (const p of parti) {
      const [chiave, ...resto] = p.split('=');
      if (!resto.length) { // 2.1: TYPE senza nome (WORK;VOICE;PREF;QUOTED-PRINTABLE)
        const v = chiave.trim().toUpperCase();
        if (v === 'QUOTED-PRINTABLE' || v === 'BASE64' || v === 'B' || v === '8BIT') params.ENCODING = [v];
        else (params.TYPE ||= []).push(v);
        continue;
      }
      const ch = chiave.trim().toUpperCase();
      const vals = resto.join('=').replace(/^"|"$/g, '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      (params[ch] ||= []).push(...vals);
    }
    out.push({ nome, params, valore });
  }
  return out;
}

function valoreDi(p) {
  const enc = (p.params.ENCODING || [])[0] || '';
  if (enc === 'BASE64' || enc === 'B') return null; // foto e allegati: non servono
  let bin = p.valore;
  if (enc === 'QUOTED-PRINTABLE') bin = quotedPrintable(bin);
  return decodifica(bin, (p.params.CHARSET || [])[0]);
}
const ha = (p, t) => (p.params.TYPE || []).includes(t) || (t === 'PREF' && !!p.params.PREF);

/** Data vCard (19851210, 1985-12-10, --1210, 1985-12-10T00:00:00Z) → gg/mm/aaaa (o gg/mm senza anno). */
export function dataVcard(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = /^--(\d{2})-?(\d{2})$/.exec(s);
  if (m) return `${m[2]}/${m[1]}`;
  return s;
}

function schedaAContatto(props) {
  const c = { gruppi: [] };
  const emails = []; const tel = []; const note = [];
  let adr = null; let fn = '';
  const unisci = (k, v) => { v = String(v || '').trim(); if (v) c[k] = c[k] ? `${c[k]} ${v}` : v; };
  for (const p of props) {
    const val = valoreDi(p);
    if (val == null) continue;
    switch (p.nome) {
      case 'N': {
        const [cognome = '', nome = '', altri = ''] = dividi(val, ';').map((x) => togliEscape(x).trim());
        if (cognome) c.cognome = cognome;
        if (nome || altri) c.nome = [nome, altri].filter(Boolean).join(' ');
        break;
      }
      case 'FN': fn = togliEscape(val).trim(); break;
      case 'ORG': c.ragioneSociale = dividi(val, ';').map((x) => togliEscape(x).trim()).filter(Boolean).join(' - '); break;
      case 'TITLE': case 'ROLE': if (!c.ruolo) unisci('ruolo', togliEscape(val)); break;
      case 'EMAIL': {
        const e = togliEscape(val).trim().replace(/^mailto:/i, '');
        if (e) emails.push({ e, pec: ha(p, 'PEC') || (p.params['X-TYPE'] || []).includes('PEC') || SEMBRA_PEC.test(e), pref: ha(p, 'PREF') });
        break;
      }
      case 'TEL': {
        const t = togliEscape(val).trim().replace(/^tel:/i, '');
        if (t) tel.push({ t, pref: ha(p, 'PREF') });
        break;
      }
      case 'ADR': {
        if (adr && !ha(p, 'PREF')) break;
        const [, est = '', via = '', citta = '', regione = '', cap = '', paese = ''] = dividi(val, ';').map((x) => togliEscape(x).replace(/\s*\n\s*/g, ', ').trim());
        adr = { indirizzo: [via, est].filter(Boolean).join(', '), citta, provincia: regione, cap, nazione: paese };
        break;
      }
      case 'NOTE': { const n = togliEscape(val).trim(); if (n) note.push(n); break; }
      case 'BDAY': c.dataNascita = dataVcard(togliEscape(val)); break;
      case 'CATEGORIES': c.gruppi.push(...dividi(val, ',').map((x) => togliEscape(x).trim()).filter(Boolean)); break;
      case 'X-CODICEFISCALE': case 'X-CODICE-FISCALE': case 'X-CF': c.codiceFiscale = togliEscape(val).trim(); break;
      case 'X-PARTITAIVA': case 'X-PARTITA-IVA': case 'X-VAT': c.partitaIva = togliEscape(val).trim(); break;
      default: break;
    }
  }
  if (!c.nome && !c.cognome && fn && fn !== c.ragioneSociale) c.nome = fn;
  // email: la PEC (dichiarata o riconosciuta dal dominio) nel suo campo, la preferita in «email», le altre nelle note
  const pec = emails.find((x) => x.pec);
  if (pec) c.pec = pec.e;
  const normali = emails.filter((x) => x !== pec).sort((a, b) => b.pref - a.pref);
  if (normali.length) c.email = normali[0].e;
  if (normali.length > 1) note.push('Altre email: ' + normali.slice(1).map((x) => x.e).join(', '));
  if (tel.length) c.telefono = tel.sort((a, b) => b.pref - a.pref).map((x) => x.t).filter((t, i, a) => a.indexOf(t) === i).join(' / ');
  if (adr) {
    for (const [k, v] of Object.entries(adr)) if (v) c[k] = v;
    if (c.provincia && !/^[A-Za-z]{2}$/.test(c.provincia) && !c.citta) { c.citta = c.provincia; delete c.provincia; }
    if (/^(it|ita|italy|italia)$/i.test(c.nazione || '')) delete c.nazione;
  }
  if (note.length) c.note = note.join('\n');
  c.gruppi = [...new Set(c.gruppi)];
  return c;
}

/**
 * Legge un file vCard (byte o testo). → { contatti: object[], schede: number, scartate: number }
 * Le schede senza alcun dato utile vengono scartate.
 */
export function leggiVcard(input) {
  const bin = binario(input);
  if (!/BEGIN:VCARD/i.test(bin)) throw new Error('Il file non contiene schede vCard (manca «BEGIN:VCARD»).');
  const props = proprieta(bin);
  const contatti = []; let schede = 0; let scartate = 0; let cur = null;
  for (const p of props) {
    if (p.nome === 'BEGIN' && /^VCARD$/i.test(p.valore.trim())) { cur = []; continue; }
    if (p.nome === 'END' && /^VCARD$/i.test(p.valore.trim())) {
      if (cur) {
        schede++;
        const c = schedaAContatto(cur);
        if (['nome', 'cognome', 'ragioneSociale', 'email', 'pec', 'telefono'].some((k) => c[k])) contatti.push(c); else scartate++;
      }
      cur = null; continue;
    }
    if (cur) cur.push(p);
  }
  return { contatti, schede, scartate };
}
