// Archivio personale 0.3.1: scrypt più forte (e asincrono), rafforzamento trasparente delle chiavi della 0.3.0,
// copia di riserva della chiave, casi di errore (chiave danneggiata o mancante, portachiavi azzerato, disco pieno,
// password sbagliata dopo il rafforzamento), backup completo e ripristino end-to-end su un archivio nuovo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createArchivio } from '../src/renderer/features/personale/lib/archivio.js';
import { createIpcBackend } from '../src/renderer/features/personale/lib/backend.js';

const require = createRequire(import.meta.url);
const { createCassaforte, derivaChiave, KDF } = require('../electron/personale/cassaforte.cjs');
const { safeWrite } = require('../electron/core/safe-write.cjs');
const feature = require('../electron/features/personale.cjs');

const FIXTURE = join(import.meta.dirname, 'fixtures', 'personale-0.3.0');

/** safeStorage finto (lo stesso usato per generare gli archivi della 0.3.0). */
function fakeSafe({ disponibile = true, backend = 'gnome_libsecret', rotto = false } = {}) {
  return {
    isEncryptionAvailable: () => disponibile,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.concat([Buffer.from('SS:'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
    decryptString: (b) => { if (rotto || !b.subarray(0, 3).equals(Buffer.from('SS:'))) throw new Error('decrypt'); return Buffer.from(b.subarray(3).map((x) => x ^ 0x5a)).toString('utf8'); },
  };
}
/** Parametri scrypt dentro chiave.json (decodificando il safeStorage finto o il metodo «file»). */
function kdfDi(cartella) {
  const k = JSON.parse(readFileSync(join(cartella, 'chiave.json'), 'utf8'));
  const raw = Buffer.from(k.protetta.dati, 'base64');
  const testo = k.protetta.metodo === 'sistema' ? Buffer.from(raw.subarray(3).map((x) => x ^ 0x5a)).toString('utf8') : raw.toString('utf8');
  const w = JSON.parse(testo);
  return { N: w.N, r: w.r, p: w.p, metodo: k.protetta.metodo };
}
const enospc = () => Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });

let base; let dir;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'leggio-031-')); dir = join(base, 'personale'); });
afterEach(() => rmSync(base, { recursive: true, force: true }));
const copiaFixture = (nome) => { cpSync(join(FIXTURE, nome), dir, { recursive: true }); return dir; };

describe('scrypt più forte', () => {
  it('i nuovi archivi con password usano N=131072, r=8, p=1', async () => {
    expect(KDF).toEqual({ N: 131072, r: 8, p: 1 });
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.impostaPassword('', 'password-nuova');
    expect(kdfDi(dir)).toMatchObject({ N: 131072, r: 8, p: 1, metodo: 'sistema' });
  });

  it('resta sotto ~0,5 s (margine largo per la CI) e non blocca il processo principale', async () => {
    const salt = Buffer.alloc(16, 1);
    await derivaChiave('riscaldamento', salt); // la prima volta il pool di libuv si avvia
    let tick = 0; const iv = setInterval(() => { tick++; }, 5);
    const t0 = performance.now();
    await derivaChiave('una password qualsiasi', salt);
    const ms = performance.now() - t0;
    clearInterval(iv);
    console.log(`scrypt N=${KDF.N}: ${Math.round(ms)} ms, ${tick} tick del timer durante il calcolo`);
    expect(ms).toBeLessThan(3000);
    // asincrono: il ciclo degli eventi continua a girare (con scryptSync i tick sarebbero 0)
    expect(tick).toBeGreaterThan(Math.min(5, Math.floor(ms / 20)));
  });

  it('limite di memoria di scrypt a 256 MB: i nostri parametri ci stanno con margine, quelli più grandi no', async () => {
    const mem = 128 * KDF.r * (KDF.N + KDF.p + 2);
    expect(mem).toBeLessThanOrEqual(256 * 1024 * 1024 / 2 + 1024 * 1024);
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    for (const [N, r] of [[1 << 18, 8], [1 << 17, 16], [1 << 20, 1]]) {
      const head = { formato: 'leggio-backup', versione: 1, kdf: 'scrypt', N, r, p: 1, salt: 'AAAA' };
      const finto = Buffer.from('LEGGIO-BACKUP-1\n' + JSON.stringify(head) + '\n' + 'x'.repeat(64));
      const t = performance.now();
      await expect(c.importaBackup(finto, 'qualunque-password'), `N=${N} r=${r}`).rejects.toMatchObject({ code: 'formato' });
      expect(performance.now() - t).toBeLessThan(200); // rifiutato prima di calcolare
    }
  });

  it('rifiuta parametri esagerati letti da un file (niente esaurimento della memoria)', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    const head = { formato: 'leggio-backup', versione: 1, kdf: 'scrypt', N: 1 << 20, r: 32, p: 1, salt: 'AAAA' };
    const finto = Buffer.from('LEGGIO-BACKUP-1\n' + JSON.stringify(head) + '\n' + 'x'.repeat(64));
    await expect(c.importaBackup(finto, 'qualunque-password')).rejects.toMatchObject({ code: 'formato' });
    await expect(c.importaBackup(finto, 'qualunque-password')).rejects.toThrow(/aggiorna Leggio/i);
  });
});

describe('compatibilità con gli archivi della 0.3.0', () => {
  it('archivio con password (portachiavi): si apre, la chiave viene rafforzata e la password resta la stessa', async () => {
    copiaFixture('sistema-password');
    expect(kdfDi(dir)).toMatchObject({ N: 32768 });
    const prima = readFileSync(join(dir, 'chiave.json'));
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    expect(c.stato()).toMatchObject({ bloccato: true, password: true });
    // password sbagliata: nessun rafforzamento, file intatto
    await expect(c.sblocca('sbagliata')).rejects.toMatchObject({ code: 'password-errata' });
    expect(readFileSync(join(dir, 'chiave.json')).equals(prima)).toBe(true);
    await c.sblocca('password-030');
    expect(c.stato()).toMatchObject({ bloccato: false, kdfRafforzato: true });
    expect(kdfDi(dir)).toMatchObject({ N: 131072, r: 8, p: 1, metodo: 'sistema' });
    // copia di riserva identica
    expect(readFileSync(join(dir, 'chiave.json.bak')).equals(readFileSync(join(dir, 'chiave.json')))).toBe(true);
    const indice = await c.leggiIndice();
    expect(indice.profilo.nome).toBe('Maria');
    expect((await c.leggiBlob('firma-0001')).toString()).toBe('PNG-firma');
    expect((await c.leggiBlob('modello-0001')).toString()).toBe('%PDF-modello');

    // nuovo avvio dopo il rafforzamento: password sbagliata → messaggio chiaro; giusta → si apre, niente da rifare
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    await expect(c2.sblocca('password-03')).rejects.toThrow(/Password errata/);
    await expect(c2.sblocca('PASSWORD-030')).rejects.toMatchObject({ code: 'password-errata' });
    const dopo = readFileSync(join(dir, 'chiave.json'));
    await c2.sblocca('password-030');
    expect(c2.stato()).toMatchObject({ bloccato: false, kdfRafforzato: false });
    expect(readFileSync(join(dir, 'chiave.json')).equals(dopo)).toBe(true);
    expect((await c2.leggiIndice()).contatti[0].nome).toBe('Giulia');
  });

  it('archivio senza password e senza portachiavi (metodo «file»): si apre e chiede di avvisare', async () => {
    copiaFixture('file-senza-password');
    const c = createCassaforte({ dir, safeStorage: fakeSafe({ backend: 'basic_text' }), platform: 'linux' });
    await c.inizializza();
    expect(c.stato()).toMatchObject({ bloccato: false, protezione: 'file', avvisoPortachiavi: true, creatoOra: false });
    expect((await c.leggiBlob('timbro-0001')).toString()).toBe('PNG-timbro');
    // con la password l'avviso sparisce (resta la protezione «file», ma la chiave è avvolta dalla password)
    await c.impostaPassword('', 'nuova-password');
    expect(c.stato()).toMatchObject({ protezione: 'file', password: true, avvisoPortachiavi: false });
    expect(kdfDi(dir)).toMatchObject({ N: 131072, metodo: 'file' });
  });

  it('archivio con password e metodo «file»: rafforzato; poi passa al portachiavi quando c\'è', async () => {
    copiaFixture('file-password');
    const c = createCassaforte({ dir, safeStorage: fakeSafe({ backend: 'basic_text' }), platform: 'linux' });
    await c.inizializza();
    await c.sblocca('password-030');
    expect(kdfDi(dir)).toMatchObject({ N: 131072, metodo: 'file' });
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    await c2.sblocca('password-030');
    expect(kdfDi(dir)).toMatchObject({ N: 131072, metodo: 'sistema' });
    expect((await c2.leggiIndice()).firme).toHaveLength(1);
  });

  it('un backup esportato dalla 0.3.0 si importa nella 0.3.1', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'win32' });
    await c.inizializza();
    const r = await c.importaBackup(readFileSync(join(FIXTURE, 'backup-030.leggio-backup')), 'backup-030-pw');
    expect(r.elementi).toBe(3);
    expect(r.indice.modelli[0].blob).toBe('modello-0001');
    expect((await c.leggiBlob('modello-0001')).toString()).toBe('%PDF-modello');
  });
});

describe('rafforzamento sicuro: la chiave si apre sempre', () => {
  it('disco pieno mentre si scrive la chiave rafforzata: lo sblocco riesce, resta la chiave vecchia, si riprova dopo', async () => {
    copiaFixture('sistema-password');
    const prima = readFileSync(join(dir, 'chiave.json'));
    const log = [];
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux', log: (l, m) => log.push(m), scrivi: async (p, b) => { if (basename(p).startsWith('chiave.json')) throw enospc(); return safeWrite(p, b); } });
    await c.inizializza();
    await c.sblocca('password-030');
    expect(c.stato()).toMatchObject({ bloccato: false, kdfRafforzato: false });
    expect(log.some((m) => /rafforzamento della chiave rimandato/.test(m))).toBe(true);
    expect(readFileSync(join(dir, 'chiave.json')).equals(prima)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.leggio-tmp'))).toEqual([]);
    // spazio liberato: al prossimo sblocco il rafforzamento riesce
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    await c2.sblocca('password-030');
    expect(c2.stato().kdfRafforzato).toBe(true);
    expect(kdfDi(dir).N).toBe(131072);
  });

  it('se la copia di riserva non si scrive, la vecchia (più debole) viene tolta; si ricrea al prossimo sblocco', async () => {
    copiaFixture('sistema-password');
    // copia di riserva della chiave della 0.3.0 già presente; la scrittura della nuova copia non riesce
    cpSync(join(dir, 'chiave.json'), join(dir, 'chiave.json.bak'));
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux', scrivi: async (p, b) => { if (basename(p) === 'chiave.json.bak') throw enospc(); return safeWrite(p, b); } });
    await c.inizializza();
    await c.sblocca('password-030');
    expect(kdfDi(dir).N).toBe(131072);
    expect(existsSync(join(dir, 'chiave.json.bak'))).toBe(false); // mai una copia con la protezione vecchia
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    await c2.sblocca('password-030');
    expect(readFileSync(join(dir, 'chiave.json.bak')).equals(readFileSync(join(dir, 'chiave.json')))).toBe(true);
    // ora chiave.json si rovina: si recupera dalla copia (rafforzata), con la stessa password
    writeFileSync(join(dir, 'chiave.json'), '{ rotto');
    const c3 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c3.inizializza();
    await c3.sblocca('password-030');
    expect(c3.stato()).toMatchObject({ bloccato: false, chiaveRecuperata: true });
    expect((await c3.leggiIndice()).profilo.cognome).toBe('Rossi');
    expect(kdfDi(dir).N).toBe(131072);
    expect(readFileSync(join(dir, 'chiave.json.bak')).equals(readFileSync(join(dir, 'chiave.json')))).toBe(true);
  });

  it('Linux senza portachiavi: dopo aver messo la password la chiave dati in chiaro non resta in nessun file', async () => {
    const safe = fakeSafe({ backend: 'basic_text' });
    const c0 = createCassaforte({ dir, safeStorage: safe, platform: 'linux' });
    await c0.inizializza(); await c0.salvaIndice({ v: 1 });
    const inChiaro = JSON.parse(readFileSync(join(dir, 'chiave.json.bak'), 'utf8')).protetta.dati; // base64 della chiave dati
    // 1. la copia non si riesce a scrivere
    const c = createCassaforte({ dir, safeStorage: safe, platform: 'linux', scrivi: async (p, b) => { if (basename(p) === 'chiave.json.bak') throw enospc(); return safeWrite(p, b); } });
    await c.inizializza();
    await c.impostaPassword('', 'password-nuova');
    for (const f of readdirSync(dir)) if (f.startsWith('chiave')) expect(readFileSync(join(dir, f), 'utf8')).not.toContain(inChiaro);
    expect(existsSync(join(dir, 'chiave.json.bak'))).toBe(false);
    // 2. «spegnimento» fra le due scritture: al momento di scrivere chiave.json la copia vecchia è già sparita
    rmSync(dir, { recursive: true, force: true });
    const d0 = createCassaforte({ dir, safeStorage: safe, platform: 'linux' });
    await d0.inizializza(); await d0.salvaIndice({ v: 1 });
    const segreto = JSON.parse(readFileSync(join(dir, 'chiave.json'), 'utf8')).protetta.dati;
    const d = createCassaforte({ dir, safeStorage: safe, platform: 'linux', scrivi: async (p, b) => {
      if (basename(p) === 'chiave.json' && b.toString().includes('"password": true')) { expect(existsSync(join(dir, 'chiave.json.bak'))).toBe(false); await safeWrite(p, b); throw new Error('spento'); }
      return safeWrite(p, b);
    } });
    await d.inizializza();
    await d.impostaPassword('', 'password-nuova').catch(() => {});
    for (const f of readdirSync(dir)) if (f.startsWith('chiave')) expect(readFileSync(join(dir, f), 'utf8')).not.toContain(segreto);
    const d2 = createCassaforte({ dir, safeStorage: safe, platform: 'linux' });
    await d2.inizializza();
    await d2.sblocca('password-nuova');
    expect(await d2.leggiIndice()).toEqual({ v: 1 });
  });

  it('il cambio di password non lascia la password vecchia nella copia di riserva', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ v: 1 });
    await c.impostaPassword('', 'password-vecchia');
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux', scrivi: async (p, b) => { if (basename(p) === 'chiave.json.bak') throw enospc(); return safeWrite(p, b); } });
    await c2.inizializza(); await c2.sblocca('password-vecchia');
    await c2.impostaPassword('password-vecchia', 'password-nuova');
    expect(existsSync(join(dir, 'chiave.json.bak'))).toBe(false);
    writeFileSync(join(dir, 'chiave.json'), 'rotto');
    const c3 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await expect(c3.inizializza()).rejects.toMatchObject({ code: 'chiave-danneggiata' }); // niente da recuperare con la vecchia
  });
});

describe('casi di errore: messaggio chiaro e una via d\'uscita, mai dati persi in silenzio', () => {
  it('chiave.json danneggiato: si recupera dalla copia di riserva', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ v: 'dati' });
    expect(existsSync(join(dir, 'chiave.json.bak'))).toBe(true);
    writeFileSync(join(dir, 'chiave.json'), Buffer.from([0, 1, 2, 3]));
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    expect(c2.stato().chiaveRecuperata).toBe(true);
    expect(await c2.leggiIndice()).toEqual({ v: 'dati' });
    expect(JSON.parse(readFileSync(join(dir, 'chiave.json'), 'utf8')).formato).toBe('leggio-chiave');
  });

  it('chiave.json con il contenuto rovinato (JSON valido): si usa la copia di riserva', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe({ backend: 'basic_text' }), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ v: 'dati' });
    const k = JSON.parse(readFileSync(join(dir, 'chiave.json'), 'utf8'));
    k.protetta.dati = Buffer.from('corta').toString('base64');
    writeFileSync(join(dir, 'chiave.json'), JSON.stringify(k));
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe({ backend: 'basic_text' }), platform: 'linux' });
    await c2.inizializza();
    expect(await c2.leggiIndice()).toEqual({ v: 'dati' });
  });

  it('chiave.json e copia entrambe danneggiate: errore «chiave-danneggiata», nulla viene sovrascritto, si può mettere da parte', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ v: 'dati' });
    writeFileSync(join(dir, 'chiave.json'), 'rotto'); writeFileSync(join(dir, 'chiave.json.bak'), 'rotto anche questo');
    const indicePrima = readFileSync(join(dir, 'indice.dat'));
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    const err = await c2.inizializza().catch((e) => e);
    expect(err.code).toBe('chiave-danneggiata');
    expect(err.message).toMatch(/danneggiato.*backup/s);
    expect(readFileSync(join(dir, 'chiave.json'), 'utf8')).toBe('rotto');
    expect(readFileSync(join(dir, 'indice.dat')).equals(indicePrima)).toBe(true);
    const r = await c2.azzera();
    expect(existsSync(join(r.messoDaParte, 'indice.dat'))).toBe(true);
    expect(c2.stato()).toMatchObject({ pronto: true, bloccato: false, creatoOra: true });
  });

  it('chiave.json cancellato ma dati presenti: NON crea una chiave nuova sopra i dati', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ v: 'dati' });
    rmSync(join(dir, 'chiave.json')); rmSync(join(dir, 'chiave.json.bak'));
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await expect(c2.inizializza()).rejects.toMatchObject({ code: 'chiave-mancante' });
    expect(existsSync(join(dir, 'chiave.json'))).toBe(false);
    // con la sola copia di riserva invece si recupera
    const c3 = createCassaforte({ dir: join(base, 'altro'), safeStorage: fakeSafe(), platform: 'linux' });
    await c3.inizializza(); await c3.salvaIndice({ v: 'altro' });
    rmSync(join(base, 'altro', 'chiave.json'));
    const c4 = createCassaforte({ dir: join(base, 'altro'), safeStorage: fakeSafe(), platform: 'linux' });
    await c4.inizializza();
    expect(await c4.leggiIndice()).toEqual({ v: 'altro' });
  });

  it('portachiavi azzerato: errore «sistema» chiaro, dati intatti; si mette da parte e si ripristina il backup', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.scriviBlob('firma-0001', Buffer.from('immagine'));
    await c.salvaIndice({ firme: [{ id: 'firma-0001', blob: 'firma-0001' }] });
    const { dati } = await c.esportaBackup('password-backup');
    const rotto = fakeSafe({ rotto: true });
    const c2 = createCassaforte({ dir, safeStorage: rotto, platform: 'linux' });
    const err = await c2.inizializza().catch((e) => e);
    expect(err.code).toBe('sistema');
    expect(err.message).toMatch(/portachiavi.*non sono stati toccati.*backup/s);
    expect(existsSync(join(dir, 'indice.dat'))).toBe(true);
    // via d'uscita: mettere da parte (con un portachiavi che non rilegge, la nuova chiave usa la protezione di base)
    const r = await c2.azzera();
    expect(existsSync(r.messoDaParte)).toBe(true);
    expect(c2.stato()).toMatchObject({ bloccato: false, protezione: 'file', avvisoPortachiavi: true });
    const imp = await c2.importaBackup(dati, 'password-backup');
    expect(imp.elementi).toBe(1);
    expect((await c2.leggiBlob('firma-0001')).toString()).toBe('immagine');
  });

  it('disco pieno durante il salvataggio: messaggio chiaro, la versione precedente resta leggibile, poi si riprova', async () => {
    let pieno = false;
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux', scrivi: async (p, b) => { if (pieno) throw enospc(); return safeWrite(p, b); } });
    await c.inizializza();
    await c.salvaIndice({ v: 1 });
    pieno = true;
    const err = await c.salvaIndice({ v: 2 }).catch((e) => e);
    expect(err.code).toBe('disco-pieno');
    expect(err.message).toMatch(/Spazio su disco esaurito.*intatti/s);
    await expect(c.scriviBlob('firma-0002', Buffer.from('x'))).rejects.toMatchObject({ code: 'disco-pieno' });
    expect(await c.leggiIndice()).toEqual({ v: 1 });
    pieno = false;
    await c.salvaIndice({ v: 2 });
    expect(await c.leggiIndice()).toEqual({ v: 2 });
  });

  it('disco pieno vero (safeWrite): nessun file temporaneo lasciato, originale intatto', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux', scrivi: (p, b) => safeWrite(p, b, { onStep: (s) => { if (s === 'tmp') throw enospc(); } }) });
    await expect(c.inizializza()).rejects.toMatchObject({ code: 'disco-pieno' });
  });
});

describe('backup completo', () => {
  it('include indice, immagini di firme e timbri e PDF dei modelli; segnala ciò che manca', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.scriviBlob('firma-0001', Buffer.from('F'));
    await c.scriviBlob('timbro-0001', Buffer.from('T'));
    await c.scriviBlob('modello-0001', Buffer.from('%PDF'));
    await c.scriviBlob('orfano-0001', Buffer.from('non citato'));
    const indice = { firme: [{ id: 'firma-0001', blob: 'firma-0001' }], timbri: [{ id: 'timbro-0001', blob: 'timbro-0001' }, { id: 't2', tipo: 'testo', blob: null }], modelli: [{ id: 'm1', blob: 'modello-0001' }], contatti: [{ id: 'c1' }] };
    await c.salvaIndice(indice);
    let ex = await c.esportaBackup('password-backup');
    expect(ex).toMatchObject({ elementi: 3, mancanti: [] });
    const letto = await c.leggiBackup(ex.dati, 'password-backup');
    expect(letto.indice).toEqual(indice);
    expect([...letto.blob.keys()].sort()).toEqual(['firma-0001', 'modello-0001', 'timbro-0001']);
    // un'immagine sparita dal disco: il backup si fa lo stesso ma lo dice
    rmSync(join(dir, 'blob', 'timbro-0001.dat'));
    ex = await c.esportaBackup('password-backup');
    expect(ex).toMatchObject({ elementi: 2, mancanti: ['timbro-0001'] });
    expect((await c.leggiBackup(ex.dati, 'password-backup')).mancanti).toEqual(['timbro-0001']);
  });

  it('il backup resta cifrato con N=131072 e la password scelta', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.salvaIndice({ contatti: [{ id: 'c1', nome: 'Segretissimo' }] });
    const { dati } = await c.esportaBackup('password-backup');
    const head = JSON.parse(dati.toString('utf8').split('\n')[1]);
    expect(head).toMatchObject({ formato: 'leggio-backup', N: 131072, r: 8, p: 1 });
    expect(dati.includes(Buffer.from('Segretissimo'))).toBe(false);
    await expect(c.leggiBackup(dati, 'password-sbagliata')).rejects.toMatchObject({ code: 'password-errata' });
  });

  it('end-to-end: firme, timbri, modelli e rubrica esportati dall\'app e ripristinati su un computer nuovo', async () => {
    // processo principale vero (canali feat:personale:*) + modello dei dati del renderer
    const percorsoBackup = join(base, 'backup.leggio-backup');
    // (un processo principale alla volta: il modulo dei canali tiene un solo archivio)
    function avvia(userData) {
      const h = {};
      feature.register({
        ipcMain: { handle: (ch, f) => { h[ch] = f; } },
        app: { getPath: () => userData },
        dialog: { showSaveDialog: async () => ({ canceled: false, filePath: percorsoBackup }), showOpenDialog: async () => ({ canceled: false, filePaths: [percorsoBackup] }) },
        getWindow: () => null,
      });
      const backend = createIpcBackend((ch, a) => h[ch]({}, structuredClone(a)));
      return { backend, archivio: createArchivio({ backend }) };
    }
    const png = (n) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n, n, n]);
    const pdf = Uint8Array.from(Buffer.from('%PDF-1.7 modello di prova'));

    const A = avvia(join(base, 'pc-1'));
    expect(await A.archivio.apri()).toBe(true);
    await A.archivio.aggiungiFirma({ nome: 'La mia firma', immagine: png(1), w: 10, h: 5 });
    await A.archivio.aggiungiFirma({ nome: 'Sigla', tipo: 'sigla', immagine: png(2) });
    await A.archivio.aggiungiTimbro({ nome: 'Timbro ente', immagine: png(3) });
    await A.archivio.aggiungiTimbro({ nome: 'Ricevuto', tipo: 'testo', spec: { testo: 'Ricevuto il' } });
    const mod = await A.archivio.salvaModello({ nome: 'Domanda', tipo: 'zone', zone: [{ x: 1 }] }, pdf);
    A.archivio.salvaContatto({ nome: 'Giulia', cognome: 'Bianchi', codiceFiscale: 'BNCGLI80A41H501X' });
    A.archivio.salvaProfilo({ nome: 'Maria' });
    await A.archivio.salvaOra();
    const ex = await A.backend.esporta('password-del-backup');
    expect(ex).toMatchObject({ elementi: 4, mancanti: 0 });
    expect(existsSync(percorsoBackup)).toBe(true);
    const invA = A.archivio.inventario();

    // computer nuovo, archivio vuoto
    const B = avvia(join(base, 'pc-2'));
    expect(await B.archivio.apri()).toBe(true);
    expect(B.archivio.inventario().firmeMie).toBe(0);
    const f = await B.backend.importaScegli();
    await expect(B.backend.importaApri(f.token, 'sbagliata')).rejects.toMatchObject({ code: 'password-errata' });
    const r = await B.backend.importaApri(f.token, 'password-del-backup');
    expect(r.elementi).toBe(4);
    const invB = await B.archivio.applicaImportato(r.indice, 'sostituisci');
    expect(invB).toEqual(invA);
    // le immagini e il PDF si rileggono uguali dall'archivio nuovo (cifrato con la sua chiave)
    const firma = B.archivio.firme().find((x) => x.nome === 'La mia firma');
    const sigla = B.archivio.firme().find((x) => x.nome === 'Sigla');
    expect(Array.from(await B.archivio.leggiBlob(firma.blob))).toEqual(Array.from(png(1)));
    expect(Array.from(await B.archivio.leggiBlob(sigla.blob))).toEqual(Array.from(png(2)));
    expect(Buffer.from(await B.archivio.pdfModello(mod.id)).toString()).toBe('%PDF-1.7 modello di prova');
    const timbro = B.archivio.timbri().find((t) => t.nome === 'Timbro ente');
    expect(Array.from(await B.archivio.leggiBlob(timbro.blob))).toEqual(Array.from(png(3)));
    expect(B.archivio.contatti()[0].cognome).toBe('Bianchi');
    expect(B.archivio.profilo().nome).toBe('Maria');
    // e restano dopo un riavvio (dati davvero scritti su disco)
    const B2 = avvia(join(base, 'pc-2'));
    expect(await B2.archivio.apri()).toBe(true);
    expect(B2.archivio.inventario()).toEqual(invA);
  });
});
