// Collaudo nell'app vera (Playwright + Electron) della COMPILAZIONE IN SERIE della 0.3:
//  1. modulo AcroForm di prova (10 campi) aperto in Leggio, 100 contatti in un gruppo della rubrica;
//  2. procedura guidata percorsa con i clic (modulo → gruppo → abbinamento con anteprima → opzioni);
//  3. generazione verso una cartella (dialogo di sistema sostituito dal main): 100 PDF con i dati giusti;
//  4. interfaccia reattiva durante la generazione (Web Worker): tempi di risposta della pagina misurati;
//  5. abbinamento salvato come modello e riconosciuto; schermate dei passaggi (deviceScaleFactor 1).
// Uso: npx vite build && xvfb-run -a node test/e2e/serie-100.mjs   (SCHERMATE=/cartella per le immagini)
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as PDFLib from '@cantoo/pdf-lib';
import { carattereControlloCf } from '../../src/renderer/features/personale/lib/validatori.js';

const { _electron: electron } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const PORTA = 9403; // area «moduli» (docs/ARCHITETTURA.md)
const N = Number(process.env.RECORD) || 100;
const dir = mkdtempSync(join(tmpdir(), 'leggio-moduli-serie-'));
const dati = join(dir, 'ud');
const uscita = join(dir, 'uscita'); mkdirSync(uscita);
const schermate = process.env.SCHERMATE || join(dir, 'schermate'); mkdirSync(schermate, { recursive: true });
let fallite = 0;
const ok = (cond, msg, extra) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg + (cond || extra === undefined ? '' : ' → ' + JSON.stringify(extra))); if (!cond) fallite++; };

// ---------------------------------------------------------------- dati di prova
const CAMPI = [['cognome', 'Cognome'], ['nome', 'Nome'], ['codice_fiscale', 'Codice fiscale'], ['data_nascita', 'Data di nascita'], ['luogo_nascita', 'Luogo di nascita'], ['indirizzo', 'Indirizzo'], ['cap', 'CAP'], ['citta', 'Città'], ['email', 'Email'], ['telefono', 'Telefono']];
async function modulo() {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]);
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  p.drawText('Domanda di partecipazione al bando 2026', { x: 50, y: 790, size: 16, font });
  const f = d.getForm();
  CAMPI.forEach(([nome, etichetta], i) => {
    p.drawText(etichetta, { x: 50, y: 736 - i * 42, size: 11, font });
    const t = f.createTextField(nome); if (nome === 'codice_fiscale') t.setMaxLength(16);
    t.addToPage(p, { x: 190, y: 730 - i * 42, width: 320, height: 22 });
  });
  return d.save();
}
const NOMI = ['Maria', 'Giuseppe', 'Anna', 'Francesco', 'Lucia', 'Antonio', 'Giulia', 'Marco', 'Chiara', 'Luca'];
const COGNOMI = ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco'];
function cf(i) {
  const lettere = 'BCDFGHLMNPRSTVZ';
  const p15 = `${lettere[i % 15]}${lettere[(i * 7) % 15]}${lettere[(i * 3) % 15]}MRA${String(60 + (i % 40)).padStart(2, '0')}A${String(1 + (i % 28)).padStart(2, '0')}H501`;
  return p15 + carattereControlloCf(p15);
}
const contatti = Array.from({ length: N }, (_, i) => ({
  id: 'serie-' + i, nome: NOMI[i % 10], cognome: `${COGNOMI[Math.floor(i / 10) % 10]}${i >= 100 ? i : ''}`, codiceFiscale: cf(i),
  dataNascita: `${String(1 + (i % 28)).padStart(2, '0')}/01/19${60 + (i % 40)}`, luogoNascita: 'Roma', indirizzo: `Via Garibaldi ${i + 1}`, cap: '56100', citta: 'Pisa', email: `persona${i}@esempio.it`, telefono: `050 ${String(100000 + i)}`,
  gruppi: ['Bando 2026'],
}));

// ---------------------------------------------------------------- avvio
const app = await electron.launch({
  args: ['--no-sandbox', `--remote-debugging-port=${PORTA}`, ROOT],
  env: { ...process.env, LEGGIO_USER_DATA: dati, LEGGIO_NO_UPDATE_CHECK: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  executablePath: process.env.ELECTRON_PATH || createRequire(join(ROOT, 'package.json'))('electron'),
});
const page = await app.firstWindow();
const foto = async (nome) => { const p = join(schermate, nome + '.png'); await page.screenshot({ path: p }); console.log('     schermata:', p); };
const clic = (testo) => page.locator('.serie-dlg .dlg-foot button', { hasText: testo }).click();

try {
  await page.waitForFunction(() => !!window.__leggio && !!window.__leggioPersonale, null, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 860); w.center(); });
  await page.waitForTimeout(800);
  console.log(`1. preparazione: modulo con ${CAMPI.length} campi e ${N} contatti nel gruppo «Bando 2026»`);
  const pdf = join(dir, 'domanda.pdf');
  writeFileSync(pdf, await modulo());
  const aperto = await page.evaluate(async (lista) => {
    const P = window.__leggioPersonale;
    if (!(await P.apri())) return false;
    P.archivio.salvaContatti(lista);
    await P.archivio.salvaOra();
    return P.archivio.contatti().length;
  }, contatti);
  ok(aperto === N, `archivio aperto, ${aperto} contatti`);
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, pdf);
  await page.evaluate(() => window.__leggio.openDialog());
  await page.waitForFunction(() => window.__leggio.activeDoc?.name === 'domanda.pdf', null, { timeout: 15000 });
  await page.waitForTimeout(800);

  console.log('2. procedura guidata');
  await page.evaluate(() => { window.__leggio.tools.run('mail-merge'); });
  await page.waitForSelector('.serie-dlg .serie-scelta-box.scelta input[value="doc"]', { timeout: 10000 });
  await foto('serie-1-modulo');
  await clic('Avanti');
  await page.waitForSelector('.serie-dlg input[value="gruppo"]:checked', { timeout: 10000 });
  await foto('serie-2-dati');
  await clic('Avanti');
  await page.waitForSelector('.serie-anteprima-pagina canvas', { timeout: 20000 });
  const abbinati = await page.evaluate(() => [...document.querySelectorAll('.serie-tabella select')].map((s) => s.value));
  ok(abbinati.filter(Boolean).length === 10, 'tutti i 10 campi abbinati in automatico', abbinati);
  const chi = await page.textContent('.serie-anteprima-chi');
  ok(/Maria Rossi/.test(chi) && /Record 1 di/.test(chi), 'anteprima sul primo record', chi);
  await foto('serie-3-abbinamento');
  await page.click('.serie-anteprima-nav button[aria-label="Record successivo"]');
  await page.waitForFunction(() => /Record 2 di/.test(document.querySelector('.serie-anteprima-chi')?.textContent || ''), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  ok(true, 'scorrimento dei record nell\'anteprima');
  await clic('Avanti');
  await page.waitForSelector('.serie-dlg .serie-segnaposto', { timeout: 10000 });
  const esempio = await page.textContent('.serie-esempio');
  ok(/Rossi_Maria_domanda\.pdf/.test(esempio), 'nome dei file proposto', esempio);
  await foto('serie-4-opzioni');

  console.log('3. generazione verso una cartella');
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, uscita);
  // misura della reattività: ritardi del ciclo di eventi della pagina e tempo di risposta di evaluate
  await page.evaluate(() => { window.__ritardi = []; let t = performance.now(); window.__lag = setInterval(() => { const n = performance.now(); window.__ritardi.push(n - t - 50); t = n; }, 50); });
  const t0 = Date.now();
  await clic(`Genera ${N} PDF`);
  const risposte = [];
  let vistoAvanzamento = false;
  for (;;) {
    const a = Date.now();
    const stato = await page.evaluate(() => ({ prog: !!document.querySelector('.progress-dlg'), fine: [...document.querySelectorAll('#overlay-root .dlg h2')].some((h) => /Compilazione in serie (completata|interrotta)/.test(h.textContent)), testo: document.querySelector('.progress-text')?.textContent || '' }));
    risposte.push(Date.now() - a);
    if (stato.prog && !vistoAvanzamento) { vistoAvanzamento = true; await foto('serie-5-avanzamento'); }
    if (stato.fine) break;
    if (Date.now() - t0 > 180000) throw new Error('la generazione non finisce');
    await page.waitForTimeout(40);
  }
  const ms = Date.now() - t0;
  const ritardi = await page.evaluate(() => { clearInterval(window.__lag); return window.__ritardi; });
  const maxRisposta = Math.max(...risposte); const maxRitardo = Math.max(0, ...ritardi);
  console.log(`     ${N} PDF in ${(ms / 1000).toFixed(1)} s (con scrittura su disco); risposta della pagina: max ${maxRisposta} ms su ${risposte.length} prove; ritardo massimo del ciclo di eventi ${Math.round(maxRitardo)} ms`);
  ok(maxRisposta < 1000, `interfaccia reattiva durante la generazione (max ${maxRisposta} ms)`);
  await page.waitForTimeout(300);
  await foto('serie-6-riepilogo');
  const conteggi = await page.$$eval('.serie-conteggio strong', (els) => els.map((e) => +e.textContent));
  ok(conteggi[0] + conteggi[1] === N && conteggi[2] === 0, `riepilogo: ${conteggi[0]} senza problemi, ${conteggi[1]} con avvisi, ${conteggi[2]} non generati`);
  await page.locator('#overlay-root .dlg-foot button', { hasText: 'Chiudi' }).click();

  console.log('4. verifica dei file');
  const file = readdirSync(uscita).filter((f) => f.endsWith('.pdf')).sort();
  ok(file.length === N, `${file.length} PDF nella cartella`);
  let giusti = 0; const sbagliati = [];
  for (const c of contatti) {
    const nome = `${c.cognome}_${c.nome}_domanda.pdf`;
    const trovato = file.find((f) => f === nome) || file.find((f) => f.startsWith(`${c.cognome}_${c.nome}_domanda_`) && false);
    if (!trovato) { sbagliati.push(nome); continue; }
    const d = await PDFLib.PDFDocument.load(readFileSync(join(uscita, trovato)));
    const f = d.getForm();
    const v = (n) => f.getTextField(n).getText() || '';
    if (v('cognome') === c.cognome && v('nome') === c.nome && v('codice_fiscale') === c.codiceFiscale && v('citta') === 'Pisa' && v('email') === c.email && v('data_nascita') === c.dataNascita) giusti++;
    else sbagliati.push(nome);
  }
  ok(giusti === N, `${giusti} PDF con i dati giusti`, sbagliati.slice(0, 5));

  console.log('5. modello salvato e riconosciuto');
  const mod = await page.evaluate(async () => {
    const P = window.__leggioPersonale; const m = P.archivio.modelli()[0];
    return { n: P.archivio.modelli().length, nome: m?.nome, nomeFile: m?.nomeFile, campi: m?.campi?.length, cf: m?.corrispondenze?.codice_fiscale };
  });
  ok(mod.n === 1 && mod.campi === 10 && mod.cf === 'codiceFiscale' && /\{cognome\}/.test(mod.nomeFile || ''), `modello «${mod.nome}» salvato con abbinamento e schema dei nomi`, mod);
  await page.evaluate(() => { window.__leggio.tools.run('templates'); });
  await page.waitForSelector('.serie-modelli .serie-modello', { timeout: 10000 });
  await foto('serie-7-modelli');
  await page.locator('#overlay-root .dlg-foot button', { hasText: 'Chiudi' }).click();
} catch (err) {
  fallite++;
  console.error('  ✗ errore:', err.message);
  await foto('serie-errore').catch(() => {});
} finally {
  // chiude solo il processo avviato da questo collaudo
  const chiusa = new Promise((r) => app.once('close', r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy()).catch(() => {});
  await Promise.race([chiusa, new Promise((r) => setTimeout(r, 8000))]);
  try { app.process().kill('SIGKILL'); } catch { /* già chiuso */ }
}
console.log(fallite ? `\n${fallite} verifiche fallite` : '\nTutte le verifiche superate');
console.log('Cartella di prova:', dir);
process.exit(fallite ? 1 : 0);
