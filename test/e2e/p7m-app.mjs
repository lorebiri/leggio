// Collaudo nell'app Electron vera: un .p7m aperto «dal sistema» (riga di comando, come il doppio clic)
// non viene MAI riscritto né rinominato. Il PDF contenuto si apre in memoria con un nome distinto;
// ogni scrittura sul .p7m viene rifiutata dal processo main.
// Avvio: node test/e2e/p7m-app.mjs   (avvia da solo Electron su xvfb; serve `npx vite build` prima)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const forge = require('node-forge');
const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');

const dir = mkdtempSync(join(tmpdir(), 'leggio-p7m-app-'));
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

// PDF firmato in una busta CAdES
const pd = await PDFDocument.create(); const f = await pd.embedFont(StandardFonts.Helvetica);
pd.addPage([595, 842]).drawText('Contratto firmato digitalmente', { x: 60, y: 760, size: 18, font: f });
const pdf = await pd.save();
const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
const cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = '01';
cert.validity.notBefore = new Date(Date.UTC(2020, 0, 1)); cert.validity.notAfter = new Date(Date.UTC(2035, 0, 1));
cert.setSubject([{ name: 'commonName', value: 'MARIO ROSSI' }]); cert.setIssuer([{ name: 'commonName', value: 'CA di prova' }]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const p7 = forge.pkcs7.createSignedData();
p7.content = forge.util.createBuffer(Buffer.from(pdf).toString('binary')); p7.addCertificate(cert);
p7.addSigner({ key: keys.privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() }] });
p7.sign();
const P7M = join(dir, 'contratto.pdf.p7m');
writeFileSync(P7M, Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary'));
const before = { bytes: readFileSync(P7M).toString('base64'), mtime: statSync(P7M).mtimeMs };

const PORT = 9411;
const electron = spawn('xvfb-run', ['-a', resolve('node_modules/.bin/electron'), '.', '--no-sandbox', `--remote-debugging-port=${PORT}`, P7M], { env: { ...process.env, LEGGIO_USER_DATA: join(dir, 'ud'), LEGGIO_NO_UPDATE_CHECK: '1' }, stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pend = new Map();
        ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
        const ev = (expr) => new Promise((res, rej) => { const k = ++id; pend.set(k, (m) => (m.result?.exceptionDetails ? rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400))) : res(m.result?.result?.value))); ws.send(JSON.stringify({ id: k, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } })); });
        await ev('for (let i = 0; i < 100 && !window.__leggio; i++) await new Promise((r) => setTimeout(r, 100)); return 1');
        return { ws, ev };
      }
    } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('app non raggiungibile');
}

try {
  const { ws, ev } = await connect();
  const st = await ev(`for (let i = 0; i < 100 && !__leggio.docs.length; i++) await new Promise((r) => setTimeout(r, 100));
    const d = __leggio.activeDoc; return d ? { name: d.name, path: d.path, p7m: !!d.data.p7m, src: d.data.p7m?.sourceName, readOnly: !!d.readOnly } : null;`);
  check('il .p7m aperto dal sistema mostra il PDF contenuto con firme', st && st.p7m && st.src === 'contratto.pdf.p7m', JSON.stringify(st));
  check('il PDF contenuto è in memoria (nessun percorso) e ha un nome distinto', st && st.path === null && st.name === 'contratto (da p7m).pdf');
  const w1 = await ev(`try { await __leggio.platform.writeFile(${JSON.stringify(P7M)}, new Uint8Array([37, 80, 68, 70])); return 'scritto'; } catch (e) { return 'rifiutato: ' + e.message; }`);
  check('il main rifiuta di scrivere sul .p7m', /^rifiutato/.test(w1), w1.slice(0, 140));
  // modifica del documento: resta senza percorso, quindi «Salva» chiederà sempre un nome nuovo
  await ev(`await __leggio.editWithPdfLib('prova', (d) => { d.addPage([200, 200]); }); return 1`);
  const st2 = await ev(`const d = __leggio.activeDoc; return { path: d.path, dirty: d.dirty, name: d.name };`);
  check('dopo una modifica il documento non punta al .p7m', st2.path === null && st2.dirty === true, JSON.stringify(st2));
  ws.close();
} catch (e) { check('collaudo completato', false, e.message); }
finally { electron.kill('SIGTERM'); spawn('pkill', ['-f', `remote-debugging-port=${PORT}`]); }
await new Promise((r) => setTimeout(r, 800));
const after = { bytes: readFileSync(P7M).toString('base64'), mtime: statSync(P7M).mtimeMs };
check('il file .p7m è identico byte per byte e non è stato toccato', after.bytes === before.bytes && after.mtime === before.mtime);
const files = readdirSync(dir).filter((n) => n !== 'ud');
check('nella cartella non è comparso nessun file nuovo né rinominato', files.length === 1 && files[0] === 'contratto.pdf.p7m', files.join(', '));
rmSync(dir, { recursive: true, force: true });
console.log(`\n${results.filter(Boolean).length}/${results.length} superati`);
process.exit(results.every(Boolean) ? 0 : 1);
