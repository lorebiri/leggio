// «Pronto per la pubblicazione» (Amministrazione Trasparente): procedura guidata in un pannello a destra, sul
// documento attivo. Usa i servizi delle altre aree: oscuramento (sicurezza), sanificazione (sicurezza),
// PDF/A e controllo di accessibilità (conversione). Alla fine salva «_pubblicabile.pdf» e un rapporto PDF da archiviare.
import { prepareAccessibility } from './accessibility.js';
import { testoSicuro } from '../lib/protocollo.js';
import { aCapo } from '../lib/conformita.js';
import { sha256Hex, fmtData } from '../lib/report.js';

const PASSI = [
  { id: 'oscura', titolo: 'Oscura i dati personali', spiega: 'Codici fiscali, IBAN, indirizzi, telefoni, firme: cerca e oscura in modo definitivo (il testo sotto viene eliminato).' },
  { id: 'sanifica', titolo: 'Togli metadati e contenuti nascosti', spiega: 'Autore, programma, commenti, allegati, livelli nascosti, JavaScript, versioni precedenti.' },
  { id: 'accessibile', titolo: 'Rendi accessibile', spiega: 'Titolo, lingua, testo alternativo delle immagini, struttura per gli screen reader.' },
  { id: 'pdfa', titolo: 'Converti in PDF/A', spiega: 'Formato per la conservazione nel tempo, con verifica.' },
  { id: 'controllo', titolo: 'Controlla l\'accessibilità', spiega: 'Verifica finale con l\'elenco di cosa va e cosa no.' },
  { id: 'salva', titolo: 'Salva «_pubblicabile.pdf» e il rapporto', spiega: 'Copia pronta da pubblicare e rapporto PDF da archiviare con la pratica.' },
];

export function prontoPubblicazione(app) {
  const doc0 = app.activeDoc;
  const stato = (doc0.data.pubblicabile ||= { inizio: Date.now(), originale: doc0.name, esiti: {} });
  const { h } = app.ui;
  let off = [];
  const c = app.openRightPanel('Pronto per la pubblicazione', { onClose: () => off.forEach((o) => o()) });
  const render = () => {
    if (!c.isConnected) { off.forEach((o) => o()); return; }
    const doc = app.activeDoc;
    const s = doc?.data?.pubblicabile || stato;
    if (doc && !doc.data.pubblicabile) doc.data.pubblicabile = s; // continua sul documento attivo (es. la copia «_oscurato»)
    c.innerHTML = '';
    c.append(h('div', { class: 'pad av-side' },
      h('p', { class: 'av-note' }, `Documento: ${doc?.name || '—'}. Esegui i passi in ordine; ognuno si può annullare con «Annulla».`),
      ...PASSI.map((p, i) => {
        const e = s.esiti[p.id];
        return h('div', { class: 'av-box' },
          h('h3', {}, h('span', { class: 'av-step-n' }, e?.fatto ? '✓' : String(i + 1)), p.titolo),
          h('p', { class: 'av-note' }, p.spiega),
          e ? h('p', { class: e.ok === false ? 'av-warn' : 'av-ok' }, e.testo) : null,
          h('div', { class: 'av-row' }, ...azioni(p.id, s)));
      })));
  };
  const segna = (s, id, ok, testo, dati) => { s.esiti[id] = { fatto: true, ok, testo, dati, ora: Date.now() }; render(); };
  off = [app.bus.on('document:activated', render), app.bus.on('document:changed', () => setTimeout(render, 50))];
  const btn = (label, fn, primary) => h('button', { class: primary ? 'btn small primary' : 'btn small', onclick: async () => { try { await fn(); } catch (err) { if (err?.name !== 'AbortError') app.reportError(err, label); } } }, label);
  const servizio = (n) => typeof app.services?.[n] === 'function' ? app.services[n] : null;
  function azioni(id, s) {
    const doc = app.activeDoc;
    switch (id) {
      case 'oscura': {
        const auto = servizio('oscuraDatiPersonali');
        return [
          auto ? btn('Oscura automaticamente…', async () => {
            const r = await app.ui.withProgress('Oscuramento dei dati personali', async (p) => auto(await app.currentBytes(doc), { password: doc.password, progress: p }));
            if (!r) return;
            await app.applyEdit('Dati personali oscurati', async () => r.bytes, doc);
            segna(s, id, r.verifica !== false, `Oscurati ${r.trovati ?? '?'} dati personali${r.verifica === false ? ' — la verifica finale ha trovato testo residuo' : ''}.`, { trovati: r.trovati });
          }, true) : null,
          app.tools.get('redact-search') ? btn('Apri «Cerca e oscura»', () => { app.tools.run('redact-search'); app.ui.toast('Quando hai finito di oscurare, torna qui e premi «Fatto». Scegli «Applica al documento aperto» per continuare su questo file.', { timeout: 10000 }); }, !auto) : null,
          btn('Fatto', () => segna(s, id, true, 'Oscuramento eseguito (verifica dell\'operatore).')),
          btn('Non ci sono dati da oscurare', () => segna(s, id, true, 'Nessun dato personale da oscurare (dichiarato dall\'operatore).')),
        ].filter(Boolean);
      }
      case 'sanifica': {
        const san = servizio('sanitize');
        if (!san) return [h('span', { class: 'av-note' }, 'Servizio non disponibile in questa versione.')];
        return [btn('Esegui', async () => {
          const r = await app.ui.withProgress('Rimozione dei contenuti nascosti', async (p) => { p.set(null, 'Pulizia…'); return san(await app.currentBytes(doc), { metadati: true, javascript: true, allegati: true, commenti: true, campiNascosti: true, livelliNascosti: true, datiPrivati: true, xfa: true, versioni: true }, { password: doc.password }); }, { cancellable: false });
          if (!r) return;
          await app.applyEdit('Metadati e contenuti nascosti rimossi', async () => r.bytes, doc);
          const n = r.report && typeof r.report === 'object' ? Object.values(r.report).reduce((a, x) => a + (typeof x === 'number' ? x : Array.isArray(x) ? x.length : x ? 1 : 0), 0) : null;
          segna(s, id, true, `Rimossi metadati e contenuti nascosti${n != null ? ` (${n} elementi)` : ''}.`, { report: r.report });
        }, true)];
      }
      case 'accessibile':
        return [btn('Prepara…', async () => { await prepareAccessibility(app); segna(s, id, true, 'Titolo, lingua e struttura impostati.'); }, true), btn('Già fatto', () => segna(s, id, true, 'Già accessibile (dichiarato dall\'operatore).'))];
      case 'pdfa': {
        const pdfa = servizio('pdfa');
        if (!pdfa) return [h('span', { class: 'av-note' }, 'Conversione PDF/A non disponibile in questa versione.')];
        return [btn('Converti in PDF/A-2', async () => {
          const r = await app.ui.withProgress('Conversione in PDF/A', async (p) => pdfa(await app.currentBytes(doc), { part: 2, ocr: true, title: doc.name.replace(/\.pdf$/i, ''), lang: 'it-IT', password: doc.password, progress: p }));
          if (!r) return;
          await app.applyEdit('Convertito in PDF/A', async () => r.bytes, doc);
          const ko = (r.verifica || []).filter((x) => !x.ok);
          segna(s, id, !ko.length, ko.length ? `PDF/A con ${ko.length} controlli non superati: ${ko.slice(0, 2).map((x) => x.titolo).join('; ')}` : 'PDF/A-2 verificato.', { verifica: r.verifica, avvisi: r.avvisi });
        }, true)];
      }
      case 'controllo': {
        const chk = servizio('controllaAccessibilita');
        if (!chk) return [h('span', { class: 'av-note' }, 'Controllo non disponibile in questa versione.')];
        return [btn('Controlla', async () => {
          const r = await app.ui.withProgress('Controllo di accessibilità', async (p) => { p.set(null, 'Controllo…'); return chk(await app.currentBytes(doc), doc.password); }, { cancellable: false });
          if (!r) return;
          const err = r.filter((x) => !x.ok && x.livello !== 'avviso'); const avv = r.filter((x) => !x.ok && x.livello === 'avviso');
          segna(s, id, !err.length, err.length ? `${err.length} problemi: ${err.slice(0, 3).map((x) => x.titolo).join('; ')}` : `Nessun problema bloccante${avv.length ? ` (${avv.length} avvisi)` : ''}.`, { controlli: r });
        }, true)];
      }
      case 'salva':
        return [btn('Salva…', async () => {
          const base = s.originale.replace(/\.pdf$/i, '').replace(/_oscurat[oa]$/i, '');
          const nome = `${base}_pubblicabile.pdf`;
          const vecchio = doc.name; doc.name = nome;
          const ok = await app.save(doc, { as: true });
          if (!ok) { doc.name = vecchio; return; }
          const bytes = await app.currentBytes(doc);
          const rap = await rapportoPubblicazione(app.lib.PDFLib, { originale: s.originale, nome: doc.name, sha256: await sha256Hex(bytes), dimensione: bytes.length, pagine: doc.pageCount, esiti: s.esiti, inizio: s.inizio });
          await app.exportFile(rap, `${base}_pubblicabile_rapporto.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
          segna(s, id, true, `Salvati «${doc.name}» e il rapporto.`);
        }, true)];
      default: return [];
    }
  }
  render();
}

/** Rapporto finale (PDF) della procedura. */
export async function rapportoPubblicazione(PDFLib, info) {
  const d = await PDFLib.PDFDocument.create();
  const reg = await d.embedFont(PDFLib.StandardFonts.Helvetica); const bold = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  d.setTitle(`Rapporto di pubblicazione - ${info.nome}`); d.setLanguage('it-IT'); d.setCreator('Leggio');
  let page = d.addPage([595.28, 841.89]); let y = 780; const M = 50; const W = 495;
  const ink = PDFLib.rgb(0.1, 0.11, 0.13); const muted = PDFLib.rgb(0.4, 0.43, 0.47); const ok = PDFLib.rgb(0.02, 0.46, 0.28); const ko = PDFLib.rgb(0.7, 0.14, 0.09);
  const line = (t, { f = reg, s = 10, c = ink, gap = 4, x = M } = {}) => { for (const r of aCapo(f, s, t, W - (x - M))) { if (y < 60) { page = d.addPage([595.28, 841.89]); y = 780; } y -= s; page.drawText(r, { x, y, size: s, font: f, color: c }); y -= gap; } };
  line('Rapporto di preparazione alla pubblicazione', { f: bold, s: 16, gap: 8 });
  line(`Amministrazione Trasparente — generato da Leggio il ${fmtData(new Date())}`, { s: 9, c: muted, gap: 12 });
  line(`Documento originale: ${info.originale}`); line(`Documento pubblicabile: ${info.nome}`); line(`Pagine: ${info.pagine} — Dimensione: ${info.dimensione.toLocaleString('it-IT')} byte`);
  line(`Impronta SHA-256: ${info.sha256}`, { s: 8.5, gap: 12 });
  for (const p of PASSI.filter((x) => x.id !== 'salva')) {
    const e = info.esiti[p.id];
    line(`${e?.fatto ? (e.ok === false ? '!' : '✓') : '—'}  ${p.titolo}`.replace('✓', 'OK'), { f: bold, s: 11, c: !e ? muted : e.ok === false ? ko : ok, gap: 3 });
    line(e ? `${e.testo} (${fmtData(e.ora)})` : 'Passo non eseguito.', { s: 9.5, x: M + 14, gap: 3 });
    const checks = e?.dati?.controlli || e?.dati?.verifica;
    if (Array.isArray(checks)) for (const k of checks.slice(0, 25)) line(`${k.ok ? 'sì' : 'NO'} — ${k.titolo}`, { s: 8.5, x: M + 24, c: k.ok ? muted : ko, gap: 2 });
    y -= 6;
  }
  line('Le verifiche automatiche non sostituiscono il controllo dell\'operatore: rileggi il documento prima di pubblicarlo.', { s: 9, c: muted });
  void testoSicuro;
  return d.save();
}
