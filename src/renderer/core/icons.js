// Icone SVG a tratto: griglia 24×24, contenuto tra 3 e 21, tratto 1.75 (currentColor), estremità e angoli
// arrotondati, raggio 1.5–2 sui rettangoli. Regole e catalogo in docs/DESIGN.md.
// Le aree possono AGGIUNGERE icone con registerIcon(nome, svg); un nome già presente qui non viene sostituito,
// così il set resta coerente (le icone di pagine e archivio sono state ridisegnate qui).
const DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
const P = {
  // ---- file ----
  open: '<path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5"/><path d="M3 7.5h18l-1.6 10.7A2 2 0 0 1 17.4 20H6.6a2 2 0 0 1-2-1.8z"/>',
  save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h7V3M7.5 21v-6.5h9V21"/>',
  saveAs: '<path d="M11 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v4"/><path d="M8 3v5h7"/><path d="m14 21 .6-2.9 4.6-4.6a1.5 1.5 0 0 1 2.1 2.1l-4.6 4.6z"/>',
  print: '<path d="M7 9V3h10v6"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>',
  file: DOC,
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3M14.5 11.5v6M11.5 14.5h6"/>',
  paperclip: '<path d="m20.5 11.5-8.4 8.4a5.5 5.5 0 0 1-7.8-7.8l8.4-8.4a3.7 3.7 0 0 1 5.2 5.2l-8.4 8.4a1.8 1.8 0 0 1-2.6-2.6l7.7-7.7"/>',

  // ---- comandi ----
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.9-3.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>', chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>', chevronDown: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5"/><path d="M20 3.5v5h-5"/>',
  rotateLeft: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 3.5v5h5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7"/><path d="m6 7 .9 12.1a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 7M10 11v6M14 11v6"/>',
  eraser: '<path d="m8 20-4-4a1.5 1.5 0 0 1 0-2.1L13.9 4a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1L10 20M9 9l6 6M8 20h12"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  tools: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  sparkles: '<path d="M11 3.5 12.6 8l4.4 1.6-4.4 1.6L11 15.5l-1.6-4.3L5 9.6 9.4 8z"/><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',

  // ---- vista ----
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  fitWidth: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  fitPage: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 9h6v6H9z"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 4.5v14c3.5 0 6.5.5 8.5 2 2-1.5 5-2 8.5-2v-14c-3.5 0-6.5.5-8.5 2zM12 6.5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  pointer: '<path d="m5.5 3.5 13 7.2-5.6 1.7-2 5.6z"/><path d="m13 12.5 5 5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v7M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a6.5 6.5 0 0 1-5.2-2.6L3.4 15a1.5 1.5 0 0 1 2.3-1.9L8 15.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5" opacity=".55"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  measure: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
  warning: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2v.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',

  // ---- pagine ----
  pages: '<rect x="4" y="3" width="11" height="14" rx="2"/><path d="M8.5 21H17a3 3 0 0 0 3-3V8"/>',
  organize: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/><rect x="13.5" y="14.5" width="7" height="6" rx="1.5"/>',
  pageInsert: DOC + '<path d="M12 11.5v6M9 14.5h6"/>',
  pageExtract: '<path d="M11 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v3.5"/><path d="M14 3v5h5M14.5 17.5H21M18 14.5l3 3-3 3"/>',
  pageDelete: DOC + '<path d="m9.5 12.5 5 5M14.5 12.5l-5 5"/>',
  pageReplace: '<rect x="3" y="3" width="9" height="12" rx="2"/><rect x="12" y="9" width="9" height="12" rx="2"/><path d="M7.5 18.5V20h2M16.5 5.5V4h-2"/>',
  split: '<path d="M12 3v5c0 4-6 4.5-6 9v4M12 8c0 4 6 4.5 6 9v4"/><path d="M9.5 5.5 12 3l2.5 2.5"/>',
  merge: '<path d="M6 3v4c0 4.5 6 5 6 9.5V21M18 3v4c0 4.5-6 5-6 9.5"/><path d="m9.5 18.5 2.5 2.5 2.5-2.5"/>',
  reverse: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  resize: '<rect x="3" y="8" width="11" height="13" rx="2"/><path d="M10 3h9a2 2 0 0 1 2 2v9M15 3h6v6"/>',
  crop: '<path d="M6 2.5V16a2 2 0 0 0 2 2h13.5M2.5 6H16a2 2 0 0 1 2 2v13.5"/>',
  nup: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M12 4v16M3.5 12h17"/>',
  booklet: '<path d="M12 6.5C10 5 7 4.5 3.5 4.5v14c3.5 0 6.5.5 8.5 2 2-1.5 5-2 8.5-2v-14c-3.5 0-6.5.5-8.5 2zM12 6.5v14"/>',
  headerFooter: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M8 6.5h8M10 17.5h4"/><path d="M8 10.5h8M8 13.5h5" opacity=".55"/>',
  numbering: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M10 17h4M12 17v-6l-1.6 1.2"/>',
  bates: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M8 17.5h8M8 7.5h3.5v4H8zM14 7.5h2M14 11h2"/>',
  background: '<rect x="4.5" y="3" width="15" height="18" rx="2" fill="currentColor" fill-opacity=".16"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  watermark: '<path d="M12 3.5s6 6.3 6 10.7a6 6 0 0 1-12 0c0-4.4 6-10.7 6-10.7z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" opacity=".7"/>',
  labels: '<path d="M3.5 11.6V5a1.5 1.5 0 0 1 1.5-1.5h6.6a1.5 1.5 0 0 1 1 .4l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0l-7.4-7.4a1.5 1.5 0 0 1-.4-1z"/><circle cx="8" cy="8" r="1.3"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1z"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M3.5 20.5 10 14"/>',
  compare: '<rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/><path d="M6 9h2M16 9h2M6 13h2M16 13h2"/>',

  // ---- commenti e modifica ----
  comment: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5L5 20v-4.2A2 2 0 0 1 4 14z"/>',
  note: '<path d="M6 3.5h12a2 2 0 0 1 2 2V14l-6.5 6.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M13.5 20.5V16a2 2 0 0 1 2-2h4.5"/>',
  highlight: '<path d="m9 11 6.5-6.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L13 15"/><path d="m9 11-4 4v3.5h3.5l4.5-3.5zM4 21h16"/>',
  pen: '<path d="m4 20 1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="m14.5 6 3.5 3.5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  shape: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.5"/><circle cx="16.5" cy="16.5" r="4"/>',
  stamp: '<path d="M9.5 13V9.5a2.5 2.5 0 1 1 5 0V13"/><path d="M4 15a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4zM6 20.5h12"/>',
  redact: '<rect x="3" y="9" width="18" height="6" rx="1.5" fill="currentColor"/><path d="M3 5h10M3 19h14"/>',
  ocr: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 9h8M8 12h8M8 15h5"/>',
  convert: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  form: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M14 9h3M7 14h10"/>',

  // ---- firma e protezione ----
  signature: '<path d="M3 16.5c2.5 0 3.5-7.5 6-7.5s-1 7.5 2 7.5 3-3.5 5-3.5 2 3 5 3"/><path d="M3 20.5h18"/>',
  signed: '<path d="M12 3 14 4.6l2.5-.2.8 2.4 2.2 1.2-.6 2.4 1 2.3-1.9 1.6-.2 2.5-2.5.4L14 19.2 12 18l-2 1.2-1.3-2.1-2.5-.4-.2-2.5-1.9-1.6 1-2.3-.6-2.4 2.2-1.2.8-2.4 2.5.2z"/><path d="m9 11.5 2 2 4-4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 15v2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',

  // ---- ufficio e archivio ----
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
  inbox: '<path d="M3.5 13.5 6 5.4A2 2 0 0 1 7.9 4h8.2A2 2 0 0 1 18 5.4l2.5 8.1V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5"/>',
  dossier: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 11h10M7 14.5h6"/>',
  titulus: '<path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z"/><rect x="8" y="11" width="8" height="5.5" rx="1"/><path d="M10 13.7h4M8 7.5h4"/>',
  invoice: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2-1.5L8.5 21 6 19.5z"/><path d="M9 7.5h6M9 11h6M9 14.5h2.5M13.5 14.5H15"/>',
  euro: '<path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5"/><path d="M5 10.5h8M5 13.5h7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  pec: '<path d="M21 11.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/><path d="m15 18 2 2 4-4"/>',
  mission: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12.5h18M10.5 12.5v2h3v-2"/>',
  checklist: '<path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="m8.5 12 1.5 1.5 2.5-2.5M14.5 12.5H16M8.5 17l1.5 1.5 2.5-2.5M14.5 17.5H16"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3 12h18"/>',
};
// nomi alternativi (stessa icona): così le aree trovano la parola italiana o inglese che cercano
const ALIAS = { fattura: 'invoice', fascicolo: 'dossier', missione: 'mission', controlli: 'checklist', firmato: 'signed', protocollo: 'titulus', scadenza: 'calendar', cartella: 'folder', posta: 'mail', checks: 'checklist', receipt: 'invoice', briefcase: 'mission' };
for (const [a, b] of Object.entries(ALIAS)) P[a] = P[b];
const CORE = new Set(Object.keys(P));

/** Aggiunge un'icona (stesse regole: griglia 24, tratto, niente colori). I nomi del set del nucleo non si sostituiscono. */
export function registerIcon(name, svgInner) { if (!CORE.has(name)) P[name] = svgInner; }
export function icon(name, size = 18) {
  const inner = P[name] || P.file;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
/** Nomi disponibili (per il catalogo in docs/DESIGN.md e per i test). */
export function iconNames() { return Object.keys(P); }
