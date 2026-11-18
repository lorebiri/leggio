// Configurazione di electron-builder per la release: package.json "build" + firma se ci sono i segreti.
// La logica (e la documentazione delle variabili) è in scripts/firma-lib.cjs.
//   npx electron-builder --config scripts/config-firma.cjs --win --publish never
'use strict';
module.exports = require('./firma-lib.cjs').configFirma().config;
