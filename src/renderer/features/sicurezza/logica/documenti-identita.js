// Oscuramento dei documenti d'identità: modelli con le zone da coprire su carta d'identità elettronica
// (CIE), carta d'identità cartacea e patente italiana, e la filigrana «Copia per uso esclusivo di …».
// Logica pura (nessun DOM): coordinate e testi. L'oscuramento vero lo fa redigi.js.
//
// Le zone sono in coordinate NORMALIZZATE della tessera (0…1, origine in alto a sinistra, tessera dritta):
// l'utente disegna un riquadro attorno al documento nella scansione e Leggio ci appoggia sopra le zone.
// Sono volutamente un po' più larghe del campo stampato (margine di sicurezza): dopo l'applicazione del
// modello l'utente vede le aree, può toglierle o aggiungerne altre a mano prima di oscurare.

/** Campi che l'utente può scegliere. */
export const CAMPI_DOCUMENTO = [
  { id: 'numero', label: 'Numero del documento', predefinito: true },
  { id: 'mrz', label: 'Codice a lettura ottica (MRZ, righe con «<<<»)', predefinito: true },
  { id: 'firma', label: 'Firma del titolare', predefinito: true },
  { id: 'foto', label: 'Fotografia', predefinito: false },
  { id: 'cf', label: 'Codice fiscale (anche il codice a barre)', predefinito: true },
  { id: 'indirizzo', label: 'Indirizzo di residenza', predefinito: true },
  { id: 'nascita', label: 'Data e luogo di nascita', predefinito: false },
];

// [x0, y0, x1, y1] normalizzate, origine in alto a sinistra
export const MODELLI_DOCUMENTO = [
  {
    id: 'cie', nome: 'Carta d\'identità elettronica (CIE)', formato: 'Tessera 85,6 × 54 mm', rapporto: 85.6 / 54,
    lati: {
      fronte: {
        numero: [[0.64, 0.0, 1.0, 0.16], [0.74, 0.84, 1.0, 1.0]], // numero della carta in alto a destra e CAN in basso a destra
        foto: [[0.02, 0.17, 0.34, 0.86]],
        firma: [[0.33, 0.78, 0.76, 1.0]],
        nascita: [[0.34, 0.40, 0.98, 0.58]],
      },
      retro: {
        cf: [[0.0, 0.0, 1.0, 0.30]],
        indirizzo: [[0.0, 0.28, 1.0, 0.50]],
        nascita: [[0.0, 0.48, 1.0, 0.62]],
        mrz: [[0.0, 0.62, 1.0, 1.0]],
        numero: [[0.0, 0.62, 1.0, 1.0]], // il numero è ripetuto nella MRZ
      },
    },
  },
  {
    id: 'cartacea', nome: 'Carta d\'identità cartacea (libretto aperto)', formato: 'Due facciate affiancate', rapporto: 1.55,
    lati: {
      // facciate interne: a sinistra foto, firma e timbro; a destra i dati anagrafici
      interno: {
        foto: [[0.03, 0.30, 0.30, 0.82]],
        firma: [[0.02, 0.78, 0.49, 0.97]],
        numero: [[0.50, 0.0, 1.0, 0.13], [0.50, 0.88, 1.0, 1.0], [0.0, 0.0, 0.49, 0.10]],
        nascita: [[0.51, 0.24, 1.0, 0.42]],
        indirizzo: [[0.51, 0.42, 1.0, 0.62]],
      },
      // copertina e retro (numero stampato e talvolta ripetuto)
      esterno: {
        numero: [[0.50, 0.0, 1.0, 0.18], [0.50, 0.82, 1.0, 1.0]],
      },
    },
  },
  {
    id: 'patente', nome: 'Patente di guida italiana', formato: 'Tessera 85,6 × 54 mm', rapporto: 85.6 / 54,
    lati: {
      fronte: {
        nascita: [[0.33, 0.30, 1.0, 0.46]], // campo 3
        numero: [[0.33, 0.64, 1.0, 0.79]], // campo 5
        foto: [[0.02, 0.17, 0.33, 0.86]], // campo 6
        firma: [[0.33, 0.77, 0.80, 0.97]], // campo 7
      },
      retro: {
        numero: [[0.0, 0.85, 0.6, 1.0]], // numero di serie della tessera (in basso)
      },
    },
  },
];

export const ORIENTAMENTI = [
  { value: 0, label: 'Dritto' },
  { value: 90, label: 'Ruotato di 90° in senso orario' },
  { value: 180, label: 'Capovolto' },
  { value: 270, label: 'Ruotato di 90° in senso antiorario' },
];

export function modelloDocumento(id) { return MODELLI_DOCUMENTO.find((m) => m.id === id) || null; }

/** Ruota un rettangolo normalizzato della tessera dritta nella posizione in cui appare nella scansione. */
function ruota([x0, y0, x1, y1], gradi) {
  const p = (x, y) => {
    switch (((gradi % 360) + 360) % 360) {
      case 90: return [1 - y, x];
      case 180: return [1 - x, 1 - y];
      case 270: return [y, 1 - x];
      default: return [x, y];
    }
  };
  const a = p(x0, y0); const b = p(x1, y1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/**
 * Orientamento della tessera nello spazio della pagina PDF, dato come appare sullo schermo (gradi in senso orario)
 * e la rotazione di visualizzazione della pagina (/Rotate più l'eventuale rotazione della vista, in senso orario).
 */
export function orientamentoNellaPagina(orientamentoSchermo, rotazione = 0) {
  return ((((Number(orientamentoSchermo) || 0) - (Number(rotazione) || 0)) % 360) + 360) % 360;
}

/**
 * Aree da oscurare in coordinate PDF. riquadro: [x0, y0, x1, y1] della tessera nella pagina (spazio PDF,
 * origine in basso a sinistra). → [{ campo, label, rect }]
 */
export function zoneDocumento(modelloId, lato, campi, riquadro, { orientamento = 0, margine = 0.01 } = {}) {
  const m = modelloDocumento(modelloId);
  if (!m) throw new Error('Tipo di documento sconosciuto.');
  const zone = m.lati[lato];
  if (!zone) throw new Error('Lato del documento non valido.');
  const [X0, Y0, X1, Y1] = [Math.min(riquadro[0], riquadro[2]), Math.min(riquadro[1], riquadro[3]), Math.max(riquadro[0], riquadro[2]), Math.max(riquadro[1], riquadro[3])];
  const W = X1 - X0; const H = Y1 - Y0;
  if (!(W > 5 && H > 5)) throw new Error('Il riquadro del documento è troppo piccolo.');
  const out = [];
  const visti = new Set();
  for (const campo of campi) {
    for (const z of zone[campo] || []) {
      const [nx0, ny0, nx1, ny1] = ruota(z, orientamento).map((v, i) => Math.max(0, Math.min(1, v + (i < 2 ? -margine : margine))));
      const rect = [X0 + nx0 * W, Y1 - ny1 * H, X0 + nx1 * W, Y1 - ny0 * H];
      const key = rect.map((v) => v.toFixed(2)).join(',');
      if (visti.has(key)) continue;
      visti.add(key);
      out.push({ campo, label: CAMPI_DOCUMENTO.find((c) => c.id === campo)?.label || campo, rect });
    }
  }
  return out;
}

/** Campi disponibili su un lato (per non proporre, per esempio, il codice fiscale sul fronte della CIE). */
export function campiDelLato(modelloId, lato) {
  const z = modelloDocumento(modelloId)?.lati[lato] || {};
  return CAMPI_DOCUMENTO.filter((c) => (z[c.id] || []).length);
}

// ---------- filigrana «Copia per uso esclusivo di …» ----------

/** Data italiana gg/mm/aaaa (giorno locale). */
export function dataItaliana(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** «Copia per uso esclusivo di Comune di Pisa – pratica TARI – 18/11/2026». Vuoto se manca il destinatario. */
export function testoFiligrana({ destinatario = '', finalita = '', data = '' } = {}) {
  const dest = String(destinatario).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!dest) return '';
  const fin = String(finalita).replace(/\s+/g, ' ').trim().slice(0, 120);
  return [`Copia per uso esclusivo di ${dest}`, fin ? `per ${fin.replace(/^per\s+/i, '')}` : '', String(data).trim()].filter(Boolean).join(' – ');
}

/**
 * Disposizione della filigrana su una pagina larga w e alta h (pixel o punti): righe diagonali ripetute
 * che coprono tutta la pagina (non si ritaglia via un angolo). → { angolo (radianti), dimensione, righe: [{ x, y }] }
 * misura(testo, dimensione) → larghezza del testo.
 */
export function layoutFiligrana(w, h, testo, misura = (t, s) => t.length * s * 0.5) {
  const angolo = -Math.atan2(h, w);
  const diag = Math.hypot(w, h);
  let dimensione = Math.max(8, Math.min(w, h) / 19);
  // il testo (ripetuto due volte con uno spazio) sta circa nella diagonale
  const largh = misura(testo, dimensione);
  if (largh > diag * 0.9) dimensione *= (diag * 0.9) / largh;
  const passo = dimensione * 6.5;
  const righe = [];
  for (let off = -diag / 2; off <= diag / 2 + 1; off += passo) righe.push({ x: 0, y: off });
  return { angolo, dimensione, righe, centro: [w / 2, h / 2], diag };
}
