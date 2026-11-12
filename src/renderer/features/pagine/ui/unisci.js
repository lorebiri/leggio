// «Unisci PDF» (Combina file): elenco di PDF e foto riordinabile, un segnalibro per file.
import { PDFName, PDFDict, PDFArray } from '@cantoo/pdf-lib';
import { openPdfJs } from '../../../core/pdf.js';
import { icon } from '../../../core/icons.js';
import { unisci as unisciLogica } from '../logica/crea.js';
import { intervalli, formatoMB, senzaEstensione } from './util-ui.js';
import { caricaEsterno, preparaImmagine, eImmagine, ePdf, leggiFile, mostraErrore, apriRisultato, FILTRO_TUTTI } from './comune.js';
import { apriVeloce } from '../logica/struttura.js';
import { salva } from '../logica/util.js';

function firmato(lib) {
  try {
    const acro = lib.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    const fields = acro?.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (!fields) return false;
    const visita = (f, prof = 0) => {
      if (!(f instanceof PDFDict) || prof > 10) return false;
      if (f.get(PDFName.of('FT'))?.toString() === '/Sig' && f.get(PDFName.of('V'))) return true;
      const kids = f.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (kids) for (let i = 0; i < kids.size(); i++) if (visita(kids.lookup(i), prof + 1)) return true;
      return false;
    };
    for (let i = 0; i < fields.size(); i++) if (visita(fields.lookup(i))) return true;
  } catch {}
  return false;
}

async function miniaturaPdf(bytes, password) {
  let pdf;
  try {
    ({ pdf } = await openPdfJs(bytes, { password }));
    const page = await pdf.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 112 / Math.max(vp0.width, vp0.height) });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
    page.cleanup();
    return cv;
  } catch { return null; } finally { pdf?.loadingTask?.destroy(); }
}

export async function apriUnisci(app, { file = [], includiAttivo = true, titolo = 'Unisci PDF (Combina file)', nomeRisultato } = {}) {
  const { h } = app.ui;
  const voci = []; // { id, nome, tipo, bytes, lib, pagine, intervallo, thumb, firmato, url }
  let seq = 0;
  const lista = h('div', { class: 'pg-lista', role: 'list', 'aria-label': 'File da unire' });
  const riepilogo = h('span', { class: 'help' });
  const avvisi = h('div', {});

  const aggiungiDoc = async (d) => {
    const bytes = await app.currentBytes(d);
    const lib = await apriVeloce(bytes, d.password);
    voci.push({ id: ++seq, nome: d.name, tipo: 'pdf', bytes, lib, pagine: lib.getPageCount(), intervallo: '', firmato: firmato(lib), password: d.password });
    disegna();
    const cv = await miniaturaPdf(bytes, d.password); const v = voci.find((x) => x.lib === lib); if (v) { v.thumb = cv; disegna(); }
  };
  const aggiungiFile = async (files) => {
    for (const f of files) {
      try {
        if (eImmagine(f.name)) {
          const img = await preparaImmagine(app, f.bytes, f.name);
          const url = URL.createObjectURL(new Blob([img.bytes]));
          voci.push({ id: ++seq, nome: f.name, tipo: 'immagine', bytes: img.bytes, pagine: 1, url });
          disegna();
        } else if (ePdf(f.name) || f.bytes?.[0] === 0x25) {
          const lib = await caricaEsterno(app, f.bytes, f.name);
          if (!lib) continue;
          const bytes = lib.isEncrypted ? await salva(lib) : f.bytes;
          const v = { id: ++seq, nome: f.name, tipo: 'pdf', bytes, lib, pagine: lib.getPageCount(), intervallo: '', firmato: firmato(lib) };
          voci.push(v); disegna();
          miniaturaPdf(bytes).then((cv) => { v.thumb = cv; disegna(); });
        } else app.ui.toast(`«${f.name}» non è un PDF né un'immagine: non lo aggiungo.`, { kind: 'warning', timeout: 6000 });
      } catch (err) { mostraErrore(app, err, `Impossibile aggiungere «${f.name}»`); }
    }
  };
  const sposta = (k, d) => { const j = k + d; if (j < 0 || j >= voci.length) return; [voci[k], voci[j]] = [voci[j], voci[k]]; disegna(); lista.querySelectorAll('.pg-voce')[j]?.querySelector(d < 0 ? '[data-su]' : '[data-giu]')?.focus(); };

  let trascinata = null;
  function disegna() {
    lista.innerHTML = '';
    if (!voci.length) lista.append(h('div', { class: 'pg-lista-vuota' }, h('p', {}, 'Nessun file. Usa «Aggiungi file…» oppure trascina qui PDF e foto (JPG, PNG, HEIC).')));
    voci.forEach((v, k) => {
      let errore = '';
      if (v.tipo === 'pdf' && v.intervallo.trim()) { try { intervalli(v.intervallo, v.pagine); } catch (e) { errore = e.message; } }
      const range = v.tipo === 'pdf' ? h('input', { type: 'text', class: 'pg-input', value: v.intervallo, placeholder: 'Tutte le pagine', 'aria-label': `Pagine di ${v.nome}`, title: 'Pagine da prendere, es. 1-3, 5' }) : h('span', { class: 'help' }, 'Foto → 1 pagina');
      if (v.tipo === 'pdf') range.addEventListener('change', () => { v.intervallo = range.value; disegna(); });
      const thumb = h('div', { class: 'pg-voce-thumb' });
      if (v.thumb) thumb.append(v.thumb.cloneNode ? (() => { const c = document.createElement('canvas'); c.width = v.thumb.width; c.height = v.thumb.height; c.getContext('2d').drawImage(v.thumb, 0, 0); return c; })() : v.thumb);
      else if (v.url) thumb.append(h('img', { src: v.url, alt: '' }));
      const riga = h('div', { class: 'pg-voce', role: 'listitem', draggable: 'true', 'data-k': k },
        h('span', { class: 'pg-voce-n' }, String(k + 1)), thumb,
        h('div', { class: 'pg-voce-nome' }, h('strong', { title: v.nome }, v.nome),
          errore ? h('small', { class: 'err' }, errore) : h('small', {}, v.tipo === 'pdf' ? `${v.pagine} ${v.pagine === 1 ? 'pagina' : 'pagine'} · ${formatoMB(v.bytes.length)}${v.firmato ? ' · firmato digitalmente' : ''}` : `Foto · ${formatoMB(v.bytes.length)} · adattata e raddrizzata`)),
        range,
        h('div', { class: 'pg-voce-az' },
          h('button', { type: 'button', title: 'Sposta su', 'aria-label': `Sposta su ${v.nome}`, 'data-su': '', disabled: k === 0, onclick: () => sposta(k, -1), html: icon('chevronUp', 18) }),
          h('button', { type: 'button', title: 'Sposta giù', 'aria-label': `Sposta giù ${v.nome}`, 'data-giu': '', disabled: k === voci.length - 1, onclick: () => sposta(k, 1), html: icon('chevronDown', 18) }),
          h('button', { type: 'button', class: 'danger', title: 'Togli dall\'elenco', 'aria-label': `Togli ${v.nome}`, onclick: () => { const [x] = voci.splice(k, 1); if (x.url) URL.revokeObjectURL(x.url); disegna(); }, html: icon('close', 18) })));
      riga.addEventListener('dragstart', (e) => { trascinata = k; riga.classList.add('trascina'); e.dataTransfer.setData('text/x-leggio-voce', String(k)); e.dataTransfer.effectAllowed = 'move'; });
      riga.addEventListener('dragend', () => { trascinata = null; riga.classList.remove('trascina'); });
      riga.addEventListener('dragover', (e) => { if (trascinata == null) return; e.preventDefault(); e.stopPropagation(); riga.classList.add('sopra'); });
      riga.addEventListener('dragleave', () => riga.classList.remove('sopra'));
      riga.addEventListener('drop', (e) => { if (trascinata == null) return; e.preventDefault(); e.stopPropagation(); riga.classList.remove('sopra'); const [x] = voci.splice(trascinata, 1); voci.splice(trascinata < k ? k - 1 : k, 0, x); trascinata = null; disegna(); });
      lista.append(riga);
    });
    const tot = voci.reduce((s, v) => { if (v.tipo !== 'pdf' || !v.intervallo.trim()) return s + v.pagine; try { return s + intervalli(v.intervallo, v.pagine).length; } catch { return s; } }, 0);
    riepilogo.textContent = voci.length ? `${voci.length} file · ${tot} pagine in tutto` : '';
    avvisi.innerHTML = '';
    const firmati = voci.filter((v) => v.firmato);
    if (firmati.length) avvisi.append(h('div', { class: 'pg-avviso' }, `Attenzione: ${firmati.map((v) => `«${v.nome}»`).join(', ')} ${firmati.length === 1 ? 'è firmato' : 'sono firmati'} digitalmente. Nel PDF unito la firma non sarà più verificabile: conserva anche l'originale.`));
  }
  // file trascinati dal computer sull'elenco
  lista.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); lista.classList.add('drop'); } });
  lista.addEventListener('dragleave', (e) => { if (!lista.contains(e.relatedTarget)) lista.classList.remove('drop'); });
  lista.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault(); e.stopPropagation(); lista.classList.remove('drop');
    const fs = []; for (const f of e.dataTransfer.files) fs.push(await leggiFile(f));
    await aggiungiFile(fs);
  });

  const altriAperti = () => app.docs.filter((d) => !voci.some((v) => v.nome === d.name && v.tipo === 'pdf'));
  const corpo = h('div', {},
    h('p', { class: 'dlg-msg' }, 'Metti in ordine i file: diventeranno un unico PDF, nell\'ordine dell\'elenco. Le foto vengono raddrizzate e adattate alla pagina.'),
    h('div', { class: 'pg-lista-az' },
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { const fs = await app.platform.openFiles({ multiple: true, filters: FILTRO_TUTTI, raw: true, title: 'Aggiungi PDF o foto' }); if (fs?.length) await aggiungiFile(fs); }, html: icon('plus', 16) + '<span>Aggiungi file…</span>' }),
      h('button', { type: 'button', class: 'btn', onclick: async () => { const altri = altriAperti(); if (!altri.length) return app.ui.toast('Tutti i documenti aperti sono già nell\'elenco'); for (const d of altri) await aggiungiDoc(d); }, html: icon('pages', 16) + '<span>Aggiungi i documenti aperti</span>' }),
      h('button', { type: 'button', class: 'btn', onclick: () => { voci.sort((a, b) => a.nome.localeCompare(b.nome, 'it', { numeric: true })); disegna(); } }, 'Ordina per nome'),
      h('span', { style: { flex: 1 } }), riepilogo),
    lista, avvisi);

  if (includiAttivo && app.activeDoc) await aggiungiDoc(app.activeDoc).catch((err) => mostraErrore(app, err, 'Unisci PDF'));
  if (file.length) await aggiungiFile(file);
  disegna();

  const opz = app.settings.get('pagine.unisci', { segnalibri: true, originali: true, formato: 'A4' });
  const v = await app.ui.dialog({ title: titolo, body: corpo, width: 820, okLabel: includiAttivo ? 'Unisci' : 'Crea PDF', fields: [
    { name: 'segnalibri', label: 'Crea un segnalibro per ogni file, con il suo nome', type: 'checkbox', value: opz.segnalibri },
    { name: 'originali', label: 'Mantieni i segnalibri dei file (sotto il segnalibro del file)', type: 'checkbox', value: opz.originali },
    { name: 'formato', label: 'Pagine delle foto', type: 'select', value: opz.formato, options: [{ value: 'A4', label: 'A4, foto adattata con margine' }, { value: 'Letter', label: 'Lettera USA' }, { value: 'immagine', label: 'Grandi come la foto' }] },
  ], validate: () => {
    if (!voci.length) return 'Aggiungi almeno un file.';
    if (voci.length === 1 && voci[0].tipo === 'pdf') return 'Aggiungi almeno un altro file da unire.';
    for (const x of voci) if (x.tipo === 'pdf' && x.intervallo.trim()) { try { intervalli(x.intervallo, x.pagine); } catch (e) { return `«${x.nome}»: ${e.message}`; } }
    return null;
  } });
  const pulisci = () => voci.forEach((x) => x.url && URL.revokeObjectURL(x.url));
  if (!v) return pulisci();
  app.settings.set('pagine.unisci', { segnalibri: v.segnalibri, originali: v.originali, formato: v.formato });
  const bytes = await app.ui.withProgress('Unione dei file', async (p) => {
    const out = await unisciLogica(voci.map((x) => ({ nome: x.nome, tipo: x.tipo, bytes: x.bytes, doc: x.lib, indici: x.tipo === 'pdf' && x.intervallo.trim() ? intervalli(x.intervallo, x.pagine) : null })), {
      segnalibri: v.segnalibri, segnalibriOriginali: v.originali, formatoImmagini: v.formato,
      onProgress: (f, nome) => p.set(f * 0.85, `Aggiunto «${nome}»`), signal: p.signal,
    });
    p.set(0.9, 'Salvataggio…');
    return salva(out);
  }).catch((err) => { mostraErrore(app, err, 'Unisci PDF'); return null; });
  pulisci();
  if (bytes) await apriRisultato(app, bytes, nomeRisultato || (voci.length === 1 ? `${senzaEstensione(voci[0].nome)}.pdf` : `${senzaEstensione(voci[0].nome)}_unito.pdf`));
}
