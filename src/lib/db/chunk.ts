/**
 * Découpage des insertions en lots.
 *
 * PostgreSQL plafonne à 65 535 paramètres liés par requête : une insertion
 * multi-lignes non découpée casse dès quelques milliers de lignes. 500 lignes
 * par lot laissent la marge pour des tables larges tout en gardant un nombre
 * d'allers-retours réseau raisonnable.
 */
export const TAILLE_LOT = 500;

export function chunk<T>(rows: T[], taille = TAILLE_LOT): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < rows.length; i += taille) lots.push(rows.slice(i, i + taille));
  return lots;
}
