/**
 * Conversion des champs numériques des sources publiques.
 *
 * Les API de l'État ne renvoient pas toujours un nombre là où leur schéma en
 * annonce un : SIRENE publie littéralement la chaîne « [NON-DIFFUSIBLE] » comme
 * latitude et longitude pour les entreprises à diffusion restreinte. Un
 * `Number(...)` direct produit alors NaN — une valeur qui passe les contrôles
 * `!= null` et `IS NOT NULL`, traverse les calculs, et finit stockée en base.
 * Vu en production : trois établissements à `lat = NaN` ont donné trois scores
 * Strate à NaN et fait planter la carte des leads.
 *
 * Une donnée absente doit rester absente : on renvoie null, jamais NaN.
 */
export function nombreFini(valeur: unknown): number | null {
  if (valeur == null || valeur === "") return null;
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur !== "string") return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}
