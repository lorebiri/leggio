// Collaudo nell'app vera della SOLA LETTURA: nessun percorso deve sovrascrivere l'originale.
// Avvio: LEGGIO_USER_DATA=/tmp/leggio-e2e npx electron . --remote-debugging-port=9333
// poi:   node test/e2e/sola-lettura-app.mjs
// Usa una copia temporanea di test/fixtures/prova.pdf come «originale d'archivio» e ne confronta
// l'impronta prima e dopo ogni prova.
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'leggio-e2e-'));
const ORIG = join(dir, 'determina-archivio.pdf');
copyFileSync(resolve('test/fixtures/prova.pdf'), ORIG);
const hash = () => createHash('sha256').update(readFileSync(ORIG)).digest('hex');
const H0 = hash();

const list = await (await fetch(`http://127.0.0.1:${process.env.PORT || 9333}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const ev = (expr) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.result?.exceptionDetails ? rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400))) : res(m.result?.result?.value))); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } })); });

// risponde da sola ai dialoghi: preferisce il pulsante indicato
await ev(`window.__rispondi = (testo) => { const t = setInterval(() => { const b = [...document.querySelectorAll('.dlg-foot .btn, .dlg button[type=submit]')].find((x) => x.textContent.includes(testo)); if (b) { b.click(); clearInterval(t); } }, 50); setTimeout(() => clearInterval(t), 5000); }; return 1`);
// «Salva con nome» simulato: registra la chiamata invece di aprire il dialogo di sistema
await ev(`const p = __leggio.platform; window.__saveAs = []; p.__realSaveAs ||= p.saveAs; p.saveAs = async (bytes, name) => { window.__saveAs.push(name); return null; }; return 1`);

const results = [];
const check = async (nome, fn) => {
  let esito;
  try { esito = await fn(); } catch (err) { esito = 'errore: ' + err.message.slice(0, 160); }
  const intatto = hash() === H0;
  results.push({ prova: nome, originaleIntatto: intatto, esito });
  console.log((intatto ? 'OK ' : 'KO ') + nome + ' → ' + JSON.stringify(esito));
};
const P = JSON.stringify(ORIG);
const apri = `for (const d of [...__leggio.docs]) { d.dirty = false; d.formsDirty = false; await __leggio.closeDoc(d); } const d = await __leggio.openPath(${P}, { readOnly: true });`;

await check('1. Salva (Ctrl+S) senza modifiche', () => ev(`${apri} const r = await __leggio.save(d); return { r, saveAs: window.__saveAs.splice(0) }`));
await check('2. applyEdit → «Lascia perdere»', () => ev(`${apri} __rispondi('Lascia perdere'); const r = await __leggio.editWithPdfLib('Ruota', async (p, L) => { p.getPage(0).setRotation(L.degrees(90)); }); return { r, path: d.path, readOnly: d.readOnly }`));
await check('3. applyEdit → «Lavora su una copia», poi Salva', () => ev(`${apri} __rispondi('copia'); await __leggio.editWithPdfLib('Ruota', async (p, L) => { p.getPage(0).setRotation(L.degrees(90)); }); const r = await __leggio.save(d); return { r, path: d.path, name: d.name, saveAs: window.__saveAs.splice(0) }`));
await check('4. Annulla e Ripeti dopo la modifica, poi Salva', () => ev(`${apri} __rispondi('copia'); await __leggio.editWithPdfLib('Ruota', async (p, L) => { p.getPage(0).setRotation(L.degrees(90)); }); await __leggio.undo(d); await __leggio.redo(d); await __leggio.undo(d); const r = await __leggio.save(d); return { r, path: d.path, saveAs: window.__saveAs.splice(0) }`));
await check('5. Strumento di un\'area che scrive sul percorso originale (platform.writeFile)', () => ev(`${apri} try { await __leggio.platform.writeFile(${P}, d.bytes); return 'scritto!'; } catch (e) { return 'rifiutato: ' + e.message.slice(0, 80); }`));
await check('6. Scrittura diretta al main (file:write), aggirando il nucleo', () => ev(`${apri} try { await window.leggio.invoke('file:write', { path: ${P}, bytes: new Uint8Array([37, 80, 68, 70]) }); return 'scritto!'; } catch (e) { return 'rifiutato: ' + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 80); }`));
await check('7. Moduli compilati a schermo, poi chiusura con «Salva»', () => ev(`${apri} d.formsDirty = true; d.formsRev++; __rispondi('Salva'); const r = await __leggio.closeDoc(d); return { r, saveAs: window.__saveAs.splice(0) }`));
await check('8. Salvataggio di recupero e ripristino: torna in sola lettura', () => ev(`${apri} __rispondi('copia'); d.readOnly = true; d.dirty = true; await __leggio.recovery.snapshot(d); const list = await __leggio.recovery.backend.list(); return { recuperoScritto: true, readOnly: d.readOnly, voci: list.length }`));
await check('9. Stampa: non scrive il file', () => ev(`${apri} const p = __leggio.platform; const real = p.print; p.print = async () => ({ ok: true }); await __leggio.printFiles([d], { preset: { copies: 1 } }); p.print = real; return 'stampato (simulato)'`));
await check('10. Riordino pagine (strumento del nucleo) → «Lascia perdere»', () => ev(`${apri} __rispondi('Lascia perdere'); const r = await __leggio.reorderPages([5, 4, 3, 2, 1, 0], 'Inverti', d); return { r, path: d.path }`));

await ev(`const p = __leggio.platform; if (p.__realSaveAs) p.saveAs = p.__realSaveAs; for (const d of [...__leggio.docs]) { d.dirty = false; d.formsDirty = false; await __leggio.closeDoc(d); } return 1`);
const ko = results.filter((r) => !r.originaleIntatto);
console.log(`\n${results.length - ko.length}/${results.length} prove: originale intatto${ko.length ? ' — FALLITE: ' + ko.map((r) => r.prova).join(', ') : ''}`);
rmSync(dir, { recursive: true, force: true });
process.exit(ko.length ? 1 : 0);
