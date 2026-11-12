// Estrazione del testo leggera e veloce, pagina per pagina (per indicizzare migliaia di PDF).
// Nessun accesso al DOM: funziona nel thread principale e dentro un Web Worker.
// Si passa il modulo pdf.js già configurato (vedi estrai-testo.worker.js).

/** Testo di una pagina da getTextContent: righe separate da \n, spazi normalizzati. */
export function testoDaContenuto(tc) {
  let out = '';
  for (const it of tc?.items || []) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    if (it.hasEOL) out += '\n';
    else if (it.str && !/\s$/.test(it.str)) out += ' ';
  }
  return out.replace(/\u0000/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const SOGLIA_SCANSIONE = 20; // caratteri visibili sotto i quali la pagina si considera senza testo

/**
 * Estrae il testo di un PDF.
 * pdfjs: modulo pdfjs-dist; data: Uint8Array (viene copiato);
 * opts: { password, maxPagine (default tutte), controllaImmagini=false (più lento: distingue
 *         "scansione" da "pagina bianca"), signal, assets: { cMapUrl, standardFontDataUrl, ... } }
 * → { pagine: [{ n, testo, caratteri, senzaTesto, scansione }], numPagine, info: { titolo, autore, oggetto, parole, creato, modificato },
 *     scansione (true se nessuna pagina ha testo), protetto:false }
 * Errori: { codice: 'password'|'danneggiato', message } come eccezione.
 */
export async function estraiTesto(pdfjs, data, opts = {}) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), password: opts.password, // copia (anche da Buffer o ArrayBuffer)
    isEvalSupported: false, enableXfa: false, stopAtErrors: false, disableFontFace: true, useSystemFonts: false,
    ...(opts.assets || {}),
  });
  let pdf;
  try { pdf = await task.promise; }
  catch (err) {
    await task.destroy().catch(() => {});
    const e = new Error(err?.name === 'PasswordException' ? 'Il file è protetto da password.' : 'Il file non è un PDF leggibile o è danneggiato.');
    e.codice = err?.name === 'PasswordException' ? 'password' : 'danneggiato';
    throw e;
  }
  try {
    const n = Math.min(pdf.numPages, opts.maxPagine || Infinity);
    const OPS = pdfjs.OPS;
    const pagine = [];
    for (let i = 1; i <= n; i++) {
      if (opts.signal?.aborted) throw new DOMException('Annullato', 'AbortError');
      let testo = ''; let scansione = false;
      try {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent({ disableNormalization: false });
        testo = testoDaContenuto(tc);
        const caratteri = testo.replace(/\s/g, '').length;
        if (caratteri < SOGLIA_SCANSIONE) {
          scansione = true; // probabile scansione
          if (opts.controllaImmagini) {
            const ops = await page.getOperatorList();
            scansione = ops.fnArray.some((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageXObjectRepeat);
          }
        }
        page.cleanup();
        pagine.push({ n: i, testo, caratteri, senzaTesto: caratteri < SOGLIA_SCANSIONE, scansione });
      } catch {
        pagine.push({ n: i, testo: '', caratteri: 0, senzaTesto: true, scansione: false, errore: true });
      }
    }
    let info = {};
    try {
      const m = await pdf.getMetadata();
      const I = m?.info || {};
      info = { titolo: I.Title || '', autore: I.Author || '', oggetto: I.Subject || '', parole: I.Keywords || '', creato: I.CreationDate || '', modificato: I.ModDate || '' };
    } catch { /* metadati illeggibili */ }
    return { pagine, numPagine: pdf.numPages, info, scansione: pagine.length > 0 && pagine.every((p) => p.senzaTesto) };
  } finally {
    await task.destroy().catch(() => {});
  }
}
