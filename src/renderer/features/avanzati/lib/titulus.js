// Titulus (protocollo informatico del CNR): Leggio NON assegna numeri di protocollo.
// Qui: (1) riconoscimento della segnatura stampata sui PDF protocollati, con modelli configurabili (il formato
// esatto dell'AOO va verificato: i modelli predefiniti sono generici); (2) controlli dei file prima del
// caricamento in Titulus. Logica pura.

/**
 * Modelli predefiniti (espressioni regolari con gruppi nominati: numero e data obbligatori; aoo, anno facoltativi).
 * Il testo viene prima normalizzato (spazi e a capo → uno spazio), così la segnatura spezzata su due righe è trovata.
 */
const P = String.raw`[Pp][Rr][Oo][Tt](?:[Oo][Cc][Oo][Ll][Ll][Oo])?\.?`;
const N = String.raw`(?:[Nn]umero|[Nn]um\.|[Nn][Rr]\.?|[Nn]°|[Nn]\.?)`;
const AOO = String.raw`(?<aoo>[A-Z][A-Z0-9_]{1,24}(?:[ \-][A-Z][A-Z0-9_]{1,24}){0,2})`;
const DATA = String.raw`(?<data>\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2}))`;
export const MODELLI_PREDEFINITI = [
  // formato reale di Titulus (CNR): «Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001» (AOO dopo «Prot.», UOR facoltativa)
  String.raw`\b${P}\s*(?<aoo>[A-Z][A-Z0-9_\-]{1,24})\s*${N}\s*[:.]?\s*(?<numero>\d{1,10})\s*(?:[Dd]el|[-–—,])\s*${DATA}(?:\s*[-–—,]?\s*U\.?\s?O\.?\s?R\.?\s*[:.]?\s*(?<uor>[A-Z0-9]{2,20}))?`,
  // [AOO] Prot. n. 0012345 del 12/11/2026 · Protocollo n° 12345/2026 del 12.11.2026 · PROT. 0004567 - 12/11/2026
  String.raw`(?:${AOO}\s*[-–—:|,]?\s*)?\b${P}\s*(?:${N})?\s*[:.]?\s*0*(?<numero>\d{1,10})(?:\s*\/\s*(?<anno>\d{4}))?\s*(?:[-–—,]|[Dd]el|dd\.?|in data|[Dd]ata)?\s*[:.]?\s*${DATA}`,
  // data prima del numero: 12/11/2026 - Prot. n. 0012345
  String.raw`${DATA}\s*[-–—,]?\s*(?:${AOO}\s*[-–—:|,]?\s*)?\b${P}\s*(?:${N})?\s*[:.]?\s*0*(?<numero>\d{1,10})`,
];

const CLASSIFICA = /(?:Class(?:ifica(?:zione)?)?\.?|Tit(?:olo)?\.?)\s*[:.]?\s*(?<classifica>[IVXLC]+(?:\s*[.\/-]?\s*(?:Cl(?:asse)?\.?\s*)?\d+){0,3}|\d+(?:[.\/]\d+){0,3})/i;
const FASCICOLO = /Fasc(?:icolo)?\.?\s*(?:n\.?|n°)?\s*[:.]?\s*(?<fascicolo>[0-9A-Z][0-9A-Z.\/\-]{0,30})/i;

/** Compila i modelli (stringhe, sensibili a maiuscole/minuscole) → RegExp. Lancia un errore leggibile se un modello non è valido. */
export function compilaModelli(modelli = MODELLI_PREDEFINITI) {
  return (Array.isArray(modelli) ? modelli : String(modelli).split(/\r?\n/)).map((m) => String(m).trim()).filter(Boolean).map((m, i) => {
    let re;
    try { re = new RegExp(m, 'g'); } catch (e) { throw new Error(`Il modello ${i + 1} non è valido: ${e.message}`); }
    if (!/\(\?<numero>/.test(m) || !/\(\?<data>/.test(m)) throw new Error(`Il modello ${i + 1} deve contenere i gruppi (?<numero>…) e (?<data>…).`);
    return re;
  });
}

function dataIso(s, annoFallback) {
  const m = String(s || '').match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  const d = +m[1]; const mo = +m[2];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  void annoFallback;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Tutte le segnature trovate nel testo. → [{ aoo, numero (com'è scritto, con gli zeri), numeroIntero, anno, data (ISO),
 *   dataTesto, uor, classifica, fascicolo, testo, origine: 'testo'|'immagine' }]   (numeroOriginale = numero, per compatibilità)
 */
export function segnatureTitulus(testo, { modelli, origine = 'testo', mascheraUor = '' } = {}) {
  const t = String(testo || '').replace(/[ \s]+/g, ' ').slice(0, 2_000_000);
  const res = []; const visti = new Set();
  for (const re of compilaModelli(modelli || MODELLI_PREDEFINITI)) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(t));) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const g = m.groups || {};
      const data = dataIso(g.data);
      if (!data || !g.numero) continue;
      const numeroIntero = parseInt(g.numero, 10);
      const key = numeroIntero + '|' + data;
      if (visti.has(key)) continue;
      visti.add(key);
      const dopo = t.slice(m.index + m[0].length, m.index + m[0].length + 160);
      // il numero com'è scritto (con gli zeri iniziali): il modello generico li consuma, li recuperiamo dal testo trovato
      const numero = (m[0].match(/\d+/g) || []).find((x) => /^\d+$/.test(x) && parseInt(x, 10) === numeroIntero && x.length >= String(g.numero).length) || String(g.numero);
      res.push({
        aoo: g.aoo ? g.aoo.trim() : '', numero, numeroIntero, numeroOriginale: numero, anno: g.anno || data.slice(0, 4), uor: origine === 'immagine' ? correggiSecondoMaschera(g.uor || '', mascheraUor) : (g.uor || ''), origine,
        data, dataTesto: g.data, classifica: dopo.match(CLASSIFICA)?.groups?.classifica?.trim() || '', fascicolo: dopo.match(FASCICOLO)?.groups?.fascicolo || '',
        testo: m[0].trim(), indice: m.index,
      });
    }
  }
  return res.sort((a, b) => a.indice - b.indice).map(({ indice, ...r }) => r);
}

/** La prima segnatura del testo (di solito in testa alla prima pagina), o null. */
export function segnaturaTitulus(testo, opts) { return segnatureTitulus(testo, opts)[0] || null; }

// ---------------- segnatura come immagine (striscia verticale sul margine) ----------------

/**
 * Tra le immagini disegnate su una pagina, quelle che sembrano la striscia della segnatura: molto strette e alte
 * (rapporto ≥ 8:1, in un verso o nell'altro) e vicine a un bordo (entro ~15 mm).
 * immagini: [{ transform: [a,b,c,d,e,f] }] (l'immagine occupa il quadrato unitario trasformato), pagina: { x, y, w, h }
 * → [{ rect: [x1,y1,x2,y2], verticale, lato }] ordinate dalla più vicina al bordo sinistro.
 */
export function trovaStrisce(immagini, pagina, { rapportoMin = 8, distanzaMax = 15 / 25.4 * 72 } = {}) {
  const out = [];
  for (const im of immagini || []) {
    const [a, b, c, d, e, f] = im.transform || [];
    if (![a, b, c, d, e, f].every(Number.isFinite)) continue;
    const xs = [e, e + a, e + c, e + a + c]; const ys = [f, f + b, f + d, f + b + d];
    const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const w = r[2] - r[0]; const h = r[3] - r[1];
    if (w <= 0 || h <= 0) continue;
    const verticale = h / w >= rapportoMin; const orizzontale = w / h >= rapportoMin;
    if (!verticale && !orizzontale) continue;
    const dist = { sinistra: r[0] - pagina.x, destra: pagina.x + pagina.w - r[2], basso: r[1] - pagina.y, alto: pagina.y + pagina.h - r[3] };
    const lato = verticale ? (dist.sinistra <= dist.destra ? 'sinistra' : 'destra') : (dist.basso <= dist.alto ? 'basso' : 'alto');
    if (dist[lato] > distanzaMax) continue;
    out.push({ rect: r, verticale, lato, distanza: dist[lato] });
  }
  return out.sort((x, y) => (x.lato !== 'sinistra') - (y.lato !== 'sinistra') || x.distanza - y.distanza);
}

/**
 * Corregge le confusioni tipiche dell'OCR (1/I, 0/O, 5/S, 8/B, 2/Z) secondo una maschera: «A» = lettera, «9» = cifra,
 * altri caratteri = uguali. Es. maschera «AA999999»: «S1000002» → «XX000001». Se la lunghezza non torna, il valore resta com'è.
 */
export const MASCHERA_UOR_PREDEFINITA = 'AA999999'; // da un solo esempio reale: da verificare con l'ufficio protocollo
export function correggiSecondoMaschera(valore, maschera) {
  const v = String(valore || ''); const m = String(maschera || '');
  if (!m || v.length !== m.length) return v;
  const aLettera = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' }; const aCifra = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
  return [...v].map((c, i) => (m[i] === 'A' && /\d/.test(c) ? aLettera[c] || c : m[i] === '9' && /[A-Z]/i.test(c) ? aCifra[c.toUpperCase()] || c : c)).join('');
}

/** Correzioni tipiche dell'OCR su una riga di segnatura (O→0 nei numeri, «Prot» letto male…). */
export function ripulisciOcr(t) {
  return String(t || '').replace(/[|]/g, 'l')
    .replace(/(?<=\d)[Oo](?=\d)/g, '0').replace(/(?<=\d)[Il](?=\d)/g, '1')
    .replace(/\bPr[o0]t\b/gi, 'Prot').replace(/\bn\s*[.,:]/g, 'n.').replace(/\s+/g, ' ').trim();
}

// ---------------- «Prepara per Titulus» ----------------

export const SOGLIA_MB_PREDEFINITA = 30;

/** Il nome del file è chiaro? → { ok, motivi, proposta } (proposta solo se serve). */
export function valutaNome(nome) {
  const n = String(nome || '');
  const base = n.replace(/(\.pdf)?(\.p7m)*$/i, '');
  const motivi = [];
  if (/^(scan|scansione|img|image|doc|document|documento|file|senza titolo|untitled|nuovo documento|stampa)[\s_\-]*\d*$/i.test(base) || /^\d+$/.test(base)) motivi.push('il nome non descrive il documento');
  if (/[^A-Za-z0-9À-ÿ _.\-()]/.test(base)) motivi.push('contiene caratteri speciali');
  if (base.length > 100) motivi.push('è troppo lungo');
  if (/\s{2,}|^\s|\s$/.test(base)) motivi.push('contiene spazi doppi o all\'inizio/fine');
  return { ok: !motivi.length, motivi };
}
export function nomePulito(nome) {
  const ext = (String(nome).match(/((\.pdf)?(\.p7m)+|\.pdf)$/i) || [''])[0].toLowerCase() || '.pdf';
  let base = String(nome).slice(0, String(nome).length - ext.length).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _.\-()]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100);
  if (!base) base = 'documento';
  return base + ext;
}

/** Il PDF dichiara la conformità PDF/A (metadati XMP)? */
export function dichiaraPdfA(xmpTesto) {
  const m = String(xmpTesto || '').match(/pdfaid:part\s*(?:=\s*["']|>)\s*(\d)/i);
  return m ? +m[1] : 0;
}

/**
 * Valutazione di un file. info: { nome, dimensione, tipo: 'pdf'|'p7m'|'altro', leggibile, protetto, firmato (PAdES),
 *   esitoFirma ('valid'|'warning'|'invalid'|null), pdfa (parte o 0), sogliaMb }
 * → { problemi: [testo], avvisi: [testo], azioni: { pdfa, riduci, rinomina } }
 */
export function valutaPerTitulus(info) {
  const problemi = []; const avvisi = []; const azioni = { pdfa: false, riduci: false, rinomina: false };
  const soglia = (info.sogliaMb || SOGLIA_MB_PREDEFINITA) * 1048576;
  if (info.tipo === 'altro') problemi.push('non è un PDF né un file firmato .p7m');
  if (info.leggibile === false) problemi.push('il file è danneggiato o non leggibile');
  if (info.protetto) problemi.push('è protetto da password: Titulus e la conservazione non possono leggerlo. Chiedi una copia senza password o togli la protezione.');
  const firmato = info.tipo === 'p7m' || info.firmato;
  if (firmato) {
    if (info.esitoFirma === 'invalid') problemi.push('la firma digitale NON è valida (documento modificato dopo la firma)');
    else if (info.esitoFirma === 'warning') avvisi.push('firma integra ma da controllare (certificato non qualificato o non verificabile senza rete)');
    avvisi.push('file firmato: viene copiato com\'è (convertirlo o ridurlo renderebbe la firma non valida)');
  }
  if (!firmato && info.tipo === 'pdf' && info.leggibile !== false && !info.protetto && !info.pdfa) { avvisi.push('non è PDF/A'); azioni.pdfa = true; }
  if (info.dimensione > soglia) {
    if (firmato) avvisi.push(`è grande (${(info.dimensione / 1048576).toFixed(1).replace('.', ',')} MB) ma, essendo firmato, non si può ridurre`);
    else { avvisi.push(`è grande (${(info.dimensione / 1048576).toFixed(1).replace('.', ',')} MB, oltre ${info.sogliaMb || SOGLIA_MB_PREDEFINITA} MB)`); azioni.riduci = true; }
  }
  const nome = valutaNome(info.nome);
  if (!nome.ok) { avvisi.push('nome: ' + nome.motivi.join(', ')); azioni.rinomina = true; }
  return { problemi, avvisi, azioni };
}

// ---------------- «Dati per Titulus» ----------------
const dataIt = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '');
const euroIt = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €');

/**
 * Campi da incollare in Titulus. Da una FatturaPA (dati esatti) o dal testo (dati: estraiDati, analisi: rinomina.analizza).
 * → [{ chiave, etichetta, valore }] solo con i campi trovati. L'oggetto è una proposta da rivedere.
 */
export function datiPerTitulus({ fattura, dati, analisi, firma, nomeFile } = {}) {
  const out = [];
  const add = (chiave, etichetta, valore) => { if (valore != null && String(valore).trim()) out.push({ chiave, etichetta, valore: String(valore).trim() }); };
  if (fattura) {
    const c = fattura.corpi[0]; const tipo = { TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella' }[c.tipo] || 'Fattura';
    const forn = fattura.cedente?.nome || '';
    add('oggetto', 'Oggetto (proposta)', [`${tipo} n. ${c.numero} del ${dataIt(c.data)}`, forn, c.cig.length ? `CIG ${c.cig.join(', ')}` : '', c.cup.length ? `CUP ${c.cup.join(', ')}` : ''].filter(Boolean).join(' – '));
    add('mittente', 'Mittente / fornitore', forn);
    add('piva', 'P.IVA o codice fiscale del mittente', fattura.cedente?.partitaIva || fattura.cedente?.codiceFiscale);
    add('numero', 'Numero del documento', c.numero);
    add('data', 'Data del documento', dataIt(c.data));
    add('cig', 'CIG', c.cig.join(', ')); add('cup', 'CUP', c.cup.join(', '));
    add('importo', 'Importo totale', euroIt(c.calcoli.totale));
    if (fattura.corpi.length > 1) add('nota', 'Nota', `Il file contiene ${fattura.corpi.length} documenti`);
  } else if (dati || analisi) {
    const a = analisi || {}; const d = dati || { cig: [], cup: [], piva: [] };
    const tipo = a.tipo && a.tipo !== 'Documento' ? a.tipo.replace('NotaCredito', 'Nota di credito') : (nomeFile ? String(nomeFile).replace(/(\.pdf)?(\.p7m)*$/i, '').replace(/_+/g, ' ') : 'Documento');
    const cig = d.cig?.map((x) => x.valore).join(', '); const cup = d.cup?.map((x) => x.valore).join(', ');
    add('oggetto', 'Oggetto (proposta)', [`${tipo}${a.numero ? ` n. ${a.numero}` : ''}${a.data ? ` del ${dataIt(a.data)}` : ''}`, a.soggetto, cig ? `CIG ${cig}` : '', cup ? `CUP ${cup}` : '', d.durc?.scadenza ? `scadenza ${dataIt(d.durc.scadenza)}` : ''].filter(Boolean).join(' – '));
    add('mittente', 'Mittente / fornitore', a.soggetto);
    add('piva', 'P.IVA del mittente', d.piva?.[0]?.valore);
    add('numero', 'Numero del documento', a.numero);
    add('data', 'Data del documento', dataIt(a.data));
    add('cig', 'CIG', cig); add('cup', 'CUP', cup);
    add('importo', 'Importo totale', d.totale != null ? euroIt(d.totale) : '');
  }
  const firmatari = firma?.result?.levels?.flatMap((l) => l.signers.map((s) => s.name)) || [];
  if (firmatari.length) add('firma', 'Firmato digitalmente da', firmatari.join(', '));
  if (!out.length && nomeFile) add('oggetto', 'Oggetto (proposta)', String(nomeFile).replace(/(\.pdf)?(\.p7m)*$/i, '').replace(/[_]+/g, ' '));
  return out;
}
export function testoDatiTitulus(campi) { return campi.map((c) => `${c.etichetta}: ${c.valore}`).join('\n'); }
