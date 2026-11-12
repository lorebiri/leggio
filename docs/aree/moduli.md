# Area «moduli» — moduli compilabili e firme

## Strumenti (categoria `moduli`)
| id | Nome (come Acrobat) | Cosa fa |
|---|---|---|
| `fill-sign` (rapido) | Compila e firma | Clic ovunque per scrivere (anche su moduli non compilabili); ✓ ✗ ●, data di oggi, iniziali, firma, «Dati personali». Il testo si aggancia alle righe `____`, i segni si centrano nelle caselle ☐. Elementi spostabili/ridimensionabili; «Applica» o «Fine» li scrive nel contenuto della pagina (annullabile). |
| `sign` (rapido) | Firma | Firma in due clic: la firma salvata compare subito al centro della pagina, si trascina e basta. |
| `form-editor` | Prepara modulo | Crea campi (testo con formato importo/data/email, casella, pulsanti di opzione, elenco a discesa, casella di riepilogo, pulsante, campo firma); sposta/ridimensiona/elimina/rinomina campi esistenti; proprietà. **Riconosci campi** dal testo (`____`, `☐`/`[ ]`, «Nome:», «Data:», «Firma»). |
| `flatten-form`, `reset-form` | Appiattisci / Reimposta modulo | |
| `export-form-data`, `import-form-data` | Esporta / Importa dati | CSV (punto e virgola, per Excel italiano), JSON, XFDF, FDF. |
| `export-forms-csv` | Esporta dati di più moduli | Un CSV con una riga per modulo. |
| `autofill-profile`, `personal-data` | Compila con i miei dati | Profilo locale (nome, CF, ufficio, ente…) → campi riconosciuti dal nome, con conferma. |
| `digital-sign` | Usa un certificato | .p12/.pfx → PAdES (ETSI.CAdES.detached o adbe.pkcs7.detached) visibile (riquadro trascinato, con firma grafica facoltativa) o invisibile; oppure busta CAdES `.p7m`. |
| `sign-batch` | Firma più file | Una password per molti file; copie `_firmato.pdf` / `.p7m` accanto agli originali, mai sovrascritti. |
| `create-digital-id` | Crea ID digitale | Certificato autofirmato RSA 2048 → .p12. |
| `verify-signatures` | Verifica firme | Pannello con verdetto in italiano, dettagli, «Mostra nel documento», rapporto PDF esportabile. |
| `open-p7m` | Apri file firmato .p7m | Verifica la busta (anche annidata o in Base64) e apre il PDF contenuto; anche trascinando un `.p7m`. |

Barra informativa sopra il documento: campi compilabili (Evidenzia campi, Compila con i miei dati) e documento firmato (avviso prima di modificarlo, Pannello firme).

## Struttura
- `lib/` logica pura testata: `formdata.js` (formati dati), `detect.js` (riconoscimento campi), `geom.js` (rotazioni, tratti, sfondo firma), `store.js` (firme e profilo in localStorage).
- `board.js` elementi posizionati sugli overlay (modello in coordinate PDF, ridisegno su `page:rendered`).
- `fillsign.js`, `sigpad.js`, `profile.js`, `formeditor.js`, `formtools.js`, `digital.js`, `bridge.js`.
- `electron/features/moduli.cjs` (main): canali `feat:moduli:sign | sign-p7m | sign-batch | describe-id | create-id | verify | verify-p7m`; risposta sempre `{ok, result}` o `{ok:false, error, code}`.

## Firma digitale: garanzie
- Aggiornamento **incrementale** (xref classica o a flusso, come l'originale): i byte originali restano identici; le firme precedenti restano valide.
- Prima di restituire il risultato: controllo che il prefisso sia intatto, riapertura con pdf-lib, verifica della nuova firma (integrità, firma, copertura del file).
- CMS costruito con ASN.1 (node-forge) e firmato con `crypto` di Node: attributi contentType, messageDigest, signingCertificateV2 (ESS), signingTime solo per adbe/p7m. Chiavi RSA ed ECDSA.
- Verificato con strumenti indipendenti: `pdfsig` (poppler) «Signature is Valid» su entrambe le firme; `openssl cms -verify` sul `.p7m` con contenuto identico.
- Verifica offline: niente controllo di revoca (CRL/OCSP) né elenco di fiducia AgID/EU — lo dice il verdetto.

## Limiti noti
- Smart card/token (CNS, firma qualificata) e firma remota non ancora supportati: vedi il rapporto per la proposta.
- Firmare un PDF protetto da password non è possibile (messaggio che chiede di togliere la protezione).
- Le modifiche fatte con gli altri strumenti (pdf-lib) riscrivono il file e invalidano le firme: la barra lo avvisa.
- Testo non rappresentabile in WinAnsi (es. greco, cinese) in «Compila e firma» diventa «?» (solo font standard, nessun font incorporato).
- Il riconoscimento dei campi usa il testo, non le linee disegnate senza testo.
