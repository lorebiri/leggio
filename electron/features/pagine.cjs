// Area «pagine», processo principale: conversione delle foto HEIC (iPhone) in JPEG.
// Chromium non decodifica HEIC; su macOS usiamo lo strumento di sistema `sips`.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_BYTES = 150 * 1024 * 1024;

function sembraHeic(b) {
  // contenitore ISO BMFF: "ftyp" ai byte 4-7, marchio heic/heix/hevc/heim/heis/mif1/msf1/avif
  if (!b || b.length < 16) return false;
  const tag = Buffer.from(b.subarray(4, 8)).toString('latin1');
  const brand = Buffer.from(b.subarray(8, 12)).toString('latin1');
  return tag === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand);
}

function register({ ipcMain }) {
  ipcMain.handle('feat:pagine:heic', async (_e, arg) => {
    const bytes = arg && arg.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) return { errore: 'non-valido' };
    if (!sembraHeic(bytes)) return { errore: 'non-heic' };
    if (process.platform !== 'darwin') return { errore: 'non-supportato' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-heic-'));
    const src = path.join(dir, 'foto.heic');
    const dst = path.join(dir, 'foto.jpg');
    try {
      fs.writeFileSync(src, Buffer.from(bytes));
      await new Promise((resolve, reject) => {
        execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', src, '--out', dst], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
      });
      return { bytes: new Uint8Array(fs.readFileSync(dst)) };
    } catch (err) {
      return { errore: 'conversione', dettaglio: String(err && err.message || err).slice(0, 300) };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
}

module.exports = { register, sembraHeic };
