/**
 * Détail d'un signal — ce qui s'ouvre quand on déplie une ligne de la chronologie.
 *
 * Un signal reste une dérivée datée : il ne recopie pas l'annonce. Quand il en
 * désigne une, on va rechercher la ligne de staging (`offre_brute`) et on sert son
 * contenu tel que la source l'a publié — description, salaire, compétences. Pour
 * les autres sources, le payload du signal est rendu à plat, avec des libellés
 * français : mieux vaut montrer ce qu'on a que laisser le commercial deviner.
 */
import type { offreBrute } from "./db/schema";
import { idOffreFrancetravail, lienOffreFrancetravail, type SignalLiable } from "./liens-signal";
import { trancheByCode } from "./reference/tranches";
import { dateCourte } from "./format";

export type OffreStaging = typeof offreBrute.$inferSelect;

export type Fait = { label: string; valeur: string };
export type BlocListe = { titre: string; items: string[] };
export type BlocTexte = { titre: string; corps: string };
export type Lien = { label: string; href: string };

export type DetailSignal = {
  faits: Fait[];
  listes: BlocListe[];
  textes: BlocTexte[];
  liens: Lien[];
};

// ---------------------------------------------------------------------------
// Lecture défensive du payload (jsonb : rien n'est garanti)
// ---------------------------------------------------------------------------

type Payload = Record<string, unknown> | null | undefined;

function txt(p: Payload, k: string): string | null {
  const v = p?.[k];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function vrai(p: Payload, k: string): boolean {
  return p?.[k] === true;
}

function liste(p: Payload, k: string): string[] | null {
  const v = p?.[k];
  if (!Array.isArray(v)) return null;
  const items = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return items.length > 0 ? items : null;
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

function euros(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€`;
  if (abs >= 10_000) return `${Math.round(n / 1000).toLocaleString("fr-FR")} k€`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

/**
 * « Mensuel de 1982.0 Euros à 2398.0 Euros sur 12 mois » →
 * « Mensuel de 1 982 € à 2 398 € sur 12 mois ». La source publie des décimales
 * anglo-saxonnes et le mot « Euros » en toutes lettres.
 */
export function salaireLisible(libelle: string): string {
  return libelle
    .replace(/(\d+)[.,](\d+)/g, (_, ent: string, dec: string) => {
      const n = Number(`${ent}.${dec}`);
      return Number.isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : `${ent},${dec}`;
    })
    .replace(/\bEuros?\b/gi, "€")
    .replace(/\s+/g, " ")
    .trim();
}

/** Une date ISO en date courte, sinon la valeur telle quelle. */
function dateSiPossible(v: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? dateCourte(v) : v;
}

function jours(n: number): string {
  if (n >= 30 && n % 30 === 0) return `${n / 30} mois`;
  return `${n.toLocaleString("fr-FR")} j`;
}

// ---------------------------------------------------------------------------
// Payload générique (sources hors France Travail)
// ---------------------------------------------------------------------------

/** Libellés français des clés de payload rencontrées dans les signaux. */
const LABELS_PAYLOAD: Record<string, string> = {
  intitule: "Poste",
  rome: "Code ROME",
  romeLibelle: "Métier",
  typeContrat: "Contrat",
  nombrePostes: "Postes à pourvoir",
  nbActualisations: "Réactualisations",
  premierePublication: "Première publication",
  nbRepublications: "Publications",
  nbOffres14j: "Offres sur 14 jours",
  baselineMoyenne: "Moyenne de référence",
  ecartsTypes: "Écarts-types au-dessus",
  nbCdd: "CDD courts",
  fenetreJours: "Fenêtre observée",
  dureeMoyenneJours: "Durée moyenne",
  objet: "Objet",
  montant: "Montant",
  cpv: "Code CPV",
  acheteur: "Acheteur",
  acheteurNom: "Acheteur",
  dureeMois: "Durée du marché",
  typeMarche: "Type de marché",
  descripteur: "Descripteur",
  dateLimite: "Date limite de réponse",
  procedure: "Procédure",
  tribunal: "Tribunal",
  denomination: "Dénomination publiée",
  typeAnnonce: "Nature de l'annonce",
  themesFr: "Thèmes de l'accord",
  idcc: "IDCC",
  ape: "Code APE",
  numero: "Numéro de dépôt",
  nature: "Nature de l'accord",
  raisonSociale: "Raison sociale",
  dateFin: "Fin d'application",
  annee: "Exercice",
  ca: "Chiffre d'affaires",
  caPrecedent: "Exercice précédent",
  deltaPct: "Variation",
  trancheAvant: "Effectif avant",
  trancheApres: "Effectif après",
  surface: "Surface",
  destination: "Destination",
  entrepriseNom: "Employeur annoncé",
  agenceInterim: "Agence",
  commune: "Commune",
  codePostal: "Code postal",
};

/** Clés déjà portées par l'en-tête de la ligne, ou purement techniques. */
const CLES_MASQUEES = new Set(["offreId", "urlAvis", "themes", "resumeFr"]);

function faitGenerique(cle: string, valeur: unknown): Fait | null {
  const label = LABELS_PAYLOAD[cle];
  if (!label || valeur == null) return null;

  if (cle === "trancheAvant" || cle === "trancheApres") {
    const t = trancheByCode(typeof valeur === "string" ? valeur : null);
    return t ? { label, valeur: t.labelFr } : null;
  }
  if (typeof valeur === "number") {
    if (cle === "montant" || cle === "ca" || cle === "caPrecedent") return { label, valeur: euros(valeur) };
    if (cle === "deltaPct") return { label, valeur: `${valeur > 0 ? "+" : ""}${valeur.toLocaleString("fr-FR")} %` };
    if (cle === "dureeMois") return { label, valeur: `${valeur.toLocaleString("fr-FR")} mois` };
    if (cle === "surface") return { label, valeur: `${Math.round(valeur).toLocaleString("fr-FR")} m²` };
    if (cle === "fenetreJours" || cle === "dureeMoyenneJours") return { label, valeur: jours(valeur) };
    return { label, valeur: valeur.toLocaleString("fr-FR") };
  }
  if (typeof valeur === "boolean") return { label, valeur: valeur ? "oui" : "non" };
  if (Array.isArray(valeur)) {
    const items = valeur.filter((x) => typeof x === "string" || typeof x === "number").map(String);
    return items.length > 0 ? { label, valeur: items.join(", ") } : null;
  }
  if (typeof valeur === "string" && valeur.trim().length > 0) {
    return { label, valeur: dateSiPossible(valeur.trim()) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Détail d'une offre France Travail
// ---------------------------------------------------------------------------

function detailOffre(o: OffreStaging): DetailSignal {
  const p = o.payload;
  const faits: Fait[] = [];
  const pousser = (label: string, valeur: string | null) => {
    if (valeur) faits.push({ label, valeur });
  };

  const contrat = txt(p, "typeContratLibelle") ?? o.typeContrat;
  pousser(
    "Contrat",
    contrat && o.dureeContratJours != null && !/\d/.test(contrat)
      ? `${contrat} · ${jours(o.dureeContratJours)}`
      : contrat,
  );
  const salaire = txt(p, "salaireLibelle");
  pousser("Salaire", salaire ? salaireLisible(salaire) : null);
  pousser("Précision salaire", txt(p, "salaireCommentaire"));
  // La source glisse des retours à la ligne dans ces libellés (« 35H/semaine\nHoraires annuels »).
  const horaires = liste(p, "horaires");
  pousser(
    "Temps de travail",
    (txt(p, "dureeTravailLibelle") ?? (horaires ? horaires.join(" · ") : null))?.replace(/\s*\n\s*/g, " · ") ?? null,
  );
  const exp = txt(p, "experienceLibelle");
  const expCom = txt(p, "experienceCommentaire");
  pousser("Expérience", exp ? (expCom ? `${exp} — ${expCom}` : exp) : null);
  pousser("Qualification", txt(p, "qualificationLibelle"));
  pousser("Postes à pourvoir", o.nombrePostes != null && o.nombrePostes > 1 ? String(o.nombrePostes) : null);
  pousser("Déplacements", txt(p, "deplacementLibelle"));
  pousser("Métier", txt(p, "appellationLibelle") ?? txt(p, "romeLibelle"));
  pousser("Code ROME", o.rome);
  pousser("Secteur de l'employeur", txt(p, "secteurActiviteLibelle"));
  pousser("Effectif annoncé", txt(p, "trancheEffectifEtabLibelle"));
  pousser(
    "Lieu de travail",
    [o.commune, o.codePostal].filter(Boolean).join(" ") || null,
  );
  pousser("Employeur annoncé", o.entrepriseNom ?? "annonce anonyme");
  pousser("Publiée le", dateCourte(o.datePublication));
  pousser(
    "Actualisée le",
    o.dateActualisation
      ? `${dateCourte(o.dateActualisation)}${o.nbActualisations > 0 ? ` (×${o.nbActualisations})` : ""}`
      : null,
  );
  pousser("Clôturée le", o.closedAt ? dateCourte(o.closedAt) : null);
  const drapeaux = [
    o.manqueCandidats === 1 ? "signalée difficile à pourvoir" : null,
    vrai(p, "alternance") ? "alternance" : null,
    vrai(p, "accessibleTH") ? "accessible aux travailleurs handicapés" : null,
    vrai(p, "entrepriseAdaptee") ? "entreprise adaptée" : null,
  ].filter(Boolean) as string[];
  pousser("Mentions", drapeaux.length > 0 ? drapeaux.join(", ") : null);
  pousser("Collectée chez", txt(p, "partenaire"));

  const listes: BlocListe[] = [];
  const ajouterListe = (titre: string, cle: string) => {
    const items = liste(p, cle);
    if (items) listes.push({ titre, items });
  };
  ajouterListe("Compétences attendues", "competences");
  ajouterListe("Savoir-être", "savoirEtre");
  ajouterListe("Formation", "formations");
  ajouterListe("Permis", "permis");
  ajouterListe("Langues", "langues");
  ajouterListe("Avantages", "salaireComplements");
  ajouterListe("Conditions d'exercice", "conditionsExercice");

  const textes: BlocTexte[] = [];
  const description = txt(p, "description");
  if (description) textes.push({ titre: "L'annonce", corps: description });
  const presentation = txt(p, "entrepriseDescription");
  if (presentation) textes.push({ titre: "L'employeur, par lui-même", corps: presentation });

  const liens: Lien[] = [];
  const url = txt(p, "urlOffre");
  if (url) liens.push({ label: "Voir l'offre sur France Travail", href: url });
  const site = txt(p, "entrepriseUrl");
  if (site) liens.push({ label: "Site de l'employeur", href: site });

  return { faits, listes, textes, liens };
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

/**
 * Détail dépliable d'un signal. `offres` est indexé par identifiant d'offre
 * France Travail ; il vient de la table de staging, chargée avec la fiche.
 * Retourne null quand il n'y a rien de plus à montrer que la ligne elle-même.
 */
export function detailSignal(
  s: SignalLiable & { type: string; payload: Record<string, unknown> | null },
  offres?: Map<string, OffreStaging>,
): DetailSignal | null {
  const idOffre = idOffreFrancetravail(s);
  const offre = idOffre ? offres?.get(idOffre) : undefined;

  const base: DetailSignal = offre
    ? detailOffre(offre)
    : { faits: [], listes: [], textes: [], liens: [] };

  // Ce que le signal ajoute par-dessus l'annonce : compteurs de dérivation
  // (réactualisations, republications, vélocité) et payloads des autres sources.
  const dejaVus = new Set(base.faits.map((f) => f.label));
  for (const [cle, valeur] of Object.entries(s.payload ?? {})) {
    if (CLES_MASQUEES.has(cle)) continue;
    const fait = faitGenerique(cle, valeur);
    if (fait && !dejaVus.has(fait.label)) {
      base.faits.push(fait);
      dejaVus.add(fait.label);
    }
  }

  // Un avis de marché public porte son propre lien.
  const urlAvis = txt(s.payload, "urlAvis");
  if (urlAvis) base.liens.push({ label: "Voir l'avis de marché", href: urlAvis });
  if (base.liens.length === 0) {
    const lienOffre = lienOffreFrancetravail(s);
    if (lienOffre) base.liens.push({ label: "Voir l'offre sur France Travail", href: lienOffre });
  }

  const vide =
    base.faits.length === 0 &&
    base.listes.length === 0 &&
    base.textes.length === 0 &&
    base.liens.length === 0;
  return vide ? null : base;
}
