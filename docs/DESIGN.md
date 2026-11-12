# Sistema di design di Leggio

Leggio è un **supporto che agevola il lavoro**: l'aspetto serve la chiarezza. Pensiamo a chi viene da Acrobat e passa
la giornata tra fatture, DURC, PEC e protocolli: testi leggibili, gerarchie nette, bersagli grandi, nessuna decorazione
che distragga. Identità: **carta calda** (`--bg #f1efe9`) e **inchiostro verde-azzurro** (`--accent #0f766e`), titoli in
serif di sistema (Iowan Old Style / Palatino), testo in font di sistema, marchio «leggio» (foglio inclinato su un'asta).
Nessun font da internet: l'app è offline.

File:

| File | Contenuto |
|---|---|
| `src/renderer/styles/tokens.css` | tutte le variabili (colori con tema scuro, tipografia, spaziature, raggi, ombre, movimento) |
| `src/renderer/styles/componenti.css` | componenti comuni con classi semplici (pulsanti, campi, segmenti, schede, riquadri di controllo, badge, liste, tabelle, avanzamento) |
| `src/renderer/styles/app.css` | guscio dell'app (barre, pannelli, home, «Tutti gli strumenti», dialoghi, menu, avvisi); importa i due file sopra |
| `src/renderer/core/icons.js` | set di icone |

## Regole per chi scrive CSS in un'area

1. **Mai colori scritti a mano** per testo, fondi e bordi dell'interfaccia: usare le variabili. Un `#fff` o un
   `#7a4100` resta uguale nel tema scuro e lì sparisce o abbaglia. Uniche eccezioni: ciò che sta **sulla pagina PDF**
   (che è bianca in entrambi i temi: riquadri di oscuramento, link, campi proposti, evidenziazioni) — e lì si usa
   `--paper`, `--paper-line`, `--paper-muted` o un colore fisso commentato.
2. **Tema scuro**: non scrivere regole `:root[data-theme="dark"] …` nelle aree. Le variabili cambiano da sole, anche
   con il tema «Come il sistema» (che le regole scritte a mano dimenticavano).
3. **Testo mai sotto 13 px** (`--fs-xs`). Unica eccezione: le etichette sotto le icone di barra e colonna (`--fs-label`, 12,5 px).
4. **Bersagli**: almeno 32 px (`--target`), 36 px con i caratteri grandi; azioni frequenti 40–44 px.
5. **Zoom dell'interfaccia**: dentro barra laterale, pannello destro, finestre e menu le altezze relative alla finestra
   si scrivono `calc(50 * var(--vh))`, non `50vh` (lo zoom moltiplica anche `vh` e la finestra uscirebbe dallo schermo).
6. **Movimento**: solo per mostrare cosa è cambiato (si apre, compare, si conferma), con `--dur-1/2/3`. Niente
   animazioni continue o di richiamo. `prefers-reduced-motion` le spegne tutte (regola globale in `app.css`).
7. **Parole**: le regole sui testi restano quelle di `docs/ARCHITETTURA.md` («Annulla» solo per annullare una modifica,
   «Lascia perdere» per uscire, «Interrompi» per fermare).

## Variabili

### Colori (chiaro → scuro)

| Variabile | Uso | Chiaro | Scuro |
|---|---|---|---|
| `--bg` | carta: fondo dell'app | `#f1efe9` | `#17181b` |
| `--surface` | fogli: barre, pannelli, finestre, schede | `#ffffff` | `#202226` |
| `--surface-2` | barra laterale, campi secondari, righe al passaggio | `#f8f7f3` | `#1b1c20` |
| `--surface-3` | incavi: binario dei segmenti, contatori | `#efede6` | `#141518` |
| `--ink` | testo principale | `#1c1e22` | `#ecebe6` |
| `--ink-2` | testo secondario forte (stato, sottotitoli, etichette dei campi) | `#3f434a` | `#c9cbd0` |
| `--muted` | testo secondario, aiuti | `#5f636b` | `#a7aab1` |
| `--faint` | **solo** decorazioni e icone spente, mai testo | `#8a8d93` | `#72757c` |
| `--border` / `--border-strong` | separatori / contorni di pulsanti | `#e0ddd4` / `#cdc9bd` | `#2f3137` / `#41444b` |
| `--control-border` | contorni di campi, menu a tendina, caselle (≥ 3:1) | `#8f8b80` | `#6b6e76` |
| `--accent` | inchiostro: azione principale, selezione | `#0f766e` | `#3cc7b4` |
| `--accent-soft` / `--accent-text` | fondo attivo / accento usato come testo su quel fondo | `#d8efe9` / `#0b6158` | `#163a36` / `#6fe0cf` |
| `--info`, `--info-soft`, `--info-line` | informazione | `#1d5c96` … | `#8cbcf0` … |
| `--success`, `--success-soft`, `--success-line` | esito positivo | `#067647` … | `#47cd89` … |
| `--warning`, `--warning-soft`, `--warning-line` | da guardare / da fare | `#a33f06` … | `#fdb022` … |
| `--danger`, `--danger-soft`, `--danger-line` | errore, scaduto | `#b42318` … | `#ff8a7a` … |
| `--danger-solid` / `--danger-solid-ink` | pulsante «Elimina», avviso di errore | `#b42318` / bianco | `#c4372b` / bianco |
| `--tint-{blue,amber,green,violet,teal,gray}-{bg,ink,line}` | categorie (tipi di documento, colori dei filtri) | tinte chiare | tinte scure |
| `--mark-bg`, `--mark-ink`, `--hit`, `--hit-current` | parola trovata, risultato corrente | giallo / verde-azzurro | uguali |
| `--paper`, `--paper-line`, `--paper-muted` | cose disegnate su una pagina (miniature, riquadro firma) | bianco | bianco |

### Tipografia

| Variabile | Valore | Uso |
|---|---|---|
| `--font` | font di sistema | tutto il testo |
| `--font-display` | Iowan Old Style, Palatino… | titoli di vista, di sezione, della home |
| `--fs-xs` | 13 px | note, aiuti, didascalie (minimo) |
| `--fs-sm` | 13,5 px | testo secondario, etichette dei campi |
| `--fs-md` | 14 px | testo di base (era 13,5) |
| `--fs-lg` | 15,5 px | titoli di scheda, testo in evidenza |
| `--fs-xl` | 18 px serif | titoli di sezione (con filo) |
| `--fs-2xl` | 23 px serif | titolo di una vista («Archivio d'ufficio», «Tutti gli strumenti») |
| `--fs-3xl` | 44 px serif | titolo della home |

Niente MAIUSCOLETTO per i titoli di sezione (prima «OGGI IN ARCHIVIO»): si usa la classe `.sec-title` (serif, con un
filo che porta lo sguardo verso destra), già applicata a home, «Tutti gli strumenti» e Scheda dell'archivio.

### Spaziature, raggi, ombre, movimento

- Spaziature a passo 4: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 · `--sp-10` 40.
- Raggi per gerarchia: `--radius-sm` 6 (piccoli controlli) < `--radius` 8 (pulsanti, campi) < `--radius-lg` 12 (schede)
  < `--radius-xl` 16 (finestre, viste) · `--radius-pill` per badge e contatori.
- Ombre: `--shadow-1` (scheda sollevata al passaggio), `--shadow-2` (barre che galleggiano sulla pagina),
  `--shadow-pop` (finestre e menu), `--page-shadow`, `--thumb-shadow`.
- Movimento: `--dur-1` 0,12 s (passaggio del mouse), `--dur-2` 0,18 s (comparsa di barre, menu, finestre),
  `--dur-3` 0,26 s (cambi di dimensione, avanzamento); curve `--ease` e `--ease-out`.
- Fuoco: anello `outline: 2px solid var(--focus)` per tastiera; nei campi bordo accento + `--focus-ring`.

## Componenti (classi)

| Cosa | Classi |
|---|---|
| Pulsanti | `.btn` · `.btn.primary` · `.btn.danger` (pieno, per azioni distruttive confermate) · `.btn.danger-soft` · `.btn.ghost` · `.btn.link` · `.btn.on` (premuto) · `.btn.small` / `.btn.big` · `.btn-row` |
| Campi | `.field` > `label` + `input/select/textarea` + `.help` · `.input` / `.select` / `.textarea` · errore: `.field.invalid` o `aria-invalid="true"` + `.field-error`; `.field-ok` |
| Scelte | `.seg` (segmenti, `button.active`) · `.linguette` (schede a linguetta, `button.on` o `aria-selected`) |
| Contenitori | `.card` (`.raised`, `.quiet`) · `.list` > `li` > `.list-item` · `.table` (`th`, `.num`) · `.empty` |
| Riquadri di controllo | `.callout.info` · `.callout.ok` · `.callout.warn` · `.callout.danger` · `.callout.todo` (cosa da fare); icona facoltativa come primo figlio |
| Stato di un documento | `.badge` + `.protocollato` (blu), `.firmato` (verde-azzurro), `.da-pagare` / `.da-fare` / `.in-scadenza` (ambra), `.pagato` / `.valida` (verde), `.scaduto` / `.non-valida` (rosso); oppure `.info .ok .warn .danger .accent` |
| Categoria | `.tag.blue .amber .green .violet .teal` (es. Fattura blu, DURC ambra, Ordine/Contratto verde, Missione viola, PEC verde-azzurro) |
| Esito a semaforo | `.semaforo.ok .warn .danger .info` (punto da 10 px accanto al testo) |
| Contatori | `.count` (`.on` se c'è qualcosa da fare) |
| Avanzamento | `.progress` > `.progress-fill` (`.indeterminate`) · `.progress.slim` |
| Titoli di sezione | `.sec-title` |
| Menu | `app.ui.contextMenu` (stile `.ctx-menu`, voce `.danger`) |

Esempio (Scheda di una fattura):

```html
<p class="callout warn"><svg class="ico">…</svg><span><strong>Da controllare prima di pagare.</strong> Manca il DURC del fornitore.</span></p>
<span class="badge protocollato">Protocollato (Titulus)</span> <span class="badge firmato">Firmato</span> <span class="badge da-pagare">Da pagare</span>
```

## Icone

`icon(nome, misura)` da `core/icons.js`. Regole: griglia 24×24, contenuto tra 3 e 21, **tratto 1,75** in `currentColor`,
estremità e angoli arrotondati, rettangoli con raggio 1,5–2, nessun colore né riempimento (salvo `redact`, `background`).
Le aree possono **aggiungere** icone con `registerIcon(nome, svg)`; i nomi del set del nucleo **non si sostituiscono**
(così il set resta coerente: le icone di pagine e archivio sono state ridisegnate nel nucleo e le loro `registerIcon`
ora non hanno effetto; si possono togliere).

Catalogo (immagine: `~/Developer/leggio-feedback/design/icone-dopo.png`):

- file: `open save saveAs print file export folder copy duplicate paperclip`
- comandi: `search plus minus close check chevron* undo redo rotate rotateLeft trash eraser link settings tools sparkles`
- vista: `sidebar fitWidth fitPage book sun moon pointer hand layers speaker measure info warning clock calendar user`
- pagine: `pages organize pageInsert pageExtract pageDelete pageReplace split merge reverse resize crop nup booklet headerFooter numbering bates background watermark labels bookmark compress compare`
- commenti e modifica: `comment note highlight pen text image shape stamp redact ocr convert form`
- firma e protezione: `signature signed lock shield`
- ufficio e archivio: `archive inbox dossier titulus invoice euro mail pec mission checklist scan`
- sinonimi italiani: `fattura fascicolo missione controlli firmato protocollo scadenza cartella posta`

## Schermate

- **Home**: titolo serif, una riga di presentazione in `--ink-2`, due azioni (Apri un PDF, Tutti gli strumenti),
  poi le sezioni con titolo serif e filo («Oggi in archivio», «Strumenti più usati», «Recenti»). Le schede degli
  strumenti hanno l'icona in un tondo verde-azzurro, nome e descrizione; al passaggio cambia solo il bordo.
- **Tutti gli strumenti**: finestra larga 1100 px, ricerca alta 42 px; categorie con titolo serif e filo; le icone
  non si schiacciano più (prima diventavano pillole strette).
- **Avvisi**: inchiostro rovesciato (scuro nel tema chiaro, chiaro nel tema scuro); l'icona dice il tipo
  (✓ verde, triangolo ambra, «i» blu); l'errore è rosso pieno con testo bianco (prima nel tema scuro era bianco su
  rosa, 2,3:1).
- **Dialoghi**: con i caratteri grandi restano dentro lo schermo (prima il dialogo Impostazioni usciva in alto e in basso).

## Contrasti misurati (WCAG 2.1, rapporto di contrasto)

Calcolati dai valori delle variabili (`AA` = 4,5:1 per il testo, 3:1 per i contorni dei controlli).

| Coppia | Chiaro | Scuro |
|---|---|---|
| Testo principale su carta | 14.52 | 14.87 |
| Testo principale su foglio | 16.69 | 13.35 |
| Testo secondario forte su foglio | 9.94 | 9.81 |
| Testo secondario su carta | 5.24 (prima 4.45: non AA) | 7.63 |
| Testo secondario su barra laterale | 5.62 | 7.32 |
| Testo secondario su accent-soft | 5.01 | 5.33 |
| Pulsante primario (testo) | 5.47 | 7.89 |
| Accento come testo su foglio | 5.47 | 7.60 |
| Accento come testo su accent-soft | 6.09 (prima 4.55) | 7.82 |
| Contorno dei campi su foglio (≥ 3) | 3.40 (prima 1.66) | 3.12 |
| Contorno dei campi su barra laterale (≥ 3) | 3.17 | 3.34 |
| Info su info-soft | 5.92 | 7.35 |
| Ok su success-soft | 4.95 | 7.06 |
| Avviso su warning-soft | 5.76 | 7.51 |
| Errore su danger-soft | 5.59 | 6.60 |
| Errore come testo su foglio | 6.57 | 6.96 |
| Avviso come testo su foglio | 6.42 | 8.66 |
| Pulsante / avviso di errore | 6.57 | 5.35 (prima 2.29) |
| Tipo «Fattura» (blu) | 7.15 | 9.08 (prima chiaro su scuro: illeggibile) |
| Tipo «DURC» (ambra) | 6.06 | 10.20 |
| Tipo «Ordine» (verde) | 6.95 | 10.37 |
| Tipo «Missione» (viola) | 7.95 | 9.65 |
| Tipo «PEC» (verde-azzurro) | 6.70 | 9.96 |
| Etichetta neutra | 8.48 | 10.13 |
| Testo degli avvisi | 14.52 | 14.87 |

Prima `--faint` (#9a9da3, 2,36:1) era usato per testi («oppure trascina qui i file», percorsi dei Recenti): ora quei
testi usano `--muted`.

## Archivio e avanzati

Applicato direttamente a `archivio/archivio.css` e `avanzati/avanzati.css` (dopo la fine del loro ciclo):

- **Tipi di documento** (`.ar-tipo.t-*`) e **etichette di stato** (`.ar-chip.*`) sulle tinte e sugli stati del sistema:
  ora leggibili nel tema scuro. La vecchia regola `:root.dark .ar-tipo` non scattava mai (il tema è `data-theme`).
- **Semaforo «pronta per il pagamento»** (`.ar-semaforo.s-*`, `.ar-chip.pag-*`): riquadro di controllo con il punto
  colorato; verde/ambra/rosso dalle variabili di stato.
- **Scheda** (`.right-content.ar-scheda-doc`): sezioni con titolo serif, coppie etichetta/valore più ariose, Pratica
  con il documento corrente evidenziato. La regola `.ar-scheda-doc` prima valeva anche per la linguetta «Documenti»
  della vista (stessa classe!) e le dava spaziature e caratteri del pannello: ora è limitata al pannello.
- **Oggi**: sezioni vuote su fondo `--surface-2` invece che semitrasparenti; contatori `.ar-num` come `.count`.
- **Controlli** (`.av-controllo`): riquadri di controllo `info`/`avviso` con il segno «i» / «!» a sinistra.
- **Semaforo firme** (`.av-sem-*`), **avvisi** (`.av-warn`), ricerca in più PDF, tabelle: variabili e testo ≥ 13 px.

Da fare nel codice delle aree (non solo CSS, quindi non l'ho toccato):

- `avanzati/ui/controlli.js`: il pannello «Controlli» usa l'icona `check`; meglio `checklist` (o `controlli`).
  `avanzati/ui/fattura.js`: il pannello «Fattura elettronica» usa `file`; meglio `invoice`.
- `archivio/index.js`: `registerIcon('archive', …)` non serve più (l'icona è nel nucleo).
- `pagine/index.js`: le `registerIcon` delle righe 16–33 non servono più.
- `sicurezza/comune.js`: gli stili iniettati hanno colori scritti a mano e il tema scuro solo per `data-theme="dark"`.
  In `app.css` c'è un «ponte» che li riporta alle variabili; quando l'area riprende, usare `.callout.warn/.ok/.danger`
  (o le variabili) e togliere il ponte.
- `sicurezza/comune.js` e `commenti/commenti.css` definivano entrambi `.lg-row` con regole diverse: in commenti ora
  la regola vale solo dentro `.lg-replybox`.
