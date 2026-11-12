// Controllo di accessibilità di base (logica pura su pdf-lib + dati di testo da pdf.js).

function nome(v) { return v?.asString ? v.asString().replace(/^\//, '') : v?.decodeText ? v.decodeText() : undefined; }
function testo(v) { try { return v?.decodeText ? v.decodeText() : v?.asString ? v.asString() : undefined; } catch { return undefined; } }

/** Visita l'albero della struttura (tag) e conta elementi, figure e figure senza testo alternativo. */
export function visitaStruttura(root, PDFLib, limite = 200000) {
  const { PDFDict, PDFArray, PDFName } = PDFLib;
  const r = { elementi: 0, figure: 0, figureSenzaAlt: 0, tabelle: 0, titoli: 0, tipi: new Map() };
  const stack = [root.lookup(PDFName.of('K'))];
  const visti = new Set();
  while (stack.length && r.elementi < limite) {
    const k = stack.pop();
    if (!k) continue;
    if (k instanceof PDFArray) { for (let i = 0; i < k.size(); i++) stack.push(k.lookup(i)); continue; }
    if (!(k instanceof PDFDict) || visti.has(k)) continue;
    visti.add(k);
    const s = nome(k.get(PDFName.of('S')));
    if (s) {
      r.elementi++;
      r.tipi.set(s, (r.tipi.get(s) || 0) + 1);
      if (s === 'Figure') { r.figure++; if (!testo(k.lookup(PDFName.of('Alt'))) && !testo(k.lookup(PDFName.of('ActualText')))) r.figureSenzaAlt++; }
      if (s === 'Table') r.tabelle++;
      if (/^H\d?$/.test(s)) r.titoli++;
    }
    const kids = k.lookup(PDFName.of('K'));
    if (kids) stack.push(kids);
  }
  return r;
}

/**
 * Controlli. dati: { pagine, pagineSenzaTesto:[indici], immagini (numero stimato), testoIllegibile (bool) }
 * → [{ id, ok, livello:'errore'|'avviso'|'ok', titolo, spiegazione, correzione: 'titolo'|'lingua'|'mostraTitolo'|'ocr'|'tag'|'segnalibri'|null }]
 */
export function controllaAccessibilita(pdfDoc, PDFLib, dati = {}) {
  const { PDFDict, PDFName, PDFBool, PDFArray, PDFNumber } = PDFLib;
  const cat = pdfDoc.catalog;
  const out = [];
  const add = (id, ok, titolo, spiegazione, correzione = null, livello) => out.push({ id, ok, livello: livello || (ok ? 'ok' : 'errore'), titolo, spiegazione, correzione: ok ? null : correzione });

  // tag e struttura
  const mark = cat.lookup(PDFName.of('MarkInfo'));
  const marked = mark instanceof PDFDict && mark.lookup(PDFName.of('Marked')) === PDFBool.True;
  const root = cat.lookup(PDFName.of('StructTreeRoot'));
  const st = root instanceof PDFDict ? visitaStruttura(root, PDFLib) : null;
  const tagged = !!(marked && st && st.elementi > 0);
  add('tag', tagged, tagged ? `Documento con tag (${st.elementi} elementi di struttura)` : 'Documento senza tag', tagged
    ? 'I lettori di schermo possono seguire titoli, paragrafi ed elenchi.'
    : 'Senza tag i lettori di schermo non conoscono titoli, paragrafi, tabelle e ordine di lettura. Va preparato con «Prepara per l’accessibilità».', 'tag');

  // titolo
  let title = '';
  try { title = pdfDoc.getTitle() || ''; } catch { /* */ }
  add('titolo', !!title.trim(), title.trim() ? `Titolo: «${title.trim()}»` : 'Manca il titolo del documento', title.trim() ? '' : 'Il titolo viene letto per primo dai lettori di schermo e mostrato nelle schede.', 'titolo');
  const vp = cat.lookup(PDFName.of('ViewerPreferences'));
  const showTitle = vp instanceof PDFDict && vp.lookup(PDFName.of('DisplayDocTitle')) === PDFBool.True;
  add('mostraTitolo', showTitle, showTitle ? 'Nella finestra compare il titolo' : 'Nella finestra compare il nome del file, non il titolo', showTitle ? '' : 'Impostazione richiesta da PDF/UA: si corregge con un clic.', 'mostraTitolo', showTitle ? 'ok' : 'avviso');

  // lingua
  const lang = testo(cat.lookup(PDFName.of('Lang')));
  add('lingua', !!lang, lang ? `Lingua del documento: ${lang}` : 'Manca la lingua del documento', lang ? '' : 'Serve al lettore di schermo per pronunciare correttamente il testo.', 'lingua');

  // testo presente
  const nst = dati.pagineSenzaTesto?.length || 0;
  add('testo', nst === 0, nst === 0 ? 'Tutte le pagine contengono testo' : `${nst} ${nst === 1 ? 'pagina è' : 'pagine sono'} solo immagine (scansione)`, nst === 0 ? '' : `Pagine: ${dati.pagineSenzaTesto.slice(0, 12).map((i) => i + 1).join(', ')}${nst > 12 ? '…' : ''}. Il testo non può essere letto: renderle ricercabili con l’OCR.`, 'ocr');
  if (dati.testoIllegibile) add('codifica', false, 'Parte del testo non è leggibile come caratteri', 'Alcuni font non hanno la tabella dei caratteri (ToUnicode): copia e lettura producono simboli strani.', null, 'avviso');

  // immagini e testo alternativo
  if (tagged) {
    add('alt', st.figureSenzaAlt === 0, st.figure ? (st.figureSenzaAlt ? `${st.figureSenzaAlt} di ${st.figure} immagini senza testo alternativo` : `Tutte le ${st.figure} immagini hanno il testo alternativo`) : 'Nessuna immagine marcata come figura', st.figureSenzaAlt ? 'Descrivi le immagini significative con un testo alternativo.' : '', 'tag', st.figureSenzaAlt ? 'errore' : 'ok');
  } else if (dati.immagini) {
    add('alt', false, `${dati.immagini} immagini senza testo alternativo`, 'Senza tag non è possibile associare una descrizione alle immagini.', 'tag');
  }

  // ordine di lettura: tag + ordine di tabulazione per pagine con annotazioni
  let senzaTabs = 0;
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray && annots.size() && nome(page.node.get(PDFName.of('Tabs'))) !== 'S') senzaTabs++;
  }
  add('ordine', tagged && !senzaTabs, tagged ? (senzaTabs ? `${senzaTabs} pagine con collegamenti o campi senza ordine di tabulazione` : 'Ordine di lettura definito dai tag') : 'Ordine di lettura non definito', tagged ? (senzaTabs ? 'Il tasto Tab potrebbe saltare tra i campi in modo disordinato.' : '') : 'Senza tag l’ordine di lettura è quello interno del file, spesso sbagliato con colonne e tabelle.', 'tag', tagged && senzaTabs ? 'avviso' : undefined);

  // moduli
  const acro = cat.lookup(PDFName.of('AcroForm'));
  if (acro instanceof PDFDict) {
    let campi = 0; let senzaDescr = 0;
    const fields = acro.lookup(PDFName.of('Fields'));
    const stack = fields instanceof PDFArray ? [fields] : [];
    while (stack.length) {
      const a = stack.pop();
      for (let i = 0; i < a.size(); i++) {
        const f = a.lookup(i);
        if (!(f instanceof PDFDict)) continue;
        const kids = f.lookup(PDFName.of('Kids'));
        if (kids instanceof PDFArray && kids.size() && kids.lookup(0)?.get?.(PDFName.of('T'))) { stack.push(kids); continue; }
        campi++;
        if (!testo(f.lookup(PDFName.of('TU')))) senzaDescr++;
      }
    }
    if (campi) add('campi', !senzaDescr, senzaDescr ? `${senzaDescr} di ${campi} campi senza descrizione` : `Tutti i ${campi} campi hanno una descrizione`, senzaDescr ? 'La descrizione (suggerimento) viene letta quando si arriva al campo.' : '', null, senzaDescr ? 'avviso' : 'ok');
  }

  // protezione
  const enc = pdfDoc.context.trailerInfo.Encrypt;
  if (enc) {
    const e = pdfDoc.context.lookup(enc);
    const p = e instanceof PDFDict ? e.lookup(PDFName.of('P')) : null;
    const perm = p instanceof PDFNumber ? p.asNumber() : -1;
    const ok = (perm & 512) !== 0;
    add('protezione', ok, ok ? 'La protezione consente le tecnologie assistive' : 'La protezione blocca i lettori di schermo', ok ? '' : 'Rimuovi la protezione o consenti l’accesso al testo per l’accessibilità.');
  }

  // segnalibri per documenti lunghi
  const pages = dati.pagine || pdfDoc.getPageCount();
  if (pages > 20) {
    const outl = cat.lookup(PDFName.of('Outlines'));
    const has = outl instanceof PDFDict && !!outl.get(PDFName.of('First'));
    add('segnalibri', has, has ? 'Segnalibri presenti' : 'Documento lungo senza segnalibri', has ? '' : 'Con più di 20 pagine i segnalibri aiutano a orientarsi.', 'segnalibri', has ? 'ok' : 'avviso');
  }
  return out;
}
