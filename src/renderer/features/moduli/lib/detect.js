// Riconoscimento automatico dei campi di un modulo dal testo della pagina (come "Prepara modulo" di Acrobat Pro).
// Logica pura: riceve gli elementi di testo già convertiti in coordinate PDF e restituisce proposte di campi.
//
// item: { str, x, y, w, h }  (x,y = origine della linea di base in punti PDF, w larghezza, h altezza del carattere)
// segments (opzionale): linee orizzontali disegnate [{ x1, x2, y }] — righe su cui scrivere
// proposta: { type: 'text'|'checkbox'|'signature', name, rect:[x1,y1,x2,y2], format?: 'date'|'number'|'email', label }

const LABELS = [
  // [espressione, tipo, formato, nome]
  [/^(firma|signature|firma del richiedente|firma leggibile)\b/i, 'signature', null, 'firma'],
  [/^(data|date|li|lì|il giorno)\b/i, 'text', 'date', 'data'],
  [/^(data di nascita|nato\/a il|nata il|nato il|birth ?date)\b/i, 'text', 'date', 'data_nascita'],
  [/^(e-?mail|posta elettronica|pec)\b/i, 'text', 'email', 'email'],
  [/^(tel(efono)?|cell(ulare)?|phone|fax)\b/i, 'text', 'number', 'telefono'],
  [/^(cap|c\.a\.p\.|zip)\b/i, 'text', 'number', 'cap'],
  [/^(importo|euro|€|totale|quantità|n\.|numero|età)\b/i, 'text', 'number', null],
  [/^(nome e cognome|cognome e nome)\b/i, 'text', null, 'nome_cognome'],
  [/^(nome|name|first name)\b/i, 'text', null, 'nome'],
  [/^(cognome|surname|last name)\b/i, 'text', null, 'cognome'],
  [/^(codice fiscale|c\.f\.|cf)\b/i, 'text', null, 'codice_fiscale'],
  [/^(indirizzo|via|residente in|address)\b/i, 'text', null, 'indirizzo'],
  [/^(città|comune|luogo|city|nato\/a a|nato a|nata a)\b/i, 'text', null, 'luogo'],
  [/^(provincia|prov\.)\b/i, 'text', null, 'provincia'],
  [/^(partita iva|p\.? ?iva)\b/i, 'text', 'number', 'partita_iva'],
];
const BOX_CHARS = /[☐□❑❒■◻▢⬜□☐☑☒]/;
const UNDERS_SRC = '_{3,}|\\.{6,}|…{3,}';
const unders = () => new RegExp(UNDERS_SRC, 'g');

export function slugName(label) {
  const s = String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'campo';
}

function classify(label) {
  const l = label.trim().replace(/[:.\s]+$/, '');
  for (const [re, type, format, name] of LABELS) if (re.test(l)) return { type, format, name: name || slugName(l) };
  return { type: 'text', format: null, name: slugName(l) };
}

function overlaps(a, b, pad = 1) {
  return a[0] < b[2] - pad && a[2] > b[0] + pad && a[1] < b[3] - pad && a[3] > b[1] + pad;
}

/** Testo che precede immediatamente x sulla stessa riga (etichetta del campo). */
function labelBefore(lineItems, x, ownPrefix) {
  if (ownPrefix && ownPrefix.trim().length > 1) return ownPrefix.trim().replace(/[:\s]+$/, '');
  const prev = lineItems.filter((it) => it.x + it.w <= x + 2).sort((a, b) => b.x - a.x)[0];
  return prev ? prev.str.replace(unders(), ' ').trim().split(/\s{2,}/).pop().replace(/[:\s]+$/, '') : '';
}

/**
 * @param {Array} items elementi di testo
 * @param {{width:number,height:number,x0?:number,y0?:number}} page dimensioni pagina (punti)
 * @param {{existing?:Array<[number,number,number,number]>, segments?:Array, maxFields?:number}} opts
 */
export function detectFields(items, page, opts = {}) {
  const existing = opts.existing || [];
  const maxFields = opts.maxFields ?? 300;
  const x0 = page.x0 || 0; const right = x0 + page.width - 36;
  const clean = (items || []).filter((it) => it && typeof it.str === 'string' && it.str.length && Number.isFinite(it.x) && Number.isFinite(it.y) && it.w >= 0 && it.h > 0 && it.h < 200);
  // raggruppa per riga (stessa linea di base, tolleranza 30% dell'altezza)
  const sorted = [...clean].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const ln = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.3));
    if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  const out = [];
  const taken = [...existing];
  const used = new Set();
  const push = (p) => {
    if (out.length >= maxFields) return;
    const r = p.rect.map((v) => Math.round(v * 10) / 10);
    if (r[2] - r[0] < 6 || r[3] - r[1] < 6) return;
    if (taken.some((t) => overlaps(t, r))) return;
    let name = p.name; let k = 2;
    while (used.has(name)) name = `${p.name}_${k++}`;
    used.add(name); taken.push(r);
    out.push({ ...p, name, rect: r });
  };

  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    for (const it of ln.items) {
      const cw = it.str.length ? it.w / it.str.length : it.h * 0.5;
      // 1) caselle ☐ (anche come "[ ]")
      const chars = [...it.str];
      let pos = 0;
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        if (BOX_CHARS.test(ch)) {
          const bx = it.x + pos * cw; const size = Math.min(Math.max(it.h * 0.9, 8), 20);
          const after = chars.slice(ci + 1).join('').replace(BOX_CHARS, ' ').trim().split(/\s{2,}|[☐□]/)[0] || '';
          const label = after || labelBefore(ln.items, bx, chars.slice(0, ci).join(''));
          push({ type: 'checkbox', name: slugName(label || 'casella'), label: label || 'Casella', rect: [bx, it.y - it.h * 0.1, bx + size, it.y - it.h * 0.1 + size] });
        }
        pos++;
      }
      const sq = /\[\s?\]/g; let m;
      while ((m = sq.exec(it.str))) {
        const bx = it.x + m.index * cw; const size = Math.min(Math.max(it.h * 0.9, 8), 20);
        const label = it.str.slice(m.index + m[0].length).trim().split(/\s{2,}|\[/)[0] || labelBefore(ln.items, bx, it.str.slice(0, m.index));
        push({ type: 'checkbox', name: slugName(label || 'casella'), label: label || 'Casella', rect: [bx, it.y - it.h * 0.1, bx + size, it.y - it.h * 0.1 + size] });
      }
      // 2) trattini bassi / puntini: spazio per scrivere
      const ure = unders();
      while ((m = ure.exec(it.str))) {
        const fx1 = it.x + m.index * cw; const fx2 = it.x + (m.index + m[0].length) * cw;
        const label = labelBefore(ln.items, fx1, it.str.slice(0, m.index));
        const c = classify(label || 'campo');
        const hgt = c.type === 'signature' ? Math.max(it.h * 2.2, 26) : Math.max(it.h * 1.35, 14);
        push({ type: c.type, format: c.format, name: c.name, label: label || 'Campo', rect: [fx1, it.y - it.h * 0.15, fx2, it.y - it.h * 0.15 + hgt] });
      }
    }
    // 3) etichette con i due punti senza spazio sottolineato: campo a destra fino al prossimo testo
    for (let k = 0; k < ln.items.length; k++) {
      const it = ln.items[k];
      const t = it.str.trim();
      if (!/:\s*$/.test(t) || t.length > 40 || unders().test(t)) continue;
      const label = t.replace(/:\s*$/, '');
      if (!/[a-zà-ú]/i.test(label)) continue;
      const startX = it.x + it.w + 4;
      const next = ln.items.slice(k + 1).find((n) => n.x > startX + 2);
      const endX = Math.min(next ? next.x - 6 : right, startX + 260);
      if (endX - startX < 30) continue;
      const c = classify(label);
      const hgt = c.type === 'signature' ? Math.max(it.h * 2.2, 26) : Math.max(it.h * 1.35, 14);
      // se c'è una riga disegnata sotto, si allinea a quella
      const seg = (opts.segments || []).find((s) => Math.abs(s.y - (it.y - 2)) < it.h * 0.8 && s.x2 > startX + 20 && s.x1 < endX);
      const y1 = seg ? seg.y + 1 : it.y - it.h * 0.25;
      push({ type: c.type, format: c.format, name: c.name, label, rect: [seg ? Math.max(startX, seg.x1) : startX, y1, seg ? Math.min(endX, seg.x2) : endX, y1 + hgt] });
    }
  }
  // 4) righe disegnate isolate (senza trattini nel testo): campo testo sopra la riga, con l'etichetta a sinistra
  for (const s of opts.segments || []) {
    if (s.x2 - s.x1 < 40 || s.x2 - s.x1 > page.width * 0.95) continue;
    const ln = lines.find((l) => Math.abs(l.y - s.y) < 14 && l.items.some((it) => it.x + it.w <= s.x1 + 4));
    if (!ln) continue;
    const label = labelBefore(ln.items, s.x1);
    if (!label) continue;
    const c = classify(label);
    const hgt = c.type === 'signature' ? 28 : 15;
    push({ type: c.type, format: c.format, name: c.name, label, rect: [s.x1, s.y + 1, s.x2, s.y + 1 + hgt] });
  }
  return out;
}

/** Converte gli elementi di getTextContent() di pdf.js in {str,x,y,w,h}. */
export function textItemsFromPdfjs(textContent) {
  const out = [];
  for (const it of textContent?.items || []) {
    if (!it || typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue;
    const [a, b, , d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue; // testo ruotato: ignorato
    const hgt = Math.hypot(b, d) || it.height || 10;
    out.push({ str: it.str, x: e, y: f, w: it.width || 0, h: hgt });
  }
  return out;
}
