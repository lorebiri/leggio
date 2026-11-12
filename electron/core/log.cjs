// Registro locale ruotato: userData/logs/leggio.log (max ~2 MB), più 3 file precedenti.
// Niente rete, niente telemetria: il file resta sul computer dell'utente.
const fs = require('node:fs');
const path = require('node:path');

function createLogger(dir, { maxBytes = 2 * 1024 * 1024, keep = 3 } = {}) {
  const file = path.join(dir, 'leggio.log');
  let size = -1;
  function ensure() {
    if (size >= 0) return;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    try { size = fs.statSync(file).size; } catch { size = 0; }
  }
  function rotate() {
    for (let i = keep - 1; i >= 1; i--) {
      try { fs.renameSync(path.join(dir, `leggio.${i}.log`), path.join(dir, `leggio.${i + 1}.log`)); } catch { /* */ }
    }
    try { fs.renameSync(file, path.join(dir, 'leggio.1.log')); } catch { /* */ }
    size = 0;
  }
  function write(level, message, data, source = 'main') {
    try {
      ensure();
      let line = `${new Date().toISOString()} [${String(level).toUpperCase()}] (${source}) ${String(message).replace(/\s+/g, ' ').slice(0, 2000)}`;
      if (data !== undefined) { let d; try { d = JSON.stringify(data); } catch { d = String(data); } line += ' ' + d.slice(0, 8000); }
      line += '\n';
      if (size + line.length > maxBytes) rotate();
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch { /* il registro non deve mai far fallire l'app */ }
  }
  return { dir, file, write, info: (m, d) => write('info', m, d), warn: (m, d) => write('warn', m, d), error: (m, d) => write('error', m, d) };
}

module.exports = { createLogger };
