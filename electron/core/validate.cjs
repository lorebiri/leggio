// Validazione degli argomenti dei canali IPC: un renderer compromesso (es. da un PDF malevolo
// che sfruttasse un bug di pdf.js) non deve poter usare il main per leggere o scrivere file
// arbitrari o esaurire la memoria.
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;

class IpcValidationError extends Error { constructor(m) { super(m); this.name = 'IpcValidationError'; } }

function str(v, name, max = 4096) {
  if (typeof v !== 'string' || v.length > max) throw new IpcValidationError(`Argomento non valido: ${name}`);
  return v;
}
function optStr(v, name, max) { return v == null ? undefined : str(v, name, max); }
function absPath(v, name = 'percorso') {
  str(v, name, 32767);
  if (!path.isAbsolute(v) || v.includes('\0')) throw new IpcValidationError(`Percorso non valido: ${name}`);
  return path.normalize(v);
}
function bytes(v, name = 'byte', max = MAX_BYTES) {
  if (v instanceof ArrayBuffer) v = new Uint8Array(v);
  if (!(v instanceof Uint8Array)) throw new IpcValidationError(`Dati non validi: ${name}`);
  if (v.byteLength > max) throw new IpcValidationError('Il file supera i 2 GB: operazione non consentita.');
  return v;
}
function fileName(v, name = 'nome') {
  str(v, name, 255);
  const clean = v.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_');
  if (!clean || clean === '.' || clean === '..') throw new IpcValidationError('Nome file non valido');
  return clean;
}
function filters(v) {
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.length > 30) throw new IpcValidationError('Filtri non validi');
  return v.map((f) => ({ name: str(f?.name, 'filtro', 200), extensions: (Array.isArray(f?.extensions) ? f.extensions : []).slice(0, 50).map((e) => str(e, 'estensione', 20)) }));
}
function key(v) { if (typeof v !== 'string' || !/^[a-f0-9]{8,64}$/.test(v)) throw new IpcValidationError('Chiave non valida'); return v; }
function webUrl(v) {
  str(v, 'url', 8192);
  let u; try { u = new URL(v); } catch { return null; }
  return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
}

module.exports = { IpcValidationError, str, optStr, absPath, bytes, fileName, filters, key, webUrl, MAX_BYTES };
