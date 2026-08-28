/**
 * Métiers ROME induits par un signal qui ne porte pas de ROME lui-même :
 * un marché public (descripteur BOAMP, CPV DECP), un permis de construire.
 * Une table de correspondance courte et lisible — la raison d'appeler s'en sert
 * pour proposer des métiers, et Tempo pour lire BMO et la conjoncture.
 */

type Regle = { motifs: RegExp; romes: string[] };

/**
 * Marchés dont l'objet cite un ouvrage sans qu'aucun ouvrier n'y travaille :
 * prestations intellectuelles, contrôle, assurance, fournitures. Sans ce filtre,
 * « vérifications périodiques obligatoires des bâtiments » proposerait des maçons
 * (cas réel, marché Vichy Communauté du 14 juin 2026) et « maîtrise d'œuvre pour
 * la réhabilitation de l'établissement thermal » aussi. Ces marchés vont à des
 * bureaux d'études ou à des négociants : le titulaire ne recrute pas d'intérim
 * de chantier. Prioritaire sur toutes les règles positives.
 */
const EXCLUSIONS = new RegExp(
  [
    "ma[îi]trise d.?\\s?(o?e?)uvre",
    "ma[îi]trise d.?ouvrage",
    "\\bmoe\\b",
    "\\bamo\\b",
    "assistance",
    "\\b[ée]tudes?\\b",
    "diagnostic",
    "audit",
    "expertise",
    "contr[ôo]le technique",
    "v[ée]rification",
    "coordination sps",
    "\\bsps\\b",
    "assurance",
    "emprunt",
    "\\bbancaire\\b",
    "informatique",
    "logiciel",
    "site internet",
    "t[ée]l[ée]communication",
    "t[ée]l[ée]phonie",
    "formation",
    "communication",
    "impression",
    "fourniture",
    "acquisition",
    "location de",
    "mobilier",
    "v[ée]hicule",
    "carburant",
    "denr[ée]es",
    "ma[îi]trise fonci[èe]re",
    "g[ée]om[èe]tre",
    "topograph",
    "architecte",
  ].join("|"),
  "i",
);

const REGLES_DESCRIPTEUR: Regle[] = [
  {
    // Les objets du BOAMP sont parfois nommés par une machine, sans espaces
    // (« AT03_TransportScolaire_19Lots_2026 ») : la règle doit le tolérer.
    motifs:
      // `\btad\b` ne mordrait pas dans « AT03_TAD_10lots » : en regex, « _ » est un
      // caractère de mot, donc il n'y a pas de frontière entre « _ » et « T ».
      /transport[\s_-]?scolaire|transport de voyageurs|autocar|transport en commun|navette|transport[\s_-]?[àa][\s_-]?la[\s_-]?demande|(?<![a-z0-9])tad(?![a-z0-9])/i,
    romes: ["N4103"],
  },
  {
    // « aménagement de l'entrée d'agglomération » est de la voirie, pas du gros œuvre.
    motifs:
      /voirie|r[ée]seaux|vrd|terrassement|assainissement|enrob|canalisation|trottoir|am[ée]nagement (de )?(l.)?(entr[ée]e|abords|place|rue|voie|carrefour|giratoire)/i,
    romes: ["F1702", "F1302", "F1704"],
  },
  {
    // « bâtiment » seul est trop large : « entretien des installations de chauffage
    // des bâtiments communaux » est un marché de chauffagiste, pas de maçon.
    motifs: /gros ?[oœ]uvre|ma[çc]onnerie|construction (d|de )|r[ée]habilitation|r[ée]novation|r[ée]fection|fa[çc]ade|ravalement|d[ée]molition|travaux de b[âa]timent/i,
    romes: ["F1703", "F1701", "F1704"],
  },
  { motifs: /[ée]lectricit|[ée]clairage/i, romes: ["F1602"] },
  { motifs: /plomberie|chauffage|climatisation|cvc|ventilation|sanitaire/i, romes: ["F1603"] },
  { motifs: /menuiserie|fermeture|serrurerie|m[ée]tallerie/i, romes: ["F1607"] },
  { motifs: /peinture|rev[êe]tement|sols?\b|carrelage|pl[âa]trerie|isolation/i, romes: ["F1606", "F1608"] },
  { motifs: /couverture|charpente|[ée]tanch[ée]it|toiture|zinguerie/i, romes: ["F1610", "F1503"] },
  // `\bménage\b` et non `ménage` : sans la borne, « aménagement » contient « ménage »
  // et tout marché de voirie proposait des agents d'entretien (cas réel, 28/08/2026).
  { motifs: /nettoyage|propret[ée]|entretien des locaux|\bm[ée]nage\b/i, romes: ["K2204"] },
  { motifs: /espaces? verts|[ée]lagage|paysag|tonte|d[ée]broussaill/i, romes: ["A1203"] },
  { motifs: /transport|d[ée]m[ée]nagement|livraison/i, romes: ["N4101", "N4105"] },
  { motifs: /collecte|d[ée]chets|ordures|d[ée]chetterie|encombrants/i, romes: ["K2303", "N4105"] },
  { motifs: /logistique|entreposage|manutention|stockage/i, romes: ["N1103", "N1105"] },
  {
    // Piège d'homonymie : la « restauration de l'Église Notre-Dame » n'est pas un
    // marché de restauration collective (cas réel, BOAMP Montluçon).
    motifs: /restauration (collective|scolaire|rapide)|service de restauration|restaurant|\brepas\b|cantine|cuisine centrale/i,
    romes: ["G1602", "G1605"],
  },
  { motifs: /gardiennage|s[ée]curit|surveillance/i, romes: ["K2503"] },
];

/** ROME induits par un libellé de marché (descripteur BOAMP, objet). Vide pour l'intellectuel (maîtrise d'œuvre, contrôle, assurance…). */
export function romesDeLibelleMarche(libelles: (string | null | undefined)[]): string[] {
  const texte = libelles.filter(Boolean).join(" · ");
  if (EXCLUSIONS.test(texte)) return [];
  const romes: string[] = [];
  for (const r of REGLES_DESCRIPTEUR) {
    if (r.motifs.test(texte)) for (const rome of r.romes) if (!romes.includes(rome)) romes.push(rome);
  }
  // Transporter des élèves n'est pas transporter des palettes : le métier de
  // voyageurs, plus précis, chasse celui de marchandises.
  if (romes.includes("N4103")) return romes.filter((r) => r !== "N4101" && r !== "N4105");
  // Filet de sécurité : un marché de travaux dont aucune règle ne reconnaît le
  // corps de métier reste un chantier — on propose le gros œuvre, sans inventer
  // de spécialité.
  if (romes.length === 0 && /\btravaux\b|\bchantier\b/i.test(texte)) return ["F1704", "F1703"];
  return romes;
}

/** ROME induits par un code CPV (DECP). */
export function romesDeCpv(cpv: string | null | undefined): string[] {
  if (!cpv) return [];
  const c = cpv.replace(/[^0-9]/g, "");
  if (c.startsWith("4523")) return ["F1702", "F1302", "F1704"];
  if (c.startsWith("4531")) return ["F1602"];
  if (c.startsWith("4533")) return ["F1603"];
  if (c.startsWith("4542")) return ["F1607"];
  if (c.startsWith("4544")) return ["F1606"];
  if (c.startsWith("4526")) return ["F1610", "F1503"];
  if (c.startsWith("4511")) return ["F1302", "F1704"];
  if (c.startsWith("45")) return ["F1703", "F1701", "F1704"];
  if (c.startsWith("9091") || c.startsWith("9092")) return ["K2204"];
  if (c.startsWith("905")) return ["K2303", "N4105"];
  if (c.startsWith("90")) return ["K2204", "K2303"];
  if (c.startsWith("77")) return ["A1203"];
  // Le CPV 60 couvre les deux transports : 6018/6024 sont des marchandises,
  // 601x/602x du transport de personnes (scolaire, urbain, à la demande).
  if (c.startsWith("6018") || c.startsWith("6024") || c.startsWith("6025")) return ["N4101", "N4105"];
  if (c.startsWith("601") || c.startsWith("602")) return ["N4103"];
  if (c.startsWith("60")) return ["N4101", "N4105"];
  if (c.startsWith("63")) return ["N1103", "N1105"];
  if (c.startsWith("55")) return ["G1602", "G1605"];
  if (c.startsWith("7971")) return ["K2503"];
  return [];
}

/** Métiers probables d'un permis de construire de locaux : chantier d'abord, exploitation ensuite. */
export function romesDePermis(destination: string | null | undefined): { chantier: string[]; exploitation: string[] } {
  const d = (destination ?? "").toLowerCase();
  const chantier = ["F1703", "F1701", "F1704", "F1602"];
  if (/entrep[ôo]t|logisti|stock/.test(d)) return { chantier, exploitation: ["N1103", "N1101", "N1105"] };
  if (/industri|usine|atelier|production/.test(d)) return { chantier, exploitation: ["H3302", "H2903", "I1304"] };
  if (/commerc|magasin|vente/.test(d)) return { chantier, exploitation: ["D1507", "N1103"] };
  if (/h[ôo]tel|h[ée]bergement|restaur/.test(d)) return { chantier, exploitation: ["G1602", "G1605"] };
  if (/agric|serre|[ée]levage/.test(d)) return { chantier, exploitation: ["A1416"] };
  return { chantier, exploitation: [] };
}
