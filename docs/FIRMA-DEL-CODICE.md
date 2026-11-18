# Firma del codice: perché serve, opzioni, costi, passi

## Perché il download risulta «non sicuro»

Windows (SmartScreen), Edge e Chrome avvisano quando un eseguibile **non è firmato** o il suo editore
**non ha ancora «reputazione»** (pochi download). Su macOS Gatekeeper blocca le app non firmate con un
certificato Apple **Developer ID** e non **notarizzate**. Non dipende da un difetto di Leggio, e nessuna
modifica al codice lo elimina del tutto: serve la firma.

Cosa è già fatto (gratis):

- metadati corretti dell'eseguibile Windows: nome prodotto, descrizione, versione, editore
  (autore di `package.json`), copyright, marchio;
- pubblicazione **solo** da GitHub Releases in HTTPS, con il file **`SHA256SUMS.txt`** (impronte SHA-256 di ogni
  pacchetto) calcolato dal workflow;
- l'avviso di aggiornamento dentro l'app apre **solo** indirizzi `https://github.com/lorebiri/leggio/releases/download/…`
  (qualunque altro indirizzo viene scartato: `safeDownloadUrl` in `electron/updater.cjs`);
- pipeline di firma **pronta ma spenta** in `.github/workflows/release.yml` (+ `scripts/config-firma.cjs`):
  si accende impostando segreti e variabili del repository, senza cambiare il codice;
- pagina di download (`site/`) con istruzioni per superare gli avvisi finché manca la firma.

## Confronto delle opzioni

Prezzi indicativi, novembre 2026: **verificarli prima di qualunque iscrizione**.

| Opzione | Sistema | Costo annuo | Chi compare come editore | Avviso SmartScreen | Note |
|---|---|---|---|---|---|
| **SignPath Foundation** | Windows | **0 €** | «SignPath Foundation» | sparisce man mano che cresce la reputazione | Per progetti open source con licenza OSI (Leggio è GPL-3.0: va bene). Richiede domanda e approvazione, regole di sicurezza (2FA, build da CI, policy di firma pubblica) e la frase «Free code signing provided by SignPath.io, certificate by SignPath Foundation» |
| **Azure Artifact Signing** (ex Trusted Signing) | Windows | circa **120 USD** (≈ 10 USD/mese, piano Basic) | il nome verificato (persona o organizzazione) | come OV: migliora con la reputazione | Per le **persone fisiche** risulta disponibile solo in USA e Canada; in Italia serve un'organizzazione con storia verificabile. Si paga da quando si crea l'account. Supportato direttamente da electron-builder |
| Certificato OV «Open Source» Certum | Windows | circa **69 €** (versione cloud SimplySign) – 359 € (con lettore e carta) | il nome di Lorenzo | migliora con la reputazione | Validità 1 anno (dal 2026 massimo ~15 mesi per tutti i certificati). Su token/cloud: integrazione con la CI più laboriosa |
| Certificato OV/EV commerciale | Windows | 200–600 € | il nome di Lorenzo | EV non dà più reputazione immediata (dal 2024) | Sconsigliato: costa di più senza vantaggi reali per Leggio |
| **Apple Developer Program** | macOS | **99 USD/anno** (≈ 99 €) | il nome di Lorenzo | — | Unico modo per non avere l'avviso su Mac: certificato Developer ID + notarizzazione. Va bene come persona fisica |
| Nessuna firma (oggi) | tutti | 0 € | «Editore sconosciuto» | sempre, finché i download non creano reputazione | Le istruzioni per gli utenti sono nella pagina di download |

**Raccomandazione:** Windows con **SignPath Foundation** (gratuito, pensato esattamente per questo caso);
se la domanda non viene accettata, Certum Open Source (cloud). macOS: Apple Developer Program solo quando gli
utenti Mac sono abbastanza da giustificare 99 USD/anno.

## Passi che deve fare Lorenzo

Niente di quanto segue è stato fatto: richiede iscrizioni, accettazione di condizioni o pagamenti.

### Windows con SignPath Foundation (gratuito)

1. Fare domanda su <https://signpath.org> (modulo per progetti open source) indicando il repository `lorebiri/leggio`.
2. Pubblicare nel README/sito una «Code signing policy» (chi può firmare, che si firmano solo build della CI)
   e la frase di attribuzione richiesta.
3. Dopo l'approvazione, nel progetto SignPath creare due *artifact configuration*:
   - `app`: uno zip con dentro i file PE da firmare (`Leggio.exe`, `*.dll`, `resources/**/*.exe`, `*.node`);
   - `installer`: uno zip con `Leggio-*-installer.exe` e `Leggio-*-portatile.exe`;
   e una *signing policy* (es. `release-signing`) collegata al *trusted build system* GitHub.
4. In GitHub → Settings → Secrets and variables → Actions:
   - segreto `SIGNPATH_API_TOKEN`;
   - variabili `FIRMA_WINDOWS=signpath`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`.
5. Avviare a mano il workflow **Release** (Run workflow) e controllare il passo «Verifica la firma Authenticode».

### Windows con Azure Artifact Signing (a pagamento, alternativa)

1. Verificare che l'identità (persona o organizzazione) sia accettata nel proprio Paese.
2. Creare l'account *Artifact Signing*, la verifica d'identità e un *certificate profile* «Public Trust».
3. Creare un'app in Microsoft Entra ID con il ruolo «Artifact Signing Certificate Profile Signer».
4. Segreti `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; variabili `FIRMA_WINDOWS=azure`,
   `AZURE_SIGN_ENDPOINT` (es. `https://weu.codesigning.azure.net`), `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`,
   `AZURE_SIGN_PUBLISHER` (il nome esattamente come nel certificato).

### macOS con Developer ID e notarizzazione

1. Iscrizione all'Apple Developer Program (99 USD/anno).
2. Certificato **Developer ID Application** esportato in `.p12` con password; password specifica per app
   dell'Apple ID; Team ID.
3. Segreti `CSC_LINK` (il `.p12` in base64), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
   Con il certificato `scripts/config-firma.cjs` toglie da solo la firma «ad hoc» e attiva la notarizzazione.

## Come verifica l'utente

Ogni release contiene `SHA256SUMS.txt`. Verifica:

- Windows (PowerShell): `Get-FileHash .\Leggio-X.Y.Z-win-x64-installer.exe -Algorithm SHA256`
- macOS / Linux: `shasum -a 256 Leggio-X.Y.Z-mac-arm64.dmg`

L'impronta deve coincidere con la riga del file. Con la firma attiva, su Windows: tasto destro sul file →
Proprietà → Firme digitali.
