// «Estrai immagini» (tutte le immagini incorporate, in una cartella) e «Statistiche del documento».
import { stimaTempo } from './lib/ocr-layout.js';
import { statisticheTesto, minutiLettura, formatoPagina } from './lib/frasi.js';
import { elencoFont } from './lib/pdfa.js';
import { abortIf, nomeBase, canvasBytes, liberaCanvas, testoPagina, messaggioErrore } from './comune.js';
import { blocchiInTesto, ricostruisciPagina } from './lib/testo.js';

function oggettoImmagine(page, name) {
  const store = name.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    let fatto = false;
    const t = setTimeout(() => { if (!fatto) { fatto = true; resolve(null); } }, 5000);
    try {
      store.get(name, (img) => { if (!fatto) { fatto = true; clearTimeout(t); resolve(img); } });
    } catch { clearTimeout(t); resolve(null); }
  });
}

/** Converte l'oggetto immagine di pdf.js in canvas (ImageBitmap o pixel grezzi). */
function immagineInCanvas(img) {
  if (!img) return null;
  const w = img.width || img.bitmap?.width; const hgt = img.height || img.bitmap?.height;
  if (!w || !hgt) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const ctx = c.getContext('2d');
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  if (!img.data) return null;
  const out = ctx.createImageData(w, hgt);
  const d = out.data; const src = img.data;
  if (img.kind === 3 || src.length === w * hgt * 4) d.set(src.subarray(0, d.length));
  else if (img.kind === 2 || src.length === w * hgt * 3) { for (let i = 0, j = 0; i < w * hgt; i++, j += 3) { d[i * 4] = src[j]; d[i * 4 + 1] = src[j + 1]; d[i * 4 + 2] = src[j + 2]; d[i * 4 + 3] = 255; } }
  else if (img.kind === 1) { // 1 bit per pixel
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1; const v = bit ? 255 : 0; const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return c;
}

async function estraiImmagini(app) {
  const doc = app.activeDoc;
  const v = await app.ui.dialog({
    title: 'Estrai immagini', message: 'Salva in una cartella le immagini contenute nel documento (foto, loghi, grafici), alla loro risoluzione originale.',
    fields: [
      { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
      { name: 'fmt', label: 'Formato', type: 'radio', value: 'png', options: [{ value: 'png', label: 'PNG (qualità perfetta)' }, { value: 'jpeg', label: 'JPG (file più leggeri)' }] },
      { name: 'min', label: 'Ignora le immagini più piccole di', type: 'select', value: '32', options: [{ value: '0', label: 'nessun limite' }, { value: '32', label: '32 pixel (icone e decorazioni)' }, { value: '100', label: '100 pixel' }] },
    ],
    okLabel: 'Scegli la cartella…', validate: (x) => { try { app.parsePages(x.pages); } catch (e) { return e.message; } },
  });
  if (!v) return;
  const pages = app.parsePages(v.pages);
  const folder = await app.platform.chooseFolder('Cartella in cui salvare le immagini');
  if (!folder) return;
  const OPS = app.lib.pdfjs.OPS;
  const min = Number(v.min);
  try {
    const n = await app.ui.withProgress('Estrazione delle immagini', async (p) => {
      const viste = new Set(); let salvate = 0;
      const t0 = performance.now();
      for (let k = 0; k < pages.length; k++) {
        abortIf(p.signal);
        const page = await doc.pdf.getPage(pages[k] + 1);
        try {
          const ops = await page.getOperatorList();
          let nPag = 0;
          for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat) continue;
            const name = ops.argsArray[i][0];
            if (typeof name !== 'string' || viste.has(name)) continue;
            viste.add(name);
            const img = await oggettoImmagine(page, name);
            if (!img || Math.max(img.width || 0, img.height || 0) < min) continue;
            let c = immagineInCanvas(img);
            if (!c) continue;
            try {
              const bytes = await canvasBytes(c, v.fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92);
              nPag++;
              await app.platform.writeInFolder(folder, `${nomeBase(doc.name)}_p${pages[k] + 1}_img${nPag}.${v.fmt === 'png' ? 'png' : 'jpg'}`, bytes);
              salvate++;
            } finally { liberaCanvas(c); c = null; }
          }
        } finally { page.cleanup(); }
        const eta = stimaTempo(performance.now() - t0, k + 1, pages.length);
        p.set((k + 1) / pages.length, `Pagina ${k + 1} di ${pages.length} · ${salvate} immagini${eta ? ' · ' + eta : ''}`);
      }
      return { salvate };
    });
    if (!n) return;
    if (!n.salvate) app.ui.toast('Nessuna immagine trovata nelle pagine scelte.', { kind: 'info' });
    else app.ui.toast(`${n.salvate} ${n.salvate === 1 ? 'immagine salvata' : 'immagini salvate'}`, { kind: 'success', action: folder !== '__download__' ? { label: 'Apri cartella', run: () => app.platform.showInFolder(folder) } : undefined });
  } catch (err) { app.reportError(new Error(messaggioErrore(err)), 'Estrazione non riuscita'); }
}

async function statistiche(app) {
  const doc = app.activeDoc;
  let r;
  try {
    r = await app.ui.withProgress('Statistiche del documento', async (p) => {
      const tot = { parole: 0, caratteri: 0, caratteriSenzaSpazi: 0, frasi: 0, paragrafi: 0 };
      const senza = []; const formati = new Map();
      for (let i = 0; i < doc.pageCount; i++) {
        abortIf(p.signal);
        const t = await testoPagina(doc.pdf, i, { withFonts: false });
        formati.set(formatoPagina(t.width, t.height), (formati.get(formatoPagina(t.width, t.height)) || 0) + 1);
        if (t.chars < 20) senza.push(i + 1);
        const blocks = ricostruisciPagina(t.frags, { width: t.width, height: t.height, detectTables: false });
        const s = statisticheTesto(blocchiInTesto(blocks));
        for (const k of ['parole', 'caratteri', 'caratteriSenzaSpazi', 'frasi']) tot[k] += s[k];
        tot.paragrafi += blocks.length;
        p.set((i + 1) / doc.pageCount, `Pagina ${i + 1} di ${doc.pageCount}`);
      }
      let fonts = [];
      try { fonts = elencoFont(await app.lib.openPdfLib(await app.currentBytes(doc), doc.password), app.lib.PDFLib); } catch { /* */ }
      return { tot, senza, formati, fonts };
    });
  } catch (err) { return app.reportError(new Error(messaggioErrore(err)), 'Statistiche non disponibili'); }
  if (!r) return;
  const { h } = app.ui;
  const f = (n) => n.toLocaleString('it-IT');
  const righe = [
    ['Pagine', f(doc.pageCount)], ['Parole', f(r.tot.parole)], ['Caratteri (spazi inclusi)', f(r.tot.caratteri)], ['Caratteri (spazi esclusi)', f(r.tot.caratteriSenzaSpazi)],
    ['Frasi', f(r.tot.frasi)], ['Paragrafi', f(r.tot.paragrafi)], ['Tempo di lettura', r.tot.parole ? `circa ${minutiLettura(r.tot.parole)} min` : '—'],
    ['Formato delle pagine', [...r.formati].map(([k, n]) => (r.formati.size > 1 ? `${k} (${n})` : k)).join(', ')],
    ['Dimensione del file', app.ui.formatBytes(doc.bytes.length)],
    ['Pagine senza testo', r.senza.length ? `${r.senza.length} (${r.senza.slice(0, 10).join(', ')}${r.senza.length > 10 ? '…' : ''})` : 'nessuna'],
  ];
  const fontNomi = [...new Map(r.fonts.map((x) => [x.nome, x])).values()];
  await app.ui.dialog({
    title: 'Statistiche del documento', cancelLabel: null, okLabel: 'Chiudi', width: 520,
    body: h('div', { class: 'conv-stats' },
      h('table', {}, righe.map(([k, val]) => h('tr', {}, h('th', {}, k), h('td', {}, val)))),
      fontNomi.length ? h('details', {}, h('summary', {}, `Caratteri tipografici usati (${fontNomi.length})`), h('ul', {}, fontNomi.map((x) => h('li', {}, x.nome, x.incorporato ? '' : ' — non incorporato')))) : null,
      h('button', { type: 'button', class: 'btn small', onclick: () => navigator.clipboard?.writeText(righe.map(([k, val]) => `${k}: ${val}`).join('\n')).then(() => app.ui.toast('Statistiche copiate'), () => {}) }, 'Copia')),
  });
}

export function registraImmaginiStatistiche(app) {
  app.registerTool({
    id: 'extract-images', name: 'Estrai immagini', category: 'converti', icon: 'image',
    description: 'Salva le immagini contenute nel PDF',
    keywords: 'estrai immagini foto loghi grafici salva immagini esporta immagini incorporate',
    run: () => estraiImmagini(app),
  });
  app.registerTool({
    id: 'word-count', name: 'Statistiche del documento', category: 'vista', icon: 'info',
    description: 'Conteggio di parole, caratteri e pagine',
    keywords: 'conta parole conteggio caratteri statistiche numero parole battute lunghezza tempo di lettura',
    run: () => statistiche(app),
  });
}
