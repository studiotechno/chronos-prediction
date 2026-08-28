/* ── Thème d'interface (clair par défaut, « noir » optionnel) ─────────
   Le thème vit sur <html data-theme="…"> : tous les tokens de globals.css
   en dépendent, donc il doit être posé AVANT la première peinture — d'où
   le script bloquant injecté dans le <head> (cf. src/app/layout.tsx). */

export type Theme = "clair" | "noir";

export const THEME_KEY = "chronos_theme";

/** Script bloquant du <head> : applique la préférence sans flash. */
export const THEME_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem('${THEME_KEY}')==='noir'){document.documentElement.dataset.theme='noir'}}catch(e){}})()`;

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "noir" ? "noir" : "clair";
  } catch {
    return "clair";
  }
}

/** Applique le thème au document et mémorise la préférence. */
export function applyTheme(theme: Theme): void {
  if (theme === "noir") document.documentElement.dataset.theme = "noir";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* stockage indisponible : le thème reste actif pour la session */
  }
  // Les fonds MapLibre ne suivent pas les variables CSS : chaque carte
  // montée écoute cet événement pour recharger son style.
  window.dispatchEvent(new CustomEvent<Theme>("chronos:theme", { detail: theme }));
}
