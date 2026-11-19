// Strumenti comuni ai collaudi dell'avvio (Playwright + Electron): avvio, chiusura regolare, uccisione,
// lettura dello stato della finestra. Ogni prova usa una sua cartella dati (LEGGIO_USER_DATA).
import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Playwright non è fra le dipendenze del progetto: si usa quello installato nel sistema (NODE_PATH)
const { _electron: electron } = createRequire(import.meta.url)('playwright');

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);

/** Cartella di lavoro con due PDF di prova (A con 6 pagine, B) e una cartella dati vuota. */
export function preparaCartella() {
  const dir = mkdtempSync(join(tmpdir(), 'leggio-avvio-'));
  const A = join(dir, 'contratto.pdf');
  const B = join(dir, 'fattura.pdf');
  const C = join(dir, 'doppio-clic.pdf');
  copyFileSync(join(ROOT, 'test/fixtures/prova.pdf'), A);
  copyFileSync(join(ROOT, 'test/fixtures/secondo.pdf'), B);
  copyFileSync(join(ROOT, 'test/fixtures/secondo.pdf'), C);
  return { dir, dati: join(dir, 'dati'), A, B, C };
}

/** Avvia Leggio (come con un doppio clic se si passano file) e aspetta che la logica d'avvio abbia agito. */
export async function avvia(dati, files = [], { attesa = 2500 } = {}) {
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT, ...files],
    env: { ...process.env, LEGGIO_USER_DATA: dati, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    executablePath: process.env.ELECTRON_PATH || createRequire(join(ROOT, 'package.json'))('electron'),
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__leggio, null, { timeout: 30000 });
  await page.waitForTimeout(attesa);
  return { app, page };
}

/** Chiusura regolare dalla finestra (come la X o Cmd+Q): passa dalle domande del renderer. */
export async function chiudi({ app }) {
  const chiusa = new Promise((r) => app.once('close', r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([chiusa, new Promise((_, rej) => setTimeout(() => rej(new Error('Leggio non si è chiuso')), 20000))]);
}

/** Crash o chiusura forzata: il processo viene ucciso senza alcuna domanda. */
export async function uccidi({ app }) {
  const chiusa = new Promise((r) => app.once('close', r));
  app.process().kill('SIGKILL');
  await chiusa;
}

/** Stato visibile: documenti aperti, scheda attiva, schermata iniziale, dialoghi. */
export async function stato({ page }) {
  return page.evaluate(() => {
    const a = window.__leggio;
    const home = document.querySelector('.home');
    return {
      docs: a.docs.map((d) => d.path || d.name),
      attivo: a.activeDoc?.path || null,
      sporchi: a.docs.filter((d) => d.dirty).map((d) => d.path || d.name),
      pagina: a.activeDoc ? a.viewer.page : null,
      zoom: a.activeDoc ? a.viewer.pdfViewer.currentScaleValue : null,
      home: !!home && !a.docs.length,
      riapri: document.querySelector('.home [data-azione="riapri-ultimo"]')?.textContent?.trim() || null,
      recenti: [...document.querySelectorAll('.home .recent-item small')].map((x) => x.textContent),
      dialoghi: [...document.querySelectorAll('#overlay-root .dlg')].map((d) => d.querySelector('h2')?.textContent || ''),
      testoDialogo: [...document.querySelectorAll('#overlay-root .dlg .dlg-body')].map((d) => d.textContent).join(' | '),
    };
  });
}

/** Apre un file come farebbe l'utente con «Apri» (il dialogo di sistema è sostituito: risponde con il percorso). */
export async function apri(s, p) {
  await s.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
  await s.page.evaluate(() => window.__leggio.openDialog());
  await s.page.waitForTimeout(300);
}
export const chiudiDoc = (s, p) => s.page.evaluate((p) => window.__leggio.closeDoc(window.__leggio.docs.find((d) => d.path === p)), p);
export const impostazione = (s, k, v) => s.page.evaluate(([k, v]) => window.__leggio.settings.set(k, v), [k, v]);

/** Raccoglie gli esiti e stampa il riepilogo. */
export function registro() {
  const esiti = [];
  return {
    esiti,
    ok(nome, cond, dettaglio) { esiti.push({ nome, ok: !!cond }); console.log(`${cond ? 'OK ' : 'KO '} ${nome}${cond ? '' : ' → ' + JSON.stringify(dettaglio)}`); },
    fine() {
      const ko = esiti.filter((e) => !e.ok);
      console.log(`\n${esiti.length - ko.length}/${esiti.length} verifiche superate`);
      return ko.length;
    },
  };
}
