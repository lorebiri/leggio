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
| `digital-sign` | Usa un certificato | Certificato del sistema o della smart card («Firmatario di sistema»), file .p12/.pfx, oppure il programma di firma installato → PAdES (ETSI.CAdES.detached o adbe.pkcs7.detached) visibile (riquadro trascinato, con firma grafica facoltativa) o invisibile; oppure busta CAdES `.p7m`. |
| `sign-batch` | Firma più file | Un solo PIN/password per molti file (le firme sono chieste in un'unica operazione); copie `_firmato.pdf` / `.p7m` accanto agli originali, mai sovrascritti. |
| `create-digital-id` | Crea ID digitale | Certificato autofirmato RSA 2048 → .p12. |
| `verify-signatures` | Verifica firme | Pannello con verdetto in italiano, dettagli, «Mostra nel documento», rapporto PDF esportabile. |
| `sign-external` | Firma con il programma installato | Apre il documento in Dike, ArubaSign, FirmaOK… e osserva la cartella: il file firmato (`.p7m` o PDF firmato) viene riaperto da solo. |

I file `.p7m` (apertura, trascinamento) sono gestiti dall'area «avanzati»; la verifica CAdES è `feat:moduli:verify-p7m`.

Barra informativa sopra il documento: campi compilabili (Evidenzia campi, Compila con i miei dati) e documento firmato (avviso prima di modificarlo, Pannello firme).

## Struttura
- `lib/` logica pura testata: `formdata.js` (formati dati), `detect.js` (riconoscimento campi), `geom.js` (rotazioni, tratti, sfondo firma), `store.js` (firme e profilo in localStorage).
- `board.js` elementi posizionati sugli overlay (modello in coordinate PDF, ridisegno su `page:rendered`).
- `fillsign.js`, `sigpad.js`, `profile.js`, `formeditor.js`, `formtools.js`, `digital.js`, `bridge.js`.
- `electron/features/moduli.cjs` (main): canali `feat:moduli:sign | sign-p7m | sign-batch | describe-id | list-system-ids | create-id | verify | verify-p7m | external-apps | external-choose | external-sign | external-cancel` (evento `feat:moduli:external-result`); le richieste di firma portano `credential: { type:'p12', p12, password } | { type:'system', id }`; risposta sempre `{ok, result}` o `{ok:false, error, code}`.

## Firma digitale: garanzie
- Aggiornamento **incrementale** (xref classica o a flusso, come l'originale): i byte originali restano identici; le firme precedenti restano valide.
- Prima di restituire il risultato: controllo che il prefisso sia intatto, riapertura con pdf-lib, verifica della nuova firma (integrità, firma, copertura del file).
- CMS costruito con ASN.1 (node-forge) e firmato con `crypto` di Node: attributi contentType, messageDigest, signingCertificateV2 (ESS), signingTime solo per adbe/p7m. Chiavi RSA ed ECDSA.
- Verificato con strumenti indipendenti: `pdfsig` (poppler) «Signature is Valid» su entrambe le firme; `openssl cms -verify` sul `.p7m` con contenuto identico.
- Verifica offline: niente controllo di revoca (CRL/OCSP) né elenco di fiducia AgID/EU — lo dice il verdetto.

## Firmatario di sistema (smart card, token, certificati installati)
Nessuna dipendenza nuova; le chiavi non vengono mai esportate né copiate: si chiede al sistema di firmare.
- **macOS**: elenco con `security find-identity` + `security find-certificate -a -Z -p` (sola lettura); per le smart card
  (CryptoTokenKit) i certificati si leggono con `security list-smartcards` / `export-smartcard -e <cartella temporanea>`.
  Firma con `security cms -S -Z <identificativo chiave> -H SHA256 -G [-T]`: la busta CMS la crea il sistema, quindi nei PDF
  il formato è `adbe.pkcs7.detached` (manca l'attributo ESS richiesto da ETSI.CAdES). Una chiamata per file.
- **Windows**: elenco di `Cert:\CurrentUser\My` (solo `HasPrivateKey`) con PowerShell; firma con .NET
  (`GetRSAPrivateKey`/`GetECDsaPrivateKey` → `SignData`, SHA-256) degli attributi firmati; la busta CAdES (con ESS
  signingCertificateV2) la costruisce Leggio, quindi PAdES `ETSI.CAdES.detached`. Il PIN lo chiede il middleware del fornitore.
  Gli script PowerShell sono fissi (passati con `-EncodedCommand`, dati solo su stdin) e non contengono comandi di scrittura.
  **Firma in blocco**: tutte le firme in un solo processo → un solo PIN (se il middleware lo memorizza per la sessione).
  Nota: si usa la firma «grezza» della chiave invece di `SignedCms/CmsSigner`, per avere la stessa busta CAdES ovunque.
- Elenco: solo certificati con chiave privata ed estensione «uso della chiave» con firma digitale o non ripudio; esclusi quelli
  per autenticazione, siti, codice, marche temporali e i certificati Apple; in cima i qualificati (QCStatements) e «non ripudio».
  Mostra nome, organizzazione, CF (serialNumber `TINIT-…`), emittente, scadenza; gli scaduti sono visibili ma non selezionabili.
- Ripiego «Firma con il programma installato»: programmi cercati in /Applications e ~/Applications (macOS) o Program Files /
  AppData\Local\Programs (Windows) per nome (Dike, ArubaSign, FirmaOK, FirmaCerta, GoSign, File Protector…), oppure scelti
  dall'utente (ricordati in `userData/moduli-programmi-firma.json`). Se il documento ha modifiche non salvate si apre una
  copia in una cartella temporanea `Leggio-firma`. Osservazione della cartella per 30 minuti (annullabile). Proposto anche
  automaticamente quando la firma di sistema fallisce.
- In Leggio l'aggiunta di una firma digitale usa `applyEdit(…, { signatureWarning: false })`: l'aggiornamento incrementale non
  invalida le firme esistenti.

### Cosa è stato provato davvero
- **macOS, portachiavi temporaneo** (test `moduli-sistema`, con `LEGGIO_TEST_KEYCHAIN=1`): portachiavi creato in una cartella
  temporanea, importato un ID di prova, elencato, firmati PAdES, `.p7m` e un file in blocco con `security cms`; verifiche con la
  verifica di Leggio, `pdfsig` («Signature is Valid») e `openssl cms -verify` (contenuto identico). Portachiavi cancellato alla fine;
  il test controlla che l'elenco dei portachiavi dell'utente non cambi (non cambia: `create-keychain` non lo aggiunge).
- **macOS, portachiavi reale**: solo lettura dell'elenco (4 identità presenti, tutte escluse correttamente: certificati MDM/dispositivo).
- **Windows**: NON provato su Windows (non disponibile). Provato con un PowerShell simulato che risponde come i due script
  (elenco, firma RSA ed ECDSA, errori «annullato» / «Keyset does not exist» / risposta non valida), inclusa la firma in blocco con
  una sola chiamata di firma.
- Ripiego: osservazione della cartella provata (copia `.pdf.p7m` che compare, PDF riscritto sul posto con una firma, annullamento,
  scadenza). L'avvio vero di Dike/ArubaSign non è provato (programmi non installati qui).
- Interfaccia: scelta del certificato, errore della smart card con proposta del programma installato e attesa del file,
  provate nel browser simulando le risposte del processo principale.

### Cosa serve provare con una carta vera
1. Windows 10/11 + CNS/firma qualificata (es. Bit4id, Athena, Oberthur/IDEMIA) con il middleware del fornitore: la carta compare
   nell'elenco? `GetRSAPrivateKey` funziona con il CSP/KSP? Il PIN viene chiesto una sola volta nella firma in blocco?
   La firma risulta valida in Acrobat e in Dike (PAdES e `.p7m`), anche come firma qualificata?
2. Token USB e firma con carta su macOS: CryptoTokenKit espone l'identità a `security find-identity`? `security cms` la usa
   (o chiede il PIN)? I certificati della carta si leggono con `export-smartcard`?
3. Verifica in Acrobat delle firme `adbe.pkcs7.detached` create con `security cms` (catena inclusa da macOS).
4. Ripiego: nomi e percorsi reali di Dike, ArubaSign, FirmaOK, GoSign; dove salvano il file firmato e con che nome.

## Limiti noti
- Firma remota (Aruba, InfoCert, Namirial): non supportata (API proprietarie, rete); si può usare il programma del fornitore come ripiego.
- PKCS#11 diretto (`pkcs11js`): non usato (dipendenza nativa); il Firmatario di sistema passa dai driver già installati.
- Firmare un PDF protetto da password non è possibile (messaggio che chiede di togliere la protezione).
- Le modifiche fatte con gli altri strumenti (pdf-lib) riscrivono il file e invalidano le firme: la barra lo avvisa.
- Testo non rappresentabile in WinAnsi (es. greco, cinese) in «Compila e firma» diventa «?» (solo font standard, nessun font incorporato).
- Il riconoscimento dei campi usa il testo, non le linee disegnate senza testo.
