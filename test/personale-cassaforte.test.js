// Archivio personale cifrato (electron/personale/cassaforte.cjs): cifratura, password, backup automatico,
// scritture atomiche, export/import, pulizia, canali IPC validati.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { createCassaforte, sistemaDisponibile, blobUsati } = require('../electron/personale/cassaforte.cjs');
const feature = require('../electron/features/personale.cjs');

/** safeStorage finto: «cifra» con un prefisso e uno XOR (basta a distinguere i casi). */
function fakeSafe({ disponibile = true, backend = 'gnome_libsecret', rotto = false } = {}) {
  return {
    isEncryptionAvailable: () => disponibile,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.concat([Buffer.from('SS:'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
    decryptString: (b) => { if (rotto || !b.subarray(0, 3).equals(Buffer.from('SS:'))) throw new Error('decrypt'); return Buffer.from(b.subarray(3).map((x) => x ^ 0x5a)).toString('utf8'); },
  };
}

let dir;
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'leggio-cass-')), 'personale'); });
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

describe('protezione dal sistema', () => {
  it('considera non sicuro il ripiego basic_text di Linux', () => {
    expect(sistemaDisponibile(fakeSafe(), 'linux')).toBe(true);
    expect(sistemaDisponibile(fakeSafe({ backend: 'basic_text' }), 'linux')).toBe(false);
    expect(sistemaDisponibile(fakeSafe({ backend: 'basic_text' }), 'darwin')).toBe(true);
    expect(sistemaDisponibile(fakeSafe({ disponibile: false }), 'win32')).toBe(false);
    expect(sistemaDisponibile(null)).toBe(false);
  });

  it('crea la chiave protetta dal sistema e nessun dato in chiaro su disco', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    expect(c.stato()).toMatchObject({ pronto: true, bloccato: false, password: false, protezione: 'sistema' });
    await c.salvaIndice({ contatti: [{ id: 'c1', nome: 'Mariagrazia', codiceFiscale: 'RSSMRA80A41H501X' }] });
    await c.scriviBlob('firma-0001', Buffer.from('PNG-SEGRETO'));
    const k = JSON.parse(readFileSync(join(dir, 'chiave.json'), 'utf8'));
    expect(k.protetta.metodo).toBe('sistema');
    for (const f of ['indice.dat', 'blob/firma-0001.dat']) {
      const raw = readFileSync(join(dir, f));
      expect(raw.subarray(0, 4).toString()).toBe('LGV1');
      expect(raw.includes(Buffer.from('Mariagrazia'))).toBe(false);
      expect(raw.includes(Buffer.from('SEGRETO'))).toBe(false);
    }
    // riapertura (nuovo processo)
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    expect((await c2.leggiIndice()).contatti[0].nome).toBe('Mariagrazia');
    expect((await c2.leggiBlob('firma-0001')).toString()).toBe('PNG-SEGRETO');
  });

  it('ripiego documentato senza portachiavi, poi passa al sistema quando c\'è', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe({ backend: 'basic_text' }), platform: 'linux' });
    await c.inizializza();
    expect(c.stato().protezione).toBe('file');
    await c.salvaIndice({ x: 1 });
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c2.inizializza();
    expect(c2.stato().protezione).toBe('sistema');
    expect(await c2.leggiIndice()).toEqual({ x: 1 });
  });

  it('se il sistema non apre più la chiave dà un messaggio chiaro e permette di mettere da parte l\'archivio', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza(); await c.salvaIndice({ x: 1 });
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe({ rotto: true }), platform: 'linux' });
    await expect(c2.inizializza()).rejects.toThrow(/portachiavi|backup/);
    const r = await c2.azzera();
    expect(existsSync(r.messoDaParte)).toBe(true);
    expect(await c2.leggiIndice()).toBe(null);
  });
});

describe('password facoltativa', () => {
  it('blocca, sblocca, rifiuta la password sbagliata, cambia e toglie la password', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'darwin' });
    await c.inizializza();
    await c.salvaIndice({ v: 'uno' });
    await expect(c.impostaPassword('', 'corta')).rejects.toThrow(/8 caratteri/);
    await c.impostaPassword('', 'password-lunga');
    expect(c.stato().password).toBe(true);
    // nuovo avvio: bloccato
    const c2 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'darwin' });
    await c2.inizializza();
    expect(c2.stato().bloccato).toBe(true);
    await expect(c2.leggiIndice()).rejects.toThrow(/bloccato/);
    await expect(c2.sblocca('sbagliata')).rejects.toThrow(/Password errata/);
    await c2.sblocca('password-lunga');
    expect(await c2.leggiIndice()).toEqual({ v: 'uno' });
    await c2.blocca();
    expect(c2.stato().bloccato).toBe(true);
    await c2.sblocca('password-lunga');
    await expect(c2.impostaPassword('sbagliata', 'altra-password')).rejects.toThrow(/errata/);
    await c2.impostaPassword('password-lunga', 'altra-password');
    await c2.impostaPassword('altra-password', '');
    const c3 = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'darwin' });
    await c3.inizializza();
    expect(c3.stato()).toMatchObject({ bloccato: false, password: false });
    expect(await c3.leggiIndice()).toEqual({ v: 'uno' });
  });
});

describe('backup automatico e scritture', () => {
  it('conserva la versione precedente e la usa se l\'indice è danneggiato', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.salvaIndice({ v: 1 });
    await c.salvaIndice({ v: 2 });
    writeFileSync(join(dir, 'indice.dat'), Buffer.from('LGV1' + 'x'.repeat(60)));
    expect(await c.leggiIndice()).toEqual({ v: 1 });
    expect(c.stato().ripristinato).toBe(true);
    // il salvataggio successivo non sovrascrive il backup buono con l'indice rotto
    await c.salvaIndice({ v: 3 });
    expect(await c.leggiIndice()).toEqual({ v: 3 });
    expect(c.stato().ripristinato).toBe(false);
    await c.salvaIndice({ v: 4 });
    writeFileSync(join(dir, 'indice.dat'), 'rotto');
    expect(await c.leggiIndice()).toEqual({ v: 3 });
  });

  it('con «purga» anche il backup prende la nuova versione (cancellazione GDPR)', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.salvaIndice({ contatti: ['Rossi'] });
    await c.salvaIndice({ contatti: [] }, { purga: true });
    rmSync(join(dir, 'indice.dat'));
    expect(await c.leggiIndice()).toEqual({ contatti: [] });
  });

  it('non lascia file temporanei e serializza le scritture concorrenti', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await Promise.all(Array.from({ length: 20 }, (_, i) => c.salvaIndice({ i })));
    expect(await c.leggiIndice()).toEqual({ i: 19 });
    expect(readdirSync(dir).filter((f) => !['chiave.json', 'chiave.json.bak', 'indice.dat', 'indice.dat.bak', 'blob'].includes(f))).toEqual([]);
  });

  it('nessun limite pratico: 500 firme e un indice di qualche MB', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    const firme = [];
    for (let i = 0; i < 500; i++) { const id = 'firma-' + String(i).padStart(4, '0'); firme.push({ id, blob: id }); }
    await Promise.all(firme.map((f) => c.scriviBlob(f.blob, Buffer.alloc(2000, 7))));
    const contatti = Array.from({ length: 5000 }, (_, i) => ({ id: 'c' + i, nome: 'Nome ' + i, note: 'n'.repeat(300) }));
    await c.salvaIndice({ firme, contatti });
    const r = await c.leggiIndice();
    expect(r.firme).toHaveLength(500);
    expect(r.contatti).toHaveLength(5000);
    expect((await c.leggiBlob('firma-0499')).length).toBe(2000);
  });

  it('valida identificativi, dimensioni e forma dell\'indice', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await expect(c.scriviBlob('../fuori', Buffer.from('x'))).rejects.toThrow(/Identificativo/);
    await expect(c.leggiBlob('a/b')).rejects.toThrow(/Identificativo/);
    await expect(c.scriviBlob('firma-1234', 'non byte')).rejects.toThrow(/non validi/);
    await expect(c.salvaIndice([1, 2])).rejects.toThrow(/non valido/);
    await expect(c.salvaIndice('x')).rejects.toThrow(/non valido/);
    let o = {}; const root = o; for (let i = 0; i < 20; i++) { o.a = {}; o = o.a; }
    await expect(c.salvaIndice(root)).rejects.toThrow(/annidato/);
    await expect(c.leggiBlob('mancante-1')).rejects.toThrow(/non trovato/);
  });

  it('un blob non può essere scambiato con un altro (dati legati al nome)', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.scriviBlob('firma-aaaa', Buffer.from('A'));
    await c.scriviBlob('firma-bbbb', Buffer.from('B'));
    writeFileSync(join(dir, 'blob/firma-bbbb.dat'), readFileSync(join(dir, 'blob/firma-aaaa.dat')));
    await expect(c.leggiBlob('firma-bbbb')).rejects.toThrow(/danneggiato/);
  });

  it('elimina solo i blob orfani e vecchi', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.scriviBlob('usato-0001', Buffer.from('1'));
    await c.scriviBlob('orfano-001', Buffer.from('2'));
    await c.scriviBlob('nuovo-0001', Buffer.from('3'));
    await c.salvaIndice({ firme: [{ blob: 'usato-0001' }], modelli: [{ campi: [{ blob: 'x' }] }] });
    const vecchio = (Date.now() - 3 * 86400e3) / 1000;
    utimesSync(join(dir, 'blob/orfano-001.dat'), vecchio, vecchio);
    utimesSync(join(dir, 'blob/usato-0001.dat'), vecchio, vecchio);
    expect(await c.pulisciBlob()).toBe(1);
    expect(readdirSync(join(dir, 'blob')).sort()).toEqual(['nuovo-0001.dat', 'usato-0001.dat']);
    expect([...blobUsati({ a: [{ blob: 'abcd1' }, { b: { blob: 'efgh2' } }], blob: 'no/valido' })]).toEqual(['abcd1', 'efgh2']);
  });
});

describe('backup esportato', () => {
  it('esporta con password, reimporta su un altro computer, rifiuta password e file sbagliati', async () => {
    const c = createCassaforte({ dir, safeStorage: fakeSafe(), platform: 'linux' });
    await c.inizializza();
    await c.scriviBlob('firma-0001', Buffer.from('immagine'));
    await c.salvaIndice({ firme: [{ id: 'f1', blob: 'firma-0001', nome: 'La mia firma' }] });
    await expect(c.esportaBackup('corta')).rejects.toThrow(/8 caratteri/);
    const ex = await c.esportaBackup('backup-password');
    expect(ex).toMatchObject({ elementi: 1, mancanti: [] });
    const buf = ex.dati;
    expect(buf.includes(Buffer.from('La mia firma'))).toBe(false);
    expect(buf.includes(Buffer.from('immagine'))).toBe(false);
    // altro computer: chiave del sistema diversa
    const altro = join(dir, '..', 'altro');
    const d = createCassaforte({ dir: altro, safeStorage: fakeSafe(), platform: 'win32' });
    await d.inizializza();
    await expect(d.importaBackup(buf, 'sbagliata')).rejects.toThrow(/errata/);
    await expect(d.importaBackup(Buffer.from('ciao'), 'x')).rejects.toThrow(/non è un backup/);
    const r = await d.importaBackup(buf, 'backup-password');
    expect(r.indice.firme[0].nome).toBe('La mia firma');
    expect(r.elementi).toBe(1);
    expect((await d.leggiBlob('firma-0001')).toString()).toBe('immagine');
    // il file è manomesso: rifiutato
    const rotto = Buffer.from(buf); rotto[rotto.length - 5] ^= 1;
    await expect(d.importaBackup(rotto, 'backup-password')).rejects.toThrow(/errata|danneggiato/);
  });
});

describe('canali feat:personale:*', () => {
  function fakeMain(dialogo = {}) {
    const h = {};
    feature.register({
      ipcMain: { handle: (c, f) => { h[c] = f; } },
      app: { getPath: () => join(dir, '..') },
      dialog: { showSaveDialog: async () => dialogo.save || { canceled: true }, showOpenDialog: async () => dialogo.open || { canceled: true } },
      getWindow: () => null,
    });
    return (ch, a) => h['feat:personale:' + ch]({}, a);
  }
  it('risponde con { ok, result } e messaggi chiari, valida gli argomenti', async () => {
    const inv = fakeMain({ save: { canceled: false, filePath: join(dir, '..', 'b.leggio-backup') } });
    const st = await inv('stato');
    expect(st.ok).toBe(true);
    expect(st.result.pronto).toBe(true);
    expect((await inv('salva', { indice: { a: 1 } })).ok).toBe(true);
    expect((await inv('leggi')).result.indice).toEqual({ a: 1 });
    expect((await inv('blob-scrivi', { id: 'firma-9999', dati: new Uint8Array([1, 2, 3]) })).ok).toBe(true);
    expect(Array.from((await inv('blob-leggi', { id: 'firma-9999' })).result)).toEqual([1, 2, 3]);
    expect((await inv('blob-leggi', { id: '../../etc/passwd' })).error).toMatch(/Identificativo/);
    expect((await inv('salva', { indice: null })).error).toMatch(/non valido/);
    expect((await inv('azzera', {})).error).toMatch(/Conferma/);
    const ex = await inv('esporta', { password: 'una-password' });
    expect(ex.ok).toBe(true);
    expect(existsSync(ex.result.percorso)).toBe(true);
    expect((await inv('importa-apri', { token: 'inventato', password: 'x' })).error).toMatch(/Scegli di nuovo/);
  });
});
