/**
 * Liens vers la source d'un signal.
 *
 * Un signal n'est jamais une offre recopiée, mais quand il en désigne UNE
 * (offre directe, manque de candidats, multipostes, réactualisée, republiée,
 * mission d'un concurrent), le commercial doit pouvoir lire l'annonce avant
 * d'appeler. On ne fabrique le lien que pour la source réelle : une fixture
 * porte un identifiant inventé, qui ne mène nulle part.
 */

const BASE_OFFRE_FT = "https://candidat.francetravail.fr/offres/recherche/detail/";

/** Préfixes de `rawRef` construits autour d'un unique identifiant d'offre. */
const PREFIXES_OFFRE = ["pending-directe-", "directe-", "manque-", "multi-", "mission-", "reactu-"];

export type SignalLiable = {
  source: string;
  rawRef: string;
  payload: Record<string, unknown> | null;
};

/**
 * Identifiant de l'offre à l'origine du signal, s'il y en a une seule.
 * Le payload fait foi (renseigné à la dérivation) ; le `rawRef` sert de repli pour
 * les signaux dérivés avant l'ajout du champ.
 *
 * Le bassin de démo est accepté ici : il alimente la même table de staging, donc
 * la même fiche dépliable. Ce qu'il n'obtient pas, c'est un lien sortant.
 */
export function idOffreFrancetravail(s: SignalLiable): string | null {
  if (s.source !== "francetravail" && s.source !== "fixture:francetravail") return null;

  const duPayload = s.payload?.offreId;
  if (typeof duPayload === "string" && /^[0-9A-Za-z-]+$/.test(duPayload)) return duPayload;

  const prefixe = PREFIXES_OFFRE.find((p) => s.rawRef.startsWith(p));
  if (!prefixe) return null;
  // `reactu-<id>-<nbActualisations>` : le compteur en queue n'appartient pas à l'id.
  const reste = s.rawRef.slice(prefixe.length).replace(/-\d+$/, "");
  return /^[0-9A-Za-z]+$/.test(reste) ? reste : null;
}

/**
 * URL publique de l'annonce sur France Travail, ou null si le signal n'en désigne
 * pas une. Jamais pour une fixture : son identifiant est inventé et ne mène nulle part.
 */
export function lienOffreFrancetravail(s: SignalLiable): string | null {
  if (s.source !== "francetravail") return null;
  const id = idOffreFrancetravail(s);
  return id ? `${BASE_OFFRE_FT}${encodeURIComponent(id)}` : null;
}
