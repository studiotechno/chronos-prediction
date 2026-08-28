/**
 * Mise en forme des libellés venus des sources d'offres : les enseignes et les
 * intitulés y sont écrits en capitales, avec des suffixes « (H/F) » partout.
 * Recopier ça tel quel donne une liste qui crie ; on la rend lisible sans
 * jamais toucher aux données stockées.
 */

/** Un mot tout en capitales assez long pour être un nom, pas un sigle (LIP, CRIT, ABM). */
const LONGUEUR_SIGLE = 4;

function capitaliser(mot: string): string {
  return mot.charAt(0).toUpperCase() + mot.slice(1).toLowerCase();
}

/** « MANPOWER FRANCE » → « Manpower France », « LIP VICHY » → « LIP Vichy ». */
export function casseEnseigne(nom: string): string {
  return nom
    .split(/(\s+|-)/)
    .map((mot) => {
      if (/^[\s-]*$/.test(mot)) return mot;
      const lettres = mot.replace(/[^A-Za-zÀ-ÿ]/g, "");
      const crie = lettres.length > 0 && lettres === lettres.toUpperCase();
      return crie && lettres.length >= LONGUEUR_SIGLE ? capitaliser(mot) : mot;
    })
    .join("");
}

/** « INFIRMIER » → « Infirmier » : un intitulé est une phrase, pas un titre. */
export function casseIntitule(intitule: string): string {
  const lettres = intitule.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (lettres.length === 0 || lettres !== lettres.toUpperCase()) return intitule;
  const bas = intitule.toLowerCase();
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}

/** Les intitulés de la source traînent tous « (H/F) » : bruit pur en liste. */
export function sansMentionHF(intitule: string): string {
  return intitule.replace(/\s*[([]\s*[hf][\s/–-]*[hf]\s*[)\]]/gi, "").trim() || intitule;
}

/** Intitulé de mission prêt à afficher. */
export function intituleLisible(intitule: string): string {
  return casseIntitule(sansMentionHF(intitule));
}
