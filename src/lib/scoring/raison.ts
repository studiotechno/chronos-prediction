/**
 * Explicabilité : raison d'appeler générée par templates DÉTERMINISTES
 * à partir des 2-3 signaux dominants, puis une PROPOSITION — les métiers à
 * proposer, la fenêtre, le lieu. Pas de LLM dans le chemin critique.
 */
import { trancheByCode } from "../reference/tranches";
import { ROME_LABELS } from "../reference/rome";
import type { SignalContribution, SignalScoringInput } from "./types";

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function dateFr(iso: string): string {
  const d = new Date(iso);
  const jour = d.getDate();
  return `${jour === 1 ? "1er" : jour} ${MOIS_FR[d.getMonth()]}`;
}

export function montantFr(montant: number): string {
  if (montant >= 1_000_000) {
    const m = montant / 1_000_000;
    return `${m.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  }
  return `${Math.round(montant / 1000)} k€`;
}

/** « Cariste CACES 3 (H/F) » → « cariste CACES 3 » */
export function metier(intitule: string): string {
  const nettoye = intitule.replace(/\s*\((H\/F|F\/H)\)\s*/gi, "").trim();
  return nettoye.charAt(0).toLowerCase() + nettoye.slice(1);
}

type SignalAvecPayload = SignalScoringInput & { contribution: number };

function str(payload: Record<string, unknown> | null, key: string): string {
  const v = payload?.[key];
  return typeof v === "string" ? v : "";
}

function num(payload: Record<string, unknown> | null, key: string): number {
  const v = payload?.[key];
  return typeof v === "number" ? v : 0;
}

/** Clause de phrase (sans majuscule initiale) pour un signal ou un groupe de signaux du même type. */
function clause(type: string, groupe: SignalAvecPayload[]): string | null {
  const s = groupe[0];
  const p = s.payload;
  switch (type) {
    case "OFFRE_REPUBLIEE":
      return `a republié ${num(p, "nbRepublications")} fois la même offre de ${metier(str(p, "intitule"))} depuis le ${dateFr(str(p, "premierePublication") || s.occurredAt)}`;
    case "OFFRE_REACTUALISEE":
      return `réactualise depuis le ${dateFr(str(p, "premierePublication") || s.occurredAt)} son offre de ${metier(str(p, "intitule"))} toujours non pourvue (${num(p, "nbActualisations")} actualisations)`;
    case "OFFRE_MANQUE_CANDIDATS":
      return `cherche un ${metier(str(p, "intitule"))} que France Travail signale en manque de candidats depuis le ${dateFr(s.occurredAt)}`;
    case "OFFRE_MULTIPOSTES":
      return `recrute ${num(p, "nombrePostes")} ${metier(str(p, "intitule"))} d'un coup depuis le ${dateFr(s.occurredAt)}`;
    case "MARCHE_ATTRIBUE": {
      const montant = num(p, "montant");
      const objet = str(p, "objet");
      const acheteur = str(p, "acheteurNom");
      const quoi = objet ? ` (${objet.length > 70 ? objet.slice(0, 67) + "…" : objet})` : "";
      const qui = acheteur ? ` pour ${acheteur}` : "";
      return montant > 0
        ? `a décroché un marché public de ${montantFr(montant)}${qui} le ${dateFr(s.occurredAt)}${quoi}`
        : `a décroché un marché public${qui} le ${dateFr(s.occurredAt)}${quoi}`;
    }
    case "OFFRE_DIRECTE": {
      if (groupe.length > 1) {
        const plusAncien = groupe.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b));
        return `a publié ${groupe.length} offres en direct depuis le ${dateFr(plusAncien.occurredAt)}`;
      }
      return `a publié une offre de ${metier(str(p, "intitule"))} en direct le ${dateFr(s.occurredAt)}`;
    }
    case "OFFRE_VELOCITE":
      return `a publié ${num(p, "nbOffres14j")} offres en 14 jours, très au-dessus de son rythme habituel`;
    case "CDD_COURT_REPETE":
      return `enchaîne ${num(p, "nbCdd")} CDD courts sur ${num(p, "fenetreJours") || 60} jours`;
    case "EFFECTIF_UP": {
      const avant = trancheByCode(str(p, "trancheAvant"))?.labelFr ?? "?";
      const apres = trancheByCode(str(p, "trancheApres"))?.labelFr ?? "?";
      return `est passé de ${avant} à ${apres}`;
    }
    case "CA_CROISSANCE":
      return `a vu son chiffre d'affaires progresser de ${Math.round(num(p, "deltaPct"))} % (exercice ${num(p, "annee") || "?"})`;
    case "BODACC_CAPITAL":
      return str(p, "typeAnnonce") === "fusion"
        ? `a annoncé une fusion au BODACC le ${dateFr(s.occurredAt)}`
        : `a réalisé une augmentation de capital le ${dateFr(s.occurredAt)}`;
    case "ACCORD_SURCHARGE":
      return `a signé le ${dateFr(s.occurredAt)} un accord sur ${str(p, "themesFr") || "le temps de travail"} : la capacité est tendue`;
    case "PERMIS_LOCAUX": {
      const surface = num(p, "surface");
      const dest = str(p, "destination");
      return `a obtenu un permis de construire${dest ? ` (${dest.toLowerCase()})` : ""}${surface > 0 ? ` de ${Math.round(surface).toLocaleString("fr-FR")} m²` : ""} le ${dateFr(s.occurredAt)}`;
    }
    case "ETAB_NOUVEAU": {
      const commune = str(p, "commune");
      return `a ouvert un établissement${commune ? ` à ${commune}` : " sur le bassin"} le ${dateFr(s.occurredAt)}`;
    }
    case "AO_RENOUVELLEMENT": {
      const acheteur = str(p, "acheteurNom");
      const limite = str(p, "dateLimite");
      const objet = str(p, "objetPrecedent") || str(p, "objet");
      const quoi = objet ? ` (${objet.length > 60 ? objet.slice(0, 57) + "…" : objet})` : "";
      return `voit son marché${acheteur ? ` avec ${acheteur}` : ""} remis en concurrence${limite ? `, offres attendues le ${dateFr(limite)}` : ""}${quoi}`;
    }
    default:
      return null;
  }
}

/** Résumé court d'un signal (badges, timeline). */
export function resumeSignal(s: SignalScoringInput): string {
  const p = s.payload;
  switch (s.type) {
    case "OFFRE_REPUBLIEE":
      return `Republiée ×${num(p, "nbRepublications")} : ${metier(str(p, "intitule"))}`;
    case "OFFRE_REACTUALISEE":
      return `Réactualisée ×${num(p, "nbActualisations")} : ${metier(str(p, "intitule"))}`;
    case "OFFRE_MANQUE_CANDIDATS":
      // La puce dit déjà « Manque de candidats » : le résumé n'a plus qu'à
      // nommer le poste, sinon la ligne se répète mot pour mot.
      return capitalize(metier(str(p, "intitule"))) || "Manque de candidats";
    case "OFFRE_MULTIPOSTES":
      return `${num(p, "nombrePostes")} postes : ${metier(str(p, "intitule"))}`;
    case "MARCHE_ATTRIBUE": {
      const montant = num(p, "montant");
      const acheteur = str(p, "acheteurNom") || str(p, "acheteur");
      return montant > 0 ? `Marché ${montantFr(montant)} — ${acheteur}` : `Marché attribué — ${acheteur}`;
    }
    case "AO_OUVERT":
      return `Appel d'offres ${str(p, "acheteurNom")} : ${str(p, "objet").slice(0, 60)}`;
    case "OFFRE_DIRECTE":
      return `Offre ${str(p, "typeContrat") || "?"} : ${metier(str(p, "intitule"))}`;
    case "OFFRE_VELOCITE":
      return `${num(p, "nbOffres14j")} offres en 14 jours (baseline ${num(p, "baselineMoyenne").toLocaleString("fr-FR")})`;
    case "CDD_COURT_REPETE":
      return `${num(p, "nbCdd")} CDD < 3 mois sur ${num(p, "fenetreJours") || 60} jours`;
    case "EFFECTIF_UP": {
      const avant = trancheByCode(str(p, "trancheAvant"))?.labelFr ?? "?";
      const apres = trancheByCode(str(p, "trancheApres"))?.labelFr ?? "?";
      return `Effectif : ${avant} → ${apres}`;
    }
    case "CA_CROISSANCE":
      return `CA +${Math.round(num(p, "deltaPct"))} % (${num(p, "annee") || "?"})`;
    case "CA_BAISSE":
      return `CA ${Math.round(num(p, "deltaPct"))} % (${num(p, "annee") || "?"})`;
    case "BODACC_CAPITAL":
      return str(p, "typeAnnonce") === "fusion" ? "Fusion annoncée au BODACC" : `Augmentation de capital`;
    case "BODACC_RISQUE":
      return capitalize(str(p, "procedure") || "procédure collective");
    case "ACCORD_SURCHARGE":
      return `Accord : ${str(p, "themesFr") || "temps de travail"}`;
    case "ACCORD_RESTRUCTURATION":
      return `Accord : ${str(p, "themesFr") || "restructuration"}`;
    case "PERMIS_LOCAUX":
      return `Permis ${str(p, "destination") || "de locaux"}${num(p, "surface") > 0 ? ` · ${Math.round(num(p, "surface"))} m²` : ""}`;
    case "MISSION_CONCURRENT":
      return `${str(p, "agenceInterim")} : ${metier(str(p, "intitule"))} à ${str(p, "commune")}`;
    case "DEMANDE_ANONYME":
      return `Employeur non nommé : ${metier(str(p, "intitule"))} à ${str(p, "commune")}`;
    case "ETAB_NOUVEAU":
      return `Ouverture${str(p, "commune") ? ` à ${str(p, "commune")}` : ""} (${str(p, "naf") || "établissement"})`;
    case "AO_RENOUVELLEMENT":
      return `Remis en concurrence — ${str(p, "acheteurNom")}${str(p, "dateLimite") ? ` · offres le ${dateFr(str(p, "dateLimite"))}` : ""}`;
    default:
      return s.type;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type RaisonResult = {
  raisonFr: string;
  propositionFr: string | null;
  topSignals: { id: string; type: string; occurredAt: string; contribution: number; resumeFr: string }[];
};

function fenetreFr(fenetre: { debut: string; fin: string }, now: Date): string {
  const debut = new Date(fenetre.debut);
  const fin = new Date(fenetre.fin);
  if (debut.getTime() <= now.getTime() && now.getTime() <= fin.getTime()) {
    return `appeler maintenant, jusqu'au ${dateFr(fenetre.fin)}`;
  }
  if (debut.getTime() > now.getTime()) {
    return `appeler entre le ${dateFr(fenetre.debut)} et le ${dateFr(fenetre.fin)}`;
  }
  return `fenêtre passée depuis le ${dateFr(fenetre.fin)}`;
}

/**
 * La proposition : ce qu'on dit après « bonjour ». Métiers à proposer,
 * fenêtre, lieu — uniquement quand on a de quoi le dire.
 */
export function buildProposition(opts: {
  romesInduits: string[];
  fenetre: { debut: string; fin: string } | null;
  lieuFr: string | null;
  distanceKm: number | null;
  now: Date;
  /** Libellés métier publiés par la source, par code ROME. Priment sur le dictionnaire local. */
  libelles?: Map<string, string>;
  /** Faux quand le besoin est réel mais hors des secteurs et métiers de l'agence. */
  servable?: boolean;
}): string | null {
  const morceaux: string[] = [];
  if (opts.servable === false) morceaux.push("Hors secteurs et métiers de l'agence");
  // Un code ROME brut n'est pas un métier : « proposer : i1613 » ne se dit pas au
  // téléphone. On prend le libellé de la source, sinon celui du dictionnaire, et
  // à défaut on se tait sur ce métier-là plutôt que d'afficher un code.
  const metiers = opts.romesInduits
    .map((r) => opts.libelles?.get(r) ?? ROME_LABELS[r] ?? null)
    .filter((l): l is string => !!l)
    .map((l) => l.toLowerCase())
    .filter((l, i, tous) => tous.indexOf(l) === i)
    .slice(0, 3);
  if (metiers.length > 0) morceaux.push(`Proposer : ${metiers.join(", ")}`);
  if (opts.fenetre) morceaux.push(capitalize(fenetreFr(opts.fenetre, opts.now)));
  if (opts.lieuFr) {
    morceaux.push(
      `Besoin à ${opts.lieuFr}${opts.distanceKm != null ? ` (${opts.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} km)` : ""}`,
    );
  }
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/**
 * Assemble la raison d'appeler à partir des signaux dominants.
 * Exemple : « A republié 3 fois la même offre de cariste CACES 3 depuis le 12 août,
 * et a décroché un marché public de 480 k€ le 3 août. Secteur à fort recours à l'intérim. »
 */
export function buildRaison(
  signaux: SignalScoringInput[],
  contributions: SignalContribution[],
  opts: {
    tauxRecoursSecteur: number;
    seuilSecteurFort?: number;
    romesInduits?: string[];
    fenetre?: { debut: string; fin: string } | null;
    lieuFr?: string | null;
    distanceKm?: number | null;
    servable?: boolean;
    now?: Date;
  },
): RaisonResult {
  const parId = new Map(signaux.map((s) => [s.id, s]));
  const tries = [...contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const topSignals = tries.slice(0, 5).map((c) => {
    const s = parId.get(c.id)!;
    return {
      id: c.id,
      type: c.type,
      occurredAt: c.occurredAt,
      contribution: c.contribution,
      resumeFr: resumeSignal(s),
    };
  });

  // Groupes de signaux positifs par type, ordonnés par contribution cumulée
  const positifs = tries.filter((c) => c.contribution > 0);
  const groupes = new Map<string, SignalAvecPayload[]>();
  for (const c of positifs) {
    const s = parId.get(c.id);
    if (!s) continue;
    const g = groupes.get(c.type) ?? [];
    g.push({ ...s, contribution: c.contribution });
    groupes.set(c.type, g);
  }
  const groupesTries = [...groupes.entries()].sort(
    (a, b) =>
      b[1].reduce((s, x) => s + x.contribution, 0) - a[1].reduce((s, x) => s + x.contribution, 0),
  );

  const clauses: string[] = [];
  for (const [type, groupe] of groupesTries) {
    if (clauses.length >= 3) break;
    const c = clause(type, groupe);
    if (c) clauses.push(c);
  }

  let raison: string;
  if (clauses.length === 0) {
    raison = "Bon profil structurel, aucun déclencheur récent.";
  } else if (clauses.length === 1) {
    raison = `${capitalize(clauses[0])}.`;
  } else {
    const debut = clauses.slice(0, -1).join(", ");
    raison = `${capitalize(debut)}, et ${clauses[clauses.length - 1]}.`;
  }

  if (opts.tauxRecoursSecteur >= (opts.seuilSecteurFort ?? 5) && clauses.length > 0) {
    raison += " Secteur à fort recours à l'intérim.";
  }

  const risque = tries.find((c) => c.type === "BODACC_RISQUE");
  if (risque) {
    const s = parId.get(risque.id);
    const procedure = str(s?.payload ?? null, "procedure") || "procédure collective";
    raison += ` Attention : ${procedure} en cours depuis le ${dateFr(risque.occurredAt)}.`;
  }
  const restructuration = tries.find((c) => c.type === "ACCORD_RESTRUCTURATION");
  if (restructuration) {
    raison += ` Prudence : accord de restructuration signé le ${dateFr(restructuration.occurredAt)}.`;
  }

  // Les libellés métier viennent des signaux eux-mêmes quand la source les publie.
  const libelles = new Map<string, string>();
  for (const s of signaux) {
    const code = str(s.payload, "rome");
    const libelle = str(s.payload, "romeLibelle");
    if (code && libelle) libelles.set(code, libelle);
  }

  const propositionFr = buildProposition({
    romesInduits: opts.romesInduits ?? [],
    fenetre: opts.fenetre ?? null,
    lieuFr: opts.lieuFr ?? null,
    distanceKm: opts.distanceKm ?? null,
    now: opts.now ?? new Date(),
    libelles,
    servable: opts.servable,
  });

  return { raisonFr: raison, propositionFr, topSignals };
}
