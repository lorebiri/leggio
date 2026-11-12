# Area «modifica»

Modifica del contenuto vero della pagina (non commenti): testo esistente, testo nuovo, immagini, link,
trova e sostituisci, forme. Codice in `src/renderer/features/modifica/`.

## Strumenti

| id | Nome | Cosa fa |
|---|---|---|
| `edit-content` (M, barra rapida) | Modifica testo e immagini | Blocchi di testo modificabili in loco; immagini selezionabili (sposta, ridimensiona, ruota, ritaglia, sostituisci, elimina) |
| `add-text` | Aggiungi testo | Testo come contenuto di pagina; carattere, dimensione, colore, grassetto, corsivo, allineamento; pulsanti «Data di oggi» e «Protocollo» |
| `insert-date` | Inserisci data | Come Aggiungi testo, già compilato con la data di oggi |
| `add-image` | Aggiungi immagine | PNG/JPEG, trascina e ridimensiona con proporzioni bloccate |
| `links` | Link | Crea (rettangolo), modifica, elimina link a sito, pagina o email |
| `auto-links` | Crea link automatici | Rende cliccabili URL ed email scritti nel testo |
| `find-replace` | Trova e sostituisci | Elenco delle occorrenze con contesto, conferma una per una o tutte |
| `draw-shapes` | Disegna forme | Linee, rettangoli, ellissi come contenuto |

## Come funziona la modifica del testo

1. `contentstream.js` – tokenizer/parser del content stream (stringhe annidate ed escape, esadecimali, TJ, dizionari,
   immagini in linea BI/ID/EI). La riscrittura **copia byte per byte** tutto ciò che non viene sostituito.
2. `interpreter.js` – segue CTM, q/Q, stato del testo (Tf Tm Td TD T* Tc Tw Tz TL Ts ' ") e calcola la posizione di
   ogni glifo; entra nei Form XObject (marcandone il contenuto come non riscrivibile); elenca le immagini (`Do`).
3. `fontmodel.js` + `pdfpage.js` – larghezze, Unicode (ToUnicode, codifiche, Differences) e codifica inversa per
   riscrivere con **lo stesso font** (font semplici e Type0 Identity-H; nei sottoinsiemi solo i glifi presenti).
4. `operations.js` – tre livelli, dal più fedele:
   - **in loco**: se cambia un tratto di una sola riga dentro un solo operatore e il font ha i caratteri, si
     sostituiscono solo quei codici (stesso font, stessa posizione, il resto dell'operatore scorre);
   - **riscrittura**: i glifi del blocco sono tolti dal content stream (al loro posto uno spostamento equivalente nel TJ,
     così nient'altro si muove) e il nuovo testo è scritto col font originale se possibile, altrimenti con il font
     standard più simile (Helvetica/Times/Courier) o, per caratteri fuori da WinAnsi, con Liberation Sans (OFL,
     fornito da pdf.js) incorporato;
   - **copertura** (ripiego, con avviso): rettangolo del colore di sfondo campionato + nuovo testo.
5. `verify.js` + `ui/common.js#safePageEdit` – **dopo ogni riscrittura** il PDF è riaperto con pdf.js e il testo fuori
   dalla zona modificata è confrontato carattere per carattere con quello di prima; deve comparire il testo nuovo.
   Se la verifica fallisce si riprova con la copertura; se fallisce ancora la modifica non viene applicata.

## Collaudo

- `npx vitest run test/modifica` – 54 prove: tokenizer (incluso fuzzing di 400 input casuali e 100.000 operatori),
  font, interprete, riscrittura, operazioni su PDF generati (Helvetica, Type0 sottoinsieme, array di stream,
  immagine in linea, Form XObject, stream corrotto, 4.000 operatori di testo), link, verifica, firme, cifratura.
- `LEGGIO_REAL_PDFS=/cartella npx vitest run test/modifica-reali` – prova facoltativa su PDF reali: per ogni pagina
  riscrittura identica, correzione di una parola e riscrittura di blocchi, verifica del resto del testo.
- `LEGGIO_FIXTURES_OUT=/cartella npx vitest run test/modifica` scrive i PDF di prova per il collaudo a mano.

## Limiti noti

- Il testo nei **Form XObject**, nei font **Type3**, nei font con CMap diversa da Identity-H, verticale o senza
  tabella Unicode si modifica solo con la copertura (il testo originale resta nel file, sotto il riquadro: non usare
  questa funzione per nascondere dati riservati — per quello c'è l'oscuramento).
- La correzione in loco non ridistribuisce il testo successivo posizionato in modo assoluto: se la parola nuova è più
  lunga, si passa alla riscrittura del blocco (o, in trova e sostituisci, la riga può sovrapporsi: c'è un avviso).
- I paragrafi sono ricostruiti da pdf.js con regole euristiche: in impaginazioni molto complesse un «blocco» può essere
  una riga sola.
- Il font Unicode di ripiego è solo sans serif (Liberation Sans), incorporato intero (~140 KB): il sottoinsieme di
  fontkit non funziona con quel file.
- Immagini: si modificano quelle disegnate direttamente nella pagina; non quelle in linea (BI/ID/EI) né quelle dentro
  Form XObject. Il ritaglio è un tracciato di ritaglio (i pixel nascosti restano nel file); un'immagine eliminata
  resta tra le risorse finché il file non viene ottimizzato.
- I documenti protetti «solo proprietario» non si modificano finché non si toglie la protezione.
- Il testo ruotato si modifica in un riquadro orizzontale; nel documento resta ruotato.
- Le pagine molto pesanti vengono analizzate nel thread dell'interfaccia (pochi decimi di secondo per 100.000 operatori).
