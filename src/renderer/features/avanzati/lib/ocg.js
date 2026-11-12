// Livelli (Optional Content Groups): rende "predefinita" la visibilità scelta, così stampa ed esportazione
// la rispettano. Logica pura su pdf-lib.

/**
 * visibili: Map/oggetto { 'num gen R' oppure nome livello → boolean }.
 * Imposta /OCProperties /D /ON e /OFF; restituisce il numero di livelli aggiornati.
 */
export function impostaVisibilitaPredefinita(pdfDoc, PDFLib, statoPerRef) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = PDFLib;
  const ocp = pdfDoc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!ocp) throw new Error('Il documento non contiene livelli.');
  const ocgs = ocp.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!ocgs) throw new Error('Il documento non contiene livelli.');
  let d = ocp.lookupMaybe(PDFName.of('D'), PDFDict);
  if (!d) { d = pdfDoc.context.obj({}); ocp.set(PDFName.of('D'), d); }
  const on = pdfDoc.context.obj([]); const off = pdfDoc.context.obj([]);
  let n = 0;
  for (let i = 0; i < ocgs.size(); i++) {
    const ref = ocgs.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const key = `${ref.objectNumber}R${ref.generationNumber === 0 ? '' : ref.generationNumber}`;
    const vis = statoPerRef[key];
    if (vis === undefined) continue;
    (vis ? on : off).push(ref); n++;
  }
  d.set(PDFName.of('ON'), on);
  d.set(PDFName.of('OFF'), off);
  d.set(PDFName.of('BaseState'), PDFName.of('ON'));
  // le eventuali "configurazioni" alternative e gli stati di stampa (AS) non devono sovrascrivere la scelta
  d.delete(PDFName.of('AS'));
  return n;
}

/** Elenca i livelli con pdf-lib: [{ key, name }] */
export function elencaLivelli(pdfDoc, PDFLib) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = PDFLib;
  const ocp = pdfDoc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const ocgs = ocp?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  const out = [];
  for (let i = 0; i < (ocgs?.size() || 0); i++) {
    const ref = ocgs.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const dict = pdfDoc.context.lookup(ref);
    const nm = dict?.get?.(PDFName.of('Name'));
    out.push({ key: `${ref.objectNumber}R${ref.generationNumber === 0 ? '' : ref.generationNumber}`, name: nm?.decodeText ? nm.decodeText() : String(nm || 'Livello') });
  }
  return out;
}
