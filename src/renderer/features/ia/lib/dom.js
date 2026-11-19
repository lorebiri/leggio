// Sostituisce i figli di un elemento saltando null, undefined e false (replaceChildren li scriverebbe come testo «null»).
export function metti(el, ...figli) {
  el.replaceChildren(...figli.flat().filter((f) => f != null && f !== false));
  return el;
}
