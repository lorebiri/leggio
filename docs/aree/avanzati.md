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
| `protocol-stamp` | Timbro di protocollo | Ente, ufficio, numero (contatore annuale nelle impostazioni), data, entrata/uscita, classificazione, posizione, prima pagina o tutte. Gestisce le pagine ruotate. |
| `batch` | Azioni guidate | Cartella (anche sottocartelle) o file; sequenze salvabili; scrive in «Elaborati» (mai sugli originali senza conferma); rapporto finale. |
| `create-from-web` | Crea PDF da pagina web o HTML… | BrowserWindow nascosta, sandbox, senza JavaScript per i file locali, timeout. |
| `create-from-office` | Crea PDF da Word, Excel, PowerPoint… | LibreOffice (profilo temporaneo separato, timeout, annullabile); su Windows ripiego su Microsoft Office via PowerShell/COM. Se manca, spiega come installarlo. |
| `search-folder` | Cerca in più PDF | Ignora maiuscole e accenti; file protetti/danneggiati saltati e segnalati; clic → apre alla pagina con la ricerca attiva. |
| `scan-folder` | Crea PDF dalla cartella delle scansioni | Sostituisce l'acquisizione diretta (non possibile senza componenti nativi): osserva la cartella dello scanner ogni 4 s. |
| `split-view` | Vista divisa | Secondo `PDFViewer` affiancato, scorrimento sincronizzabile, larghezza regolabile. |
| `portfolio` | File del portfolio PDF | Avviso automatico all'apertura dei portfolio. |
| `accessibility-prepare` | Prepara per l'accessibilità | Titolo, lingua, testo alternativo, struttura di tag di base (H1/H2/P/Figure/Artifact). Non sostituisce la verifica dell'area che fa il controllo. |

Pannelli: `p7m` (Firme .p7m), `fattura` (Fattura elettronica), `layers` (Livelli). I pannelli `p7m` e `fattura` appartengono al loro documento: passando a un altro documento si torna alle miniature. Impostazione: «riapri i documenti dell'ultima volta» (`avanzati.restoreSession`, attiva).

## Per le altre aree
- **Operazioni nelle azioni guidate**: `app.bus.on('batch:operations', (list) => list.push({ id, label, description, fields, summary(params), runBytes: async (bytes, params, ctx) => nuoviBytes }))`. Così OCR, compressione vera e PDF/A compaiono nell'elenco.
- `app.avanzati.openSignedFile(app, { bytes, name })` e `app.avanzati.openFattura(app, bytes, name)` aprono .p7m e fatture da qualunque punto.

## Limiti noti (onesti)
- Firme: non si controllano revoca (CRL/OCSP) né l'elenco AgID dei certificatori; «verde» solo con certificato qualificato, integrità e validità alla data. Le firme PAdES dentro i PDF sono dell'area sicurezza.
- Accessibilità: ordine di lettura = ordine del flusso; tabelle, elenchi, link e note non riconosciuti; testo dentro XObject modulo = un paragrafo; i PDF già marcati non vengono rimarcati.
- Ricerca: le scansioni senza OCR non sono ricercabili; nessun indice persistente (scansione ogni volta).
- Scansioni: TIFF/HEIC non supportati.
- Office→PDF con Microsoft Office e il percorso Windows non collaudati (sviluppo su macOS).

## Collaudo
`npx vitest run test/avanzati*` (p7m generati con node-forge, FatturaPA, protocollo, azioni guidate, tag letti con pdf.js, livelli, ricerca, sessione, modulo main con LibreOffice simulato).
