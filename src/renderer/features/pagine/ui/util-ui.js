// Piccole utilità per l'interfaccia (riesporta la logica pura usata nei dialoghi).
export { intervalli, senzaEstensione, indiciInTesto, nomeFileSicuro } from '../logica/util.js';
export function formatoMB(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
