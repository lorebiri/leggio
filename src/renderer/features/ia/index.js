// Area «ia»: assistente IA locale (facoltativo, spento finché l'utente non lo attiva). Vedi docs/aree/ia.md.
// Questo file è volutamente piccolo: le finestre e la logica si caricano solo quando servono,
// così chi non usa l'assistente non ha nessun costo all'avvio. Motore e modelli non sono nel pacchetto.
import './ia.css';
import { registerIcon } from '../../core/icons.js';
import { disponibile, chiama } from './servizio.js';

registerIcon('ia', '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>');

export default function register(app) {
  const attivo = () => !!app.settings.get('ia.attivo', false);
  const configura = async (opz) => (await import('./ui/configura.js')).apriConfigura(app, opz);
  const soloDesktop = () => { app.ui.toast('L\'assistente IA è disponibile solo nell\'app desktop di Leggio.', { kind: 'warning' }); return false; };
  const pronto = async (testo) => {
    if (!disponibile(app)) return soloDesktop();
    if (attivo()) return true;
    await configura({ motivo: testo });
    return attivo();
  };

  app.registerTool({
    id: 'ia-impostazioni', name: 'Assistente IA (sul tuo computer)…', category: 'avanzati', icon: 'ia', needsDoc: false,
    description: 'Attiva l\'assistente che risponde alle domande sui documenti e cerca nell\'archivio per significato. Facoltativo, funziona senza internet.',
    keywords: 'ia intelligenza artificiale assistente ai chat domande riassunto modello locale offline privacy gemma qwen llama',
    run: () => (disponibile(app) ? configura() : soloDesktop()),
  });
  app.registerTool({
    id: 'ia-chiedi', name: 'Chiedi al documento (assistente IA)', category: 'avanzati', icon: 'ia', needsDoc: true, hidden: !attivo(),
    description: 'Fai una domanda sul PDF aperto: la risposta indica la pagina da cui viene. Aiuto da verificare.',
    keywords: 'ia intelligenza artificiale domanda chiedi risposta assistente pagina citazione chat',
    run: async () => { if (await pronto('Per fare domande sul documento attiva prima l\'assistente.')) (await import('./ui/chiedi.js')).apriChiedi(app, () => configura()); },
  });
  app.registerTool({
    id: 'ia-archivio', name: 'Cerca per significato nell\'archivio', category: 'archivio', icon: 'ia', needsDoc: false, hidden: !attivo(),
    description: 'Trova i documenti descrivendoli con parole tue, anche senza le parole esatte (assistente IA).',
    keywords: 'ia ricerca semantica significato archivio trova simile descrizione',
    run: async () => { if (await pronto('Per cercare per significato attiva prima l\'assistente.')) (await import('./ui/archivio.js')).apriRicercaArchivio(app, () => configura()); },
  });

  const aggiornaStrumenti = () => {
    for (const id of ['ia-chiedi', 'ia-archivio']) { const t = app.tools.get(id); if (t) t.hidden = !attivo(); }
    app.bus.emit('tools:changed');
  };
  app.bus.on('ia:cambiato', aggiornaStrumenti);

  // Impostazioni: un interruttore. Accenderlo la prima volta apre la finestra per scaricare i componenti.
  app.bus.on('settings:fields', (arr) => {
    if (!disponibile(app)) return;
    arr.push({ key: 'ia.attivo', field: { name: 'ia.attivo', label: 'Assistente IA sul tuo computer (facoltativo)', type: 'checkbox', value: false, help: 'Domande sui documenti con la pagina citata e ricerca per significato nell\'archivio. Funziona senza internet; i documenti non escono dal PC. Aiuto da verificare.' } });
  });
  let prima = attivo();
  app.bus.on('settings:changed', async (e) => {
    if (e?.key !== 'ia.attivo') return;
    const ora = attivo();
    if (ora === prima) return;
    prima = ora;
    if (ora) {
      // accesa dalle Impostazioni: se mancano i componenti si apre la finestra per installarli
      try {
        const st = await chiama(app, 'stato');
        const modello = app.settings.get('ia.modello', '') || 'principale';
        if (!st.motore?.installato || !st.modelli?.[modello]?.installato) { app.settings.set('ia.attivo', false); prima = false; await configura({ motivo: 'Per attivare l\'assistente servono il motore e un modello: scaricali qui (una volta sola).' }); }
      } catch { /* */ }
    } else {
      chiama(app, 'ferma').catch(() => {});
    }
    aggiornaStrumenti();
  });
}
