/** Libellés français des types de signaux. */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  OFFRE_DIRECTE: "Offre directe",
  OFFRE_VELOCITE: "Accélération d'offres",
  OFFRE_REPUBLIEE: "Offre republiée",
  CDD_COURT_REPETE: "CDD courts répétés",
  MISSION_CONCURRENT: "Mission concurrente",
  MARCHE_ATTRIBUE: "Marché public attribué",
  EFFECTIF_UP: "Croissance d'effectif",
  BODACC_CAPITAL: "Mouvement de capital",
  BODACC_RISQUE: "Procédure collective",
};

export function signalTypeLabel(type: string): string {
  return SIGNAL_TYPE_LABELS[type] ?? type;
}
