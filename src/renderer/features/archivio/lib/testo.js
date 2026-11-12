// Testo per la ricerca: normalizzazione «uno a uno» (stessa lunghezza dell'originale, così le
// posizioni trovate nel testo normalizzato valgono anche nell'originale per gli estratti),
// interpretazione della frase cercata ed estratti con contesto. Logica pura.

const cache = new Map();
/** Minuscole, senza accenti, spazi uniformi. La lunghezza resta identica all'originale. */
export function normalizza(s) {
  s = String(s ?? '');
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let r = null;
    if (c < 128) {
      if (c >= 65 && c <= 90) r = String.fromCharCode(c + 32);
      else if (c === 9 || c === 10 || c === 13 || c === 12 || c === 11) r = ' ';
      else continue;
    } else {
      r = cache.get(c);
      if (r === undefined) {
        const ch = String.fromCharCode(c);
        if (/\s/.test(ch)) r = ' ';
        else if (c >= 0xd800 && c <= 0xdfff) r = ch; // metà di coppia surrogata: invariata
        else {
          const d = ch.normalize('NFD').charAt(0).toLowerCase();
          r = d.length === 1 ? d : ch;
          if (r === ch) r = ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
        }
        cache.set(c, r);
      }
      if (r === String.fromCharCode(c)) continue;
    }
    out += s.slice(start, i) + r;
    start = i + 1;
  }
  return start === 0 ? s : out + s.slice(start);
}

/**
 * Interpreta la frase cercata: parole (tutte devono esserci) e "frasi tra virgolette".
 * → [{ t: testo normalizzato }]
 */
export function interpretaRicerca(q) {
  const out = [];
  const s = String(q || '').trim();
  const re = /"([^"]+)"|«([^»]+)»|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = (m[1] || m[2] || m[3] || '').trim();
    const t = normalizza(raw).replace(/\s+/g, ' ').trim();
    if (t) out.push({ t });
  }
  // le parole contenute in altre più lunghe sono inutili («fatt» e «fattura»)
  return out.filter((x, i) => !out.some((y, j) => j !== i && y.t.length > x.t.length && y.t.includes(x.t)));
}

/** Pagina (1-based) che contiene la posizione pos in un testo con le pagine separate da \f. */
export function paginaDi(testo, pos) {
  let p = 1;
  for (let i = testo.indexOf('\f'); i >= 0 && i < pos; i = testo.indexOf('\f', i + 1)) p++;
  return p;
}

/** Estratto con il contesto intorno alla posizione [start, end). */
export function estratto(testo, start, end, ctx = 60) {
  const a = Math.max(0, start - ctx); const b = Math.min(testo.length, end + ctx);
  const pulisci = (x) => x.replace(/[\s\f]+/g, ' ');
  return {
    prima: (a > 0 ? '…' : '') + pulisci(testo.slice(a, start)).trimStart(),
    trovato: pulisci(testo.slice(start, end)),
    dopo: pulisci(testo.slice(end, b)).trimEnd() + (b < testo.length ? '…' : ''),
  };
}

/** Numero all'italiana: «1.234,56» o «1234.56» → 1234.56 (o null). */
export function numeroIt(s) {
  let t = String(s ?? '').replace(/[€\s]|eur(o)?/gi, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(/,/g, '');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Importo in euro all'italiana: 1234.5 → «1.234,50 €». */
export function euro(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
}

/** Data ISO → gg/mm/aaaa */
export function dataIt(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** gg/mm/aaaa (o g.m.aa, aaaa-mm-gg) → ISO, o '' */
export function dataDaTesto(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoValida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return isoValida(y, +m[2], +m[1]); }
  return '';
}
function isoValida(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Giorni tra due date ISO (b - a). */
export function giorniTra(a, b) {
  const da = Date.parse(a + 'T00:00:00Z'); const db = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}
export function aggiungiGiorni(iso, n) {
  const d = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(d)) return '';
  return new Date(d + n * 86400000).toISOString().slice(0, 10);
}
/** Data di oggi (locale) in ISO. */
export function oggiIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
