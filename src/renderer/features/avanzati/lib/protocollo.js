// Funzioni di servizio per date, testo e coordinate. Leggio legge la segnatura di Titulus ma non la appone mai.

export function oggi(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Accetta 12/11/2026, 12.11.26, 12-11-2026, 2026-11-12 → "12/11/2026" (o null). */
export function normalizzaData(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = +m[1]; const mo = +m[2];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return oggi(dt);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return normalizzaData(`${m[3]}/${m[2]}/${m[1]}`);
  return null;
}

/** Sostituisce i caratteri che il font standard non sa scrivere. */
export function testoSicuro(font, s) {
  let out = '';
  for (const ch of String(s)) {
    try { font.encodeText(ch); out += ch; }
    catch { out += { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...' }[ch] || '?'; }
  }
  return out;
}

/**
 * Converte coordinate "visive" (come appare la pagina, origine in basso a sinistra) in coordinate
 * della pagina tenendo conto della rotazione (/Rotate) e dell'origine del riquadro visibile.
 */
export function visivoAPagina(page, u, v) {
  const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const W = box.width; const H = box.height;
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  let x; let y;
  if (R === 90) { x = W - v; y = u; }
  else if (R === 180) { x = W - u; y = H - v; }
  else if (R === 270) { x = v; y = H - u; }
  else { x = u; y = v; }
  return { x: x + box.x, y: y + box.y, rot: R };
}
export function dimensioniVisive(page) {
  const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  return R === 90 || R === 270 ? { w: box.height, h: box.width } : { w: box.width, h: box.height };
}


// Leggio non disegna segnature di protocollo: a ICCOM-CNR la stampigliatura la mette solo Titulus.
// Qui restano solo funzioni di servizio (date, testo sicuro, coordinate) usate da altri strumenti.
