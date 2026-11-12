import { App } from './core/app.js';
import { registerFeatures } from './features/index.js';

const app = new App(document.getElementById('app'));
registerFeatures(app);
window.__leggio = app; // utile per debug e test automatici
const last = app.settings.get('sidebarPanel', 'thumbs');
app.bus.on('document:loaded', () => { if (last && app.docs.length === 1) app.sidebar.show(last); });
