# IA locale in Leggio: studio di fattibilità

*Novembre 2026. Studio con misure reali, senza modifiche all'app. Codice, dati e risultati grezzi in [`ricerca-ia/`](../ricerca-ia/).*

---

## In breve (per chi non è tecnico)

**Si può fare.** Un'IA che gira solo sul computer dell'utente, gratis, senza internet e senza inviare documenti a nessuno, oggi è abbastanza brava da aiutare in ufficio su determine, bandi, contratti, circolari e verbali. Va però presentata come un **aiuto da verificare**, non come una fonte sicura.

Abbiamo provato **7 modelli aperti** su **20 documenti veri della pubblica amministrazione**: determine, delibere, bandi, capitolati, una fattura, circolari e verbali. Per ognuno avevamo preparato prima le risposte giuste.

**Cosa abbiamo misurato, con il modello consigliato:**

- **Domande sul documento.** Risponde giusto e indica la pagina giusta nell'**87–93% dei casi**. Su un PC d'ufficio la risposta arriva in **circa 8 secondi**.
- **Ricerca per significato nell'archivio.** Trovare un atto descrivendolo con parole proprie (per esempio "posti letto per i senzatetto d'inverno") funziona: il documento giusto è **tra i primi 3 risultati nell'85% dei casi**. Con la ricerca per parole attuale si arriva all'80%, ma il documento è **primo solo nel 55%** dei casi, contro il **70–75%** della ricerca per significato.
- **Riassunti.** Sono **fedeli**: solo il 10% contiene un errore, contro il 55–80% degli altri modelli. Sono però **incompleti**: in media coprono circa metà dei punti chiave.
- **Estrazione automatica dei dati** (importo, CIG, CUP, scadenze, RUP…). Circa **8 dati su 10 sono giusti**. CIG e CUP quasi sempre. Scadenze e responsabile del procedimento sbagliano più spesso, quindi servono sempre i controlli dell'operatore.

**La scelta:**

| Ruolo | Modello | Perché |
|---|---|---|
| **Principale** | **Gemma 4 E2B** (Google, licenza Apache-2.0) | È il più affidabile nei riassunti e tra i migliori nelle risposte con pagina. Legge i documenti da 2 a 5 volte più in fretta degli altri modelli bravi. |
| **Riserva / versione leggera** | **Qwen3.5-2B** (Alibaba, Apache-2.0) | Usa metà della memoria (2 GB contro 4,2) e il file pesa 1,2 GB. Rende un po' meno, soprattutto nei riassunti. È quello da usare sui PC con poca RAM. |
| **Ricerca per significato** | **granite-embedding-107m-multilingual** (IBM, Apache-2.0) | Piccolo (115 MB) e veloce nell'indicizzare l'archivio. Supporta l'italiano. |

**Cosa serve sul PC:** un processore x64 degli ultimi 10 anni (Intel Haswell 2013 o AMD Ryzen e successivi) con 4 core, **8 GB di RAM** (16 consigliati), 3,5 GB liberi su disco. Non serve la scheda grafica. Su Mac con chip Apple (M1 e successivi) è più veloce.

**Rischi principali:**

- **L'IA può sbagliare.** L'interfaccia deve dirlo chiaramente e mostrare sempre la pagina da cui viene la risposta.
- **Il modello è un file grande.** Va scaricato a parte e solo su richiesta, oppure importato da una chiavetta negli uffici senza internet.
- **Il modello italiano non è pronto.** Velvet-2B, l'unico addestrato soprattutto sull'italiano con licenza adatta, oggi non è utilizzabile per questo uso: ha il punteggio più basso di tutti.

**Sforzo stimato:**

- **Prima versione** (domande con citazione e ricerca per significato nell'archivio): **5–6 settimane** di una persona.
- **Seconda versione** (riassunti ed estrazione dati per Titulus e U-GOV): altre **3 settimane**.

---

## 1. Cosa abbiamo fatto

1. **7 modelli linguistici** tra 0,8 e 4 miliardi di parametri, quantizzati GGUF Q4_K_M, più **5 modelli di embedding**. Solo licenze Apache-2.0 o MIT (§2).
2. **Motore:** llama.cpp (`llama-server`, commit `8043748`) su **sola CPU, 4 thread**. Compilato **solo con AVX2** (senza AVX-512) per avvicinarsi a un PC d'ufficio. Integrazione verificata anche con **node-llama-cpp 3.22.3**, il motore che userebbe Electron (§3.4).
3. **Banco di prova:**
   - 20 PDF pubblici e veri, elencati in [`ricerca-ia/banco/ELENCO.md`](../ricerca-ia/banco/ELENCO.md): 9 corti, 7 medi, 4 lunghi da 20 a 35 pagine; in tutto 547.000 caratteri.
   - Testo estratto con **pdf.js** usando la funzione `estraiTesto` di Leggio (`src/renderer/features/conversione/lib/estrai-testo.js`).
   - Per ogni documento le risposte di riferimento: 7 campi da estrarre, 3 domande con la pagina, un riassunto di 5 righe e i punti chiave.
   - Ogni risposta di riferimento è controllata da uno script, che verifica che il valore compaia davvero nella pagina indicata.
4. **Per ogni modello e documento:**
   - estrazione dati con **JSON schema** (grammatica di llama.cpp);
   - riassunto;
   - 3 domande in due modi: con il **documento intero** e con il **recupero dei passaggi (RAG)** tramite embedding.
   - I documenti oltre 10.000 token passano alla **strategia a pezzi (map-reduce)**: estrazione e mini-riassunto per ogni pezzo di circa 3.500 token, poi unione.
5. **Valutazione:**
   - **Estrazione e domande:** punteggio automatico con criteri espliciti, scritti in testa a `ricerca-ia/script/punteggi.py`.
   - **Riassunti:** 140 riassunti valutati **alla cieca**, senza sapere quale modello li avesse scritti, confrontandoli con il testo. Criteri: fedeltà da 1 a 5, numero di invenzioni, copertura dei punti chiave da 1 a 5, italiano da 1 a 5.
   - **Ricerca nell'archivio:** 20 richieste parafrasate, scritte senza riusare le parole dell'oggetto.

> **Trasparenza sul metodo.** Le risposte di riferimento e i voti ai riassunti li ha prodotti Claude, l'assistente che ha condotto lo studio. Li ha scritti leggendo il testo e verificando ogni dato con ricerche automatiche nel testo; i riassunti li ha valutati senza sapere quale modello li avesse scritti. Non sono stati rivisti da una persona dell'ufficio. Un controllo a campione da parte di un operatore è tra i prossimi passi.

## 2. Candidati e licenze

Le licenze sono state verificate il 19/11/2026 sulla scheda ufficiale di ogni modello su Hugging Face (campo `license` dei metadati dell'autore). La licenza del modello vale anche per le sue conversioni GGUF.

| Modello | Autore | Parametri | Licenza | Italiano | File GGUF provato (Q4_K_M) |
|---|---|---|---|---|---|
| **Gemma 4 E2B it** | Google | 2 mld "effettivi" (5,1 totali, con tabelle di embedding per strato) | **Apache-2.0** (Gemma 4 è uscito con Apache-2.0, non più con la licenza Gemma) | dichiarato | unsloth/gemma-4-E2B-it-GGUF, 2,9 GB |
| **Qwen3.5-4B** | Alibaba Qwen | ≈4 mld | **Apache-2.0** | dichiarato (multilingue) | unsloth/Qwen3.5-4B-GGUF, 2,6 GB |
| **Qwen3.5-2B** | Alibaba Qwen | ≈1,9 mld | **Apache-2.0** | dichiarato | unsloth/Qwen3.5-2B-GGUF, 1,2 GB |
| **Ministral 3 3B Instruct 2512** | Mistral AI | 3,4 mld (+ visione) | **Apache-2.0** | dichiarato | mistralai/…-GGUF (ufficiale), 2,0 GB |
| **Granite 4.1 3B** | IBM | 3,4 mld | **Apache-2.0** | dichiarato (12 lingue) | ibm-granite/granite-4.1-3b-GGUF (ufficiale), 2,0 GB |
| **Velvet-2B** | Almawave (Italia) | 2,2 mld | **Apache-2.0** (download originale dietro un modulo di contatto) | **addestrato soprattutto su italiano e inglese** | SistInf/Velvet-2B-GGUF (comunità), 1,3 GB |
| Qwen3.5-0.8B (soglia minima) | Alibaba Qwen | 0,9 mld | **Apache-2.0** | dichiarato | unsloth, 0,5 GB |

**Embedding:**

| Modello | Licenza | File (Q8_0) |
|---|---|---|
| multilingual-e5-small (intfloat) | **MIT** | 126 MB |
| granite-embedding-107m-multilingual (IBM) | **Apache-2.0** | 115 MB |
| granite-embedding-278m-multilingual (IBM) | **Apache-2.0** | 289 MB |
| Qwen3-Embedding-0.6B | **Apache-2.0** | 610 MB |

**Esclusi o segnalati a parte:**

- **Licenza non adatta** (non Apache/MIT):
  - **Llama 3.2** 1B/3B: *Llama 3.2 Community License*, con politica d'uso, obblighi di marchio e limiti per grandi aziende.
  - **Gemma 3**: *Gemma Terms of Use*, con divieti d'uso. Gemma 4 invece è Apache-2.0.
  - **Qwen2.5-3B**: *Qwen Research License*, solo ricerca.
  - **LFM2.5** (Liquid AI): *LFM Open License*, con un limite di fatturato.
- **Licenza adatta ma non provati** per tempo e disco:
  - **Phi-4-mini-instruct** (MIT, 3,8 mld). Resta la prima alternativa da provare.
  - **SmolLM3-3B**, **EuroLLM-1.7B**, **Salamandra-2B** (tutti Apache-2.0).
- **Modelli addestrati sull'italiano:**
  - **Velvet2-3B** (Almawave, ottobre 2026, Apache-2.0): non ha ancora un GGUF e il download originale richiede un account.
  - **Minerva** (Sapienza, Apache-2.0): la versione istruita a rispondere è da 7 mld, oltre il limite; quelle piccole esistono solo come modelli base.
  - Questi due sono da riprovare in futuro.

**Compatibilità con GPL-3.0:** Apache-2.0 e MIT sono compatibili con GPL-3.0. In più il modello **non entra nell'installer**: si scarica a parte come file di dati, con la sua LICENSE e il suo NOTICE.

## 3. Risultati

Tutte le tabelle sono generate da `ricerca-ia/script/tabelle.py` a partire dai risultati grezzi (`ricerca-ia/risultati/`).

### 3.1 Velocità e memoria

Misure su CPU con 4 thread e build AVX2: Xeon a 2,1 GHz, 4 core, senza GPU. Dettagli:

- **Lettura e scrittura:** misurate con `llama-bench`, con lettura su un prompt di 2048 token e scrittura su 128 token.
- **Pronto a freddo:** tempo fino alla prima risposta dopo aver svuotato la cache del disco.
- **RAM di picco:** misurata con contesto di 8.192 token.
- **Tempo per documento:** comprende estrazione, riassunto e 6 domande.
- **Velvet:** i valori vengono dal server, perché `llama-bench` non carica il suo file.

| Modello | File | Lettura documento (tok/s) | Scrittura risposta (tok/s) | Pronto a freddo | RAM di picco | Tempo per documento (≤10k token) | Documento lungo (map-reduce) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Gemma 4 E2B** | 2,89 GB | **206** | 12,9 | 4,5 s | 4,2 GB | **89 s** | **294 s** |
| Qwen3.5-4B | 2,55 GB | 42 | 7,0 | 5,2 s | 4,4 GB | 269 s | 897 s |
| **Qwen3.5-2B** | 1,19 GB | 112 | 15,6 | 2,5 s | **2,0 GB** | 108 s | 374 s |
| Ministral 3 3B | 2,00 GB | 44 | 9,4 | 14,6 s | 4,3 GB | 310 s | 1028 s |
| Granite 4.1 3B | 1,96 GB | 44 | 9,7 | 4,8 s | 4,1 GB | 256 s | 947 s |
| Velvet-2B | 1,29 GB | 76 | 11,0 | 2,4 s | 2,6 GB | 149 s | 502 s |
| Qwen3.5-0.8B | 0,50 GB | 235 | 32,0 | 1,5 s | 0,9 GB | 54 s | 189 s |

**Come si legge:**

- **Leggere il documento costa più che scrivere la risposta.** Un documento di 5 pagine (circa 5.000 token) richiede circa 25 s con Gemma 4 E2B e circa 2 minuti con un modello denso da 3–4 miliardi di parametri.
- **Le domande successive sono rapide**, perché il documento resta in memoria (cache del prompt):
  - 4 s con Gemma, 6 s con Qwen3.5-2B, 14 s con Qwen3.5-4B;
  - con il RAG, che legge solo 5 passaggi, servono 8–24 s anche sui documenti di 35 pagine.
- **Gemma 4 E2B è così veloce nella lettura** perché il suo file grande contiene soprattutto tabelle consultate per ogni parola, mentre la parte di calcolo vera è da circa 2 miliardi di parametri.
- **Il tokenizzatore pesa sull'italiano.** Lo stesso testo italiano vale 3.598 token per Qwen e 4.820 per Ministral: Qwen e Gemma "spendono" meno sull'italiano.

Tempi per singola operazione:

| Modello | Estrazione dati | Riassunto (documento già letto) | Domanda (documento già letto) | Domanda con RAG |
|---|---:|---:|---:|---:|
| Gemma 4 E2B | 102 s | 16 s | 4,4 s | 7,8 s |
| Qwen3.5-4B | 312 s | 44 s | 14,4 s | 24,0 s |
| Qwen3.5-2B | 124 s | 21 s | 6,5 s | 9,9 s |
| Ministral 3 3B | 359 s | 71 s | 11,1 s | 24,0 s |
| Granite 4.1 3B | 336 s | 42 s | 6,9 s | 23,1 s |
| Velvet-2B | 140 s | 18 s | 4,9 s | 10,5 s |
| Qwen3.5-0.8B | 63 s | 10 s | 3,4 s | 4,7 s |

*Il tempo dell'estrazione comprende la prima lettura del documento intero; per i documenti lunghi comprende tutti i pezzi.*

### 3.2 Qualità

| Modello | Estrazione: campi giusti | Estrazione: valori inventati | Domande, documento intero: giuste / con pagina giusta | Domande, RAG: giuste / con pagina giusta | Riassunto: fedeltà (1–5) | Copertura (1–5) | Italiano (1–5) | Riassunti con almeno un'invenzione |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Gemma 4 E2B** | 79% | 7% | 98% / 93% | 88% / 87% | **4,80** | 2,80 | **4,80** | **10%** |
| Qwen3.5-4B | **85%** | **4%** | **100% / 95%** | 88% / 87% | 4,05 | 3,40 | 4,60 | 75% |
| Qwen3.5-2B | 74% | 6% | 95% / 81% | 85% / 85% | 3,65 | 3,05 | 4,10 | 70% |
| Ministral 3 3B | 76% | 5% | 98% / 86% | 88% / 80% | 3,85 | **3,80** | 3,75 | 55% |
| Granite 4.1 3B | 76% | 14% | 90% / 69% | 83% / 75% | 3,45 | 2,75 | 3,90 | 80% |
| Velvet-2B | 31% | 39% | 51% / 33% | 50% / 38% | 3,75 | 2,50 | 3,40 | 55% |
| Qwen3.5-0.8B | 45% | 15% | 62% / 45% | 62% / 58% | 3,50 | 2,65 | 3,30 | 75% |

**Come sono state contate le colonne:**

- **Domande con il documento intero:** 42 domande, sui 14 documenti che entrano interi nel contesto.
- **Domande con il RAG:** tutte le 60 domande.
- **Valori inventati:** un valore estratto che non compare da nessuna parte nel documento.
- **Riassunti con invenzioni:** almeno un fatto non supportato dal testo o contraddetto da esso. Due esempi: un importo inesistente; un'aggiudicataria sbagliata.

Estrazione, per tipo di dato:

| Modello | oggetto | importo | CIG | CUP | scadenze | controparte | RUP | JSON valido |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 E2B | 90% | 75% | 100% | 95% | 55% | 70% | 70% | 100% |
| Qwen3.5-4B | 90% | 75% | 100% | 100% | 70% | 75% | 85% | 100% |
| Qwen3.5-2B | 90% | 65% | 95% | 95% | 65% | 45% | 65% | 100% |
| Ministral 3 3B | 95% | 70% | 100% | 100% | 55% | 30% | 80% | 100% |
| Granite 4.1 3B | 75% | 55% | 95% | 85% | 80% | 55% | 90% | 100% |
| Velvet-2B | 45% | 20% | 20% | 15% | 75% | 15% | 25% | 95% |
| Qwen3.5-0.8B | 80% | 60% | 45% | 45% | 45% | 10% | 30% | 95% |

**Cosa insegnano gli errori:**

- **Gli errori tipici:**
  - come importo, il totale del progetto al posto di quello dell'affidamento;
  - come RUP, il dirigente che firma;
  - come controparte, l'ente stesso;
  - una data di trasmissione scambiata per una scadenza.
- Sono gli stessi errori che fa una persona di fretta. Per questo l'estrazione va presentata come **proposta da confermare**, con controlli automatici:
  - CIG di 10 caratteri e CUP di 15;
  - il valore proposto deve comparire davvero nel testo.
- **Output strutturato.** Con il JSON schema (grammatica di llama.cpp) il **100%** delle risposte è JSON valido. Senza schema, Gemma su 10 documenti ha prodotto JSON valido nel **90%** dei casi e campi giusti nel **77%**, contro l'**83%** con schema sugli stessi documenti. La grammatica conviene sempre.
- **Map-reduce.** Funziona sui documenti lunghi, ma unire i pezzi è delicato. Per esempio, nella determina di Firenze il "primo importo trovato" era il valore dell'intero programma. Per la v2 serve un passaggio finale di scelta tra i candidati.
- **Domande: documento intero o RAG.**
  - Il documento intero dà qualche punto in più di precisione: 93% contro 87% con Gemma.
  - Il RAG è l'unica strada per i documenti lunghi e tiene i tempi sotto i 10 s.
  - Il passaggio giusto era tra i 5 recuperati nel 93% dei casi.
  - Proposta: documento intero fino a circa 8.000 token, RAG oltre.
- **Velvet.** Il GGUF disponibile usa un tokenizzatore che llama.cpp ufficiale non riconosce. È stato forzato a `tekken`, e serve anche una correzione del parametro RoPE: senza, oltre 4.000 token produce testo senza senso. Anche così segue male le istruzioni: in un'estrazione ha ricopiato il testo del compito al posto dei dati. **Oggi non è utilizzabile.** Va rivalutato quando Almawave pubblicherà un GGUF ufficiale di Velvet2-3B.

### 3.3 Ricerca per significato (embedding)

| Modello | File | Domande: passaggio giusto tra i primi 5 | idem, ibrido con BM25 | Archivio: documento giusto al 1° posto | Archivio: tra i primi 3 | Velocità di indicizzazione | RAM |
|---|---:|---:|---:|---:|---:|---:|---:|
| BM25 (ricerca per parole, nessun modello) | — | 100% | — | 55% | 80% | — | — |
| multilingual-e5-small (MIT) | 126 MB | 93% | 98% | 75% | 85% | 20,6 passaggi/s | 300 MB |
| *stesso modello, altra conversione GGUF (difettosa)* | 126 MB | 67% | 83% | **5%** | 15% | 25,3 passaggi/s | 221 MB |
| **granite-embedding-107m-multilingual (Apache)** | 115 MB | 93% | 98% | 70% | 85% | **39,3 passaggi/s** | 291 MB |
| granite-embedding-278m-multilingual (Apache) | 289 MB | 93% | 98% | 75% | 80% | 7,4 passaggi/s | 486 MB |
| Qwen3-Embedding-0.6B (Apache) | 610 MB | 95% | 97% | **85%** | **90%** | 1,2 passaggi/s | 1638 MB |

**Come si legge:**

- **Due prove diverse:**
  - **Domande:** si cerca la pagina giusta dentro un documento. Le domande del banco riprendono le parole del testo, quindi la ricerca per parole (BM25) è già ottima.
  - **Archivio:** si cerca l'atto giusto tra 20 con una descrizione parafrasata. Qui la ricerca per significato vince nettamente: il documento giusto è primo nel 70–85% dei casi, contro il 55% della ricerca per parole.
- **Proposta:** l'ibrido, cioè significato più parole. Per l'archivio, il significato fa da criterio principale e le parole contano di più quando la richiesta contiene codici o numeri (CIG, protocollo).
- **Scelta: granite-embedding-107m-multilingual.**
  - Ha la stessa qualità di e5-small e di granite-278m.
  - È il più veloce: un archivio di 1.000 PDF, circa 60.000 passaggi, si indicizza in circa 25 minuti, contro 50 con e5-small e oltre 13 ore con Qwen3-Embedding.
  - Qwen3-Embedding-0.6B è il più preciso, ma è troppo lento per indicizzare archivi grandi su CPU.
- **Lezione importante.** Una delle due conversioni GGUF "di comunità" di e5-small era **difettosa** (5% contro 75%) pur caricandosi senza errori. **Leggio deve distribuire solo file convertiti dal progetto** dai pesi ufficiali e verificati su questo banco di prova, con SHA-256 fissato.

### 3.4 Integrazione con node-llama-cpp (Electron)

Prova con `ricerca-ia/script/prova-node-llama-cpp.mjs`: node-llama-cpp 3.22.3 (MIT), Gemma 4 E2B, solo CPU, 4 thread. Il documento di prova è la determina di Verona, di 5.404 token.

- caricamento 2,6 s; lettura **18 s** (300 tok/s); scrittura 10 tok/s; RAM del processo 4,9 GB;
- estrazione con JSON schema corretta: `{"importo": "7.900,84 IVA ed oneri esclusi", "cig": "B8A11ABCA1", "rup": "Ing. Flavio Tagliapietra"}`.

I binari precompilati di node-llama-cpp scelgono da soli le istruzioni della CPU (qui AVX-512, quindi più veloci della build AVX2 delle tabelle). I binari pesano circa 33 MB per piattaforma, più 43 MB di libreria; vanno escluse le varianti CUDA e Vulkan.

### 3.5 Thread e istruzioni della CPU

Gemma 4 E2B, stessa macchina (`ricerca-ia/risultati/thread-e-build.json`):

| Configurazione | Lettura (tok/s) | Scrittura (tok/s) |
|---|---:|---:|
| AVX2, 2 thread | 119 | 7,7 |
| AVX2, 4 thread | 222 | 14,1 |
| AVX-512, 4 thread | 390 | 14,9 |

- La lettura cresce con i core e con AVX-512.
- La scrittura è limitata dalla velocità della memoria.

## 4. Hardware e requisiti

### PC d'ufficio tipico (4 core, 8 GB, nessuna GPU)

Le misure di questo studio sono state fatte con la build AVX2 su 4 core a 2,1 GHz. Un PC d'ufficio recente (per esempio Intel Core i5 di 10ª–13ª generazione, 4–6 core a 3–4 GHz, DDR4 o DDR5 in doppio canale) dovrebbe andare **come le misure o fino al 30% meglio**. Un PC vecchio o carico di altri programmi può andare a **metà velocità**: è il caso "2 thread" della tabella in §3.5.

| Con Gemma 4 E2B | PC d'ufficio (stima) | PC vecchio o carico |
|---|---:|---:|
| Domanda con RAG | 6–8 s | 12–16 s |
| Prima domanda su un documento di 5 pagine (lettura completa) | 20–30 s | 45–60 s |
| Domande successive | 3–5 s | 8–10 s |
| Riassunto di un documento di 5 pagine | 40–50 s | 90 s |
| Riassunto di 30 pagine (map-reduce) | 4–5 min | 8–10 min |
| Indicizzare 1.000 PDF per la ricerca per significato | 25–40 min, in background | 1 ora |

**RAM:**

- Gemma 4 E2B arriva a **4,2 GB** di picco con un contesto di 8.192 token.
- Con 8 GB totali (Windows 2,5–3,5 GB, Leggio circa 0,5 GB) ci sta, ma senza altri programmi pesanti aperti.
- Se all'avvio dell'assistente la RAM libera è sotto i 5 GB, Leggio propone il modello leggero **Qwen3.5-2B** (2,0 GB).

### Mac con Apple Silicon (Metal)

**Stima ricavata da benchmark pubblici, non misurata in questo studio.** La fonte è la [tabella ufficiale di llama.cpp per Apple Silicon](https://github.com/ggml-org/llama.cpp/discussions/4167), misurata con Llama 2 7B Q4_0.

- La **velocità di lettura** è riscalata in base ai parametri.
- La **velocità di scrittura** è riscalata in base alla dimensione del file, perché dipende dalla banda della memoria.
- L'intervallo va dal 60% al 100% del valore teorico, perché i modelli piccoli e quelli ibridi scalano peggio.

| Mac (GPU base) | Gemma 4 E2B: lettura / scrittura (tok/s) | Qwen3.5-2B | Qwen3.5-4B |
|---|---:|---:|---:|
| M1 (8 GPU, 68 GB/s) | 240–400 / 10–17 | 250–420 / 25–42 | 115–190 / 12–20 |
| M2 (10 GPU, 100 GB/s) | 360–600 / 16–27 | 380–640 / 39–66 | 170–290 / 18–31 |
| M3 (10 GPU, 100 GB/s) | 380–630 / 16–26 | 400–660 / 38–64 | 180–300 / 18–30 |
| M4 (10 GPU, 120 GB/s) | 450–750 / 18–30 | 470–780 / 43–72 | 210–355 / 20–34 |

In pratica un Mac con chip Apple legge i documenti **da 2 a 3 volte più in fretta** del PC d'ufficio. Su Mac con 8 GB di memoria unificata vale la stessa cautela sulla RAM.

### Requisiti minimi proposti

| | Minimo | Consigliato |
|---|---|---|
| Processore | x64 con **AVX2** (Intel Haswell 2013+, AMD Zen+), 4 core; oppure Apple M1 | 6+ core, AVX-512; oppure Apple M2+ |
| RAM | 8 GB (con il modello leggero Qwen3.5-2B se liberi < 5 GB) | 16 GB |
| Disco | 3,5 GB liberi (modello 2,9 GB + embedding 0,1 GB + indice) | SSD |
| GPU | non necessaria | — |
| Sistema | Windows 10/11 64 bit, macOS 12+, Linux x64 | — |

Sotto il minimo (niente AVX2, meno di 8 GB) l'assistente resta **disattivato** e Leggio funziona come oggi.

## 5. La scelta

| | Modello | Licenza | Qualità in italiano | Velocità | RAM | Motivazione |
|---|---|---|---|---|---|---|
| **Principale** | **Gemma 4 E2B it**, Q4_K_M (2,9 GB) | Apache-2.0 | Riassunti i più fedeli (4,8/5, invenzioni nel 10%), italiano 4,8/5; domande con pagina giusta 87–93%; estrazione 79% | Lettura la più rapida tra i modelli validi (206 tok/s su CPU AVX2) | 4,2 GB | Il miglior equilibrio: affidabile dove conta (non inventa), veloce sui PC senza GPU. |
| **Riserva** | **Qwen3.5-2B**, Q4_K_M (1,2 GB) | Apache-2.0 | Domande con pagina 81–85%; estrazione 74%; riassunti meno fedeli (3,65/5) | 112 tok/s in lettura, 15,6 in scrittura | 2,0 GB | Per i PC con 8 GB già pieni; è di un altro produttore, quindi copre anche il rischio che un modello venga ritirato. |
| **Embedding** | **granite-embedding-107m-multilingual**, Q8_0 (115 MB) | Apache-2.0 | Passaggio giusto tra i primi 5: 93% (98% ibrido); archivio: 70% al primo posto, 85% tra i primi 3 | 39 passaggi/s | 0,3 GB | Piccolo e veloce: l'unico adatto a indicizzare archivi grandi su CPU. |

**Nota su Qwen3.5-4B:** è il migliore nell'**estrazione dati** (85%, RUP 85%, controparte 75%) e nelle domande, ma è **3 volte più lento** e nei riassunti inventa più spesso (75%). Per la v2 si può offrire come "modello di precisione" facoltativo per l'estrazione, sui PC con 16 GB.

## 6. Architettura proposta per Leggio

```
┌───────────────── Leggio (Electron) ─────────────────┐
│ Renderer (interfaccia)                               │
│   pannello "Chiedi al documento" · ricerca Archivio  │
│        │  MessagePort                                 │
│ Processo principale ── avvia / ferma ──┐             │
│                                        ▼             │
│   utilityProcess "ia" (Node)                         │
│     node-llama-cpp (llama.cpp: CPU, Metal su Mac)    │
│     modello linguistico GGUF (mmap)                  │
│     modello di embedding GGUF                        │
│     indice vettoriale dell'Archivio (file locale)    │
└──────────────────────────────────────────────────────┘
   modelli in <userData>/modelli/  (fuori dall'installer)
```

### 6.1 Motore e processo separato

- **Motore:** `node-llama-cpp` (MIT), che incorpora llama.cpp (MIT). Ha binari precompilati per Windows x64/arm64, macOS (Metal) e Linux. Supporta JSON schema e grammatiche, embedding e cache del prompt. Va impacchettato con `asarUnpack` e solo con le varianti CPU e Metal.
- **Processo separato:** l'inferenza gira in un `utilityProcess` di Electron, cioè un processo Node a parte, quindi l'interfaccia non si blocca mai.
  - Se l'inferenza va in errore o finisce la memoria, Leggio resta aperto e mostra un messaggio.
  - Il processo parte alla prima richiesta e si chiude dopo 5 minuti di inattività, per restituire 2–4 GB di RAM.
- **Thread:** per default `min(4, core fisici − 1)`, così il PC resta usabile. Ogni richiesta ha il pulsante **"Interrompi"**.
- **Scelte tecniche emerse dalle misure:**
  - documento intero fino a circa 8.000 token, RAG oltre;
  - cache del prompt per le domande successive sullo stesso documento;
  - contesto di 8.192 token per contenere la RAM.

### 6.2 Download del modello su richiesta

- **Dove si attiva:** l'installer **non** contiene il modello. In Impostazioni → «Assistente IA (facoltativo)» l'utente vede nome, dimensione (2,9 GB, oppure 1,2 GB per la versione leggera), licenza e requisiti, e sceglie «Scarica».
- **Fonte stabile:** un *release asset* con tag immutabile su GitHub del progetto (es. `lorebiri/leggio-modelli`, tag `gemma-4-e2b-q4km-v1`), con copia su Hugging Face con revisione fissata a un commit. **Mai** URL "latest" o file di terzi.
- **Integrità:**
  - l'elenco dei modelli (nome, URL, dimensione, **SHA-256**, licenza) è scritto nel codice di Leggio e firmato con l'app;
  - il download va in `.part`, con ripresa (HTTP Range);
  - lo SHA-256 si calcola in streaming; se non corrisponde il file si cancella, e solo dopo la verifica viene rinominato.
  - Gli SHA-256 dei file usati in questo studio sono in `ricerca-ia/risultati/sha256.txt`. I file pubblicati da Leggio però saranno conversioni proprie dai pesi ufficiali, ripassate sul banco di prova prima del rilascio (vedi §3.3).
- **Uffici senza internet:** «Importa modello da file…» da chiavetta o cartella di rete, con la stessa verifica. Gli amministratori possono anche preinstallare il file in una cartella comune.
- **Licenze:** accanto al modello si salvano LICENSE e NOTICE (Apache-2.0); la finestra «Informazioni» li mostra.

### 6.3 Funzioni

**Prima versione (v1):**

1. **Domande sul documento, con citazione:**
   - Leggio recupera i passaggi pertinenti (ibrido embedding + parole), oppure usa il documento intero se è corto.
   - Il modello risponde in JSON `{risposta, pagina}` vincolato dalla grammatica.
   - La pagina è un link: Leggio ci salta ed evidenzia il passaggio.
   - Se la risposta non c'è: «Non ho trovato la risposta in questo documento».
2. **Ricerca per significato nell'Archivio:**
   - indicizzazione con il modello di embedding in background, quando il PC è inattivo o su richiesta;
   - risultati fusi con la ricerca per parole esistente;
   - non serve il modello linguistico: bastano 115 MB.

**Seconda versione (v2):**

3. **Riassunto** in 5 righe, con map-reduce sui documenti lunghi e le pagine di provenienza.
4. **Estrazione dati** (oggetto, importo, CIG, CUP, scadenze, controparte, RUP):
   - con JSON schema;
   - con controlli automatici: formato di CIG e CUP, valore presente nel testo;
   - mostrata in un modulo modificabile;
   - esportabile verso i campi di protocollo e repertorio di **Titulus** e verso **U-GOV**: all'inizio CSV/JSON o copia negli appunti, senza collegamento diretto.

### 6.4 Avvertenze nell'interfaccia (testi proposti)

- **Prima attivazione:** «L'assistente funziona interamente su questo computer: i documenti non vengono inviati a nessuno. Può sbagliare: usalo come aiuto, non come fonte.»
- **Sotto ogni risposta:** «Risposta automatica, **aiuto da verificare**: controlla a pagina N.»
- **Riassunto:** «Riassunto automatico: può contenere errori o omissioni e non sostituisce la lettura dell'atto.»
- **Estrazione:** «Dati proposti automaticamente: controllali prima di usarli. I campi non trovati restano vuoti.»

### 6.5 Privacy

- **Tutto locale.** Durante l'uso non c'è nessuna connessione di rete. L'unica connessione è il download del modello, che è facoltativo e sostituibile con l'importazione da file.
- **Cosa resta sul disco.** Oltre ai modelli, solo l'indice dell'Archivio (vettori e passaggi di testo) nella cartella dati di Leggio. Si cancella da Impostazioni.
- **Nessuna telemetria.** È coerente con il GDPR e con le indicazioni AgID sull'IA nella PA, perché non c'è trasferimento a terzi né profilazione.

## 7. Stima dello sforzo

| Attività | Giorni-persona |
|---|---:|
| **v1** | |
| utilityProcess, integrazione node-llama-cpp, impacchettamento Windows/macOS (firma e notarizzazione dei binari nativi) | 6–8 |
| Gestione modelli: download con ripresa, SHA-256, importazione da file, Impostazioni, controllo dei requisiti | 3–4 |
| Pipeline delle domande: passaggi da `estraiTesto`, embedding, ibrido, prompt e grammatica, cache | 4–5 |
| Indice vettoriale dell'Archivio con indicizzazione in background e fusione con la ricerca esistente | 4–5 |
| Interfaccia: pannello domande, link alla pagina con evidenziazione, avvertenze, "Interrompi" | 4–5 |
| Test: unità, banco di regressione automatico (riuso di `ricerca-ia/`), prove su 3–4 PC reali | 4–5 |
| Conversione dei modelli dai pesi ufficiali, pubblicazione dei file e degli SHA-256 | 1–2 |
| **Totale v1** | **26–34 (5–6 settimane)** |
| **v2** | |
| Riassunti con map-reduce e interfaccia | 3–4 |
| Estrazione dati: schema, controlli, modulo modificabile | 4–5 |
| Esportazione Titulus / U-GOV (formati da concordare con gli uffici) | 3–5 |
| Test e taratura sul banco (più documenti, scadenze e RUP) | 3 |
| **Totale v2** | **13–17 (circa 3 settimane)** |

## 8. Rischi e limiti dello studio

- **Banco di prova:**
  - 20 documenti e 60 domande sono sufficienti per una scelta, ma ogni domanda vale 1,7 punti percentuali: differenze di 3–5 punti tra modelli non sono significative.
  - Riferimenti e voti li ha preparati un'IA (vedi §1). Prima della v2 conviene allargare il banco a 50–100 documenti e far controllare un campione a un operatore.
- **Hardware:** le misure vengono da un server cloud con la CPU limitata ad AVX2, non da PC d'ufficio reali. I Mac sono stimati, non misurati. Prima del rilascio servono prove su 3–4 PC veri.
- **Modelli giovani:**
  - Gemma 4 e Qwen3.5 usano architetture nuove, supportate da llama.cpp solo nelle versioni del 2026: bisogna fissare la versione di node-llama-cpp e ripetere il banco a ogni aggiornamento.
  - Per i modelli ibridi di Qwen3.5 la cache del prompt funziona a "punti di salvataggio": a ogni domanda rilegge circa 500 token.
- **Conversioni GGUF difettose:** succede, come mostra il caso di e5-small in §3.3. Per questo solo file propri, verificati sul banco e con SHA-256.
- **RAM su PC da 8 GB:** va gestita con la scelta automatica del modello leggero e con la chiusura del processo quando non serve.

## 9. Prossimi passi

1. **Decisioni di Lorenzo:**
   - approvare la scelta (Gemma 4 E2B, più Qwen3.5-2B e granite-embedding-107m);
   - approvare il perimetro della v1.
2. **Prova su PC reali di un ufficio:** un portatile i5 con 8 GB, un desktop con 16 GB, un Mac M1. Si usa `ricerca-ia/script/velocita.py` e `prova-node-llama-cpp.mjs`, circa mezza giornata.
3. **Controllo a campione dei riferimenti** da parte di un operatore (10 documenti) e allargamento del banco con atti dell'ateneo o dell'ente che userà Leggio.
4. **Preparare i file dei modelli:** conversione dai pesi ufficiali, verifica sul banco, pubblicazione su release fissa con SHA-256.
5. **Prototipo v1** su un branch dedicato: utilityProcess, «Chiedi al documento», ricerca per significato.
6. **Riprovare** Phi-4-mini (MIT) e, quando avranno un GGUF ufficiale scaricabile senza account, Velvet2-3B e altri modelli italiani.

---

### Come rifare le misure

Istruzioni in [`ricerca-ia/README.md`](../ricerca-ia/README.md). In sintesi:

```bash
cd ricerca-ia
npm install
bash script/esegui-tutto.sh
python3 script/archivio.py
python3 script/tabelle.py
```

`esegui-tutto.sh` compie, per ogni modello: download con SHA-256, misure di velocità, banco di prova, cancellazione del modello. I modelli non sono nel repository.
