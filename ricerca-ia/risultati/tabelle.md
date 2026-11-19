### Velocità e memoria (CPU, 4 thread, build AVX2)

| Modello | File | Lettura documento (tok/s) | Scrittura risposta (tok/s) | Pronto a freddo | RAM di picco | Tempo medio per documento | Documento lungo (map-reduce) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 E2B | 2,89 GB | 206 | 12,9 | 4,5 s | 4,2 GB | 89 s | 294 s |
| Qwen3.5-4B | 2,55 GB | 42 | 7,0 | 5,2 s | 4,4 GB | 269 s | 897 s |
| Qwen3.5-2B | 1,19 GB | 112 | 15,6 | 2,5 s | 2,0 GB | 108 s | 374 s |
| Ministral 3 3B | 2,00 GB | 44 | 9,4 | 14,6 s | 4,3 GB | 310 s | 1028 s |
| Granite 4.1 3B | 1,96 GB | 44 | 9,7 | 4,8 s | 4,1 GB | 256 s | 947 s |
| Velvet-2B (italiano) | 1,29 GB | 76 | 11,0 | 2,4 s | 2,6 GB | 149 s | 502 s |
| Qwen3.5-0.8B | 0,50 GB | 235 | 32,0 | 1,5 s | 0,9 GB | 54 s | 189 s |

### Qualità sul banco di prova (20 documenti, 60 domande)

| Modello | Estrazione: campi giusti | Estrazione: valori inventati | Domande (documento intero): giuste / con pagina giusta | Domande (RAG): giuste / con pagina giusta | Riassunto: fedeltà | copertura | italiano | Riassunti con invenzioni |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 E2B | 79% | 7% | 98% / 93% | 88% / 87% | 4,80 | 2,80 | 4,80 | 10% |
| Qwen3.5-4B | 85% | 4% | 100% / 95% | 88% / 87% | 4,05 | 3,40 | 4,60 | 75% |
| Qwen3.5-2B | 74% | 6% | 95% / 81% | 85% / 85% | 3,65 | 3,05 | 4,10 | 70% |
| Ministral 3 3B | 76% | 5% | 98% / 86% | 88% / 80% | 3,85 | 3,80 | 3,75 | 55% |
| Granite 4.1 3B | 76% | 14% | 90% / 69% | 83% / 75% | 3,45 | 2,75 | 3,90 | 80% |
| Velvet-2B (italiano) | 31% | 39% | 51% / 33% | 50% / 38% | 3,75 | 2,50 | 3,40 | 55% |
| Qwen3.5-0.8B | 45% | 15% | 62% / 45% | 62% / 58% | 3,50 | 2,65 | 3,30 | 75% |

### Estrazione: campi giusti per tipo di dato

| Modello | oggetto | importo | CIG | CUP | scadenze | controparte | RUP | JSON valido |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 E2B | 90% | 75% | 100% | 95% | 55% | 70% | 70% | 100% |
| Qwen3.5-4B | 90% | 75% | 100% | 100% | 70% | 75% | 85% | 100% |
| Qwen3.5-2B | 90% | 65% | 95% | 95% | 65% | 45% | 65% | 100% |
| Ministral 3 3B | 95% | 70% | 100% | 100% | 55% | 30% | 80% | 100% |
| Granite 4.1 3B | 75% | 55% | 95% | 85% | 80% | 55% | 90% | 100% |
| Velvet-2B (italiano) | 45% | 20% | 20% | 15% | 75% | 15% | 25% | 95% |
| Qwen3.5-0.8B | 80% | 60% | 45% | 45% | 45% | 10% | 30% | 95% |

### Tempi per singola operazione (medie)

| Modello | Estrazione | Riassunto | Domanda sul documento intero (documento già letto) | Domanda con RAG |
|---|---:|---:|---:|---:|
| Gemma 4 E2B | 102 s | 16 s | 4,4 s | 7,8 s |
| Qwen3.5-4B | 312 s | 44 s | 14,4 s | 24,0 s |
| Qwen3.5-2B | 124 s | 21 s | 6,5 s | 9,9 s |
| Ministral 3 3B | 359 s | 71 s | 11,1 s | 24,0 s |
| Granite 4.1 3B | 336 s | 42 s | 6,9 s | 23,1 s |
| Velvet-2B (italiano) | 140 s | 18 s | 4,9 s | 10,5 s |
| Qwen3.5-0.8B | 63 s | 10 s | 3,4 s | 4,7 s |

### Modelli di embedding

| Modello | File | Passaggio giusto tra i primi 5 (domande) | idem, ibrido con BM25 | Archivio: documento giusto al 1° posto | Archivio: tra i primi 3 | Indicizzazione | RAM |
|---|---:|---:|---:|---:|---:|---:|---:|
| BM25 (ricerca per parole, nessun modello) | — | 100% | — | 55% | 80% | — | — |
| multilingual-e5-small (MIT) | 126 MB | 93% | 98% | 75% | 85% | 20,6 passaggi/s | 300 MB |
| multilingual-e5-small, altra conversione GGUF (difettosa) | 126 MB | 67% | 83% | 5% | 15% | 25,3 passaggi/s | 221 MB |
| granite-embedding-107m-multilingual (Apache) | 115 MB | 93% | 98% | 70% | 85% | 39,3 passaggi/s | 291 MB |
| granite-embedding-278m-multilingual (Apache) | 289 MB | 93% | 98% | 75% | 80% | 7,4 passaggi/s | 486 MB |
| Qwen3-Embedding-0.6B (Apache) | 610 MB | 95% | 97% | 85% | 90% | 1,2 passaggi/s | 1638 MB |
