# ricerca-ia: banco di prova per l'IA locale in Leggio

Materiale dello studio di fattibilità descritto in [`docs/IA-FATTIBILITA.md`](../docs/IA-FATTIBILITA.md). **Non fa parte dell'app**: niente di questa cartella viene impacchettato in Leggio.

## Contenuto

| Percorso | Cosa contiene |
|---|---|
| `banco/ELENCO.md` | i 20 documenti pubblici usati, con fonte e URL |
| `banco/testi/` | testo estratto pagina per pagina con pdf.js (funzione `estraiTesto` di Leggio) |
| `banco/riferimenti/` | risposte giuste preparate in anticipo: campi, 3 domande con pagina, riassunto, punti chiave |
| `banco/ricerca-archivio.json` | 20 richieste parafrasate per provare la ricerca nell'archivio |
| `banco/pdf/` | i PDF (non nel repository: si riscaricano dagli URL di ELENCO.md) |
| `script/estrai.mjs` | PDF → `banco/testi/` |
| `script/verifica-riferimenti.mjs` | controlla che i riferimenti compaiano davvero nel testo e nella pagina indicata |
| `script/comune.py` | avvio di `llama-server`, misura di caricamento e RAM, suddivisione in passaggi |
| `script/velocita.py` | `llama-bench`, caricamento a freddo e a caldo, RAM di picco |
| `script/valuta.py` | banco di prova di un modello: estrazione, riassunto, domande con documento intero e con RAG |
| `script/punteggi.py` | punteggi automatici (i criteri sono scritti in testa al file) |
| `script/prepara-giudizio.py` | valutazione alla cieca dei riassunti (anonimizzazione e unione dei voti) |
| `script/embedding.py`, `script/archivio.py` | confronto dei modelli di embedding |
| `script/prova-node-llama-cpp.mjs` | prova dello stesso motore dentro Node/Electron |
| `script/tabelle.py` | tabelle del rapporto → `risultati/tabelle.md` |
| `script/esegui-tutto.sh` | tutto in sequenza, un modello alla volta |
| `risultati/` | risultati grezzi (`grezzi/*.jsonl`), punteggi, voti dei riassunti, SHA-256 dei modelli |

## Rifare le misure

Requisiti: Linux o macOS, Node 22, Python 3.11+ con `requests` e `numpy`, cmake e un compilatore C++.

```bash
# 1. llama.cpp solo CPU, con AVX2 e senza AVX-512 (per simulare un PC d'ufficio)
git clone https://github.com/ggml-org/llama.cpp ~/ia-lavoro/llama.cpp
cd ~/ia-lavoro/llama.cpp
cmake -B build-avx2 -DGGML_NATIVE=OFF -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_AVX512=OFF -DLLAMA_CURL=OFF
cmake --build build-avx2 -j --target llama-server llama-bench

# 2. dipendenze di questa cartella
cd leggio/ricerca-ia && npm install

# 3. modelli di embedding (in ~/ia-lavoro/modelli, fuori dal repository; URL e SHA-256 in risultati/sha256.txt)

# 4. banco completo (scarica, misura e cancella un modello alla volta)
bash script/esegui-tutto.sh
python3 script/embedding.py && python3 script/archivio.py
python3 script/prepara-giudizio.py        # poi voti in risultati/giudizio/voti.json
python3 script/prepara-giudizio.py --unisci
python3 script/tabelle.py
```

Variabili utili: `IA_LAVORO` (cartella di modelli e log, default `/home/user/ia-lavoro`), `LLAMA_BIN` (cartella dei binari di llama.cpp), `IA_THREAD` (default 4), `TIENI=1` (non cancella i modelli dopo la prova).

I modelli (file `.gguf`) **non vanno mai nel repository**: sono esclusi da `.gitignore`.
