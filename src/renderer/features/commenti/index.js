// Area «commenti»: punto d'ingresso. Registra strumenti, pannello Commenti e comportamenti sulla pagina.
// Le annotazioni sono vere annotazioni PDF standard con aspetto /AP (vedi annots.js, appearance.js).
import './commenti.css';
import { highlightTool, installSelectionBar } from './tools-markup.js';
import { stickyNoteTool, freeTextTool, inkTool, shapesTool } from './tools-draw.js';
import { stampTool, stampBatchTool } from './tools-stamp.js';
import { selectTool } from './tool-select.js';
import { commentsPanel } from './panel.js';
import { actionTools } from './actions.js';
import { measureTool } from './measure.js';
import { pageComments } from './ui-common.js';

export default function register(app) {
  for (const t of [selectTool(app), highlightTool(app), stickyNoteTool(app), freeTextTool(app), inkTool(app), shapesTool(app), stampTool(app), stampBatchTool(app), measureTool(app), ...actionTools(app)]) {
    app.registerTool(t);
  }
  app.registerPanel(commentsPanel(app));
  installSelectionBar(app);

  // Le risposte e gli stati di revisione non hanno disegno, ma pdf.js crea comunque una zona cliccabile
  // invisibile sopra il commento di partenza: la nascondiamo, così il clic apre il commento giusto.
  app.bus.on('page:annotationlayer', async ({ pageIndex, pageDiv }) => {
    try {
      const list = await pageComments(app, pageIndex);
      for (const c of list) {
        if (!c.irt) continue;
        const el = pageDiv?.querySelector(`.annotationLayer [data-annotation-id="${CSS.escape(c.key)}"]`);
        if (el) el.style.display = 'none';
      }
    } catch { /* il livello può essere già stato rigenerato */ }
  });

  app.bus.on('settings:fields', (arr) => arr.push({ key: 'commenti.selectionBar', field: { label: 'Mostra la barretta «Evidenzia» quando selezioni del testo', type: 'checkbox', value: true } }));
}
