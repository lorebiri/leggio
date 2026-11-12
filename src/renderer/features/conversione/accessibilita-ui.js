// «Controllo accessibilità»: rapporto «cosa non va e come correggerlo», con correzioni rapide
// (titolo, lingua, titolo nella finestra) e collegamenti a OCR e preparazione dei tag.
import { controllaAccessibilita } from './lib/accessibilita.js';
import { caratteriTesto } from './lib/ocr-layout.js';
import { messaggioErrore } from './comune.js';
import { openPdfJs } from '../../core/pdf.js';

const LINGUE = [['it-IT', 'Italiano'], ['en-GB', 'Inglese (Regno Unito)'], ['en-US', 'Inglese (Stati Uniti)'], ['fr-FR', 'Francese'], ['de-DE', 'Tedesco'], ['es-ES', 'Spagnolo'], ['sl-SI', 'Sloveno']];

async function datiTesto(app, pdf, signal) {
  const pagineSenzaTesto = []; let immagini = 0; let illeggibile = false;
  const OPS = app.lib.pdfjs.OPS;
  for (let i = 0; i < pdf.numPages; i++) {
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    const page = await pdf.getPage(i + 1);
    try {
      const tc = await page.getTextContent();
      const n = caratteriTesto(tc);
      if (n < 20) pagineSenzaTesto.push(i);
      const strano = tc.items.reduce((k, it) => k + ((it.str || '').match(/[�\u0000-\u0008]/g)?.length || 0), 0);
      if (n > 50 && strano / n > 0.1) illeggibile = true;
      if (pdf.numPages <= 200) {
        const ops = await page.getOperatorList();
        for (const f of ops.fnArray) if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject) immagini++;
      }
    } catch { /* pagina danneggiata */ } finally { page.cleanup(); }
  }
  return { pagine: pdf.numPages, pagineSenzaTesto, immagini, testoIllegibile: illeggibile };
}

async function controlla(app) {
  const doc = app.activeDoc;
  let r;
  try {
    r = await app.ui.withProgress('Controllo accessibilità', async (p) => {
      p.set(null, 'Analizzo le pagine…');
      const dati = await datiTesto(app, doc.pdf, p.signal);
      const pdfDoc = await app.lib.openPdfLib(await app.currentBytes(doc), doc.password);
      return controllaAccessibilita(pdfDoc, app.lib.PDFLib, dati);
    });
  } catch (err) { return app.reportError(new Error(messaggioErrore(err)), 'Controllo non riuscito'); }
  if (r) mostra(app, r);
}

function mostra(app, risultati) {
  const { h } = app.ui;
  const c = app.openRightPanel('Accessibilità');
  const errori = risultati.filter((x) => x.livello === 'errore');
  const avvisi = risultati.filter((x) => x.livello === 'avviso');
  const tagTool = app.tools.list().find((t) => t.id !== 'accessibility-check' && /access|tag/i.test(t.id) && t.category !== 'vista');
  const correggi = async (tipo) => {
    if (tipo === 'ocr') return app.tools.run('ocr');
    if (tipo === 'tag') return tagTool ? app.tools.run(tagTool.id) : app.ui.toast('La preparazione dei tag non è ancora disponibile in questa versione.', { kind: 'info' });
    if (tipo === 'segnalibri') { const t = app.tools.list().find((x) => /bookmark|segnalib/i.test(`${x.id} ${x.keywords}`)); return t ? app.tools.run(t.id) : app.ui.toast('Aggiungi i segnalibri dal pannello Segnalibri.'); }
    if (tipo === 'titolo') {
      const t = await app.ui.prompt('Titolo del documento', '', { title: 'Aggiungi titolo', okLabel: 'Imposta' });
      if (!t?.trim()) return;
      await app.editWithPdfLib('Titolo del documento impostato', (d, L) => { d.setTitle(t.trim(), { showInWindowTitleBar: true }); });
    } else if (tipo === 'lingua') {
      const v = await app.ui.dialog({ title: 'Lingua del documento', fields: [{ name: 'l', label: 'Lingua principale', type: 'select', value: 'it-IT', options: LINGUE.map(([value, label]) => ({ value, label })) }], okLabel: 'Imposta' });
      if (!v) return;
      await app.editWithPdfLib('Lingua del documento impostata', (d, L) => { d.catalog.set(L.PDFName.of('Lang'), L.PDFString.of(v.l)); });
    } else if (tipo === 'mostraTitolo') {
      await app.editWithPdfLib('Il titolo compare nella finestra', (d, L) => { d.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true); });
    }
    controlla(app);
  };
  const correzioniRapide = risultati.filter((x) => !x.ok && ['titolo', 'lingua', 'mostraTitolo'].includes(x.correzione));
  c.append(h('div', { class: 'conv-report' },
    h('p', { class: 'conv-esito ' + (errori.length ? 'ko' : 'ok'), role: 'status' }, errori.length ? `${errori.length} ${errori.length === 1 ? 'problema' : 'problemi'}${avvisi.length ? ` e ${avvisi.length} ${avvisi.length === 1 ? 'avviso' : 'avvisi'}` : ''}` : avvisi.length ? `Nessun problema grave, ${avvisi.length} ${avvisi.length === 1 ? 'avviso' : 'avvisi'}` : 'Nessun problema trovato'),
    correzioniRapide.length > 1 ? h('button', { class: 'btn primary', onclick: async () => {
      const v = await app.ui.dialog({ title: 'Correzione rapida', fields: [
        { name: 't', label: 'Titolo del documento', type: 'text', value: '' },
        { name: 'l', label: 'Lingua principale', type: 'select', value: 'it-IT', options: LINGUE.map(([value, label]) => ({ value, label })) },
      ], okLabel: 'Correggi' });
      if (!v) return;
      await app.editWithPdfLib('Titolo e lingua impostati', (d, L) => {
        if (v.t.trim()) d.setTitle(v.t.trim(), { showInWindowTitleBar: true });
        else d.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);
        d.catalog.set(L.PDFName.of('Lang'), L.PDFString.of(v.l));
      });
      controlla(app);
    } }, 'Correggi titolo e lingua') : null,
    h('ul', { class: 'conv-checks' }, risultati.map((x) => h('li', { class: x.livello === 'ok' ? 'ok' : 'ko' },
      h('span', { class: 'conv-ico', 'aria-hidden': 'true' }, x.livello === 'ok' ? '✓' : x.livello === 'avviso' ? '!' : '✗'),
      h('div', {}, h('strong', {}, x.titolo), x.spiegazione ? h('small', {}, x.spiegazione) : null,
        x.correzione ? h('button', { class: 'btn small conv-fix', onclick: () => correggi(x.correzione) }, { titolo: 'Aggiungi titolo', lingua: 'Imposta lingua', mostraTitolo: 'Correggi', ocr: 'Rendi ricercabile (OCR)', tag: tagTool ? 'Prepara per l’accessibilità' : 'Come si fa', segnalibri: 'Aggiungi segnalibri' }[x.correzione]) : null)))),
    h('p', { class: 'muted conv-nota' }, 'Controllo automatico di base: alcuni requisiti (ad esempio che il testo alternativo descriva davvero l’immagine, o che i colori abbiano contrasto sufficiente) vanno verificati da una persona.')));
}

export function registraAccessibilita(app) {
  app.services.controllaAccessibilita = async (bytes, password) => {
    const { pdf } = await openPdfJs(bytes, { password });
    try {
      const dati = await datiTesto(app, pdf);
      return controllaAccessibilita(await app.lib.openPdfLib(bytes, password), app.lib.PDFLib, dati);
    } finally { pdf.loadingTask.destroy().catch(() => {}); }
  };
  app.registerTool({
    id: 'accessibility-check', name: 'Controllo accessibilità', category: 'vista', icon: 'check',
    description: 'Cosa non va per i lettori di schermo e come correggerlo',
    keywords: 'accessibilità accessibile verifica controllo lettore di schermo amministrazione trasparente agid tag lingua titolo testo alternativo pdf/ua',
    run: () => controlla(app),
  });
}
