# Area «ia»: l'assistente IA sul tuo computer

L'assistente risponde alle domande sul documento aperto **indicando la pagina** e cerca nell'archivio d'ufficio
**per significato**. È **facoltativo e spento** finché l'utente non lo attiva. Funziona **solo sul computer**: niente
servizi esterni, niente costi, i documenti non escono dal PC. Le risposte sono un **aiuto da verificare**.

La scelta dei modelli e le misure sono nello studio di fattibilità: `docs/IA-FATTIBILITA.md` sul ramo
`claude/ia-fattibilita`. La prova sui PC dell'ufficio è descritta in `docs/PROVA-IA-SUL-PC.md`.

## Dove si trova nell'interfaccia

| Cosa | Dove |
|---|---|
| **Assistente IA (sul tuo computer)…** (`ia-impostazioni`) | Strumenti › Strumenti avanzati; sempre visibile. Apre la finestra di attivazione |
| Interruttore **Assistente IA sul tuo computer (facoltativo)** | Impostazioni (solo nell'app desktop). Accenderlo senza componenti apre la finestra per installarli |
| **Chiedi al documento (assistente IA)** (`ia-chiedi`) | Strumenti avanzati; **nascosto** finché l'assistente è spento. Apre il pannello a destra |
| **Cerca per significato nell'archivio** (`ia-archivio`) | Archivio d'ufficio; **nascosto** finché l'assistente è spento |

## Cosa fa

### Finestra «Assistente IA»
Contiene, nell'ordine:

- **Avvertenza**: l'assistente funziona sul computer, può sbagliare, va usato come aiuto e non come fonte.
- **Questo computer**: processore (con il controllo **AVX2**), RAM totale e libera, spazio su disco.
- **Blocchi**: con meno di 6 GB di RAM, oppure con un processore x64 senza AVX2, l'assistente non si attiva e la finestra spiega perché.
- **Scelta del modello**: Gemma 4 E2B (principale) o Qwen3.5-2B (leggero). Quello consigliato dipende dalla RAM:
  - 12 GB o più: il principale;
  - tra 8 e 12 GB: il principale se ci sono almeno 5 GB liberi, altrimenti il leggero;
  - meno di 8 GB: il leggero.
- **Componenti**:
  - il motore (llama.cpp);
  - il modello scelto;
  - il modello per la ricerca per significato.

  Ogni componente ha **«Importa da file…»** (chiavetta o cartella di rete). Un pulsante **«Scarica e installa (X GB)»** scarica quelli che mancano, con avanzamento e **«Interrompi»**: il download riprende da dove era arrivato.
- **Assistente IA attivo**: l'interruttore compare quando i componenti sono installati.
- **«Rimuovi l'assistente dal PC»**: cancella motore, modelli e indice; i documenti non vengono toccati.

### «Chiedi al documento»

1. **Testo del documento.** Viene letto con pdf.js, pagina per pagina, come nell'archivio. Se è una scansione senza testo, l'assistente suggerisce di usare prima l'OCR.
2. **Fino a circa 8.000 token** (circa 25 pagine fitte) il documento va **intero** al modello.
   - La prima domanda è la più lenta. Le successive sullo stesso documento sono rapide, perché il motore tiene il documento in memoria (cache del prompt).
3. **Oltre**, il documento è diviso in passaggi di circa 600 caratteri con la loro pagina.
   - Si scelgono i 5 più pertinenti: ricerca per parole (BM25) e, se il modello di embedding c'è, per significato, uniti con la fusione dei ranghi.
4. **Formato della risposta.** Il modello risponde in JSON `{risposta, pagina}`, vincolato da uno schema (grammatica di llama.cpp).
5. **Cosa mostra la scheda:**
   - la risposta;
   - il pulsante **«Pagina N»**, che porta alla pagina e apre Trova con la parte della risposta che compare nel testo;
   - l'avvertenza «aiuto da verificare» e il tempo impiegato.
6. **Casi particolari:**
   - se la pagina citata non è tra quelle lette, o la risposta non si ritrova nel testo, compare «pagina da controllare»;
   - se il documento non contiene la risposta: «Non ho trovato la risposta in questo documento».
7. **«Interrompi»** ferma la generazione.

### «Cerca per significato nell'archivio»

- **Serve l'archivio d'ufficio**, con almeno una cartella collegata.
- **«Prepara (in sottofondo)» / «Aggiorna»** crea l'indice per significato dal **testo già indicizzato dall'archivio**: nessun file viene riletto dal disco.
  - Si indicizzano solo i documenti nuovi o cambiati, riconosciuti dall'impronta SHA-256, come nell'archivio.
  - Le copie identiche contano una volta sola. Scansioni, file protetti e file con errori sono esclusi.
  - L'indicizzazione è interrompibile. I documenti spariti dall'archivio vengono tolti dall'indice.
- **La ricerca** unisce i risultati per significato con quelli per parole dell'archivio. Se la richiesta contiene codici o numeri (CIG, protocollo, importi), pesano di più le parole.
- **Il risultato** apre il documento in sola lettura alla pagina del passaggio trovato (`app.services.apriDocumentoArchivio`).

## Come è fatta

```
renderer  src/renderer/features/ia/
  index.js            leggero: strumenti, impostazione, attivazione; le finestre si caricano con import() solo all'uso
  servizio.js         chiamate ai canali feat:ia:*
  lib/passaggi.js     passaggi, BM25, fusione dei ranghi, scelta intero/passaggi, prompt, lettura della risposta (puro)
  lib/requisiti.js    requisiti del PC, modello consigliato, componenti mancanti, testi delle avvertenze (puro)
  lib/archivio.js     cosa indicizzare, fusione dei risultati dell'archivio (puro)
  lib/testo-doc.js    testo del documento aperto (pdf.js)
  ui/configura.js, ui/chiedi.js, ui/archivio.js
main      electron/features/ia.cjs       canali feat:ia:*; all'avvio di Leggio non fa nulla
          electron/ia/catalogo.cjs       fonti fisse e impronte SHA-256 (motore e modelli)
          electron/ia/scarica.cjs        download con ripresa (Range) e verifica, importazione da file
          electron/ia/archivi.cjs        estrazione .zip / .tar.gz senza dipendenze, con controllo dei percorsi
          electron/ia/server.cjs         processi llama-server: 127.0.0.1, chiave casuale, chiusura per inattività
          electron/ia/indice.cjs         indice per significato (NDJSON, vettori Float32)
dati      userData/ia/  motore/<tag>/  modelli/*.gguf  indice/indice.ndjson  registro-motore*.txt
```

### Scelte

**Niente nel pacchetto.** Il motore è llama.cpp, nei pacchetti ufficiali con licenza MIT.

- Come i modelli, si scarica **solo se l'utente attiva l'assistente**.
- L'installer di Leggio non cambia: nessuna dipendenza nuova, nessun binario nativo.
- Le versioni sono fisse:
  - llama.cpp `b12540`;
  - i modelli hanno la revisione di Hugging Face fissata a un commit.

**Integrità.**

- Ogni file ha dimensione e **SHA-256** scritte in `catalogo.cjs`. Un file diverso viene cancellato.
- Il download parte solo da host ammessi (github.com, huggingface.co e le loro CDN), in HTTPS, e lo stesso vale dopo i reindirizzamenti.
- I pacchetti vengono estratti senza permettere percorsi fuori dalla cartella.
- Per il download si usa `net.fetch` di Electron, che usa il **proxy di sistema** dell'ufficio.

**Processo separato.** Il calcolo avviene in `llama-server`, processi figli del main. Un errore del motore non blocca Leggio.

- I processi sono al massimo due: risposte ed embedding.
- Ascoltano solo su `127.0.0.1` con una porta libera e una **chiave casuale** (`--api-key`), quindi nessun altro programma del PC può usarli.
- Partono alla prima richiesta e si fermano dopo **5 minuti** di inattività, quando si spegne l'assistente o quando si chiude Leggio.

**Parametri del motore:**

- **Risposte:** contesto di 8.192 token, nessuna cache dei prompt in RAM (`-cram 0`). La RAM di picco misurata è 4,2 GB con Gemma 4 E2B e 2,0 GB con Qwen3.5-2B.
- **Embedding:** granite-embedding-107m. I testi oltre 512 token vengono accorciati.
- **Thread:** `min(4, processori logici − 1)`.

**Privacy.**

- **Nessuna connessione durante l'uso.** L'unica rete è il download facoltativo dei componenti, sostituibile con l'importazione da file.
- **Sul disco** resta solo l'indice dell'archivio, con passaggi di testo e vettori, in `userData/ia/indice`. Si cancella con «Rimuovi l'assistente dal PC».
- **Nei registri** finiscono solo tempi e conteggi, mai il testo delle domande o dei documenti.

## Test

- **`test/ia-passaggi.test.js`**: passaggi, BM25, fusione, scelta intero/passaggi, lettura della risposta, frase da evidenziare.
- **`test/ia-logica.test.js`**: requisiti del PC, componenti mancanti, cosa indicizzare, fusione dei risultati dell'archivio.
- **`test/ia-main.test.js`**:
  - estrazione zip e tar.gz, compresi i percorsi malevoli;
  - download con avanzamento, ripresa, impronta sbagliata, host non ammessi, connessione caduta e interruzione;
  - importazione da file e catalogo;
  - indice;
  - processo del motore, provato con un **llama-server finto** scritto in Node: avvio, riuso, chiusura per inattività, errore all'avvio;
  - modulo dell'area senza componenti.
- **`test/e2e/ia-app.mjs`**: collaudo nell'app vera con motore e modelli veri, che non sono nel repository; le istruzioni sono in testa al file.
  - spento di default, nessun caricamento all'avvio;
  - importazione dei componenti dalla finestra;
  - domanda con la pagina e link che porta alla pagina;
  - documento lungo;
  - ricerca per significato con richiesta parafrasata;
  - spegnimento.

## Limiti noti (v1)

- **Niente riassunti né estrazione dati:** previsti per la v2, con i campi per Titulus e U-GOV.
- **Scansioni:** senza testo l'assistente non risponde. Serve prima l'OCR.
- **Windows ARM:** il motore c'è (llama.cpp `win-cpu-arm64`), ma non è stato provato.
- **Prima domanda su un documento lungo intero:** su un PC d'ufficio senza GPU richiede circa 20–30 secondi.
