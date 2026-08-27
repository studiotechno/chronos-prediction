/** Libellés des codes ROME utilisés sur le bassin (sous-ensemble, pour affichage). */

export const ROME_LABELS: Record<string, string> = {
  D1401: "Assistanat commercial",
  F1201: "Conduite de travaux BTP",
  F1302: "Conduite d'engins de chantier",
  F1602: "Électricité bâtiment",
  F1603: "Installation sanitaire et thermique",
  F1607: "Pose de fermetures menuisées",
  F1701: "Construction en béton (coffreur)",
  F1702: "Construction de routes et voies",
  F1703: "Maçonnerie",
  F1704: "Préparation du gros œuvre (manœuvre)",
  H2102: "Conduite d'équipement agroalimentaire",
  H2902: "Chaudronnerie-tôlerie",
  H2903: "Usinage",
  H2913: "Soudage manuel",
  H3302: "Opérations manuelles d'assemblage",
  I1304: "Maintenance industrielle",
  K2202: "Lavage de vitres",
  K2204: "Nettoyage de locaux",
  M1203: "Comptabilité",
  M1402: "Conseil en organisation",
  M1805: "Études et développement informatique",
  N1101: "Conduite d'engins de manutention",
  N1103: "Magasinage et préparation de commandes",
  N1105: "Manutention manuelle de charges",
  N4101: "Conduite de transport de marchandises",
  N4105: "Conduite et livraison par tournées",
};

export function romeLabel(rome: string): string {
  return ROME_LABELS[rome] ?? rome;
}
