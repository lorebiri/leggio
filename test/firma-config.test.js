// Pipeline di firma pronta ma spenta: senza segreti la configurazione è quella di package.json.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { configFirma } = require('../scripts/firma-lib.cjs');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('configurazione di firma per la release', () => {
  it('senza segreti: identica a package.json (mac firmato ad hoc, Windows non firmato)', () => {
    const r = configFirma({});
    expect(r.config).toEqual(pkg.build);
    expect(r.config.mac.identity).toBe('-');
    expect(r.windows).toBe('nessuna');
    expect(r.mac.firmato).toBe(false);
  });
  it('macOS con certificato e dati Apple: Developer ID + notarizzazione', () => {
    const r = configFirma({ CSC_LINK: 'x', CSC_KEY_PASSWORD: 'y', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' });
    expect(r.config.mac.identity).toBeUndefined();
    expect(r.config.mac.notarize).toBe(true);
    expect(r.mac.notarizzato).toBe(true);
    expect(pkg.build.mac.identity).toBe('-'); // package.json non viene toccato
  });
  it('Windows con Azure Trusted Signing: azureSignOptions completi, errore chiaro se manca qualcosa', () => {
    const env = { FIRMA_WINDOWS: 'azure', AZURE_SIGN_ENDPOINT: 'https://weu.codesigning.azure.net', AZURE_SIGN_ACCOUNT: 'acc', AZURE_SIGN_PROFILE: 'prof', AZURE_SIGN_PUBLISHER: 'Mario Rossi', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' };
    const r = configFirma(env);
    expect(r.config.win.azureSignOptions).toEqual({ publisherName: 'Mario Rossi', endpoint: env.AZURE_SIGN_ENDPOINT, codeSigningAccountName: 'acc', certificateProfileName: 'prof' });
    expect(() => configFirma({ FIRMA_WINDOWS: 'azure' })).toThrow(/mancano/);
  });
  it('SignPath: la firma è un passo del workflow, la configurazione non cambia', () => {
    const r = configFirma({ FIRMA_WINDOWS: 'signpath' });
    expect(r.windows).toBe('signpath');
    expect(r.config.win.azureSignOptions).toBeUndefined();
  });
  it('il workflow pubblica solo bozze, calcola SHA256SUMS e non contiene download da altri domini', () => {
    const y = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    expect(y).toMatch(/--draft/);
    expect(y).toMatch(/sha256sum Leggio-\* \| tee SHA256SUMS\.txt/);
    expect(y).not.toMatch(/curl|wget|Invoke-WebRequest/);
    expect(y).toMatch(/--publish never/);
  });
  it('metadati dell\'eseguibile: editore, versione, descrizione', () => {
    expect(pkg.author.name).toBe('Lorenzo Birindelli');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.productName).toBe('Leggio');
    expect(pkg.build.copyright).toMatch(/Lorenzo Birindelli/);
    expect(pkg.build.win.legalTrademarks).toBe('Leggio');
    expect(pkg.homepage).toMatch(/^https:\/\/github\.com\/lorebiri\/leggio/);
  });
});
