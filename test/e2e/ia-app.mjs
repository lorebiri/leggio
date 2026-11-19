// Collaudo nell'app vera (Playwright + Electron) dell'assistente IA locale.
//  1. spento di default: nessun processo, nessun file dell'assistente caricato all'avvio, solo la voce «Assistente IA…»;
//  2. installazione dalla finestra con «Importa da file…» (motore, modello, embedding) con verifica SHA-256, poi attivazione;
//  3. «Chiedi al documento» su una determina vera: risposta con la pagina, il link porta alla pagina ed evidenzia;
//  4. documento lungo (passaggi pertinenti);
//  5. «Cerca per significato nell'archivio» con una richiesta parafrasata;
//  6. spegnendo l'assistente il motore si ferma.
// Servono i file veri (non sono nel repository):
//   IA_MOTORE=<pacchetto llama.cpp per questo sistema, es. llama-b12540-bin-ubuntu-x64.tar.gz>
//   IA_MODELLI=<cartella con gemma-4-E2B-it-Q4_K_M.gguf e granite-embedding-107m-multilingual-Q8_0.gguf>
//   IA_PDF=<cartella con PDF pubblici di prova: 02-determina-comune-verona.pdf, 11-disciplinare-gara-unipi.pdf, 13-capitolato-comune-verona.pdf, …>
// Uso: npx vite build && IA_MOTORE=… IA_MODELLI=… IA_PDF=… xvfb-run -a node test/e2e/ia-app.mjs
import { avvia, chiudi, registro, ROOT } from './avvio-comune.mjs';
import { mkdtempSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { IA_MOTORE, IA_MODELLI, IA_PDF } = process.env;
if (!IA_MOTORE || !IA_MODELLI || !IA_PDF) { console.error('Imposta IA_MOTORE, IA_MODELLI e IA_PDF (vedi in testa al file).'); process.exit(2); }
const R = registro();
const dir = mkdtempSync(join(tmpdir(), 'leggio-ia-e2e-'));
const dati = join(dir, 'dati');
const archivio = join(dir, 'archivio');
mkdirSync(archivio);
for (const f of readdirSync(IA_PDF).filter((x) => x.endsWith('.pdf'))) copyFileSync(join(IA_PDF, f), join(archivio, f));
const scatta = (s, nome) => s.page.screenshot({ path: join(process.env.IA_SCREENSHOT || dir, nome + '.png') });
process.env.LEGGIO_ARCHIVIO_TEST = '1';

let s;
try {
  s = await avvia(dati, [], { attesa: 2500 });
  const { page, app } = s;
  // su Linux senza portachiavi l'archivio personale mostra un avviso all'avvio: «Non ora»
  for (let i = 0; i < 3; i++) {
    const c = await page.$('.backdrop:not(.closing) .dlg .dlg-foot .btn:not(.primary)');
    if (!c) break;
    await c.click(); await page.waitForTimeout(500);
  }

  // ---------- 1. spento di default ----------
  const iniziale = await page.evaluate(async () => {
    const a = window.__leggio;
    const st = await a.platform.invokeFeature('ia:stato', {});
    return {
      impostazioni: !!a.tools.get('ia-impostazioni') && !a.tools.get('ia-impostazioni').hidden,
      chiediNascosto: a.tools.get('ia-chiedi')?.hidden, archivioNascosto: a.tools.get('ia-archivio')?.hidden,
      attivo: a.settings.get('ia.attivo', false), processi: st.value.processi,
      fileCaricati: performance.getEntriesByType('resource').map((x) => x.name).filter((n) => /configura|chiedi-|ia\/ui/.test(n)),
    };
  });
  R.ok('spento di default: solo «Assistente IA…», strumenti nascosti', iniziale.impostazioni && iniziale.chiediNascosto && iniziale.archivioNascosto && !iniziale.attivo, iniziale);
  R.ok('all\'avvio nessun processo del motore', iniziale.processi === null, iniziale.processi);
  R.ok('all\'avvio nessuna finestra dell\'assistente caricata', iniziale.fileCaricati.length === 0, iniziale.fileCaricati);

  // ---------- 2. installazione con «Importa da file…» ----------
  await page.evaluate(() => { window.__leggio.tools.run('ia-impostazioni'); });
  await page.waitForSelector('.ia-comp', { timeout: 30000 });
  await scatta(s, '1-impostazioni');
  R.ok('nella finestra nessuna scritta «null»', !/\bnull\b/.test(await page.textContent('.ia-conf')), await page.textContent('.ia-conf'));
  const daImportare = [['Motore', IA_MOTORE], ['Modello principale', join(IA_MODELLI, 'gemma-4-E2B-it-Q4_K_M.gguf')]];
  for (const [riga, file] of daImportare) {
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);
    const t0 = Date.now();
    await page.evaluate((riga) => [...document.querySelectorAll('.ia-comp tr')].find((tr) => tr.querySelector('th')?.textContent.startsWith(riga))?.querySelector('button')?.click(), riga);
    await page.waitForFunction((riga) => [...document.querySelectorAll('.ia-comp tr')].find((tr) => tr.querySelector('th')?.textContent.startsWith(riga))?.textContent.includes('installato'), riga, { timeout: 180000 });
    R.ok(`importato e verificato: ${riga} (${Math.round((Date.now() - t0) / 1000)} s)`, true);
  }
  // il modello per la ricerca per significato si scarica davvero (Hugging Face, revisione fissa, SHA-256)
  const tD = Date.now();
  await page.click('.ia-azioni .btn.primary');
  await page.waitForSelector('.ia-attiva input', { timeout: 600000 });
  R.ok(`scaricato e verificato dalla rete: Ricerca per significato (${Math.round((Date.now() - tD) / 1000)} s)`, await page.evaluate(() => [...document.querySelectorAll('.ia-comp tr')].find((tr) => tr.textContent.startsWith('Ricerca'))?.textContent.includes('installato')));
  // dopo un download completo l'assistente si accende da solo; altrimenti si accende con l'interruttore
  if (!(await page.isChecked('.ia-attiva input'))) await page.click('.ia-attiva input');
  await page.waitForTimeout(500);
  await scatta(s, '2-installato');
  R.ok('dopo l\'attivazione compaiono gli strumenti', await page.evaluate(() => !window.__leggio.tools.get('ia-chiedi').hidden && !window.__leggio.tools.get('ia-archivio').hidden));
  await page.click('.dlg:has(.ia-conf) button[type=submit]');

  // ---------- 3. domanda con la pagina ----------
  const chiedi = async (pdf, domanda, timeout = 300000) => {
    await page.evaluate(async (p) => { for (const d of [...window.__leggio.docs]) await window.__leggio.closeDoc(d); await window.__leggio.openPath(p, { readOnly: true }); }, pdf);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__leggio.tools.run('ia-chiedi'); });
    await page.waitForSelector('.ia-domanda');
    await page.fill('.ia-domanda', domanda);
    const t0 = Date.now();
    await page.click('.ia-pannello .btn.primary');
    await page.waitForFunction(() => document.querySelector('.ia-risposta') || /non|errore/i.test(document.querySelector('.ia-stato .ia-blocco')?.textContent || ''), null, { timeout });
    return page.evaluate((ms) => ({
      risposta: document.querySelector('.ia-risposta .ia-a')?.textContent || document.querySelector('.ia-stato')?.textContent,
      pagina: document.querySelector('.ia-fonte .btn')?.textContent || '', nota: document.querySelector('.ia-nota')?.textContent || '',
      daControllare: !!document.querySelector('.ia-fonte .ia-attenzione'), secondi: Math.round(ms / 1000),
    }), Date.now() - t0);
  };
  const r1 = await chiedi(join(archivio, '02-determina-comune-verona.pdf'), 'Chi è il responsabile unico del progetto?');
  console.log('   ', JSON.stringify(r1));
  R.ok('risposta giusta (Tagliapietra) con la pagina 5', /Tagliapietra/.test(r1.risposta) && /Pagina 5/.test(r1.pagina), r1);
  R.ok('sotto la risposta: «aiuto da verificare»', /aiuto da verificare/.test(r1.nota), r1.nota);
  await page.click('.ia-fonte .btn');
  await page.waitForTimeout(1500);
  // pagina del passaggio evidenziato da Trova (la pagina «più visibile» può essere la successiva se il passaggio è in fondo)
  const vai = await page.evaluate(() => ({ evidenziata: (window.__leggio.viewer.pdfViewer.findController?.selected?.pageIdx ?? -2) + 1, visibile: window.__leggio.viewer.page, trova: document.querySelector('.findbar input[type=search]')?.value || '' }));
  R.ok('il link porta alla pagina 5 ed evidenzia il passaggio', vai.evidenziata === 5 && /Tagliapietra/.test(vai.trova), vai);
  await scatta(s, '3-domanda');
  const r2 = await page.evaluate(async () => {
    document.querySelector('.ia-domanda').value = 'Per quale importo viene affidato il servizio, IVA e oneri esclusi?';
    const t0 = Date.now(); document.querySelector('.ia-pannello .btn.primary').click();
    while (document.querySelectorAll('.ia-risposta').length < 2 && Date.now() - t0 < 300000) await new Promise((r) => setTimeout(r, 300));
    return { risposta: document.querySelector('.ia-risposta .ia-a')?.textContent, pagina: document.querySelector('.ia-fonte .btn')?.textContent, secondi: Math.round((Date.now() - t0) / 1000) };
  });
  console.log('   ', JSON.stringify(r2));
  R.ok('seconda domanda sullo stesso documento (più rapida: documento già letto)', /7\.900,84/.test(r2.risposta) && r2.secondi <= r1.secondi, r2);

  // ---------- 4. documento lungo ----------
  const r3 = await chiedi(join(archivio, '11-disciplinare-gara-unipi.pdf'), 'Chi è il responsabile del procedimento?');
  console.log('   ', JSON.stringify(r3));
  R.ok('documento lungo (35 pagine): risposta dai passaggi pertinenti', /Arras/i.test(r3.risposta) && /Pagina \d+/.test(r3.pagina), r3);

  // ---------- 5. ricerca per significato nell'archivio ----------
  await page.evaluate(async (p) => { const A = window.__leggio.archivio; await A.aggiungiCartella(p); }, archivio);
  await page.waitForFunction(() => { const A = window.__leggio.archivio; return A.attivo && A.caricato && !A.lavoro; }, null, { timeout: 300000 });
  await page.evaluate(() => { window.__leggio.tools.run('ia-archivio'); });
  await page.waitForSelector('.ia-indice button');
  await page.click('.ia-indice button');
  await page.waitForFunction(() => /Pronti per la ricerca per significato: \d+/.test(document.querySelector('.ia-indice')?.textContent || ''), null, { timeout: 600000 });
  const info = await page.textContent('.ia-indice');
  R.ok('nella ricerca nessuna scritta «null»', !/\bnull\b/.test(await page.textContent('.ia-archivio')));
  R.ok('indice per significato preparato in sottofondo', /\d+ documenti/.test(info), info);
  await page.fill('.ia-q-archivio', 'posti letto per i senzatetto durante i mesi freddi');
  await page.click('.ia-cerca .btn.primary');
  await page.waitForSelector('.ia-risultato', { timeout: 60000 });
  const primi = await page.evaluate(() => [...document.querySelectorAll('.ia-risultato strong')].slice(0, 3).map((x) => x.textContent));
  await scatta(s, '4-archivio');
  R.ok('richiesta parafrasata: il capitolato dell\'accoglienza invernale tra i primi 3', primi.some((n) => /13-capitolato/.test(n)), primi);
  await page.click('.dlg:has(.ia-archivio) button[type=submit]');

  // ---------- 6. spegnimento ----------
  await page.evaluate(() => window.__leggio.settings.set('ia.attivo', false));
  await page.waitForTimeout(2000);
  const fine = await page.evaluate(async () => ({ st: (await window.__leggio.platform.invokeFeature('ia:stato', {})).value.processi, nascosto: window.__leggio.tools.get('ia-chiedi').hidden }));
  R.ok('spegnendo l\'assistente il motore si ferma e gli strumenti spariscono', !fine.st?.chat?.attivo && !fine.st?.embed?.attivo && fine.nascosto, fine);
} catch (e) {
  R.ok('collaudo completato senza errori', false, e.message);
  if (s) await scatta(s, 'errore').catch(() => {});
} finally {
  if (s) await chiudi(s).catch(() => s.app.close());
}
console.log('Cartella del collaudo:', dir, '(ROOT', ROOT + ')');
process.exit(R.fine() ? 1 : 0);
