// Rinomina intelligente: propone un nome di file dal contenuto (tipo di documento, soggetto, numero, date).
// Regola personalizzabile con segnaposto. Logica pura, a partire dal testo delle prime pagine.

export const REGOLA_PREDEFINITA = '{tipo}_{soggetto}_n{numero}_{data}';
export const CAMPI = ['tipo', 'soggetto', 'numero', 'data', 'scadenza', 'originale'];

const TIPI = [
  ['DURC', /\bdurc\b|documento unico di regolarit[aà] contributiva/i],
  ['NotaCredito', /\bnota di credito\b/i],
  ['Fattura', /\bfattura\b/i],
  ['Determina', /\bdetermin(a|azione)\b/i],
  ['Decreto', /\bdecreto\b/i],
  ['Contratto', /\bcontratto\b/i],
  ['Ordine', /\bordine (di acquisto|n\.?|numero)|\bbuono d['’]ordine/i],
  ['Preventivo', /\bpreventivo\b|\bofferta (economica|n\.?)/i],
  ['Verbale', /\bverbale\b/i],
  ['Ricevuta', /\bricevuta\b/i],
  ['Lettera', /\bspett\.?le\b|\begregio\b|\bgentile\b/i],
];

const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

function iso(d, m, y) {
  y = +y; if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== +d || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Tutte le date nel testo, in ordine di comparsa → [{ iso, index }] */
export function trovaDate(t) {
  const out = [];
  const re = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b|\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const v = m[1] ? iso(+m[1], +m[2], m[3]) : m[4] ? iso(+m[4], MESI[m[5].toLowerCase()], m[6]) : iso(+m[9], +m[8], m[7]);
    if (v) out.push({ iso: v, index: m.index });
  }
  return out;
}

/** Analizza il testo e restituisce i campi. */
export function analizza(testo, nomeOriginale = '') {
  const t = String(testo || '').replace(/\s+/g, ' ').slice(0, 20000);
  // il tipo è quello che compare per primo nel testo (es. una fattura che cita una nota di credito resta «Fattura»)
  let tipo = 'Documento'; let primo = Infinity;
  for (const [nome, re] of TIPI) { const m = re.exec(t); if (m && m.index < primo) { primo = m.index; tipo = nome; } }
  const date = trovaDate(t);
  let scadenza = '';
  const sc = t.match(/(scadenza(?: validit[aà])?|valido fino al|valid[oa] sino al)[^0-9]{0,25}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
  if (sc) scadenza = trovaDate(sc[2])[0]?.iso || '';
  let data = '';
  const dd = t.match(/\b(data(?: documento| fattura| emissione)?|del|emess[oa] il|in data)\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-z]+\s+\d{4})/i);
  if (dd) data = trovaDate(dd[2])[0]?.iso || '';
  if (!data) data = (date.find((d) => d.iso !== scadenza) || date[0])?.iso || '';
  let numero = '';
  const reN = /\b(?:numero|num\.|nr\.?|n\.|n°|prot\.(?:\s*n\.)?)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/gi;
  for (let nm; (nm = reN.exec(t));) { if (/\d/.test(nm[1])) { numero = nm[1].replace(/[.\-/]+$/, ''); break; } }
  let soggetto = '';
  const soc = t.match(/([A-Z][A-Za-zÀ-ÿ0-9&'.\- ]{2,60}?)\s*(S\.?\s?r\.?\s?l\.?s?|S\.?\s?p\.?\s?A\.?|S\.?\s?n\.?\s?c\.?|S\.?\s?a\.?\s?s\.?|Soc\.? coop\.?|società cooperativa)(?![A-Za-z])/i);
  if (soc) soggetto = soc[1].trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).slice(-3).join(' ');
  if (!soggetto) { const r = t.match(/(?:ragione sociale|denominazione|spett\.?le|fornitore|ditta)\s*:?\s*([A-Z][A-Za-zÀ-ÿ&'.\- ]{2,40})/i); if (r) soggetto = r[1].trim().split(/\s+/).slice(0, 3).join(' '); }
  return { tipo, soggetto, numero, data, scadenza, originale: String(nomeOriginale).replace(/\.pdf$/i, '') };
}

const pulisci = (s) => String(s || '').replace(/[/\\]+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

/** Applica la regola. Segmenti con campi vuoti spariscono (es. «_n{numero}» senza numero). */
export function proponiNome(campi, regola = REGOLA_PREDEFINITA) {
  const c = { ...campi };
  if (c.tipo === 'DURC' && c.scadenza && regola === REGOLA_PREDEFINITA) regola = '{tipo}_{soggetto}_scad{scadenza}';
  const parti = String(regola).split('_').map((seg) => {
    let vuoto = false;
    const v = seg.replace(/\{(\w+)\}/g, (_, k) => { const x = pulisci(c[k]); if (!x) vuoto = true; return x; });
    return vuoto ? '' : v;
  }).filter(Boolean);
  let nome = parti.join('_').slice(0, 150) || pulisci(c.originale) || 'documento';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(nome)) nome = '_' + nome;
  return nome + '.pdf';
}
