// Area «modifica»: modifica del testo esistente, aggiunta di testo e immagini, link, trova e sostituisci, forme.
import './modifica.css';
import { editContentTool } from './ui/editmode.js';
import { addTextTool, addImageTool, shapesTool } from './ui/add.js';
import { linksTool, autoLinks } from './ui/links.js';
import { findReplaceTool } from './ui/findreplace.js';
import { todayIt } from './ui/common.js';

export default function register(app) {
  app.registerTool(editContentTool(app));
  app.registerTool(addTextTool(app));
  app.registerTool(addTextTool(app, {
    id: 'insert-date', name: 'Inserisci data', icon: 'text', preset: () => todayIt(),
    description: 'Scrive la data di oggi dove fai clic (puoi correggerla prima di inserirla)',
    keywords: 'data oggi ora inserisci data timbro data protocollo',
  }));
  app.registerTool(addImageTool(app));
  app.registerTool(linksTool(app));
  app.registerTool({
    id: 'auto-links', name: 'Crea link automatici', category: 'modifica', icon: 'link',
    description: 'Rende cliccabili tutti gli indirizzi web ed email scritti nel documento',
    keywords: 'link automatici collegamenti url email rendi cliccabili',
    run: () => autoLinks(app),
  });
  app.registerTool(findReplaceTool(app));
  app.registerTool(shapesTool(app));
}
