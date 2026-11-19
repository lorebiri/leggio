# Area «personale» — archivio personale cifrato, rubrica, compilazione in serie, modelli

Novità della 0.3. Pensata per **una persona sul suo PC**: niente sincronizzazione, niente rete.

## Archivio personale cifrato
Tutti i dati personali dell'utente (profilo «io», firme e sigle, timbri, rubrica, modelli, registro delle firme di
altre persone) stanno in un archivio cifrato nella cartella dati dell'app (`<userData>/personale/`), gestito **solo dal
processo principale** (`electron/personale/cassaforte.cjs`, canali `feat:personale:*` in `electron/features/personale.cjs`).

| File | Contenuto |
|---|---|
| `chiave.json` | chiave dati (DEK, 256 bit casuali) protetta (vedi sotto) |
| `indice.dat` | indice JSON cifrato: contatti, metadati di firme/timbri/modelli, registro, profilo |
| `indice.dat.bak` | la versione precedente dell'indice (backup automatico dell'ultima versione) |
| `blob/<id>.dat` | immagini di firme e timbri, PDF dei modelli: un file cifrato ciascuno |

**Cifratura.** AES-256-GCM; ogni file: `LGV1` + IV casuale (12 byte) + tag (16 byte) + dati. I dati autenticati
aggiuntivi legano il contenuto al nome (`indice`, `blob:<id>`): un file scambiato con un altro viene rifiutato.

**Protezione della chiave dati.**
1. **Dal sistema** (predefinita): `safeStorage` di Electron → Portachiavi su macOS, DPAPI su Windows, libsecret/kwallet
   su Linux. La chiave è legata all'utente del computer.
2. **Ripiego documentato**: su Linux senza portachiavi Electron userebbe `basic_text` (una chiave fissa, nessuna vera
   protezione). In quel caso Leggio NON lo considera sicuro: la chiave dati resta in `chiave.json` protetta **solo dai
   permessi del file** (0600, leggibile solo dal proprio utente) e la finestra «Archivio personale» lo dice e consiglia
   una password. Appena il portachiavi diventa disponibile la chiave passa da sola alla protezione del sistema.
3. **Password facoltativa**: la chiave dati viene avvolta con una chiave derivata dalla password (scrypt N=32768, r=8,
   p=1; sale casuale), e il risultato è a sua volta protetto dal sistema. All'avvio l'archivio è **bloccato**: la
   password si chiede la prima volta che serve (non all'avvio dell'app). «Blocca ora» toglie la chiave dalla memoria.
   Dopo 3 password sbagliate di fila le risposte rallentano. Una password dimenticata non si recupera: lo dice
   l'interfaccia e suggerisce un backup esportato.

**Scritture.** Atomiche e verificate (`electron/core/safe-write.cjs`: temporaneo + fsync + rilettura + rename), in coda
(una alla volta). Prima di ogni nuovo indice la versione corrente diventa `indice.dat.bak`. Se l'indice è danneggiato si
legge il backup (e l'utente viene avvisato); il salvataggio successivo non sovrascrive il backup buono con quello rotto.
Se il sistema non riesce più ad aprire la chiave (utente cambiato, portachiavi azzerato) l'archivio può essere **messo da
parte** (mai cancellato: `personale-illeggibile-<data>`) per ricominciare, e poi ripristinato da un backup esportato.

**Nessun limite pratico di spazio**: indice fino a 64 MB di testo (decine di migliaia di contatti), ogni immagine o PDF
fino a 64 MB, numero di file illimitato. Provato con 5000 contatti e 500 firme (`test/personale-cassaforte.test.js`).

**Backup esportato** (`.leggio-backup`): tutto l'archivio (indice + immagini + PDF dei modelli) compresso e cifrato con
una password scelta all'esportazione (scrypt + AES-256-GCM), perché le chiavi del sistema non si spostano su un altro
computer. All'importazione: «Unisci» (per id vince la versione modificata più di recente; il profilo attuale ha la
precedenza) o «Sostituisci» (con conferma).

**Segreti e renderer.** Il renderer non vede mai la chiave dati né la password dopo averla inviata: riceve solo i dati
che deve mostrare (l'indice e, a richiesta, le singole immagini). Canali validati: identificativi `^[a-z0-9][a-z0-9_-]{3,63}$`
(niente percorsi), dimensioni massime, forma e profondità dell'indice, password ≤ 1024 caratteri, file di backup da
importare scelto solo con il dialogo del main (il renderer riceve un gettone, mai un percorso da leggere), azzeramento solo
con una conferma esplicita. Le richieste arrivano solo dalla pagina dell'app (`featureIpc` del main).

**Cancellazione.** Un'immagine eliminata viene sovrascritta con dati casuali prima della rimozione (utile sui dischi
tradizionali; sugli SSD non è garantito, per questo i file sono comunque cifrati). La cancellazione di una persona (GDPR)
riscrive anche il backup automatico. I backup esportati in passato non vengono toccati (l'interfaccia lo dice).
Le immagini non più citate dall'indice e più vecchie di un giorno vengono eliminate a ogni sblocco.

**Migrazione dalla 0.2** (automatica e silenziosa, `personale/lib/archivio.js`): firme e iniziali (`leggio.moduli.firme.v1`)
e profilo (`leggio.moduli.profilo.v1`) passano dal localStorage all'archivio cifrato; le chiavi vecchie vengono tolte dal
localStorage **solo dopo** il salvataggio riuscito (se fallisce, si riprova al prossimo avvio). Le preferenze
(`leggio.moduli.pref.v1`: colore, dimensione del testo) restano dove sono.

## Modello dei dati (renderer)
`personale/lib/archivio.js` → `createArchivio({ backend, legacyStorage, chiediPassword, log })`, un'unica istanza
(`lib/condiviso.js` → `archivioPersonale()`; in console `window.__leggioPersonale.archivio`). Cache in memoria e
salvataggio raggruppato (250 ms; `salvaOra()` per forzarlo). Eventi `cambiato`, `salvato`, `errore`, `ripristinato`.
Nell'anteprima web e nei test il backend è in memoria / localStorage (`lib/backend.js`, **non cifrato**, solo sviluppo).

| Sezione | Campi |
|---|---|
| `profilo` | dati «io» (chiavi di `PROFILE_FIELDS` + `iban`) |
| `firme` | `{ id, nome, tipo: 'firma'|'sigla', proprietario: 'io'|idContatto, blob, w, h, origine, creata, usata }` |
| `timbri` | `{ id, nome, tipo: 'immagine'|'testo', blob?, w, h, spec?, creato, usato }` |
| `contatti` | `CAMPI_CONTATTO` di `lib/campi.js` + `gruppi[]`, `creato`, `modificato`, `origine` |
| `registro` | `{ id, quando, firmaId, firmaNome, tipo, proprietario, proprietarioNome, documento, pagine, azione }` |
| `modelli` | vedi «Modelli» |

## Firme, sigle e timbri (strumenti nell'area «moduli», dati qui)
- Archivio con nome, tipo (firma/sigla) e proprietario («io» o un contatto); nessun limite di numero.
- Creazione: disegnata, scritta con un carattere manoscritto incluso (`src/renderer/public-assets/fonts`: Dancing
  Script e Great Vibes, licenza SIL OFL 1.1, testi accanto ai file) o con uno installato, oppure da **foto o scansione**
  (`moduli/lib/foto.js`: luminosità della carta stimata a blocchi per compensare ombre e luce non uniforme, carta colorata
  riconosciuta anche dalla tinta, sensibilità regolabile, rotazione, ritaglio automatico o col mouse/tastiera, colore
  dell'inchiostro nero, blu o originale).
- **Firme di altre persone**: prima dell'uso una conferma esplicita (casella «Confermo di essere autorizzato/a da …»,
  una volta per firma e documento nella sessione); dopo la scrittura nel PDF una voce nel **registro** (quale firma, di
  chi, quale documento, quali pagine, quando). Registro consultabile in «Archivio personale» → «Registro delle firme»,
  filtrabile per persona ed esportabile in CSV.
- Testo nell'interfaccia: la firma disegnata/scritta/fotografata è una **firma elettronica semplice** e non sostituisce
  la firma digitale; collegamento diretto a «Usa un certificato» (`digital-sign`).
- Timbri: modelli pronti («Copia conforme all'originale», «Ricevuto il [data]», «Annullato», «Visto», «Pagato»), timbro
  dell'ente composto (tondo con testo lungo il bordo, rettangolare o senza bordo; righe al centro; doppio bordo; data) o da
  immagine con lo sfondo tolto; colore, rotazione, data automatica; su una pagina o su più pagine.

## Strumenti dell'area
| id | Nome | Cosa fa |
|---|---|---|
| `personal-archive` | Archivio personale | Protezione e password, backup (esporta/importa), cosa c'è archiviato, firme, timbri, registro. |
| `signatures-library` | Firme e sigle salvate | Rinomina, firma/sigla, cambia proprietario, elimina. |
| `stamps-library` | Timbri salvati | Crea, modifica, elimina. |
| `signatures-log` | Registro delle firme | Usi delle firme di altre persone; CSV. |
| `rubrica` | Rubrica | vedi sotto. |
| `mail-merge` | Compilazione in serie | vedi sotto. |
| `save-template`, `template-zones`, `templates` | Modelli | vedi sotto. |

<!-- RUBRICA -->

<!-- SERIE -->

## Test
- `test/personale-cassaforte.test.js` — cifratura, nessun dato in chiaro, protezione del sistema e ripiego, password
  (blocco, errata, cambio, rimozione), backup automatico e recupero da indice danneggiato, purga GDPR, scritture
  concorrenti, 5000 contatti e 500 firme, validazione, blob non scambiabili, pulizia degli orfani, export/import, canali IPC.
- `test/personale-archivio.test.js` — migrazione dalla 0.2 (anche con salvataggio fallito), password, firme senza limite,
  firme altrui e registro, timbri, GDPR (esporta/cancella), unione dei backup, campi per «Compila a nome di».
- `test/moduli-firme-timbri.test.js` — firma da foto (carta colorata, ombra, inchiostro blu, tratto a matita), timbri,
  posizioni sulle pagine ruotate e su formati diversi, profilo dall'archivio.
- Collaudo nell'app vera: `npx vite build && node test/e2e/archivio-personale.mjs` (migrazione reale dal localStorage,
  file cifrati su disco, conferma e registro di una firma altrui, password al riavvio con dialogo vero, backup esportato e
  reimportato con i dialoghi di sistema).
