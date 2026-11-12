// Segnatura su copia di lavoro: riquadro con ente, numero e data di protocollo GIÀ ASSEGNATI da Titulus (il protocollo
// informatico del CNR), entrata/uscita, classificazione. Leggio non genera numeri di protocollo.
// Logica pura su pdf-lib (riceve PDFLib come parametro): usabile dall'interfaccia e dall'elaborazione in blocco.

export const POSIZIONI = [
  { value: 'alto-destra', label: 'In alto a destra' },
  { value: 'alto-sinistra', label: 'In alto a sinistra' },
  { value: 'alto-centro', label: 'In alto al centro' },
  { value: 'basso-destra', label: 'In basso a destra' },
  { value: 'basso-sinistra', label: 'In basso a sinistra' },
];
export const DIREZIONI = [
  { value: '', label: 'Non indicare' },
  { value: 'entrata', label: 'In entrata' },
  { value: 'uscita', label: 'In uscita' },
  { value: 'interno', label: 'Interno' },
];

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

/** Numero formattato con zeri iniziali (cifre = 0: nessun riempimento). */
export function formattaNumero(n, cifre = 7) {
  const s = String(n).trim();
  return /^\d+$/.test(s) && cifre > 0 ? s.padStart(cifre, '0') : s;
}

/** Righe di testo del timbro. */
export function righeTimbro(o) {
  const righe = [];
  const testa = [o.ente, o.ufficio].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
  if (testa) righe.push({ testo: testa, bold: true });
  righe.push({ testo: `Prot. n. ${formattaNumero(o.numero || '____', o.cifre ?? 0)} del ${o.data || oggi()}`, bold: true, grande: true });
  const terza = [];
  const dir = { entrata: 'In entrata', uscita: 'In uscita', interno: 'Interno' }[o.direzione];
  if (dir) terza.push(dir);
  if (o.classificazione) terza.push(`Class. ${String(o.classificazione).trim()}`);
  if (terza.length) righe.push({ testo: terza.join(' · ') });
  if (o.copia) righe.push({ testo: 'Copia di lavoro — originale in Titulus' });
  return righe;
}

function hexToRgb(PDFLib, hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return PDFLib.rgb(0.1, 0.27, 0.6);
  return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
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

/** Disegna un riquadro di testo in una posizione visiva della pagina. */
export function disegnaRiquadro(PDFLib, page, { righe, fonts, posizione = 'alto-destra', margine = 18, colore = '#1f4e9a', size = 9, bordo = true, sfondo = true }) {
  const col = hexToRgb(PDFLib, colore);
  const pad = 6; const gap = 2.5;
  const misure = righe.map((r) => {
    const f = r.bold ? fonts.bold : fonts.regular;
    const s = r.grande ? size + 1.5 : size;
    const t = testoSicuro(f, r.testo);
    return { f, s, t, w: f.widthOfTextAtSize(t, s) };
  });
  const bw = Math.max(...misure.map((m) => m.w)) + pad * 2;
  const bh = misure.reduce((a, m) => a + m.s, 0) + gap * (misure.length - 1) + pad * 2;
  const { w: PW, h: PH } = dimensioniVisive(page);
  let u = PW - margine - bw; let v = PH - margine - bh;
  if (posizione.endsWith('sinistra')) u = margine;
  if (posizione.endsWith('centro')) u = (PW - bw) / 2;
  if (posizione.startsWith('basso')) v = margine;
  u = Math.max(2, u); v = Math.max(2, v);
  const a = visivoAPagina(page, u, v);
  const rotate = PDFLib.degrees(a.rot);
  page.drawRectangle({ x: a.x, y: a.y, width: bw, height: bh, rotate, borderColor: bordo ? col : undefined, borderWidth: bordo ? 1.2 : 0, color: sfondo ? PDFLib.rgb(1, 1, 1) : undefined, opacity: sfondo ? 0.92 : 0, borderOpacity: 1 });
  let cy = v + bh - pad;
  for (const m of misure) {
    cy -= m.s;
    const p = visivoAPagina(page, u + pad, cy + m.s * 0.18);
    page.drawText(m.t, { x: p.x, y: p.y, size: m.s, font: m.f, color: col, rotate });
    cy -= gap;
  }
  return { u, v, w: bw, h: bh };
}

/** Applica la segnatura (numero e data presi da Titulus). opzioni: { ente, ufficio, numero, data, direzione, classificazione, posizione, pagine:'prima'|'tutte', colore, copia } */
export async function applicaProtocollo(pdfDoc, PDFLib, o) {
  const fonts = { regular: await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica), bold: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold) };
  const righe = righeTimbro(o);
  const pages = pdfDoc.getPages();
  if (!pages.length) throw new Error('Il documento non ha pagine.');
  const target = o.pagine === 'tutte' ? pages : [pages[0]];
  for (const p of target) disegnaRiquadro(PDFLib, p, { righe, fonts, posizione: o.posizione, colore: o.colore });
  return target.length;
}

/** Testo della segnatura nel formato di Titulus (CNR): «Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001». */
export function testoStriscia({ aoo = 'CNR', numero, data, uor, copia } = {}) {
  return `Prot. ${String(aoo || 'CNR').trim()} n. ${String(numero || '').trim()} del ${data || oggi()}${uor ? ` - UOR: ${String(uor).trim()}` : ''}${copia ? ' — COPIA DI LAVORO' : ''}`;
}

/**
 * Segnatura «come Titulus»: striscia verticale rossa sul margine sinistro, che si legge dal basso verso l'alto.
 * Il numero è quello già assegnato da Titulus: Leggio non ne genera. o: { aoo, numero, data, uor, copia, pagine, size }
 */
export async function applicaStriscia(pdfDoc, PDFLib, o) {
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const size = o.size || 9;
  const testo = testoSicuro(font, testoStriscia(o));
  const pages = pdfDoc.getPages();
  if (!pages.length) throw new Error('Il documento non ha pagine.');
  const target = o.pagine === 'tutte' ? pages : [pages[0]];
  for (const p of target) {
    const { h: PH } = dimensioniVisive(p);
    const w = font.widthOfTextAtSize(testo, size);
    const v0 = Math.max(12, (PH - w) / 2);
    // la riga va dal basso verso l'alto: testo ruotato di 90° in senso antiorario, a ~8 mm dal bordo sinistro
    const a = visivoAPagina(p, 22, v0);
    p.drawText(testo, { x: a.x, y: a.y, size, font, color: PDFLib.rgb(0.8, 0.07, 0.07), rotate: PDFLib.degrees(a.rot + 90) });
  }
  return target.length;
}
