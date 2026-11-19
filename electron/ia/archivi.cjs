// Assistente IA — estrazione dei pacchetti del motore (llama.cpp): .zip (Windows) e .tar.gz (macOS, Linux).
// Solo moduli di Node: niente dipendenze nuove. I nomi dei file vengono controllati: nessun file può
// finire fuori dalla cartella di destinazione (percorsi assoluti, «..», collegamenti verso l'esterno).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_FILE = 512 * 1024 * 1024; // un file del motore non supera mai questa dimensione
const MAX_VOCI = 5000;

/** Percorso sicuro dentro dest, oppure null (voci da scartare). */
function destinazione(dest, nome) {
  const pulito = String(nome).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!pulito || pulito.includes('\0') || pulito.startsWith('/') || /^[a-zA-Z]:/.test(pulito)) return null;
  if (pulito.split('/').some((p) => p === '..')) return null;
  const finale = path.resolve(dest, pulito);
  const rel = path.relative(path.resolve(dest), finale);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return finale;
}

/** Estrae un .zip (metodi 0 = memorizzato, 8 = deflate). → numero di file scritti */
async function estraiZip(file, dest) {
  const buf = await fsp.readFile(file);
  // fine della directory centrale (EOCD): firma 0x06054b50, cercata dalla fine (commento max 64 KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Pacchetto zip non valido.');
  const voci = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (voci > MAX_VOCI) throw new Error('Pacchetto zip con troppi file.');
  let scritti = 0;
  for (let k = 0; k < voci; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Pacchetto zip danneggiato.');
    const metodo = buf.readUInt16LE(p + 10);
    const compresso = buf.readUInt32LE(p + 20);
    const dim = buf.readUInt32LE(p + 24);
    const lNome = buf.readUInt16LE(p + 28); const lExtra = buf.readUInt16LE(p + 30); const lComm = buf.readUInt16LE(p + 32);
    const attrEsterni = buf.readUInt32LE(p + 38);
    const offLocale = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lNome);
    p += 46 + lNome + lExtra + lComm;
    if (dim > MAX_FILE || compresso > MAX_FILE) throw new Error('File troppo grande nel pacchetto.');
    const out = destinazione(dest, nome);
    if (!out) continue;
    if (nome.endsWith('/')) { await fsp.mkdir(out, { recursive: true }); continue; }
    if (buf.readUInt32LE(offLocale) !== 0x04034b50) throw new Error('Pacchetto zip danneggiato.');
    const inizio = offLocale + 30 + buf.readUInt16LE(offLocale + 26) + buf.readUInt16LE(offLocale + 28);
    const dati = buf.subarray(inizio, inizio + compresso);
    let contenuto;
    if (metodo === 0) contenuto = dati;
    else if (metodo === 8) contenuto = zlib.inflateRawSync(dati, { maxOutputLength: MAX_FILE });
    else throw new Error('Metodo di compressione non supportato nel pacchetto.');
    if (contenuto.length !== dim) throw new Error('Pacchetto zip danneggiato (dimensione).');
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const modo = (attrEsterni >>> 16) & 0o777;
    await fsp.writeFile(out, contenuto, { mode: modo ? modo | 0o600 : 0o644 });
    scritti++;
  }
  return scritti;
}

const ottale = (b, a, l) => parseInt(b.toString('ascii', a, a + l).replace(/\0.*$/, '').trim() || '0', 8);

/** Estrae un .tar.gz (file, cartelle, collegamenti simbolici interni; intestazioni GNU e PAX per i nomi lunghi). */
async function estraiTarGz(file, dest) {
  const buf = zlib.gunzipSync(await fsp.readFile(file), { maxOutputLength: 2 * MAX_FILE });
  let p = 0; let scritti = 0; let nomeLungo = null; let voci = 0;
  const collegamenti = [];
  while (p + 512 <= buf.length) {
    const h = buf.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    if (++voci > MAX_VOCI) throw new Error('Pacchetto con troppi file.');
    let nome = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefisso = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    if (prefisso && h.toString('ascii', 257, 262) === 'ustar') nome = prefisso + '/' + nome;
    const dim = ottale(h, 124, 12);
    const modo = ottale(h, 100, 8) & 0o777;
    const tipo = String.fromCharCode(h[156] || 48);
    const link = h.toString('utf8', 157, 257).replace(/\0.*$/s, '');
    const dati = buf.subarray(p + 512, p + 512 + dim);
    p += 512 + Math.ceil(dim / 512) * 512;
    if (dim > MAX_FILE) throw new Error('File troppo grande nel pacchetto.');
    if (tipo === 'L') { nomeLungo = dati.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (tipo === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(dati.toString('utf8')); if (m) nomeLungo = m[1]; continue; }
    if (tipo === 'g') continue;
    if (nomeLungo) { nome = nomeLungo; nomeLungo = null; }
    const out = destinazione(dest, nome);
    if (!out) continue;
    if (tipo === '5') { await fsp.mkdir(out, { recursive: true }); continue; }
    if (tipo === '2') { collegamenti.push({ out, link }); continue; }
    if (tipo !== '0' && tipo !== '\0' && tipo !== '7') continue; // dispositivi, fifo, hard link: ignorati
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, dati, { mode: (modo || 0o644) | 0o600 });
    scritti++;
  }
  // collegamenti simbolici (le librerie .so/.dylib li usano): solo verso file dentro dest
  for (const { out, link } of collegamenti) {
    const bersaglio = path.resolve(path.dirname(out), link);
    if (path.isAbsolute(link) || !destinazione(dest, path.relative(dest, bersaglio))) continue;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    try { await fsp.rm(out, { force: true }); await fsp.symlink(link, out); }
    catch { if (fs.existsSync(bersaglio)) await fsp.copyFile(bersaglio, out); }
  }
  return scritti;
}

async function estrai(file, dest) {
  await fsp.mkdir(dest, { recursive: true });
  if (/\.zip$/i.test(file)) return estraiZip(file, dest);
  if (/\.(tar\.gz|tgz)$/i.test(file)) return estraiTarGz(file, dest);
  throw new Error('Formato del pacchetto non riconosciuto.');
}

/** Cerca un file per nome dentro una cartella (anche in sottocartelle, poca profondità). */
function trova(dir, nome, profondita = 3) {
  let voci = [];
  try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const v of voci) if (v.isFile() && v.name === nome) return path.join(dir, v.name);
  if (profondita > 0) for (const v of voci) if (v.isDirectory()) { const t = trova(path.join(dir, v.name), nome, profondita - 1); if (t) return t; }
  return null;
}

module.exports = { estrai, estraiZip, estraiTarGz, trova, destinazione };
