/** Libellés français des types de signaux. */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  OFFRE_DIRECTE: "Offre directe",
  OFFRE_VELOCITE: "Accélération d'offres",
  OFFRE_REPUBLIEE: "Offre republiée",
  OFFRE_REACTUALISEE: "Offre réactualisée",
  OFFRE_MANQUE_CANDIDATS: "Manque de candidats",
  OFFRE_MULTIPOSTES: "Offre multipostes",
  CDD_COURT_REPETE: "CDD courts répétés",
  MISSION_CONCURRENT: "Mission concurrente",
  MARCHE_ATTRIBUE: "Marché public attribué",
  AO_OUVERT: "Appel d'offres ouvert",
  EFFECTIF_UP: "Croissance d'effectif",
  CA_CROISSANCE: "CA en hausse",
  CA_BAISSE: "CA en baisse",
  BODACC_CAPITAL: "Mouvement de capital",
  BODACC_RISQUE: "Procédure collective",
  ACCORD_SURCHARGE: "Accord de surcharge",
  ACCORD_RESTRUCTURATION: "Accord de restructuration",
  PERMIS_LOCAUX: "Permis de construire",
  ETAB_NOUVEAU: "Ouverture d'établissement",
  AO_RENOUVELLEMENT: "Marché remis en concurrence",
  DEMANDE_ANONYME: "Offre directe anonyme",
};

export function signalTypeLabel(type: string): string {
  return SIGNAL_TYPE_LABELS[type] ?? type;
}
