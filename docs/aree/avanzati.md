# Area «avanzati»

Funzioni di Acrobat Pro che nessun'altra area copre, più quelle pensate per la Pubblica Amministrazione italiana.
Tutto funziona senza rete (tranne «Crea PDF da pagina web», che scarica la pagina richiesta).

## Strumenti (id)

| id | Nome | Note |
|---|---|---|
| `open-p7m` | Apri file firmato (.p7m)… | CAdES, buste annidate (.p7m.p7m), base64/PEM, `.tsd`, `.m7m`. Verifica crittografica (RSA, RSA-PSS, ECDSA) in un Worker. Il PDF si apre in una scheda con il pannello **Firme (.p7m)**; una fattura XML firmata si apre impaginata. |
| `fattura-elettronica` | Apri fattura elettronica (XML)… | FPA12, FPR12, FSM10, più corpi per file, qualsiasi prefisso di namespace. CIG/CUP evidenziati, scissione dei pagamenti, ritenute, IBAN, allegati estraibili, controlli di coerenza. Nell'app la fattura apre una **scheda sua** (PDF impaginato con `printToPDF`) con il pannello «Fattura elettronica»; nell'anteprima web uno spazio di lavoro con Stampa. |
| `conformity-declaration` | Dichiarazione di conformità all'originale | Testo dell'ufficio (mai inventato), salvato come modello; segnaposto {nome} {qualifica} {data} {luogo} {pagine} {file} {ente}; pagina aggiunta o in calce; spazio firma. |
| `smart-rename` | Rinomina dal contenuto | Tipo, soggetto, numero, data, scadenza (DURC) dal testo; regola personalizzabile; anche nelle azioni guidate («Nome proposto dal contenuto»). |
| `open-eml` | Apri messaggio PEC (.eml)… | daticert.xml in chiaro, messaggio originale (postacert.eml), allegati apribili (PDF, .p7m, fatture, .eml annidati). La firma S/MIME del gestore non è verificata. |
| — | (nessuna segnatura) | **La stampigliatura di protocollo la mette solo Titulus.** Leggio la **legge** (testo o striscia-immagine, `app.services.leggiSegnaturaTitulus`) per gestire meglio i documenti, ma non la appone mai, nemmeno su copie, e non genera numeri. Le funzioni di disegno esistono solo nei test (`test/helpers/segnatura-sintetica.mjs`) per costruire PDF finti. |
| `batch` | Azioni guidate | Cartella (anche sottocartelle) o file; sequenze salvabili; scrive in «Elaborati» (mai sugli originali senza conferma); rapporto finale. |
| `create-from-web` | Crea PDF da pagina web o HTML… | BrowserWindow nascosta, sandbox, senza JavaScript per i file locali, timeout. |
| `create-from-office` | Crea PDF da Word, Excel, PowerPoint… | LibreOffice (profilo temporaneo separato, timeout, annullabile); su Windows ripiego su Microsoft Office via PowerShell/COM. Se manca, spiega come installarlo. |
| `search-folder` | Cerca in più PDF | Ignora maiuscole e accenti; file protetti/danneggiati saltati e segnalati; clic → apre alla pagina con la ricerca attiva. |
| `scan-folder` | Crea PDF dalla cartella delle scansioni | Sostituisce l'acquisizione diretta (non possibile senza componenti nativi): osserva la cartella dello scanner ogni 4 s. |
| `split-view` | Vista divisa | Secondo `PDFViewer` affiancato, scorrimento sincronizzabile, larghezza regolabile. |
| `portfolio` | File del portfolio PDF | Avviso automatico all'apertura dei portfolio. |
| `accessibility-prepare` | Prepara per l'accessibilità | Titolo, lingua, testo alternativo, struttura di tag di base (H1/H2/P/Figure/Artifact). Non sostituisce la verifica dell'area che fa il controllo. |

Pannelli: `p7m` (Firme .p7m), `fattura` (Fattura elettronica), `layers` (Livelli). I pannelli `p7m` e `fattura` appartengono al loro documento: passando a un altro documento si torna alle miniature. Impostazione: «riapri i documenti dell'ultima volta» (`avanzati.restoreSession`, attiva).

## Quinto ciclo: semplicità e niente lavoro perso
- **Mai perdere lavoro**: ogni risultato creato (pratica di missione e sue parti, fascicolo con indice, PDF da web/Office/scansioni) si apre
  prima in una scheda segnata «non salvata» (chiudendola Leggio chiede se salvare); il salvataggio viene dopo («Salva…» nell'avviso).
  Se si annulla la cartella dei giustificativi U-Web la pratica resta aperta e compare «Riprova». I rapporti PDF (verifica firma,
  pubblicazione) si aprono in una scheda se la finestra di salvataggio viene chiusa (`native.js › salvaOApri`, `apriRisultato`).
  Per l'archivio: `app.services.apriFascicolo(docs, opts)` crea il fascicolo e lo apre in una scheda (da usare al posto del salvataggio diretto).
- **Un solo pannello per la fattura**: «Fattura elettronica» non esiste più come pannello; nel riquadro «Controlli» la fattura ha avvisi in alto,
  «Dati da copiare», allegati e firma, e in fondo Salva come PDF / XML, Stampa, Vista compatta.
- **Avvisi più mirati**: un solo «Perché?» per avviso (la fonte compare solo se richiesta). La data di ricezione SdI si prende dall'indice
  dell'archivio (metadati SdI letti dall'archivio; altrimenti data del file, scritta come «stimata»); senza data non si dice nulla. Si corregge
  in linea, senza finestre. «Manca il CUP» solo quando il CUP è dovuto: CUP nell'ordine abbinato o nella pratica (stesso CIG), fattura su un
  progetto (PNRR, investimento), oppure impostazione `avanzati.cup.sempre`.
- **IBAN cambiato**: avviso se l'IBAN della fattura è diverso da quelli delle fatture precedenti dello stesso fornitore (P.IVA). Usa
  `app.services.ibanFornitore(piva, { escludi })` se l'archivio lo offre, altrimenti `app.archivio.cerca({ fornitore, tipo: 'fattura' })` (campo `iban`).

## Riquadro «Controlli» (quarto ciclo)
Un solo pannello laterale (`controlli`) sul documento aperto, al posto di «Dati chiave» e «Dati per Titulus». Parla solo se c'è
qualcosa da dire («Nessun controllo da segnalare» altrimenti); ogni avviso è una frase breve con un'azione (Copia il motivo,
Indica la data di ricezione, Cerca nell'archivio, Apri l'ordine, Cerca la ricevuta F24…) e un «Perché?». In fondo una sola
sezione «Dati da copiare» (Per Titulus, Per U-GOV, ordine abbinato o riconosciuto) e la versione delle regole con le fonti.
Nessuno strumento nuovo. Leggio segnala soltanto: non rifiuta fatture (lo si fa in U-GOV).

| Controllo | Regola (file `dati/regole-ufficio.json`, fonte e data per ciascuna) |
|---|---|
| Giorni per accettare o rifiutare | 15 dalla consegna SdI; la data di ricezione si chiede una volta (o si legge dai metadati SdI) |
| CIG / CUP mancanti o non validi | indicati come causa di rifiuto ammessa (art. 25 DL 66/2014; DM 132/2020); CUP solo come «se l'acquisto è su un progetto» |
| Nota di credito senza fattura collegata | manuale CNR fatturazione elettronica |
| Scissione dei pagamenti con ritenuta; fornitore estero con split | art. 17-ter DPR 633/72, DL 87/2018 |
| Bollo mancante sulle fatture esenti | 2 € oltre 77,47 € di importi senza IVA (Agenzia Entrate) |
| Abbinamento fattura ↔ ordine/determina (anche ODA, TD, RdO MePA) | CIG, numero d'ordine citato in fattura, P.IVA; avviso se l'imponibile supera l'ordinato. Cerca nell'indice dell'archivio (`app.archivio.cerca` + `documento`) |
| Bollo sui contratti | All. I.4 d.lgs. 36/2023 (fasce 40/120/250/500/1.000 €); cerca la ricevuta F24 con codice 1573 tra i documenti con lo stesso CIG |
| DURC scaduto o in scadenza | validità dal file di regole (120 giorni, da verificare) |

Le regole aggiornate si caricano da un file JSON con la stessa struttura («Aggiorna le regole da un file…» in fondo al riquadro).

**Dati per U-GOV**: soggetto, P.IVA/CF, tipo, numero, data, descrizione, imponibile, IVA, totale, esigibilità IVA, natura, CIG, CUP,
riferimento ordine, fattura collegata, ritenuta, scadenza, IBAN. L'ordine segue la registrazione della fattura passiva come descritta
nelle fonti pubbliche (manuale e Compendio U-GOV): **va confermato con un utente U-GOV**.

**Pratica di missione → giustificativi per U-Web**: opzione «Anche un file per ogni spesa»: un PDF per spesa (`nn_data_tipo_importo.pdf`),
tipo di spesa, data, importo e pagamento letti con l'OCR, tipo di allegato U-Web proposto; avviso per le spese che sembrano pagate in
contanti (L. 207/2024 art. 1 c. 81 → «Pagamento non tracciabile»). Leggio propone, non calcola il rimborso.

**Liste di controllo** (acquisti, PNRR): spente di default (`avanzati.liste.attive`), modificabili nelle Impostazioni (una voce per riga:
`testo | parole da cercare | fonte`; `§CUP` = CUP su ogni documento). Servizio per l'archivio, che le mostra nella pratica:
`app.services.listeControllo.{ attive(), modelli(), valuta(id, documenti[{nome,testo}]), doppioUtilizzo(fatture[{progetto,piva,numero,data}]) }`.

## Titulus (protocollo informatico del CNR)
- **Segnatura**: `lib/titulus.js › segnatureTitulus(testo, { modelli, origine, mascheraUor })` / `segnaturaTitulus` →
  `{ aoo, numero (com'è scritto, con gli zeri), numeroIntero, data (ISO), dataTesto, uor, anno, classifica, fascicolo, testo, origine: 'testo'|'immagine' }`
  (`numeroOriginale` = `numero`, per compatibilità). Modello predefinito sul formato reale: `Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001`,
  più modelli generici (AOO prima di «Prot.», «Protocollo n°», numero/anno, data prima, testo su più righe). Modelli configurabili nelle
  Impostazioni (uno per riga, gruppi `(?<numero>)` e `(?<data>)` obbligatori; sensibili alle maiuscole).
- **Servizi**: `app.services.segnaturaTitulus(testo)` (sincrono, solo testo) e `app.services.leggiSegnaturaTitulus(bytes, { password, signal })`
  (PDF o .p7m; asincrono): prima il testo della pagina 1, poi la **striscia-immagine** sul margine — `trovaStrisce` (rapporto ≥ 8:1, entro 15 mm
  dal bordo) → rendering solo di quella zona a ~500 ppi → bianco/nero (rosso = inchiostro, linee lunghe tolte) → OCR (`creaWorkerOcr`, una riga,
  caratteri limitati) nei due versi (±90°) → `ripulisciOcr` → modelli. La UOR letta dall'immagine si corregge con una maschera
  (`AA999999` predefinita, da un solo esempio: da verificare). Il documento non viene modificato (si lavora su una copia dei byte).
  Collaudo: fixture sintetica (striscia rossa come immagine, numero e UOR inventati) e un documento reale protocollato (solo in locale, non nel
  repository): riconosciuti numero, data e UOR esatti in circa 0,6–0,9 s, file invariato.
- **Prepara per Titulus** (`prepare-titulus`): per ogni file controlla leggibilità, password, firme (PAdES/CAdES, con verifica dei .p7m), PDF/A
  (metadati XMP), dimensione (soglia nelle Impostazioni, 30 MB predefinita: da verificare con il limite di Titulus) e nome; converte in PDF/A
  (`app.services.pdfa`) e riduce (`app.services.compress`) solo i file NON firmati; copie in «Per Titulus» più rapporto PDF e CSV. Nessun
  collegamento di rete a Titulus.
- Le Azioni guidate non hanno più l'operazione «protocollo» (numerazione progressiva).
- **Stato d'archivio**: applicando la segnatura su una copia (casella «Segna il documento in archivio…»), o accettando la proposta che compare
  aprendo un documento che porta già la segnatura, si emette
  `app.bus.emit('archivio:stato', { path, nome, modifica: { imposta: 'protocollato', numeroProtocollo, dataProtocollo /* ISO */ }, origine: 'segnatura'|'lettura', ricevuto: false })`;
  l'archivio, se trova il documento, imposta `ricevuto = true` in modo sincrono (altrimenti Leggio dice di cambiare lo stato a mano).
  `path` è il file ORIGINALE (anche per una fattura impaginata da XML o un PDF estratto da .p7m). L'area archivio ascolta l'evento e applica
  la modifica al documento con quel percorso. La segnatura predefinita è la striscia verticale a sinistra (non copre numero e data della fattura).
- **Dati per Titulus** (nel riquadro «Controlli»): oggetto proposto, mittente, P.IVA, numero e data del documento, CIG/CUP, importo, firmatari; «Copia»
  per ciascuno e «Copia tutto». Da FatturaPA (dati esatti) o dal testo (da controllare). `lib/titulus.js › datiPerTitulus`, `testoDatiTitulus`.

## Flussi dell'ufficio amministrativo (terzo ciclo)

| id | Nome | Criterio di accettazione (verificato) |
|---|---|---|
| `mission-file` | Pratica di missione (soglia PEC: `app.services.sogliaPec()` o l'impostazione `sic.pec.limitMB`) | Modulo PDF + foto (JPG/PNG, HEIC su macOS) in qualunque ordine → riordino con frecce, ↻ per foto storte; foto girate secondo l'EXIF e ritagliate ai margini bianchi; OCR se c'è `app.services.ocr`; riduzione sotto la soglia con `app.services.compress`; se non basta, proposta «parte k di N» con ogni parte sotto soglia; pagina di riepilogo con numero di pagina di ogni giustificativo; nome `Missione_COGNOME_aaaa-mm-gg.pdf`. Dopo aver scelto i file: 2 clic (Crea la pratica, Salva). |
| `dossier-index` | Fascicolo con indice (avvisa dei DURC scaduti prima di unire; nell'indice i .p7m riportano i firmatari e l'esito) | N documenti (anche .p7m e foto) → PDF con pagina/e indice (voce, numero di documento, pagina iniziale), voci cliccabili, un segnalibro per documento, «Allegato n. k» sulla prima pagina, numerazione facoltativa; i file illeggibili non fermano il fascicolo e vengono elencati. |
| `reporting-package` | Pacchetto per la rendicontazione | Cartella con una sottocartella per voce → `Rendicontazione/Voce_<voce>.pdf` (fascicolo con indice e allegati numerati) e `Riepilogo_rendicontazione.csv` (voce, n. allegato, file, pagine, pagina nel PDF, data, importo, CIG, CUP; «;» e virgola decimale, apribile in Excel; totali per voce). |
| `publish-ready` | Pronto per la pubblicazione | Pannello a destra, passi in ordine sul documento attivo: oscura dati personali (servizio `oscuraDatiPersonali` se esiste, altrimenti «Cerca e oscura»), `sanitize`, prepara accessibilità, `pdfa`, `controllaAccessibilita`; salva `<nome>_pubblicabile.pdf` e `<nome>_pubblicabile_rapporto.pdf` con esiti, controlli e SHA-256. Ogni passo è annullabile. |
| `entity-profile`, `insert-entity`, `fill-entity` | Profilo dell'ente | Denominazione, sigla, ufficio, sede, CF, P.IVA (verificata), codice IPA, codice univoco ufficio, PEC, direttore, firmatari. Estende il profilo personale dell'area moduli (completa ente/P.IVA/ufficio se vuoti, non sovrascrive). Un clic: inserimento sulla pagina, compilazione dei campi dei moduli (solo campi dell'ente; il codice fiscale personale resta all'area moduli), proposto nella segnatura su copia di lavoro e nella dichiarazione di conformità. Servizi: `app.services.profiloEnte()`, `app.services.profiloCompleto()`. |
| pannello `dati-chiave` | Dati chiave | CIG, CUP, P.IVA e CF (con carattere di controllo), IBAN (mod 97), totale e importi, scadenze, ognuno con «Copia»; «Copia tutti i dati». DURC: scadenza letta o calcolata (data richiesta + giorni da impostazione, 120 predefiniti, da verificare): rosso se scaduto. |

## Azioni guidate: formato delle operazioni delle altre aree
```js
app.bus.on('batch:operations', (list) => list.push({
  id, label, description, fields /* come app.ui.dialog */, summary(params) /* testo breve */, validate?(params) /* → errore|null */,
  last?: true /* deve essere l'ultima (es. proteggi) */,
  runBytes: async (bytes, params, ctx) => nuoviBytes,
}));
// ctx: { index, name, signal /* AbortSignal: interrompersi anche a metà file */, scriviFile(nome, bytes) /* altri file accanto al risultato */, note /* testo per il registro */ }
```
- Le operazioni NON devono conservare stato tra un file e l'altro: dopo un'interruzione il lavoro riparte dal primo file non fatto con gli stessi `params` (le password dell'operazione `proteggi` non vengono salvate e si richiedono alla ripresa).
- Un'operazione registrata con lo stesso `id` sostituisce la nostra. Se un'area espone il servizio ma non registra l'operazione, Leggio la offre sopra il servizio: `ocr`, `comprimi-sotto` (salvo `riduci`), `pdfa`, `sanifica`, `oscura-modelli`, `proteggi` (`app.services.protect`; Leggio non ha più una cifratura propria).
- Errori: `SkipError` (o qualunque errore) → il file viene segnato «saltato»/«non riuscito» con il messaggio, gli altri proseguono.

## Azioni guidate: fatture elettroniche
- Accettano `.xml` FatturaPA e `.p7m` (con XML o PDF dentro): le operazioni ricevono il PDF impaginato (o il PDF contenuto nel .p7m); gli
  originali firmati non si toccano. XML che non sono fatture: saltati con il motivo.
- Operazioni: «Salva come PDF (fatture elettroniche)», «Rinomina dal contenuto» (per le fatture `Fattura_FORNITORE_n…_data.pdf` dai dati
  dell'XML), «Estrai dati in Excel» (`dati_estratti_<id>.csv` accanto al registro: una riga per documento, importi come numeri; dalle fatture
  dati esatti, dai PDF letti dal testo). I dati restano nel lavoro: la ripresa li conserva.
- Nomi senza doppioni nello stesso lavoro (` (2)`), stabili anche alla ripresa (`registro.js › nomeUnico`).
- Servizio `app.services.fatturaPdf(bytes) → bytes` (XML o .p7m; solo app desktop).

## Azioni guidate su migliaia di file
- Nessun limite basso: fino a 200.000 file per cartella; l'interfaccia mostra al massimo 400 righe dell'elenco e, nel rapporto, tutti i problemi (fino a 500) più un campione dei riusciti.
- Stato del lavoro salvato nel profilo dell'app (`avanzati-azioni-guidate.json`, canali `job-save|load|clear`) al più ogni 3 s: dopo una chiusura o un annullamento, riaprendo «Azioni guidate» compare «Riprendi (N file)».
- Registro completo `Elaborati/registro_azioni_guidate_<id>.csv` (esito, file, dettagli, destinazione, durata).
- Le uscite in «Elaborati» sovrascrivono quelle con lo stesso nome (così la ripresa non crea doppioni); gli originali non si toccano mai senza conferma.
- Misure (MacBook, app Electron, 12/11/2026):
  - 1.000 PDF di 3 pagine in 60 sottocartelle (4 rotti, 4 protetti): elenco della cartella 0,3 s; numeri di pagina + filigrana + metadati in circa 1 s in tutto; 992 fatti, 8 saltati con il motivo.
  - 1.000 PDF scansionati da 2 pagine con foto (230 MB, 3 rotti) con «Riduci dimensioni» (area sicurezza) + numeri di pagina: interrotto a 415 file, ripreso dalla proposta «Riprendi (585 file)»; in tutto 60 ms per file in media, 997 fatti e 3 non riusciti, uscita 125 MB, registro di 1.000 righe, nessun doppione.

## Moduli puri in `lib/` (usati in sola lettura anche dall'area «archivio»)
`cades.js` (openP7m, overallStatus, innerName, sniff, looksLikeP7m), `fattura.js` (parseFattura, fatturaHtml, nomeProposto, isFattura), `xml.js`, `der.js`,
`datichiave.js` (estraiDati(testo,{oggi,durataDurc}), partitaIvaValida, codiceFiscaleValido, ibanValido, importo, riepilogoTesto, DURATA_DURC_GIORNI),
`rinomina.js` (analizza, proponiNome, trovaDate), `mime.js` (parseMime, parseDaticert, attachments, bodyText, summary), `ente.js`, `fascicolo.js` (creaFascicolo),
`missione.js`, `rendiconto.js`, `registro.js`, `batch-ops.js`, `protocollo.js` (senza contatore: `contatoreCorrente`/`avanzaContatore` tolte), `titulus.js`, `conformita.js`, `tagger.js`, `textsearch.js`, `report.js`.
Le firme non cambiano senza avviso nel rapporto del ciclo.

## Per le altre aree
- `app.avanzati.openSignedFile(app, { bytes, name })` e `app.avanzati.openFattura(app, bytes, name)` aprono .p7m e fatture da qualunque punto.

## Limiti noti (onesti)
- Firme: non si controllano revoca (CRL/OCSP) né l'elenco AgID dei certificatori; «verde» solo con certificato qualificato, integrità e validità alla data. Le firme PAdES dentro i PDF sono dell'area sicurezza.
- Accessibilità: ordine di lettura = ordine del flusso; tabelle, elenchi, link e note non riconosciuti; testo dentro XObject modulo = un paragrafo; i PDF già marcati non vengono rimarcati.
- Ricerca: le scansioni senza OCR non sono ricercabili; nessun indice persistente (scansione ogni volta).
- Scansioni: TIFF/HEIC non supportati.
- Office→PDF con Microsoft Office e il percorso Windows non collaudati (sviluppo su macOS).

## Collaudo
`npx vitest run test/avanzati*` (p7m generati con node-forge, FatturaPA, protocollo, azioni guidate, tag letti con pdf.js, livelli, ricerca, sessione, modulo main con LibreOffice simulato).
