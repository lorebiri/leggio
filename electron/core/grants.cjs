// Permessi sui percorsi per i canali file:* del main (logica pura, testata in Node).
// - il renderer sovrascrive solo file aperti o scelti dall'utente (grantFile);
// - scrive solo nelle cartelle scelte con il dialogo (grantFolder);
// - legge i file non PDF aperti dal sistema (grantRead);
// - i file aperti in SOLA LETTURA (es. dall'archivio) non si scrivono MAI: né con file:write, né scegliendo
//   lo stesso percorso in «Salva con nome», né scrivendo nella loro cartella con lo stesso nome.
const path = require('node:path');

function createGrants({ caseInsensitive = process.platform === 'win32' || process.platform === 'darwin' } = {}) {
  const norm = (p) => { const n = path.normalize(String(p)); return caseInsensitive ? n.toLowerCase() : n; };
  const files = new Set(); const folders = new Set(); const reads = new Set(); const readOnly = new Set();
  return {
    norm,
    grantFile(p) { if (p) files.add(norm(p)); },
    grantFolder(p) { if (p) folders.add(norm(p)); },
    grantRead(p) { if (p) reads.add(norm(p)); },
    canRead(p) { return reads.has(norm(p)); },
    hasFolder(p) { return folders.has(norm(p)); },
    /** Protegge (o libera) un file aperto in sola lettura. */
    setReadOnly(p, on) { if (!p) return; if (on) readOnly.add(norm(p)); else readOnly.delete(norm(p)); },
    isReadOnly(p) { return readOnly.has(norm(p)); },
    /** → null se si può scrivere, altrimenti il motivo (messaggio per l'utente). */
    whyNotWrite(p) {
      const name = path.basename(String(p));
      if (readOnly.has(norm(p))) return `«${name}» è aperto in sola lettura: l'originale non può essere sovrascritto. Salva una copia con un altro nome.`;
      if (!files.has(norm(p))) return `«${name}» non è stato aperto da te in Leggio (per esempio viene dall'archivio): Leggio non lo sovrascrive. Salva una copia con «Salva con nome».`;
      return null;
    },
    /** Scelta in «Salva con nome»: tutto consentito tranne un file in sola lettura. */
    whyNotSaveAs(p) {
      return readOnly.has(norm(p)) ? `«${path.basename(String(p))}» è l'originale aperto in sola lettura: scegli un altro nome o un'altra cartella.` : null;
    },
    /** Scrittura nella cartella scelta: cartella concessa e nessun file in sola lettura sovrascritto. */
    whyNotWriteInFolder(dir, file) {
      if (!folders.has(norm(dir))) return 'Cartella non scelta dall\'utente: scegline una con il dialogo.';
      if (readOnly.has(norm(file))) return `«${path.basename(String(file))}» è aperto in sola lettura e non può essere sovrascritto.`;
      return null;
    },
  };
}

module.exports = { createGrants };
