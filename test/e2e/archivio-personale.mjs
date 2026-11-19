// Collaudo nell'app vera (Playwright + Electron) dell'archivio personale cifrato della 0.3:
//  1. migrazione silenziosa di firme e profilo della 0.2 (localStorage) nell'archivio cifrato;
//  2. su disco niente in chiaro; scritture con backup automatico;
//  3. password facoltativa: dopo il riavvio l'archivio chiede la password (dialogo vero);
//  4. backup esportato e reimportato (dialoghi di sistema sostituiti dal main);
//  5. firma di un'altra persona: conferma esplicita e registro.
// Uso: npx vite build && node test/e2e/archivio-personale.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const { _electron: electron } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'leggio-pers-'));
const dati = join(dir, 'dati');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let fallite = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fallite++; };

async function avvia(files = []) {
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT, ...files],
    env: { ...process.env, LEGGIO_USER_DATA: dati, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    executablePath: process.env.ELECTRON_PATH || createRequire(join(ROOT, 'package.json'))('electron'),
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__leggio && !!window.__leggioPersonale, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { app, page };
}
async function chiudi({ app }) {
  const chiusa = new Promise((r) => app.once('close', r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([chiusa, new Promise((_, rej) => setTimeout(() => rej(new Error('Leggio non si è chiuso')), 20000))]);
}

try {
  console.log('1. migrazione dalla 0.2');
  let s = await avvia();
  // simula una 0.2: dati nel localStorage, nessun archivio
  await s.page.evaluate(async (png) => {
    await window.__leggioPersonale.archivio.salvaOra();
    await window.__leggioPersonale.archivio.backend.azzera(); // archivio nuovo e vuoto, come al primo avvio della 0.3
    localStorage.setItem('leggio.moduli.firme.v1', JSON.stringify([{ id: 'x', kind: 'signature', dataUrl: png, w: 30, h: 10, created: 1700000000000 }, { id: 'y', kind: 'initials', dataUrl: png, w: 10, h: 10, created: 1700000000000 }]));
    localStorage.setItem('leggio.moduli.profilo.v1', JSON.stringify({ nome: 'Mariagrazia', cognome: 'Vecchiarelli', codiceFiscale: 'VCCMGR80A41H501X' }));
    // avvisi della 0.3.1 (portachiavi mancante, promemoria del backup) già visti: hanno il loro collaudo
    localStorage.setItem('leggio.personale.promemoria.v1', JSON.stringify({ portachiaviAvvisato: Date.now(), maiPiu: true }));
  }, PNG);
  await s.page.reload();
  await s.page.waitForFunction(() => window.__leggioPersonale?.archivio?.aperto, null, { timeout: 20000 });
  await s.page.waitForTimeout(800);
  const m = await s.page.evaluate(() => {
    const a = window.__leggioPersonale.archivio;
    return { firme: a.firme().length, sigle: a.firme({ tipo: 'sigla' }).length, profilo: a.profilo(), legacy: localStorage.getItem('leggio.moduli.firme.v1'), legacyP: localStorage.getItem('leggio.moduli.profilo.v1') };
  });
  ok(m.firme === 2 && m.sigle === 1, `firme e sigle migrate (${m.firme})`);
  ok(m.profilo.nome === 'Mariagrazia' && m.profilo.codiceFiscale === 'VCCMGR80A41H501X', 'profilo migrato');
  ok(m.legacy === null && m.legacyP === null, 'localStorage ripulito');
  const st = await s.page.evaluate(() => window.__leggioPersonale.archivio.stato());
  console.log('     protezione:', st.protezione, '-', st.sistema);
  const pdir = join(dati, 'personale');
  const indice = readFileSync(join(pdir, 'indice.dat'));
  ok(indice.subarray(0, 4).toString() === 'LGV1' && !indice.includes(Buffer.from('Vecchiarelli')), 'indice cifrato, nessun nome in chiaro');
  ok(readdirSync(join(pdir, 'blob')).length === 2, 'due immagini cifrate in blob/');

  console.log('2. firma di un\'altra persona: conferma e registro');
  copyFileSync(join(ROOT, 'test/fixtures/prova.pdf'), join(dir, 'domanda.pdf'));
  await s.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, join(dir, 'domanda.pdf'));
  await s.page.evaluate(() => window.__leggio.openDialog());
  await s.page.waitForFunction(() => window.__leggio.activeDoc?.name === 'domanda.pdf', null, { timeout: 20000 });
  await s.page.evaluate(async (png) => {
    const a = window.__leggioPersonale.archivio;
    const c = a.salvaContatto({ nome: 'Luca', cognome: 'Bianchi', gruppi: ['volontari'] });
    window.__f = await a.aggiungiFirma({ nome: 'Firma di Luca', proprietario: c.id, immagine: png, w: 30, h: 10 });
    window.__leggio.tools.run('fill-sign');
  }, PNG);
  await s.page.waitForTimeout(800);
  const pending = s.page.evaluate(() => window.__leggioModuli.session.addSignature(window.__f));
  await s.page.waitForSelector('#overlay-root .dlg', { timeout: 10000 });
  const titolo = await s.page.textContent('#overlay-root .dlg h2');
  ok(/altra persona/.test(titolo), 'chiede conferma prima di usare la firma altrui');
  await s.page.click('#overlay-root .dlg button[type=submit]');
  const errore = await s.page.textContent('#overlay-root .dlg .dlg-error');
  ok(/spunta/.test(errore), 'senza la spunta non procede');
  await s.page.check('#overlay-root .dlg input[type=checkbox]');
  await s.page.click('#overlay-root .dlg button[type=submit]');
  await pending;
  await s.page.evaluate(() => window.__leggioModuli.session.applyNow());
  await s.page.waitForTimeout(1500);
  const reg = await s.page.evaluate(() => window.__leggioPersonale.archivio.registro());
  ok(reg.length === 1 && reg[0].documento === 'domanda.pdf' && reg[0].proprietarioNome === 'Luca Bianchi', 'uso annotato nel registro');
  await s.page.evaluate(() => window.__leggio.tools.deactivate());
  await s.page.evaluate(() => window.__leggioPersonale.archivio.salvaOra());
  ok(existsSync(join(pdir, 'indice.dat.bak')), 'backup automatico dell\'ultima versione');
  // chiude il documento senza salvare
  const chiusura = s.page.evaluate(() => window.__leggio.closeDoc());
  await s.page.waitForSelector('#overlay-root .dlg', { timeout: 10000 });
  await s.page.click('#overlay-root .dlg button:has-text("Non salvare")');
  await chiusura;

  console.log('3. password facoltativa');
  await s.page.evaluate(async () => { const a = window.__leggioPersonale.archivio; await a.salvaOra(); await a.backend.impostaPassword('', 'password-di-prova'); });
  await chiudi(s);
  s = await avvia();
  const bloccato = await s.page.evaluate(async () => (await window.__leggioPersonale.archivio.stato()).bloccato);
  ok(bloccato === true, 'dopo il riavvio l\'archivio è bloccato');
  const apertura = s.page.evaluate(() => window.__leggioPersonale.apri());
  await s.page.waitForSelector('#overlay-root .dlg input[type=password]', { timeout: 10000 });
  await s.page.fill('#overlay-root .dlg input[type=password]', 'sbagliata');
  await s.page.click('#overlay-root .dlg button[type=submit]');
  await s.page.waitForFunction(() => /errata/i.test(document.querySelector('#overlay-root .dlg')?.textContent || ''), null, { timeout: 15000 });
  ok(true, 'password sbagliata: lo dice e la richiede');
  await s.page.fill('#overlay-root .dlg input[type=password]', 'password-di-prova');
  await s.page.click('#overlay-root .dlg button[type=submit]');
  ok(await apertura === true, 'con la password giusta si apre');
  const n = await s.page.evaluate(() => window.__leggioPersonale.archivio.contatti().length);
  ok(n === 1, 'i dati ci sono tutti');

  console.log('4. backup esportato e reimportato');
  const bk = join(dir, 'backup.leggio-backup');
  await s.app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, bk);
  await s.page.evaluate(() => window.__leggioPersonale.archivio.backend.esporta('backup-password'));
  ok(existsSync(bk) && !readFileSync(bk).includes(Buffer.from('Bianchi')), 'backup salvato e cifrato');
  const imp = await s.page.evaluate(async () => {
    const a = window.__leggioPersonale.archivio;
    const id = a.contatti()[0].id;
    await a.eliminaContatto(id);
    const f = await a.backend.importaScegli();
    const r = await a.backend.importaApri(f.token, 'backup-password');
    await a.applicaImportato(r.indice, 'unisci');
    return { contatti: a.contatti().length, firmeAltrui: a.firme({ proprietario: 'altri' }).length };
  });
  ok(imp.contatti === 1 && imp.firmeAltrui === 1, 'reimportato: contatto e sua firma tornano');

  console.log('5. firma da una foto su carta colorata');
  const fotoB64 = await s.page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 400; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 900, 0); g.addColorStop(0, '#f4ecc8'); g.addColorStop(1, '#a89f82'); x.fillStyle = g; x.fillRect(0, 0, 900, 400);
    x.strokeStyle = '#1b2a6b'; x.lineWidth = 7; x.beginPath(); x.moveTo(150, 250); for (let i = 0; i < 60; i++) x.lineTo(150 + i * 10, 220 - Math.sin(i / 4) * 70); x.stroke();
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const fotoPath = join(dir, 'firma-foto.jpg');
  (await import('node:fs')).writeFileSync(fotoPath, Buffer.from(fotoB64, 'base64'));
  await s.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, fotoPath);
  const prima = await s.page.evaluate(() => window.__leggioPersonale.archivio.firme({ proprietario: 'io' }).length);
  await s.page.evaluate(() => window.__leggio.tools.run('signatures-library'));
  await s.page.click('button:has-text("Nuova firma o sigla")');
  await s.page.waitForSelector('#overlay-root .dlg .sig-tab[data-tab=image]');
  await s.page.click('#overlay-root .dlg .sig-tab[data-tab=image]');
  await s.page.click('#overlay-root .dlg button:has-text("Scegli foto o scansione")');
  await s.page.waitForSelector('#overlay-root .dlg .foto-wrap:not([hidden])', { timeout: 15000 });
  await s.page.waitForTimeout(500);
  await s.page.screenshot({ path: join(dir, 'firma-da-foto.png') });
  await s.page.click('#overlay-root .dlg button[type=submit]');
  await s.page.waitForFunction((n) => window.__leggioPersonale.archivio.firme({ proprietario: 'io' }).length > n, prima, { timeout: 10000 });
  const nuova = await s.page.evaluate(async () => { const a = window.__leggioPersonale.archivio; const f = a.firme({ proprietario: 'io' }).find((x) => x.origine === 'foto'); const u = await a.immagine(f.blob); const img = new Image(); img.src = u; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let trasp = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 0) trasp++; return { w: img.width, h: img.height, trasparente: trasp / (d.length / 4) }; });
  ok(nuova.w > 400 && nuova.w < 700 && nuova.trasparente > 0.5, `firma da foto: ritagliata (${nuova.w}×${nuova.h}) con sfondo trasparente (${Math.round(nuova.trasparente * 100)}%)`);
  console.log('     schermata:', join(dir, 'firma-da-foto.png'));
  await chiudi(s);
} catch (e) {
  console.error(e); fallite++;
}
console.log(fallite ? `\n${fallite} controlli NON superati` : '\nTutti i controlli superati');
process.exit(fallite ? 1 : 0);
