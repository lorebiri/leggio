// Genera gli archivi di esempio creati dalla 0.3.0 (da eseguire con il cassaforte.cjs della 0.3.0:
// `git show v0.3.0:electron/personale/cassaforte.cjs`). I file generati sono nel repo: questo script
// serve solo a documentare come sono stati prodotti. Il safeStorage è quello finto dei test (prefisso + XOR).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createCassaforte } = require(process.argv[2]);
const fakeSafe = (backend = 'gnome_libsecret') => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => backend,
  encryptString: (s) => Buffer.concat([Buffer.from('SS:'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
  decryptString: (b) => Buffer.from(b.subarray(3).map((x) => x ^ 0x5a)).toString('utf8'),
});
const indice = {
  formato: 'leggio-personale', versione: 1, profilo: { nome: 'Maria', cognome: 'Rossi' },
  firme: [{ id: 'firma-0001', nome: 'La mia firma', tipo: 'firma', proprietario: 'io', blob: 'firma-0001' }],
  timbri: [{ id: 'timbro-0001', nome: 'Timbro', tipo: 'immagine', blob: 'timbro-0001' }],
  modelli: [{ id: 'mod-0001', nome: 'Domanda', tipo: 'zone', blob: 'modello-0001' }],
  contatti: [{ id: 'c1', nome: 'Giulia', cognome: 'Bianchi' }], registro: [], migrazioni: {},
};
const blob = { 'firma-0001': 'PNG-firma', 'timbro-0001': 'PNG-timbro', 'modello-0001': '%PDF-modello' };
(async () => {
  const out = __dirname;
  for (const [nome, backend, password] of [['sistema-password', 'gnome_libsecret', 'password-030'], ['file-senza-password', 'basic_text', null], ['file-password', 'basic_text', 'password-030']]) {
    const dir = path.join(out, nome);
    fs.rmSync(dir, { recursive: true, force: true });
    const c = createCassaforte({ dir, safeStorage: fakeSafe(backend), platform: 'linux' });
    await c.inizializza();
    for (const [id, v] of Object.entries(blob)) await c.scriviBlob(id, Buffer.from(v));
    await c.salvaIndice(indice);
    await c.salvaIndice(indice); // crea anche indice.dat.bak
    if (password) await c.impostaPassword('', password);
    if (nome === 'sistema-password') fs.writeFileSync(path.join(out, 'backup-030.leggio-backup'), await c.esportaBackup('backup-030-pw'));
  }
})();
