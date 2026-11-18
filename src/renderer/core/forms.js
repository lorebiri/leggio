// Moduli compilati a schermo: i valori stanno nell'annotationStorage di pdf.js finché non vengono
// integrati nei byte del documento (salvataggio, stampa, strumenti, Annulla/Ripeti).

/**
 * Integra nei byte del documento i valori dei moduli compilati a schermo e restituisce i byte.
 * I valori integrati non sono ancora sul disco: il documento resta (o diventa) «modificato»,
 * così chiudendolo Leggio chiede ancora se salvare. Il salvataggio poi lo segna come salvato.
 */
export async function integrateForms(doc) {
  if (doc.pdf && doc.pdf.annotationStorage.size > 0 && doc.formsDirty) {
    const saved = await doc.pdf.saveDocument();
    doc.replaceBytes(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
    doc.formsDirty = false;
    doc.dirty = true;
  }
  return doc.bytes;
}
