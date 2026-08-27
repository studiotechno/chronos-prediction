/**
 * Normalisation de raison sociale : majuscules, accents supprimés, formes
 * juridiques supprimées, ponctuation supprimée, espaces compactés.
 */

const FORMES_JURIDIQUES = new Set([
  "SA", "SAS", "SASU", "SARL", "EURL", "SNC", "SCI", "SCM", "SCP", "SCOP", "SCEA",
  "SELARL", "SELAS", "SELASU", "GIE", "EARL", "GAEC", "SEM", "SEML", "EI", "EIRL",
  "STE", "SOCIETE", "ETS", "ETABLISSEMENT", "ETABLISSEMENTS", "CIE", "COMPAGNIE",
]);

export function normalizeDenomination(brut: string): string {
  const sansAccents = brut
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // Les points des sigles sont décollés (« S.A.R.L. » → « SARL ») AVANT la
  // tokenisation, sinon la forme juridique éclate en lettres isolées.
  const sansPoints = sansAccents.replace(/\./g, "");
  const sansPonctuation = sansPoints.replace(/[^A-Z0-9]+/g, " ");
  const tokens = sansPonctuation
    .split(" ")
    .filter(Boolean)
    .filter((t) => !FORMES_JURIDIQUES.has(t));
  return tokens.join(" ");
}
