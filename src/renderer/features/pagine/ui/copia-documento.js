// «Copia documento fronte/retro»: interfaccia. Pagine da PDF o foto → coppie fronte/retro → tessera trovata
// da sola (angoli regolabili a mano) → un PDF nuovo con fronte e retro su un foglio, in dimensione reale.
// Tutto in locale: nessun dato esce dal computer. I file di partenza non vengono toccati.
import { openPane } from '../../avanzati/pane.js';
import { openPdfJs, destroyPdf } from '../../../core/pdf.js';
import { fitScale } from '../../../core/printplan.js';
import { preparaImmagine, eImmagine, ePdf } from './comune.js';
import { drawWatermark } from '../../sicurezza/codec.js';
import { testoFiligrana, dataItaliana } from '../../sicurezza/logica/documenti-identita.js';
import {
  trovaTessera, raddrizza, migliora, impagina, pixelUscita, coppiePredefinite, ruotaAngoli, FORMATI_DOCUMENTO,
} from '../logica/copia-documento.js';

const DPI_ANALISI = 150; // anteprima e rilevamento
const DPI_STAMPA = 300; // uscita
const MAX_PAGINE = 40;

/** Pagina sorgente: { id, nome, etichetta, render(dpi) → canvas, larghezza/altezza in pollici, corners (0…1), confidenza } */
async function renderPdfPage(pdf, i, dpi) {
  const page = await pdf.getPage(i + 1);
  try {
    // pagine enormi (foto salvate in PDF a 1 pixel = 1 punto, 4000 × 3000 pt e oltre): risoluzione limitata, oltre
    // i limiti Chromium crea un canvas vuoto senza errori e la memoria finisce
    const base = page.getViewport({ scale: 1 });
    const limiti = dpi >= DPI_STAMPA ? { maxSide: 8000, maxPixels: 40e6 } : { maxSide: 3000, maxPixels: 8e6 };
    const vp = page.getViewport({ scale: fitScale(base.width, base.height, dpi / 72, limiti) });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp, intent: 'print' }).promise;
    return c;
  } finally { page.cleanup(); }
}

async function canvasDaImmagine(bytes, maxLato) {
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  const k = Math.min(1, maxLato / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

const imageData = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height);

export async function apriCopiaDocumento(app) {
  const { h } = app.ui;
  const S = { pagine: [], coppie: [], scartate: new Set(), aperti: [], seq: 0, opz: { formato: 'id1', carta: 'A4', scala: 'reale', colore: 'colore', contrasto: false, destinatario: '', finalita: '', data: dataItaliana() } };
  Object.assign(S.opz, app.settings.get('copiaDoc.opz', {}), { destinatario: '', finalita: '', data: dataItaliana() });
  const pane = openPane(app, { title: 'Copia documento fronte/retro', subtitle: 'Fronte e retro di una tessera su un solo foglio, in dimensione reale', id: 'copia-documento',
    onClose: () => { for (const p of S.aperti) destroyPdf(p); S.aperti = []; } });

  const elenco = h('div', { class: 'cd-coppie', 'aria-live': 'polite' });
  const avviso = h('p', { class: 'cd-nota' }, 'Elaborazione tutta sul tuo computer: le scansioni non vengono inviate da nessuna parte. I file di partenza non vengono modificati.');
  const crea = h('button', { class: 'btn primary', disabled: true, onclick: () => creaPdf().catch((e) => app.reportError(e, 'Copia documento non creata')) }, 'Crea il PDF');
  pane.actions.append(
    app.activeDoc ? h('button', { class: 'btn', onclick: () => aggiungiDoc(app.activeDoc).catch((e) => app.reportError(e, 'Documento non aggiunto')) }, 'Usa il documento aperto') : null,
    h('button', { class: 'btn', onclick: () => scegliFile().catch((e) => app.reportError(e, 'File non aggiunti')) }, 'Aggiungi PDF o foto…'),
    crea);

  // ---------- opzioni ----------
  const sel = (nome, valore, opzioni, onchange) => h('select', { class: 'input', 'aria-label': nome, onchange: (e) => onchange(e.target.value) }, opzioni.map(([v, l]) => h('option', { value: v, selected: v === valore }, l)));
  const campo = (etichetta, el) => h('label', { class: 'cd-campo' }, h('span', {}, etichetta), el);
  const salvaOpz = () => { const { destinatario, finalita, data, ...resto } = S.opz; app.settings.set('copiaDoc.opz', resto); };
  const opzioni = h('div', { class: 'cd-opzioni' },
    campo('Documento', sel('Documento', S.opz.formato, Object.values(FORMATI_DOCUMENTO).map((f) => [f.id, f.nome]), (v) => { S.opz.formato = v; salvaOpz(); ridisegnaTutto(true); })),
    campo('Foglio', sel('Foglio', S.opz.carta, [['A4', 'A4'], ['Letter', 'Lettera (USA)']], (v) => { S.opz.carta = v; salvaOpz(); })),
    campo('Dimensione', sel('Dimensione', S.opz.scala, [['reale', 'Reale (1:1, come l\'originale)'], ['ingrandita', 'Ingrandita (più leggibile)']], (v) => { S.opz.scala = v; salvaOpz(); })),
    campo('Colori', sel('Colori', S.opz.colore, [['colore', 'A colori'], ['bn', 'Bianco e nero']], (v) => { S.opz.colore = v; salvaOpz(); })),
    h('label', { class: 'cd-check' }, h('input', { type: 'checkbox', checked: S.opz.contrasto, onchange: (e) => { S.opz.contrasto = e.target.checked; salvaOpz(); } }), 'Migliora il contrasto'),
    campo('Filigrana: «Copia per uso esclusivo di…» (facoltativa)', h('input', { class: 'input', placeholder: 'es. Comune di Pisa', oninput: (e) => { S.opz.destinatario = e.target.value; } })),
    campo('Finalità (facoltativa)', h('input', { class: 'input', placeholder: 'es. iscrizione al nido', oninput: (e) => { S.opz.finalita = e.target.value; } })),
    campo('Data', h('input', { class: 'input', value: S.opz.data, oninput: (e) => { S.opz.data = e.target.value; } })));

  const vuoto = h('div', { class: 'cd-vuoto' },
    h('p', {}, 'Aggiungi la scansione del documento: un PDF con il fronte e il retro (una pagina per lato) oppure due foto. Puoi anche trascinare qui i file. Con più documenti nello stesso PDF, scegli le coppie pagina per pagina.'));
  pane.body.append(h('div', { class: 'cd-wrap' }, avviso, opzioni, vuoto, elenco));

  // trascinamento di file nello spazio di lavoro
  pane.el.addEventListener('dragover', (e) => { e.preventDefault(); pane.el.classList.add('cd-drop'); });
  pane.el.addEventListener('dragleave', () => pane.el.classList.remove('cd-drop'));
  pane.el.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); pane.el.classList.remove('cd-drop');
    const files = [...(e.dataTransfer?.files || [])];
    aggiungiTutti(files.map((f) => ({ name: f.name, leggi: async () => new Uint8Array(await f.arrayBuffer()) })));
  });

  // un file non valido non deve fermare gli altri: si aggiungono tutti quelli buoni e si segnalano gli altri insieme
  async function aggiungiTutti(voci) {
    const scartati = [];
    for (const v of voci) {
      try { await aggiungiFile({ name: v.name, bytes: v.bytes || await v.leggi() }); } catch (err) { scartati.push([v.name, err]); }
    }
    if (scartati.length === 1) app.reportError(scartati[0][1], 'File non aggiunto');
    else if (scartati.length > 1) {
      for (const [, err] of scartati) console.warn('Copia documento: file non aggiunto —', err);
      app.ui.dialog({ title: 'Alcuni file non sono stati aggiunti', message: scartati.map(([n, err]) => { const m = String(err?.message || err); return m.includes(n) ? m : `«${n}»: ${m}`; }).join('\n'), cancelLabel: null, okLabel: 'Ho capito' });
    }
  }

  // ---------- sorgenti ----------
  async function scegliFile() {
    const files = await app.platform.openFiles({ multiple: true, raw: true, title: 'Scansioni del documento', filters: [{ name: 'PDF e foto', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] }] });
    await aggiungiTutti((files || []).map((f) => ({ name: f.name, bytes: f.bytes })));
  }
  async function aggiungiDoc(doc) {
    const { pdf } = await openPdfJs(await app.currentBytes(doc), { password: doc.password });
    S.aperti.push(pdf);
    await aggiungiPdf(pdf, doc.name);
  }
  async function aggiungiFile(f) {
    if (ePdf(f.name) || (!eImmagine(f.name) && new TextDecoder('latin1').decode(f.bytes.subarray(0, 1024)).includes('%PDF-'))) {
      const { pdf } = await openPdfJs(f.bytes, { onPassword: () => app.ui.prompt(`«${f.name}» è protetto. Inserisci la password:`, '', { title: 'File protetto', type: 'password' }) });
      S.aperti.push(pdf);
      return aggiungiPdf(pdf, f.name);
    }
    if (!eImmagine(f.name)) throw new Error(`«${f.name}» non è un PDF né una foto (usa PDF, JPG, PNG o HEIC).`);
    const img = await preparaImmagine(app, f.bytes, f.name);
    const bytes = img.bytes;
    await aggiungiPagina({ nome: f.name, etichetta: f.name, render: (dpi) => canvasDaImmagine(bytes, dpi >= DPI_STAMPA ? 6000 : 1800) });
    finePagine();
  }
  async function aggiungiPdf(pdf, nome) {
    const n = Math.min(pdf.numPages, MAX_PAGINE - S.pagine.length);
    if (n < pdf.numPages) app.ui.toast(`Sono state prese solo le prime ${n} pagine di «${nome}».`, { kind: 'warning' });
    await app.ui.withProgress('Ricerca del documento nelle pagine…', async (p) => {
      for (let i = 0; i < n; i++) {
        p.set(i / n, `Pagina ${i + 1} di ${n}`);
        await aggiungiPagina({ nome, etichetta: `${nome} — pagina ${i + 1}`, render: (dpi) => renderPdfPage(pdf, i, dpi) });
      }
    });
    finePagine();
  }
  async function aggiungiPagina(src) {
    const c = await src.render(DPI_ANALISI);
    const pg = { id: ++S.seq, ...src, anteprima: c, corners: null, confidenza: 0 };
    rileva(pg);
    S.pagine.push(pg);
  }
  function rileva(pg) {
    const c = pg.anteprima;
    const r = trovaTessera(imageData(c), { rapporto: FORMATI_DOCUMENTO[S.opz.formato].w / FORMATI_DOCUMENTO[S.opz.formato].h });
    if (r) { pg.corners = r.corners.map(([x, y]) => [x / c.width, y / c.height]); pg.confidenza = r.confidenza; }
    else { pg.corners = tuttaLaPagina(); pg.confidenza = 0; }
  }
  const tuttaLaPagina = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
  function finePagine() {
    // coppie: dalle pagine non ancora usate, in ordine (1-2, 3-4…)
    // le pagine di una coppia tolta dall'utente non vengono riproposte
    const usate = new Set([...S.coppie.flatMap((c) => c), ...S.scartate]);
    const libere = S.pagine.filter((p) => !usate.has(p.id));
    // una coppia rimasta senza retro prende la prima pagina nuova (es. due foto aggiunte una alla volta)
    const ultima = S.coppie[S.coppie.length - 1];
    if (ultima && ultima[1] == null && ultima[0] != null && libere.length) ultima[1] = libere.shift().id;
    for (const [a, b] of coppiePredefinite(libere.length)) S.coppie.push([libere[a].id, b == null ? null : libere[b].id]);
    ridisegnaTutto(false);
  }

  // ---------- coppie ----------
  const pagina = (id) => S.pagine.find((p) => p.id === id);
  function ridisegnaTutto(rilevaDiNuovo) {
    // cambiando il tipo di documento si cerca di nuovo la tessera, ma gli angoli sistemati a mano restano
    if (rilevaDiNuovo) for (const p of S.pagine) if (!p.manuale) rileva(p);
    vuoto.hidden = S.pagine.length > 0;
    elenco.innerHTML = '';
    S.coppie.forEach((cp, i) => elenco.append(rigaCoppia(cp, i)));
    if (S.pagine.length) elenco.append(h('button', { class: 'btn small', onclick: () => { S.coppie.push([S.pagine[0].id, null]); ridisegnaTutto(false); } }, 'Aggiungi un\'altra coppia'));
    crea.disabled = !S.coppie.some((c) => c[0] != null || c[1] != null);
  }
  function rigaCoppia(cp, i) {
    const scelta = (lato) => h('select', { class: 'input', 'aria-label': `${lato ? 'Retro' : 'Fronte'} della coppia ${i + 1}`, onchange: (e) => { cp[lato] = e.target.value ? Number(e.target.value) : null; ridisegnaTutto(false); } },
      h('option', { value: '' }, lato ? '— nessun retro —' : '— nessun fronte —'),
      S.pagine.map((p) => h('option', { value: p.id, selected: cp[lato] === p.id }, p.etichetta)));
    const lato = (k) => {
      const pg = pagina(cp[k]);
      return h('div', { class: 'cd-lato' }, h('div', { class: 'cd-lato-tit' }, k ? 'Retro' : 'Fronte'), scelta(k), pg ? editorAngoli(pg) : h('div', { class: 'cd-nessuno' }, 'Nessuna pagina'));
    };
    return h('section', { class: 'cd-coppia', 'aria-label': `Coppia ${i + 1}` },
      h('div', { class: 'cd-coppia-tit' }, h('strong', {}, `Documento ${i + 1}`),
        S.coppie.length > 1 ? h('button', { class: 'btn small', onclick: () => { for (const id of S.coppie[i]) if (id != null) S.scartate.add(id); S.coppie.splice(i, 1); ridisegnaTutto(false); } }, 'Togli') : null),
      h('div', { class: 'cd-lati' }, lato(0), lato(1)));
  }

  /** Anteprima della pagina con il quadrilatero e 4 maniglie trascinabili, più il ritaglio risultante. */
  function editorAngoli(pg) {
    const W = 220; const k = W / pg.anteprima.width; const H = Math.round(pg.anteprima.height * k);
    const base = h('canvas', { width: W, height: H, class: 'cd-pagina', 'aria-hidden': 'true' });
    base.getContext('2d').drawImage(pg.anteprima, 0, 0, W, H);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'cd-quad');
    const poly = document.createElementNS(svgNS, 'polygon'); svg.append(poly);
    const maniglie = [0, 1, 2, 3].map((n) => {
      const c = document.createElementNS(svgNS, 'circle'); c.setAttribute('r', '7'); c.setAttribute('class', 'cd-maniglia' + (n === 0 ? ' cd-primo' : ''));
      c.setAttribute('tabindex', '0'); c.setAttribute('role', 'slider'); c.setAttribute('aria-label', ['Angolo in alto a sinistra', 'Angolo in alto a destra', 'Angolo in basso a destra', 'Angolo in basso a sinistra'][n] + ' del documento (frecce per spostare)');
      svg.append(c); return c;
    });
    const ritaglio = h('canvas', { class: 'cd-ritaglio', width: 214, height: 135, title: 'Come verrà stampato' });
    const stato = h('div', { class: 'cd-stato' });
    const aggiorna = () => {
      poly.setAttribute('points', pg.corners.map(([x, y]) => `${x * W},${y * H}`).join(' '));
      maniglie.forEach((m, n) => { m.setAttribute('cx', pg.corners[n][0] * W); m.setAttribute('cy', pg.corners[n][1] * H); });
      const f = FORMATI_DOCUMENTO[S.opz.formato];
      ritaglio.height = Math.round(214 * f.h / f.w);
      const src = imageData(pg.anteprima);
      pg.angoliValidi = true;
      try {
        const out = raddrizza(src, pg.corners.map(([x, y]) => [x * pg.anteprima.width, y * pg.anteprima.height]), ritaglio.width, ritaglio.height);
        ritaglio.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
      } catch {
        // angoli impossibili (tre sulla stessa linea, due sovrapposti): avviso nel riquadro, l'elenco resta usabile
        pg.angoliValidi = false;
        const g = ritaglio.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, ritaglio.width, ritaglio.height);
        stato.textContent = 'Angoli non validi: allargali sui quattro angoli della tessera, oppure usa «Rileva di nuovo».';
        stato.className = 'cd-stato warn';
        return;
      }
      stato.textContent = pg.confidenza >= 0.75 ? 'Documento trovato. Controlla il ritaglio; se serve, sposta gli angoli.' : pg.confidenza > 0 ? 'Documento trovato con qualche dubbio: controlla gli angoli.' : 'Documento non trovato: trascina gli angoli sui bordi della tessera.';
      stato.className = 'cd-stato ' + (pg.confidenza >= 0.75 ? 'ok' : 'warn');
    };
    let drag = -1;
    const punto = (e) => { const r = svg.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    maniglie.forEach((m, n) => {
      m.addEventListener('pointerdown', (e) => { drag = n; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      m.addEventListener('keydown', (e) => {
        const d = (e.shiftKey ? 10 : 1) / W; const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
        if (!mv) return; e.preventDefault();
        pg.corners[n] = [Math.min(1, Math.max(0, pg.corners[n][0] + mv[0])), Math.min(1, Math.max(0, pg.corners[n][1] + mv[1]))];
        pg.confidenza = Math.max(pg.confidenza, 0.75); pg.manuale = true; aggiorna();
      });
    });
    svg.addEventListener('pointermove', (e) => { if (drag < 0) return; pg.corners[drag] = punto(e); poly.setAttribute('points', pg.corners.map(([x, y]) => `${x * W},${y * H}`).join(' ')); maniglie[drag].setAttribute('cx', pg.corners[drag][0] * W); maniglie[drag].setAttribute('cy', pg.corners[drag][1] * H); });
    svg.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; pg.confidenza = Math.max(pg.confidenza, 0.75); pg.manuale = true; aggiorna(); } });
    const btn = (t, title, fn) => h('button', { class: 'btn small', title, onclick: () => { fn(); aggiorna(); } }, t);
    const ed = h('div', { class: 'cd-editor' },
      h('div', { class: 'cd-area' }, base, svg),
      h('div', { class: 'cd-destra' }, ritaglio, stato,
        h('div', { class: 'cd-bottoni' },
          btn('Ruota ↻', 'Ruota il documento di 90° in senso orario', () => { pg.corners = ruotaAngoli(pg.corners, 3); pg.manuale = true; }),
          btn('Capovolgi', 'Gira il documento di 180°', () => { pg.corners = ruotaAngoli(pg.corners, 2); pg.manuale = true; }),
          btn('Rileva di nuovo', 'Cerca di nuovo il documento nella pagina', () => { rileva(pg); pg.manuale = false; }),
          btn('Tutta la pagina', 'Usa tutta la pagina (se la scansione è già ritagliata)', () => { pg.corners = tuttaLaPagina(); pg.confidenza = 1; pg.manuale = true; }))));
    aggiorna();
    return ed;
  }

  // ---------- uscita ----------
  async function lato(pg) {
    const { w, h: hh } = pixelUscita(S.opz.formato, DPI_STAMPA);
    const c = await pg.render(DPI_STAMPA);
    const out = raddrizza(imageData(c), pg.corners.map(([x, y]) => [x * c.width, y * c.height]), w, hh);
    c.width = c.height = 1;
    migliora(out, { biancoNero: S.opz.colore === 'bn', contrasto: S.opz.contrasto });
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d'); ctx.putImageData(new ImageData(out.data, w, hh), 0, 0);
    const fil = testoFiligrana({ destinatario: S.opz.destinatario, finalita: S.opz.finalita, data: S.opz.data });
    if (fil) drawWatermark(ctx, w, hh, fil);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function creaPdf() {
    const coppie = S.coppie.filter((c) => c[0] != null || c[1] != null);
    if (!coppie.length) return;
    if (coppie.some((c) => c.some((id) => pagina(id)?.angoliValidi === false))) {
      app.ui.dialog({ title: 'Copia documento', message: 'In una delle pagine gli angoli della tessera non sono validi: sistemali o usa «Rileva di nuovo», poi riprova.', cancelLabel: null, okLabel: 'Ho capito' });
      return;
    }
    const L = impagina({ formato: S.opz.formato, carta: S.opz.carta, scala: S.opz.scala });
    const { PDFLib } = app.lib;
    const bytes = await app.ui.withProgress('Creazione della copia del documento…', async (p) => {
      const d = await PDFLib.PDFDocument.create();
      d.setTitle('Copia documento'); d.setCreator('Leggio'); d.setProducer('Leggio');
      for (let i = 0; i < coppie.length; i++) {
        p.set(i / coppie.length, `Documento ${i + 1} di ${coppie.length}`);
        const page = d.addPage(L.pagina);
        for (const [k, rect] of [[0, L.fronte], [1, L.retro]]) {
          const pg = pagina(coppie[i][k]); if (!pg) continue;
          const img = await d.embedJpg(await lato(pg));
          const box = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
          page.drawImage(img, box);
          // contorno sottile (per ritagliare a mano la stampa)
          page.drawRectangle({ ...box, borderColor: PDFLib.rgb(0.75, 0.75, 0.75), borderWidth: 0.4 });
        }
      }
      return d.save();
    });
    if (!bytes) return;
    const doc = await app.openBytes(new Uint8Array(bytes), { name: 'Copia documento fronte-retro.pdf', dirty: true });
    if (doc) app.ui.toast(`Copia pronta: ${coppie.length} ${coppie.length === 1 ? 'foglio' : 'fogli'}, ${S.opz.scala === 'reale' ? 'dimensione reale (stampa al 100%, senza «Adatta alla pagina»)' : 'ingrandita'}. Salvala con «Salva con nome».`, { kind: 'success', timeout: 9000 });
  }

  if (app.activeDoc && app.activeDoc.pageCount >= 1 && app.activeDoc.pageCount <= MAX_PAGINE) {
    await aggiungiDoc(app.activeDoc).catch((e) => app.reportError(e, 'Documento non aggiunto'));
  } else ridisegnaTutto(false);
  return { pane, stato: S };
}
