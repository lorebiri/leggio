// Logica della configurazione di electron-builder PER LA RELEASE (usata da scripts/config-firma.cjs), con la firma del codice quando ci sono i segreti.
// Parte dalla chiave "build" di package.json e aggiunge solo ciò che serve alla firma scelta.
// Senza segreti il risultato è identico a package.json (pacchetti non firmati, come oggi).
//
//   npx electron-builder --config scripts/config-firma.cjs --win --publish never
//
// Variabili lette (impostate dal workflow .github/workflows/release.yml):
//   FIRMA_WINDOWS = 'azure' | 'signpath' | ''   (variabile del repository, vedi docs/FIRMA-DEL-CODICE.md)
//   Azure Trusted Signing (Artifact Signing): AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE,
//     AZURE_SIGN_PUBLISHER (nome del titolare esattamente come nel certificato) + AZURE_TENANT_ID,
//     AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (letti direttamente dallo strumento di firma)
//   SignPath: la firma avviene DOPO la costruzione, nel workflow (qui non cambia nulla)
//   macOS: CSC_LINK + CSC_KEY_PASSWORD (certificato Developer ID) e APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
//     APPLE_TEAM_ID (notarizzazione). Con il certificato si toglie la firma «ad hoc» (identity "-").
'use strict';
const pkg = require('../package.json');

function configFirma(env = process.env) {
  const base = JSON.parse(JSON.stringify(pkg.build));
  const cfg = { ...base, mac: { ...base.mac }, win: { ...base.win } };

  // ---------- macOS: Developer ID + notarizzazione ----------
  const certMac = !!(env.CSC_LINK && env.CSC_KEY_PASSWORD);
  const notarizza = !!(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
  if (certMac) {
    delete cfg.mac.identity; // electron-builder usa il certificato di CSC_LINK
    cfg.mac.notarize = notarizza;
  }

  // ---------- Windows: Authenticode ----------
  const modo = String(env.FIRMA_WINDOWS || '').trim().toLowerCase();
  if (modo === 'azure') {
    const need = ['AZURE_SIGN_ENDPOINT', 'AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE', 'AZURE_SIGN_PUBLISHER', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
    const mancano = need.filter((k) => !env[k]);
    if (mancano.length) throw new Error(`Firma Azure richiesta ma mancano: ${mancano.join(', ')}`);
    cfg.win.azureSignOptions = {
      publisherName: env.AZURE_SIGN_PUBLISHER,
      endpoint: env.AZURE_SIGN_ENDPOINT,
      codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
      certificateProfileName: env.AZURE_SIGN_PROFILE,
    };
  }
  return { config: cfg, mac: { firmato: certMac, notarizzato: certMac && notarizza }, windows: modo === 'azure' || modo === 'signpath' ? modo : 'nessuna' };
}

module.exports = { configFirma };
