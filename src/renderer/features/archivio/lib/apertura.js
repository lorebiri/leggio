// Apertura dei documenti dell'archivio: SEMPRE in sola lettura (l'originale non si sovrascrive mai).
// Vale per ogni percorso: elenco, «Oggi», Scheda, Pratica, servizi per le altre aree. Logica senza DOM (testata).

/** Opzioni di apertura per il nucleo: readOnly sempre, pagina e ricerca se note. */
export function opzioniApertura({ q, pagina } = {}) {
  const opts = { readOnly: true };
  if (pagina) opts.page = pagina;
  if (q && String(q).trim()) opts.search = String(q).trim().replace(/^"|"$/g, '');
  return opts;
}

/**
 * Apre un documento dell'archivio. Per i PDF dell'app desktop: app.openPath(path, { readOnly }) (protezione anche nel
 * processo principale). Per .p7m, fatture XML, .eml: app.openFile(…, opts), che passa le opzioni al gestore dell'area
 * avanzati; poiché un gestore potrebbe ignorarle, ogni documento aperto durante la chiamata viene comunque marcato in
 * sola lettura (il PDF contenuto nel .p7m, la fattura impaginata, l'allegato del messaggio).
 * io: { app, desktop, leggiBytes(path) } → [documenti aperti]
 */
export async function apriInSolaLettura({ app, desktop, leggiBytes }, riga, { q, pagina } = {}) {
  const opts = opzioniApertura({ q, pagina });
  const aperti = [];
  const off = app.bus.on('document:loaded', ({ doc } = {}) => {
    if (!doc) return;
    if (!doc.readOnly) doc.readOnly = true;
    aperti.push(doc);
  });
  try {
    if (riga.ext === 'pdf' && desktop) await app.openPath(riga.path, opts);
    else {
      const bytes = await leggiBytes(riga.path);
      await app.openFile({ path: desktop ? riga.path : null, name: riga.nome, bytes }, opts);
    }
  } finally { off?.(); }
  return aperti;
}
