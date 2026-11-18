// Collaudo nell'app vera dei PERMESSI del main: un renderer (anche compromesso) non deve poter
// sovrascrivere file che l'utente non ha scelto.
// Avvio: LEGGIO_USER_DATA=/tmp/leggio-e2e npx electron . --remote-debugging-port=9407
// poi:   node test/e2e/permessi-app.mjs
import { writeFileSync, readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'leggio-perm-'));
const PDF = join(dir, 'mai-aperto.pdf');
copyFileSync(resolve('test/fixtures/prova.pdf'), PDF);
const TXT = join(dir, 'bersaglio.txt');
writeFileSync(TXT, 'originale');
const before = { pdf: readFileSync(PDF).toString('base64'), txt: readFileSync(TXT, 'utf8') };

const PORT = process.env.PORT || 9407;
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pend = new Map();
        ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
        const ev = (expr) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.result?.exceptionDetails ? rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400))) : res(m.result?.result?.value))); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } })); });
        await ev('for (let i = 0; i < 100 && !window.__leggio; i++) await new Promise((r) => setTimeout(r, 100)); return 1');
        return { ws, ev };
      }
    } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('app non raggiungibile');
}
const tenta = (expr) => `try { ${expr}; return 'scritto!'; } catch (e) { return 'rifiutato'; }`;
const results = [];
let { ws, ev } = await connect();

// 1. file:read di un PDF mai scelto, poi file:write sullo stesso percorso
await ev(`await window.leggio.invoke('file:read', ${JSON.stringify(PDF)}); return 1`);
results.push(['file:read non concede la sovrascrittura', await ev(tenta(`await window.leggio.invoke('file:write', { path: ${JSON.stringify(PDF)}, bytes: new Uint8Array([37, 80, 68, 70]) })`))]);

// 2. recupero automatico con un percorso inventato, ricarica, rilettura → non deve concedere la scrittura
await ev(`await window.leggio.invoke('app:recovery-write', { meta: { id: 4242, name: 'x.pdf', path: ${JSON.stringify(TXT)} }, bytes: new Uint8Array([1, 2, 3]) }); setTimeout(() => location.reload(), 50); return 1`);
ws.close();
await new Promise((r) => setTimeout(r, 1500));
({ ws, ev } = await connect());
const r2 = await ev(`const l = await window.leggio.invoke('app:recovery-list'); const v = l.find((x) => x.id === 4242); if (!v) return 'voce assente'; await window.leggio.invoke('app:recovery-read', { session: v.session, id: 4242 }); await window.leggio.invoke('app:recovery-discard', { session: v.session }); ${tenta(`await window.leggio.invoke('file:write', { path: ${JSON.stringify(TXT)}, bytes: new Uint8Array([88]) })`)}`);
results.push(['il recupero non concede percorsi inventati', r2]);

const after = { pdf: readFileSync(PDF).toString('base64'), txt: readFileSync(TXT, 'utf8') };
const intatti = after.pdf === before.pdf && after.txt === before.txt;
for (const [n, e] of results) console.log((e === 'rifiutato' ? 'OK ' : 'KO ') + n + ' → ' + e);
console.log(intatti ? 'file intatti' : 'FILE SOVRASCRITTI');
ws.close();
rmSync(dir, { recursive: true, force: true });
process.exit(intatti && results.every(([, e]) => e === 'rifiutato') ? 0 : 1);
