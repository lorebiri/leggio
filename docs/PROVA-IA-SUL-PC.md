# Provare l'assistente IA sul tuo PC (Windows)

Questa prova serve a capire se i computer dell'ufficio sono abbastanza potenti per l'assistente IA di Leggio. Funziona su **Windows 10 o 11**.

**Cosa misura**

- il processore, compreso il controllo **AVX2** (le istruzioni che servono all'IA);
- la memoria (RAM);
- il tempo che serve per rispondere alle domande su 4 documenti pubblici, già inclusi nel kit.

**Cosa non fa**

- Non legge i tuoi documenti e non installa niente.
- Non invia nulla a nessuno. L'unico collegamento a internet serve a scaricare i due modelli di IA, circa 4,4 GB in tutto. Ogni file viene controllato con la sua impronta SHA-256.

Alla fine sul Desktop trovi un file di testo con i risultati. **Rimandalo per e-mail.**

Tempo: da 20 a 60 minuti per PC, di più se la rete è lenta. Durante la prova il PC sarà lento.

---

## Prima di iniziare (una volta sola, chi prepara il kit)

1. Apri la pagina del progetto su GitHub, scheda **Actions**.
2. A sinistra scegli **«Kit prova IA (Windows)»**.
3. Apri l'esecuzione più recente con il segno verde ✅.
4. In fondo alla pagina, sotto **Artifacts**, fai clic su **Kit-prova-IA-Windows**: si scarica uno zip di qualche decina di MB.
5. Copia lo zip sui PC da provare, con una chiavetta USB o per e-mail.

> Il kit resta scaricabile per 30 giorni. Se è scaduto, si rifà con «Run workflow» nella stessa pagina.

## Sul PC da provare

**Passo 1: estrai il kit**

1. Fai clic con il tasto destro sullo zip e scegli **«Estrai tutto…»**.
2. Scegli una cartella sul **Desktop** o in **Documenti**, poi **Estrai**.
3. Controlla che sul disco ci siano almeno **6 GB liberi**.

> Non avviare la prova dall'interno dello zip senza estrarlo: non funziona.

**Passo 2: collega il portatile alla corrente**

Se il PC è un portatile, collegalo all'alimentatore. A batteria va più piano e i numeri non sono attendibili.

**Passo 3: chiudi i programmi pesanti**

Chiudi i programmi che non servono, soprattutto il browser con molte schede aperte. La posta può restare aperta.

**Passo 4: avvia la prova**

1. Nella cartella estratta, fai **doppio clic su `AVVIA-PROVA.bat`**.
2. Se compare la finestra blu **«PC protetto da Windows»**:
   - fai clic su **«Ulteriori informazioni»**;
   - poi su **«Esegui comunque»**.
   
   Succede perché il file viene da internet e non è firmato.
3. Si apre una finestra nera con le scritte della prova. **Non chiuderla.**

**Passo 5: aspetta**

La prova fa da sola tre cose:

1. **controlla il computer** (processore, AVX2, RAM, disco);
2. **scarica i due modelli** (3,1 GB + 1,3 GB) e ne controlla l'impronta. Vedi una barra di avanzamento. Se riavvii la prova, il download riparte da dove si era fermato;
3. **fa le domande** sui 4 documenti di prova, prima con un modello e poi con l'altro.

Puoi lasciare il PC acceso e fare altro di leggero nel frattempo, ma i tempi misurati saranno un po' peggiori.

**Passo 6: rimanda il risultato**

1. Alla fine si apre da sola la cartella del Desktop, con il file evidenziato. Il file si chiama **`Risultati-prova-IA-AAAAMMGG-HHMM-NNNNN.txt`**.
2. **Mandalo per e-mail così com'è**. Contiene solo:
   - modello del processore, RAM e versione di Windows;
   - tempi e risposte sui documenti di prova.
   
   Non contiene il nome del PC né dell'utente.
3. Premi un tasto per chiudere la finestra nera.

**Passo 7: fai pulizia (facoltativo)**

Cancella la cartella del kit: liberi circa 4,5 GB. Se devi provare un altro PC, copia prima la cartella `modelli` sulla chiavetta: così sull'altro PC non serve scaricare di nuovo.

---

## Se qualcosa va storto

**La prova dice «Questo processore non ha AVX2»**

Il PC è troppo vecchio per l'assistente IA. La prova si ferma subito: **rimanda comunque il file dei risultati**, perché è un'informazione utile.

**Il download non parte o si blocca** (la rete dell'ufficio blocca il sito)

La prova prova prima con `curl` e poi con il servizio di download di Windows, che usa il proxy dell'ufficio. Se non riesce nessuno dei due, scarica i file a mano da un PC con accesso libero a internet, per esempio a casa. Ecco i due indirizzi:

- https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/gemma-4-E2B-it-Q4_K_M.gguf (3,1 GB)
- https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf (1,3 GB)

Poi:

1. copia i due file nella cartella **`modelli`** del kit, senza cambiare il nome;
2. riavvia `AVVIA-PROVA.bat`.

La prova controlla da sola che i file siano quelli giusti.

**L'antivirus blocca o mette in quarantena un file**

I programmi del kit sono quelli ufficiali e gratuiti di llama.cpp, con licenza MIT. La loro impronta è nel file `llama\VERSIONE.txt`. Chiedi all'assistenza informatica di consentire la cartella del kit, oppure prova su un altro PC.

**Il doppio clic su `AVVIA-PROVA.bat` non fa nulla, oppure compare «bloccato dall'amministratore»**

Su alcuni PC gestiti l'avvio di script è vietato. Serve l'assistenza informatica, oppure prova su un altro PC.

**La finestra si chiude subito o compare un errore in rosso**

Rimanda i file `registro-prova.txt` e `registro-server.txt` che trovi nella cartella del kit, insieme a una foto della finestra.

**Il PC ha solo 8 GB di RAM**

Va bene. La prova misura proprio se ce la fa. Chiudi il browser prima di iniziare.

---

## Per chi analizza i risultati

I programmi usati sono:

- `llama-bench` per la velocità di lettura e di scrittura, con 4 thread o meno se il PC ha meno core;
- `llama-server`, con contesto di 8.192 token, per caricamento, RAM di picco (*Peak Working Set*) e tempi reali di estrazione, domande e riassunto.

I modelli sono gli stessi dello studio di fattibilità (`docs/IA-FATTIBILITA.md`, sul ramo `claude/ia-fattibilita`):

- Gemma 4 E2B Q4_K_M, SHA-256 `740185b2…34b8`;
- Qwen3.5-2B Q4_K_M, SHA-256 `aaf42c8b…9223`.

La versione di llama.cpp è b12538, la stessa dello studio.

I documenti di prova, pubblici, sono in `documenti.json`:

- determina del Comune di Pisa;
- circolare INPS n. 92/2025;
- esempio di fattura dell'Università di Ferrara;
- determina del Comune di Verona.

Opzioni per uso tecnico:

- `AVVIA-PROVA.bat -SoloGemma` prova solo il modello principale;
- `-Breve` usa un modello piccolissimo e serve solo al controllo automatico su GitHub.
