// Archivio personale 0.3.1, lato interfaccia (logica senza DOM): robustezza della password, promemoria del backup,
// avviso del portachiavi una volta sola, nuovo tentativo di salvataggio dopo un errore (disco pieno).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { robustezzaPassword } from '../src/renderer/features/personale/lib/robustezza.js';
import { decidiPromemoria, azioni, createStatoPromemoria, CHIAVE_PROMEMORIA, GIORNI_PROMEMORIA } from '../src/renderer/features/personale/lib/promemoria.js';
import { createArchivio } from '../src/renderer/features/personale/lib/archivio.js';
import { createMemoryBackend } from '../src/renderer/features/personale/lib/backend.js';
import { avvisoPortachiavi, promemoriaBackup, ERRORI_RECUPERABILI, CONSIGLIO_PASSWORD, TESTO_PORTACHIAVI } from '../src/renderer/features/personale/ui/avvisi.js';

const GIORNO = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 1);
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }

describe('robustezza della password', () => {
  it('giudica le password ovvie deboli e le frasi lunghe ottime', () => {
    expect(robustezzaPassword('')).toMatchObject({ livello: 0, etichetta: '' });
    expect(robustezzaPassword('abc')).toMatchObject({ livello: 0, etichetta: 'Troppo corta' });
    for (const p of ['password', '12345678', 'password123', 'Password1!', 'qwertyuiop', 'aaaaaaaaaaaa', 'Ciao2024', '87654321', 'juventus1897']) {
      expect(robustezzaPassword(p).livello, p).toBe(1);
    }
    expect(robustezzaPassword('Gatto!Blu7').livello).toBeGreaterThanOrEqual(3);
    expect(robustezzaPassword('tramonto sul lago di como').livello).toBe(4);
    expect(robustezzaPassword('cavallo batteria graffetta corretta')).toMatchObject({ livello: 4, etichetta: 'Ottima', consiglio: '' });
  });
  it('dà un consiglio semplice quando la password è debole', () => {
    expect(robustezzaPassword('password1').consiglio).toMatch(/frase/);
    expect(robustezzaPassword('corta', { minimo: 8 }).consiglio).toMatch(/8 caratteri/);
  });
  it('è veloce anche con password lunghissime', () => {
    const t = performance.now();
    robustezzaPassword('x'.repeat(1024));
    robustezzaPassword('ab1!'.repeat(256));
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('promemoria del backup', () => {
  const vuoto = { profilo: 0, contatti: 0, firmeMie: 0, sigleMie: 0, firmeAltrui: 0, timbri: 0, modelli: 0, registro: 0 };
  const conFirma = { ...vuoto, firmeMie: 1 };
  it('non disturba con l\'archivio vuoto', () => {
    expect(decidiPromemoria({ dal: T0, ultimaModifica: T0 + 99 * GIORNO }, vuoto, T0 + 100 * GIORNO)).toBe(null);
  });
  it('dopo la prima firma salvata propone il backup una volta', () => {
    let s = { dal: T0 };
    expect(decidiPromemoria(s, conFirma, T0 + 1000)).toBe('primo');
    s = azioni.nonOra(s, T0 + 2000);
    expect(decidiPromemoria(s, conFirma, T0 + 3000)).toBe(null);
  });
  it('poi ogni circa 30 giorni, solo se ci sono dati nuovi dall\'ultimo backup', () => {
    let s = azioni.backupFatto({ dal: T0 }, T0);
    // dati nuovi ma troppo presto
    s = azioni.modificato(s, T0 + 5 * GIORNO);
    expect(decidiPromemoria(s, conFirma, T0 + 20 * GIORNO)).toBe(null);
    expect(decidiPromemoria(s, conFirma, T0 + GIORNI_PROMEMORIA * GIORNO)).toBe('periodico');
    // nessun dato nuovo dopo il backup: niente promemoria
    const s2 = azioni.backupFatto(s, T0 + 31 * GIORNO);
    expect(decidiPromemoria(s2, conFirma, T0 + 200 * GIORNO)).toBe(null);
    // «Non ora» rimanda di altri 30 giorni
    const s3 = azioni.nonOra(s, T0 + 31 * GIORNO);
    expect(decidiPromemoria(s3, conFirma, T0 + 40 * GIORNO)).toBe(null);
    expect(decidiPromemoria(s3, conFirma, T0 + 62 * GIORNO)).toBe('periodico');
  });
  it('«Non ricordarmelo più» vale per sempre', () => {
    const s = azioni.maiPiu(azioni.modificato({ dal: T0 }, T0 + GIORNO), T0 + GIORNO);
    expect(decidiPromemoria(s, conFirma, T0 + 400 * GIORNO)).toBe(null);
  });
  it('anche senza firme (solo rubrica) ricorda dopo 30 giorni dal primo avvio', () => {
    const s = azioni.modificato({ dal: T0 }, T0 + GIORNO);
    const inv = { ...vuoto, contatti: 40 };
    expect(decidiPromemoria(s, inv, T0 + 10 * GIORNO)).toBe(null);
    expect(decidiPromemoria(s, inv, T0 + 31 * GIORNO)).toBe('periodico');
  });
  it('salva lo stato nel localStorage (solo date e scelte) e sopporta dati rovinati', () => {
    const st = memStorage();
    st.setItem(CHIAVE_PROMEMORIA, '{rotto');
    const p = createStatoPromemoria(st);
    expect(p.leggi()).toMatchObject({ maiPiu: false, ultimoBackup: null });
    p.applica('backupFatto', T0);
    p.applica('portachiaviAvvisato', T0);
    const p2 = createStatoPromemoria(st);
    expect(p2.leggi()).toMatchObject({ ultimoBackup: T0, portachiaviAvvisato: T0 });
    expect(Object.keys(JSON.parse(st.getItem(CHIAVE_PROMEMORIA))).sort()).toEqual(['dal', 'maiPiu', 'portachiaviAvvisato', 'primoMostrato', 'ultimaModifica', 'ultimoBackup', 'ultimoPromemoria']);
  });
});

/** app finta: registra i dialoghi e risponde come gli si dice. */
function fakeApp(risposte = []) {
  const dialoghi = [];
  const h = (tag, attrs, ...figli) => ({ tag, attrs, figli });
  return { dialoghi, ui: { h, dialog: async (o) => { dialoghi.push(o); return risposte.shift() ?? null; }, toast: () => {} } };
}

describe('avviso del portachiavi mancante', () => {
  it('compare una volta sola, con un testo semplice e il pulsante per la password', async () => {
    const prom = createStatoPromemoria(memStorage());
    const app = fakeApp([{}]);
    const impostaPassword = vi.fn(async () => true);
    expect(await avvisoPortachiavi(app, { stato: { avvisoPortachiavi: true }, promemoria: prom, impostaPassword })).toBe(true);
    expect(app.dialoghi[0].okLabel).toBe('Imposta una password…');
    expect(app.dialoghi[0].message).toBe(TESTO_PORTACHIAVI);
    expect(TESTO_PORTACHIAVI).toMatch(/manca il portachiavi.*permessi del file.*password/s);
    expect(TESTO_PORTACHIAVI).not.toMatch(/libsecret|safeStorage|basic_text|0600/);
    expect(impostaPassword).toHaveBeenCalledTimes(1);
    // al prossimo avvio non si ripete
    expect(await avvisoPortachiavi(app, { stato: { avvisoPortachiavi: true }, promemoria: prom, impostaPassword })).toBe(false);
    expect(app.dialoghi).toHaveLength(1);
  });
  it('non compare con il portachiavi o con la password', async () => {
    const app = fakeApp();
    expect(await avvisoPortachiavi(app, { stato: { avvisoPortachiavi: false }, promemoria: createStatoPromemoria(), impostaPassword: () => {} })).toBe(false);
    expect(app.dialoghi).toHaveLength(0);
  });
  it('il consiglio sulla password distingue PC personale e PC condiviso', () => {
    expect(CONSIGLIO_PASSWORD).toMatch(/PC personale/);
    expect(CONSIGLIO_PASSWORD).toMatch(/condiviso|ufficio/);
  });
});

describe('promemoria: le tre risposte', () => {
  it('Esporta, Non ora e Non ricordarmelo più', async () => {
    expect(await promemoriaBackup(fakeApp([{}]), 'primo')).toBe('esporta');
    expect(await promemoriaBackup(fakeApp([null]), 'periodico')).toBe('non-ora');
    // «Non ricordarmelo più» è un pulsante aggiunto nel piede del dialogo
    const app = fakeApp();
    app.ui.dialog = async (o) => {
      let aggiunto = null; const nonOra = { textContent: 'Non ora', click: vi.fn() };
      const foot = { querySelectorAll: () => [nonOra], prepend: (b) => { aggiunto = b; } };
      o.onOpen({ querySelector: () => foot });
      expect(aggiunto.figli).toContain('Non ricordarmelo più');
      aggiunto.attrs.onclick();
      expect(nonOra.click).toHaveBeenCalled();
      return null;
    };
    expect(await promemoriaBackup(app, 'periodico')).toBe('mai-piu');
  });
  it('gli errori con una via d\'uscita sono quelli di chiave e portachiavi', () => {
    for (const c of ['sistema', 'chiave-danneggiata', 'chiave-mancante', 'danneggiato']) expect(ERRORI_RECUPERABILI.has(c)).toBe(true);
    expect(ERRORI_RECUPERABILI.has('password-errata')).toBe(false);
  });
});

describe('salvataggio dopo un errore di scrittura', () => {
  afterEach(() => vi.useRealTimers());
  it('le modifiche restano in memoria, l\'utente è avvisato una volta e Leggio riprova da solo', async () => {
    vi.useFakeTimers();
    const backend = createMemoryBackend();
    let pieno = false;
    const salva = backend.salva.bind(backend);
    backend.salva = async (i, o) => { if (pieno) { const e = new Error('Spazio su disco esaurito'); e.code = 'disco-pieno'; throw e; } return salva(i, o); };
    const a = createArchivio({ backend });
    const errori = []; const recuperi = [];
    a.on('errore', (e) => errori.push(e.code)); a.on('recuperato', () => recuperi.push(1));
    await a.apri();
    pieno = true;
    a.salvaContatto({ nome: 'Giulia' });
    await expect(a.salvaOra()).rejects.toThrow(/Spazio/);
    expect(a.nonSalvato).toBe(true);
    await vi.advanceTimersByTimeAsync(31000); // secondo tentativo, ancora pieno: nessun nuovo avviso
    expect(errori).toEqual(['disco-pieno']);
    pieno = false;
    await vi.advanceTimersByTimeAsync(31000);
    expect(a.nonSalvato).toBe(false);
    expect(recuperi).toHaveLength(1);
    expect((await backend.leggi()).indice.contatti[0].nome).toBe('Giulia');
  });
  it('usare una firma non conta come «dati nuovi» per il promemoria', async () => {
    const a = createArchivio({ backend: createMemoryBackend() });
    await a.apri();
    const eventi = [];
    a.on('cambiato', (e) => eventi.push(e));
    const f = await a.aggiungiFirma({ immagine: new Uint8Array([0x89, 0x50, 1]) });
    a.usaFirma(f.id);
    expect(eventi.map((e) => e.uso)).toEqual([false, true]);
    await a.salvaOra();
  });
});
