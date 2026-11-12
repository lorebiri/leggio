// Profilo di volume nell'app vera. Avviare l'app con
//   LEGGIO_USER_DATA=/tmp/leggio-prova npx electron . --remote-debugging-port=9333
// poi: node test/stress/volume-app.mjs [cartella dei 200 PDF]   (genera-volume.mjs li crea)
// Misura: apertura di 200 file in rapida successione, 50 schede aperte, 300 cambi di scheda rapidi,
// chiusura di tutto; memoria del renderer (RSS), heap JS, worker pdf.js vivi, elementi DOM.
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';

const dir = resolve(process.argv[2] || join(homedir(), 'Developer/leggio-out/robustezza/stress/volume'));
const files = readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort().map((f) => join(dir, f));
const port = process.env.PORT || 9333;
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json());
const page = (await targets()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const m = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result?.result?.value; };
await send('HeapProfiler.enable');
const gc = () => send('HeapProfiler.collectGarbage');
const rendererPid = async () => (await ev('return 0'), Number(execSync(`ps -axo pid,command | grep "Electron Helper (Renderer)" | grep -v grep | grep "${process.env.LEGGIO_USER_DATA || 'leggio'}" | head -1 | awk '{print $1}'`).toString().trim()) || null);
const rss = (pid) => { try { return Math.round(Number(execSync(`ps -o rss= -p ${pid}`).toString()) / 1024); } catch { return null; } };
const workers = async () => (await targets()).filter((t) => t.type === 'worker').length;
const snap = async (label) => {
  await gc(); await new Promise((r) => setTimeout(r, 500)); await gc();
  const s = JSON.parse(await ev(`return JSON.stringify({ docs: __leggio.docs.length, dom: document.getElementsByTagName('*').length })`));
  const hu = await send('Runtime.getHeapUsage');
  s.heap = Math.round((hu.result?.usedSize || 0) / 1048576);
  const row = { fase: label, ...s, rssMB: rss(pid), worker: await workers() };
  console.log(JSON.stringify(row)); rows.push(row);
};
const rows = [];
const pid = await rendererPid();
await ev(`document.querySelectorAll('.backdrop').forEach((b) => b.remove()); for (const d of [...__leggio.docs]) { d.dirty = false; await __leggio.closeDoc(d); } return 1`);
await snap('inizio');

// 1. 200 file aperti in rapida successione (come un doppio clic su 200 file, senza attendere il disegno)
let t = Date.now();
await ev(`const ps = ${JSON.stringify(files)}; for (const p of ps) await __leggio.openPath(p); return __leggio.docs.length`);
const tOpen = Date.now() - t;
await snap('200 aperti');
// 2. si chiudono fino a lasciarne 50
t = Date.now();
await ev(`while (__leggio.docs.length > 50) await __leggio.closeDoc(__leggio.docs[0]); return 1`);
const tClose150 = Date.now() - t;
await snap('50 aperti');
// 3. 300 cambi di scheda rapidi (uno ogni 20 ms)
t = Date.now();
const sw = JSON.parse(await ev(`const a = __leggio; const times = []; for (let k = 0; k < 300; k++) { const d = a.docs[(k * 7) % a.docs.length]; const t0 = performance.now(); a.activate(d); times.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 20)); } times.sort((x, y) => x - y); return JSON.stringify({ p50: +times[150].toFixed(1), p95: +times[285].toFixed(1), max: +times[299].toFixed(1) })`));
const tSwitch = Date.now() - t;
await snap('dopo 300 cambi');
// 4. chiusura di tutto
t = Date.now();
await ev(`for (const d of [...__leggio.docs]) await __leggio.closeDoc(d); return 1`);
const tCloseAll = Date.now() - t;
await new Promise((r) => setTimeout(r, 2000));
await snap('tutto chiuso');
// 5. secondo giro completo (perdite: la memoria deve tornare simile)
await ev(`const ps = ${JSON.stringify(files)}; for (const p of ps.slice(0, 50)) await __leggio.openPath(p); for (const d of [...__leggio.docs]) await __leggio.closeDoc(d); return 1`);
await new Promise((r) => setTimeout(r, 2000));
await snap('secondo giro chiuso');

console.log(JSON.stringify({ apertura200ms: tOpen, perFileMs: Math.round(tOpen / files.length), chiusura150ms: tClose150, cambiScheda: sw, cambi300ms: tSwitch, chiusuraTuttoMs: tCloseAll }));
console.log('\n| Fase | Documenti | Heap JS MB | RSS renderer MB | Worker pdf.js | Elementi DOM |\n|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.fase} | ${r.docs} | ${r.heap} | ${r.rssMB} | ${r.worker} | ${r.dom} |`);
process.exit(0);
