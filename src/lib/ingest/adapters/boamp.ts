/**
 * BOAMP — Bulletin officiel des annonces de marchés publics, API Opendatasoft de la DILA.
 * ENDPOINT VÉRIFIÉ le 28/08/2026 par appels réels (voir docs/sources.md) :
 *   GET https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records
 *       ?refine=code_departement:<dept>&where=dateparution>=date'YYYY-MM-DD'
 *       &order_by=dateparution DESC&limit=100&offset=&select=…
 *
 * Pièges vérifiés :
 *   - `code_departement` est un TABLEAU de chaînes SANS zéro initial : « 3 » pour
 *     l'Allier (« 03 » renvoie 0 résultat). Un avis peut porter plusieurs départements.
 *   - `refine=` filtre les tableaux ; `where=` ne sait pas le faire sur ce champ.
 *   - `titulaire`, `type_marche`, `descripteur_libelle` sont des tableaux (avec
 *     doublons possibles dans `titulaire`) — on accepte aussi une chaîne JSON.
 *   - `nature` : APPEL_OFFRE, ATTRIBUTION, RECTIFICATIF, PRE-INFORMATION, ANNULATION…
 *
 * Le champ `donnees` (VÉRIFIÉ le 10/09/2026 sur des avis réels) porte l'avis
 * structuré, et bien plus que les colonnes plates :
 *   - ATTRIBUTION.DECISION[] → TITULAIRE.{DENOMINATION, ADRESSE, CP, VILLE},
 *     RENSEIGNEMENT.MONTANT (« #text »), RENSEIGNEMENT.DATE_ATTRIBUTION, NUM_LOT ;
 *   - OBJET.CPV.PRINCIPAL (objet ou tableau), OBJET.LOTS.LOT[].CPV ;
 *   - IDENTITE.{CP, VILLE} de l'acheteur, OBJET.LIEU_EXEC_LIVR.{ADRESSE, CODE_NUTS} ;
 *   - `annonce_lie` : l'idweb de l'appel d'offres auquel l'attribution répond.
 * Le code postal du titulaire débloque le blocage géographique du rapprochement,
 * le montant supprime le facteur « montant inconnu » dès le jour J, et la commune
 * de l'acheteur donne un lieu du besoin.
 *
 * Trois signaux :
 *   - ATTRIBUTION → MARCHE_ATTRIBUE par titulaire, avec montant, CPV, lieu ;
 *   - APPEL_OFFRE encore ouvert → AO_OUVERT, signal de bassin (aucun SIRET), pour Tempo ;
 *   - APPEL_OFFRE encore ouvert dont le même acheteur avait attribué un marché
 *     semblable → AO_RENOUVELLEMENT sur chaque titulaire sortant : son marché est
 *     remis en concurrence, lui et ses concurrents habituels vont devoir staffer.
 *     Anticipation : le lead existe AVANT l'attribution.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SignalLieu, SourceAdapter } from "../types";
import { romesDeLibelleMarche } from "../../reference/metiers";
import { trigramSimilarity } from "../../matching/trigram";
import { geocoderCommune } from "../geocode";

const BASE = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const limiter = new RateLimiter(5);

const CHAMPS = [
  "id",
  "idweb",
  "dateparution",
  "datelimitereponse",
  "nomacheteur",
  "objet",
  "nature",
  "type_marche",
  "descripteur_libelle",
  "titulaire",
  "code_departement",
  "code_departement_prestation",
  "procedure_libelle",
  "url_avis",
  "famille_libelle",
  "perimetre",
  "annonce_lie",
  "donnees",
].join(",");

/** Un champ multivalué Opendatasoft : tableau, chaîne JSON, chaîne simple ou nul. */
const liste = z
  .union([z.array(z.union([z.string(), z.number()])), z.string(), z.number(), z.null()])
  .optional()
  .transform((v): string[] => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === "number") return [String(v)];
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p.map(String).map((x) => x.trim()).filter(Boolean);
      } catch {
        // pas du JSON : chaîne simple
      }
    }
    return s ? [s] : [];
  });

export const boampRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  idweb: z.string().nullish(),
  dateparution: z.string(),
  datelimitereponse: z.string().nullish(),
  nomacheteur: z.string().nullish(),
  objet: z.string().nullish(),
  nature: z.string().nullish(),
  type_marche: liste,
  descripteur_libelle: liste,
  titulaire: liste,
  code_departement: liste,
  code_departement_prestation: liste,
  procedure_libelle: z.string().nullish(),
  url_avis: z.string().nullish(),
  famille_libelle: z.string().nullish(),
  perimetre: z.string().nullish(),
  annonce_lie: liste,
  /** Avis structuré (JSON en chaîne ou objet). Lu par `lireDonnees`. */
  donnees: z.unknown().nullish(),
});

const pageSchema = z.object({
  total_count: z.number(),
  results: z.array(z.unknown()),
});

/** Titulaire sortant d'un marché semblable du même acheteur (anticipation). */
export type Renouvellement = {
  titulaire: string;
  codePostal: string | null;
  ville: string | null;
  idwebPrecedent: string;
  dateParutionPrecedente: string;
  objetPrecedent: string | null;
  montantPrecedent: number | null;
};

export type BoampRaw = z.infer<typeof boampRecordSchema> & {
  /** Commune de l'acheteur, géocodée à la lecture : le lieu du besoin d'un marché local. */
  lieu?: SignalLieu | null;
  /** Pour un appel d'offres ouvert : les titulaires du marché précédent semblable. */
  renouvellements?: Renouvellement[];
};

/** « 03 » → « 3 » (tel que stocké par le BOAMP), « 2A »/« 2B » inchangés. */
export function departementBoamp(departement: string): string {
  const d = departement.trim().toUpperCase();
  if (/^2[AB]$/.test(d)) return d;
  return d.replace(/^0+/, "") || d;
}

const TITULAIRES_VIDES = /^(sans suite|non attribu|infructueu|d[ée]clar[ée] sans suite|n[ée]ant|-+)/i;

/** Titulaires dédoublonnés (casse ignorée) et sans mention d'absence d'attribution. */
export function titulairesDe(raw: BoampRaw): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const t of raw.titulaire) {
    const nom = t.replace(/\s+/g, " ").trim();
    if (!nom || TITULAIRES_VIDES.test(nom)) continue;
    const cle = nom.toUpperCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(nom);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lecture de l'avis structuré (`donnees`)
// ---------------------------------------------------------------------------

export type Decision = {
  denomination: string;
  codePostal: string | null;
  ville: string | null;
  montant: number | null;
  dateAttribution: string | null;
  numLot: string | null;
};

export type DonneesLues = {
  acheteurCodePostal: string | null;
  acheteurVille: string | null;
  cpv: string[];
  lieuExecution: string | null;
  decisions: Decision[];
};

type Obj = Record<string, unknown>;

function estObjet(x: unknown): x is Obj {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** Un nœud XML→JSON est tantôt un objet, tantôt un tableau, tantôt absent. */
function enListe(x: unknown): Obj[] {
  if (Array.isArray(x)) return x.filter(estObjet);
  return estObjet(x) ? [x] : [];
}

/** Valeur textuelle d'un nœud : chaîne, nombre, ou objet { "#text": … } (attributs XML). */
function texte(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x === "string") return x.trim() || null;
  if (typeof x === "number") return String(x);
  if (estObjet(x) && "#text" in x) return texte(x["#text"]);
  return null;
}

function nombre(x: unknown): number | null {
  const t = texte(x);
  if (t == null) return null;
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function codePostal(x: unknown): string | null {
  const t = texte(x)?.replace(/\D/g, "") ?? "";
  return /^\d{5}$/.test(t) ? t : null;
}

function cpvDe(noeud: unknown): string[] {
  const out: string[] = [];
  for (const c of enListe(noeud)) {
    const p = texte(c.PRINCIPAL);
    if (p) out.push(p.replace(/[^0-9]/g, ""));
  }
  return out;
}

/** Premier objet d'un nœud (objet ou tableau), ou {} — les extensions UBL sont souvent des tableaux à un élément. */
function premier(x: unknown): Obj {
  return enListe(x)[0] ?? {};
}

/** Descente sûre dans un arbre UBL : `chemin(root, "a", "b")` = premier(root.a).b. */
function chemin(o: unknown, ...cles: string[]): unknown {
  let cur: unknown = o;
  for (const k of cles) {
    if (!estObjet(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Avis au format eForms (norme européenne, 87 % des attributions de l'Allier sur
 * 90 jours au 10/09/2026 : 33 sur 38). Structure UBL, VÉRIFIÉE sur des avis réels :
 *   root = EFORMS.ContractAwardNotice | EFORMS.ContractNotice
 *   EXT  = root/ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/efext:EformsExtension
 *   EXT/efac:Organizations/efac:Organization[]/efac:Company → cac:PartyIdentification/cbc:ID,
 *        cac:PartyName/cbc:Name, cac:PostalAddress/{cbc:PostalZone, cbc:CityName}
 *   root/cac:ContractingParty/cac:Party/cac:PartyIdentification/cbc:ID → l'acheteur (ORG-…)
 *   EXT/efac:NoticeResult/efac:LotResult[] (cbc:TenderResultCode = selec-w) → efac:LotTender/cbc:ID (TEN-…),
 *        efac:SettledContract/cbc:ID (CON-…)
 *   EXT/efac:NoticeResult/efac:LotTender[] → cbc:ID, efac:TenderingParty/cbc:ID (TPA-…),
 *        cac:LegalMonetaryTotal/cbc:PayableAmount
 *   EXT/efac:NoticeResult/efac:TenderingParty[] → cbc:ID, efac:Tenderer/cbc:ID (ORG-… : le gagnant)
 *   EXT/efac:NoticeResult/efac:SettledContract[] → cbc:ID, cbc:IssueDate (date d'attribution)
 *   root/cac:ProcurementProject/cac:MainCommodityClassification/cbc:ItemClassificationCode (CPV),
 *        cac:RealizedLocation[]/cac:Address/{cbc:CityName, cbc:PostalZone, cbc:CountrySubentityCode}
 * Les identifiants (ORG-0004) ne sont que des références internes à l'avis ; le
 * CompanyID n'est pas un SIRET (UUID ou numéro interne) : le titulaire reste rapproché par nom + code postal.
 */
export function lireEforms(eforms: Obj): DonneesLues {
  const root = premier(eforms.ContractAwardNotice ?? eforms.ContractNotice ?? eforms.PriorInformationNotice);
  const ext = premier(
    chemin(premier(chemin(premier(chemin(root, "ext:UBLExtensions")), "ext:UBLExtension")), "ext:ExtensionContent", "efext:EformsExtension"),
  );

  // Annuaire des organisations de l'avis
  const orgs = new Map<string, { nom: string | null; codePostal: string | null; ville: string | null }>();
  for (const o of enListe(chemin(premier(chemin(ext, "efac:Organizations")), "efac:Organization"))) {
    const company = premier(o["efac:Company"]);
    const id = texte(chemin(premier(company["cac:PartyIdentification"]), "cbc:ID"));
    if (!id) continue;
    const adresse = premier(company["cac:PostalAddress"]);
    orgs.set(id, {
      nom: texte(chemin(premier(company["cac:PartyName"]), "cbc:Name")),
      codePostal: codePostal(adresse["cbc:PostalZone"]),
      ville: texte(adresse["cbc:CityName"]),
    });
  }

  const acheteurId = texte(chemin(premier(chemin(premier(root["cac:ContractingParty"]), "cac:Party")), "cac:PartyIdentification", "cbc:ID"));
  const acheteur = acheteurId ? orgs.get(acheteurId) : undefined;

  // CPV : principal, additionnels, puis ceux des lots
  const projet = premier(root["cac:ProcurementProject"]);
  const cpv: string[] = [];
  const ajouterCpv = (n: unknown) => {
    for (const c of enListe(n)) {
      const code = texte(c["cbc:ItemClassificationCode"])?.replace(/[^0-9]/g, "");
      if (code && !cpv.includes(code)) cpv.push(code);
    }
  };
  ajouterCpv(projet["cac:MainCommodityClassification"]);
  ajouterCpv(projet["cac:AdditionalCommodityClassification"]);
  for (const lot of enListe(root["cac:ProcurementProjectLot"])) {
    ajouterCpv(chemin(premier(lot["cac:ProcurementProject"]), "cac:MainCommodityClassification"));
  }

  // Lieu d'exécution : la première adresse nommée (les avis ne donnent souvent qu'un code NUTS)
  let lieuExecution: string | null = null;
  const lieux = [
    ...enListe(projet["cac:RealizedLocation"]),
    ...enListe(root["cac:ProcurementProjectLot"]).flatMap((lot) =>
      enListe(chemin(premier(lot["cac:ProcurementProject"]), "cac:RealizedLocation")),
    ),
  ];
  for (const l of lieux) {
    const a = premier(l["cac:Address"]);
    const ville = texte(a["cbc:CityName"]);
    const cp = codePostal(a["cbc:PostalZone"]);
    if (ville || cp) {
      lieuExecution = [cp, ville].filter(Boolean).join(" ");
      break;
    }
  }

  // Gagnants : LotResult (selec-w) → LotTender → TenderingParty → Tenderer → Organization
  const resultat = premier(ext["efac:NoticeResult"]);
  const tenders = new Map<string, { tpa: string | null; montant: number | null }>();
  for (const t of enListe(resultat["efac:LotTender"])) {
    const id = texte(t["cbc:ID"]);
    if (!id) continue;
    tenders.set(id, {
      tpa: texte(chemin(premier(t["efac:TenderingParty"]), "cbc:ID")),
      montant: nombre(chemin(premier(t["cac:LegalMonetaryTotal"]), "cbc:PayableAmount")),
    });
  }
  const parties = new Map<string, string[]>();
  for (const p of enListe(resultat["efac:TenderingParty"])) {
    const id = texte(p["cbc:ID"]);
    if (!id) continue;
    parties.set(
      id,
      enListe(p["efac:Tenderer"]).map((t) => texte(t["cbc:ID"])).filter((x): x is string => !!x),
    );
  }
  const contrats = new Map<string, string | null>();
  for (const c of enListe(resultat["efac:SettledContract"])) {
    const id = texte(c["cbc:ID"]);
    if (id) contrats.set(id, texte(c["cbc:IssueDate"]));
  }

  const decisions: Decision[] = [];
  for (const lr of enListe(resultat["efac:LotResult"])) {
    const statut = texte(lr["cbc:TenderResultCode"]);
    if (statut && statut !== "selec-w") continue;
    const tenderId = texte(chemin(premier(lr["efac:LotTender"]), "cbc:ID"));
    const tender = tenderId ? tenders.get(tenderId) : undefined;
    if (!tender?.tpa) continue;
    const contratId = texte(chemin(premier(lr["efac:SettledContract"]), "cbc:ID"));
    const dateAttribution = (contratId ? contrats.get(contratId) : null) ?? null;
    const numLot = texte(chemin(premier(lr["efac:TenderLot"]), "cbc:ID"));
    for (const orgId of parties.get(tender.tpa) ?? []) {
      const org = orgs.get(orgId);
      if (!org?.nom || TITULAIRES_VIDES.test(org.nom)) continue;
      decisions.push({
        denomination: org.nom.replace(/\s+/g, " "),
        codePostal: org.codePostal,
        ville: org.ville,
        montant: tender.montant,
        dateAttribution: dateAttribution && /^\d{4}-\d{2}-\d{2}/.test(dateAttribution) ? dateAttribution.slice(0, 10) : null,
        numLot,
      });
    }
  }

  return {
    acheteurCodePostal: acheteur?.codePostal ?? null,
    acheteurVille: acheteur?.ville ?? null,
    cpv,
    lieuExecution,
    decisions,
  };
}

export function lireDonnees(donnees: unknown): DonneesLues {
  const vide: DonneesLues = { acheteurCodePostal: null, acheteurVille: null, cpv: [], lieuExecution: null, decisions: [] };
  let d: unknown = donnees;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return vide;
    }
  }
  if (!estObjet(d)) return vide;
  if (estObjet(d.EFORMS)) return lireEforms(d.EFORMS);

  const identite = estObjet(d.IDENTITE) ? d.IDENTITE : {};
  const objet = estObjet(d.OBJET) ? d.OBJET : {};
  const cpv = [...cpvDe(objet.CPV)];
  const lots = estObjet(objet.LOTS) ? enListe(objet.LOTS.LOT) : [];
  for (const lot of lots) for (const c of cpvDe(lot.CPV)) if (!cpv.includes(c)) cpv.push(c);
  const lieuExec = estObjet(objet.LIEU_EXEC_LIVR) ? texte(objet.LIEU_EXEC_LIVR.ADRESSE) : null;

  const decisions: Decision[] = [];
  const attribution = estObjet(d.ATTRIBUTION) ? d.ATTRIBUTION : {};
  for (const dec of enListe(attribution.DECISION)) {
    const renseignement = estObjet(dec.RENSEIGNEMENT) ? dec.RENSEIGNEMENT : {};
    const montant = nombre(renseignement.MONTANT);
    const dateAttribution = texte(renseignement.DATE_ATTRIBUTION);
    const numLot = texte(dec.NUM_LOT);
    for (const t of enListe(dec.TITULAIRE)) {
      const denomination = texte(t.DENOMINATION);
      if (!denomination || TITULAIRES_VIDES.test(denomination)) continue;
      decisions.push({
        denomination: denomination.replace(/\s+/g, " "),
        codePostal: codePostal(t.CP),
        ville: texte(t.VILLE),
        montant,
        dateAttribution: dateAttribution && /^\d{4}-\d{2}-\d{2}/.test(dateAttribution) ? dateAttribution.slice(0, 10) : null,
        numLot,
      });
    }
  }

  return {
    acheteurCodePostal: codePostal(identite.CP),
    acheteurVille: texte(identite.VILLE),
    cpv,
    lieuExecution: lieuExec,
    decisions,
  };
}

/** Titulaires d'un avis, regroupés : un titulaire cité sur plusieurs lots cumule ses montants. */
export function titulairesDetailles(raw: BoampRaw): (Decision & { nbLots: number })[] {
  const lues = lireDonnees(raw.donnees);
  const parNom = new Map<string, Decision & { nbLots: number }>();
  for (const dec of lues.decisions) {
    const cle = dec.denomination.toUpperCase();
    const deja = parNom.get(cle);
    if (deja) {
      deja.montant = deja.montant != null || dec.montant != null ? (deja.montant ?? 0) + (dec.montant ?? 0) : null;
      deja.nbLots++;
      deja.codePostal ??= dec.codePostal;
      deja.ville ??= dec.ville;
      deja.dateAttribution ??= dec.dateAttribution;
    } else {
      parNom.set(cle, { ...dec, nbLots: 1 });
    }
  }
  if (parNom.size > 0) return [...parNom.values()];
  // Repli : les colonnes plates, sans adresse ni montant.
  return titulairesDe(raw).map((denomination) => ({
    denomination,
    codePostal: null,
    ville: null,
    montant: null,
    dateAttribution: null,
    numLot: null,
    nbLots: 1,
  }));
}

/** Département sur deux caractères tel que le reste du projet l'écrit (« 3 » → « 03 »). */
function departementProjet(raw: BoampRaw): string | null {
  const d = raw.code_departement_prestation[0] ?? raw.code_departement[0];
  if (!d) return null;
  const u = d.toUpperCase();
  if (/^2[AB]$/.test(u)) return u;
  return u.padStart(2, "0");
}

function normaliserObjet(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const JOUR_MS = 86400000;
/** Un appel d'offres reste « ouvert » quelques semaines après sa date limite : l'attribution suit. */
const AO_RECENT_JOURS = 30;
/** Profondeur de recherche des marchés précédents d'un acheteur. */
const RENOUVELLEMENT_ANNEES = 6;
/** Similarité d'objet minimale pour dire « c'est le même marché qui revient ». */
const RENOUVELLEMENT_SIMILARITE = 0.35;

function aoEncoreOuvert(raw: BoampRaw, now: Date): boolean {
  if (!raw.datelimitereponse) return true;
  const limite = new Date(raw.datelimitereponse).getTime();
  return !Number.isFinite(limite) || limite >= now.getTime() - AO_RECENT_JOURS * JOUR_MS;
}

/**
 * Le marché semblable précédent : même acheteur, objet proche ou même descripteur,
 * attribué dans les six dernières années. Ses titulaires sont les sortants.
 */
export function marchesSemblables(ao: BoampRaw, attributions: BoampRaw[]): BoampRaw[] {
  const objetAo = normaliserObjet(ao.objet);
  const descripteurs = new Set(ao.descripteur_libelle.map((d) => d.toLowerCase()));
  return attributions.filter((a) => {
    if (a.idweb && ao.idweb && a.idweb === ao.idweb) return false;
    const memeDescripteur = a.descripteur_libelle.some((d) => descripteurs.has(d.toLowerCase()));
    const objetA = normaliserObjet(a.objet);
    const proche = objetAo && objetA ? trigramSimilarity(objetAo, objetA) >= RENOUVELLEMENT_SIMILARITE : false;
    return proche || (memeDescripteur && objetAo && objetA && trigramSimilarity(objetAo, objetA) >= RENOUVELLEMENT_SIMILARITE / 2);
  });
}

/**
 * Jours entre la parution de l'appel d'offres et le démarrage probable du marché
 * suivant : la date limite de remise des offres, puis l'attribution (~2 mois).
 */
export function picRenouvellement(raw: BoampRaw): number {
  const parution = new Date(raw.dateparution).getTime();
  const limite = raw.datelimitereponse ? new Date(raw.datelimitereponse).getTime() : NaN;
  const delaiLimite = Number.isFinite(limite) ? Math.max(0, Math.floor((limite - parution) / JOUR_MS)) : 45;
  return Math.round(Math.max(30, delaiLimite + 60));
}

async function attributionsDeLAcheteur(nomacheteur: string, departement: string): Promise<BoampRaw[]> {
  const depuis = new Date(Date.now() - RENOUVELLEMENT_ANNEES * 365 * JOUR_MS).toISOString().slice(0, 10);
  const nom = nomacheteur.replace(/\\/g, " ").replace(/"/g, '\\"');
  const where = encodeURIComponent(`nomacheteur="${nom}" AND dateparution>=date'${depuis}'`);
  const url =
    `${BASE}?refine=${encodeURIComponent(`code_departement:${departement}`)}` +
    `&refine=${encodeURIComponent("nature:ATTRIBUTION")}` +
    `&where=${where}&order_by=dateparution%20DESC&limit=50&select=${encodeURIComponent(CHAMPS)}`;
  try {
    const body = pageSchema.parse(await fetchJsonCache("boamp", url, limiter, { ttlMs: 7 * 24 * 3600 * 1000 }));
    return body.results.map((b) => boampRecordSchema.safeParse(b)).filter((p) => p.success).map((p) => p.data as BoampRaw);
  } catch {
    return []; // l'anticipation est un plus : son échec n'arrête pas l'ingestion
  }
}

/**
 * Enrichit un avis à la lecture : lieu du besoin (commune de l'acheteur) et, pour
 * un appel d'offres ouvert, les titulaires sortants du marché semblable précédent.
 */
export async function enrichirAvis(raw: BoampRaw, departementRefine: string, now = new Date()): Promise<BoampRaw> {
  const nature = (raw.nature ?? "").toUpperCase();
  if (nature !== "ATTRIBUTION" && nature !== "APPEL_OFFRE") return raw;
  const lues = lireDonnees(raw.donnees);
  const departement = departementProjet(raw);
  // Le lieu d'exécution nommé prime sur l'adresse de l'acheteur (eForms le donne
  // parfois en clair) ; à défaut, la commune de l'acheteur.
  const execution = lues.lieuExecution?.match(/^(\d{5})?\s*(.*)$/);
  const point =
    execution && (execution[1] || execution[2])
      ? await geocoderCommune({ codePostal: execution[1] ?? null, nom: execution[2] || null, departement })
      : lues.acheteurCodePostal || lues.acheteurVille
        ? await geocoderCommune({ codePostal: lues.acheteurCodePostal, nom: lues.acheteurVille, departement })
        : null;
  const lieu: SignalLieu | null = point ? { lat: point.lat, lon: point.lon, libelle: point.libelle || lues.acheteurVille } : null;

  let renouvellements: Renouvellement[] | undefined;
  if (nature === "APPEL_OFFRE" && raw.nomacheteur && aoEncoreOuvert(raw, now)) {
    const anterieures = await attributionsDeLAcheteur(raw.nomacheteur, departementRefine);
    const vus = new Set<string>();
    renouvellements = [];
    for (const a of marchesSemblables(raw, anterieures)) {
      for (const t of titulairesDetailles(a)) {
        const cle = t.denomination.toUpperCase();
        if (vus.has(cle)) continue;
        vus.add(cle);
        renouvellements.push({
          titulaire: t.denomination,
          codePostal: t.codePostal,
          ville: t.ville,
          idwebPrecedent: a.idweb ?? a.id,
          dateParutionPrecedente: a.dateparution.slice(0, 10),
          objetPrecedent: a.objet ?? null,
          montantPrecedent: t.montant,
        });
      }
      if (renouvellements.length >= 5) break;
    }
  }
  return { ...raw, lieu, renouvellements };
}

export const boampAdapter: SourceAdapter<BoampRaw> = {
  id: "boamp",

  async *fetch(params: FetchParams): AsyncIterable<BoampRaw> {
    const departement = departementBoamp(params.departement ?? "03");
    const depuis = new Date(Date.now() - (params.depuisJours ?? 90) * JOUR_MS).toISOString().slice(0, 10);

    let offset = 0;
    const limit = 100;
    for (;;) {
      const where = encodeURIComponent(`dateparution>=date'${depuis}'`);
      const url =
        `${BASE}?refine=${encodeURIComponent(`code_departement:${departement}`)}` +
        `&where=${where}&order_by=dateparution%20DESC&limit=${limit}&offset=${offset}` +
        `&select=${encodeURIComponent(CHAMPS)}`;
      const body = pageSchema.parse(await fetchJsonCache("boamp", url, limiter));
      for (const brut of body.results) {
        const parsed = boampRecordSchema.safeParse(brut);
        if (!parsed.success) throw new Error(`[boamp] réponse inattendue : ${parsed.error.issues[0]?.message}`);
        yield await enrichirAvis(parsed.data, departement);
      }
      offset += limit;
      if (offset >= body.total_count || offset >= 9900 || body.results.length < limit) break;
    }
  },

  normalize(raw: BoampRaw): NormalizedRecord[] {
    const nature = (raw.nature ?? "").toUpperCase();
    const idweb = raw.idweb ?? raw.id;
    const parution = `${raw.dateparution.slice(0, 10)}T00:00:00.000Z`;
    const romes = romesDeLibelleMarche([...raw.descripteur_libelle, raw.objet]);
    const departement = departementProjet(raw);
    const lues = lireDonnees(raw.donnees);
    const lieu = raw.lieu ?? null;

    if (nature === "ATTRIBUTION") {
      return titulairesDetailles(raw).map((t, index) => {
        // La date d'attribution précède la parution ; c'est d'elle que part le chantier.
        const attribuee = t.dateAttribution ? new Date(t.dateAttribution).getTime() : NaN;
        const parutionMs = new Date(parution).getTime();
        const occurredAt =
          Number.isFinite(attribuee) && attribuee <= parutionMs && parutionMs - attribuee <= 365 * JOUR_MS
            ? `${t.dateAttribution}T00:00:00.000Z`
            : parution;
        return {
          kind: "signal" as const,
          signal: {
            siret: null,
            siren: null,
            type: "MARCHE_ATTRIBUE",
            source: "boamp",
            occurredAt,
            confidence: 0.9,
            payload: {
              objet: raw.objet ?? null,
              acheteurNom: raw.nomacheteur ?? null,
              acheteurCodePostal: lues.acheteurCodePostal,
              acheteurVille: lues.acheteurVille,
              descripteur: raw.descripteur_libelle,
              typeMarche: raw.type_marche,
              procedure: raw.procedure_libelle ?? null,
              urlAvis: raw.url_avis ?? null,
              titulaire: t.denomination,
              titulaireCodePostal: t.codePostal,
              titulaireVille: t.ville,
              montant: t.montant,
              nbLots: t.nbLots,
              cpv: lues.cpv[0] ?? null,
              dateParution: raw.dateparution.slice(0, 10),
              dateAttribution: t.dateAttribution,
              lieuExecution: lues.lieuExecution,
              appelOffres: raw.annonce_lie[0] ?? null,
            },
            rawRef: `boamp-${idweb}-${index}`,
            lieu,
            romes,
            rapprochement: {
              denomination: t.denomination,
              codePostal: t.codePostal,
              departement: t.codePostal ? t.codePostal.slice(0, 2) : departement,
            },
          },
        };
      });
    }

    if (nature === "APPEL_OFFRE") {
      if (!aoEncoreOuvert(raw, new Date())) return [];
      const records: NormalizedRecord[] = [
        {
          kind: "signal",
          signal: {
            siret: null,
            siren: null,
            type: "AO_OUVERT",
            source: "boamp",
            occurredAt: parution,
            confidence: 1,
            payload: {
              objet: raw.objet ?? null,
              acheteurNom: raw.nomacheteur ?? null,
              acheteurCodePostal: lues.acheteurCodePostal,
              acheteurVille: lues.acheteurVille,
              descripteur: raw.descripteur_libelle,
              typeMarche: raw.type_marche,
              dateLimite: raw.datelimitereponse ?? null,
              procedure: raw.procedure_libelle ?? null,
              urlAvis: raw.url_avis ?? null,
              cpv: lues.cpv[0] ?? null,
              lieuExecution: lues.lieuExecution,
              departement,
            },
            rawRef: `ao-${idweb}`,
            lieu,
            romes,
          },
        },
      ];
      const picJours = picRenouvellement(raw);
      for (const [index, r] of (raw.renouvellements ?? []).entries()) {
        records.push({
          kind: "signal",
          signal: {
            siret: null,
            siren: null,
            type: "AO_RENOUVELLEMENT",
            source: "boamp",
            occurredAt: parution,
            confidence: 0.85,
            payload: {
              objet: raw.objet ?? null,
              objetPrecedent: r.objetPrecedent,
              acheteurNom: raw.nomacheteur ?? null,
              dateLimite: raw.datelimitereponse ?? null,
              urlAvis: raw.url_avis ?? null,
              titulaire: r.titulaire,
              idwebPrecedent: r.idwebPrecedent,
              dateParutionPrecedente: r.dateParutionPrecedente,
              montant: r.montantPrecedent,
              cpv: lues.cpv[0] ?? null,
              picJours,
            },
            rawRef: `renouv-${idweb}-${index}`,
            lieu,
            romes,
            rapprochement: {
              denomination: r.titulaire,
              codePostal: r.codePostal,
              departement: r.codePostal ? r.codePostal.slice(0, 2) : departement,
            },
          },
        });
      }
      return records;
    }

    return [];
  },

  fixture(): BoampRaw[] {
    const depuis = (j: number) => new Date(Date.now() - j * JOUR_MS).toISOString().slice(0, 10);
    const dans = (j: number) => new Date(Date.now() + j * JOUR_MS).toISOString();
    return [
      {
        id: "26_83186",
        idweb: "26-83186",
        dateparution: depuis(1),
        datelimitereponse: null,
        nomacheteur: "Ville Vichy",
        objet: "NETTOYAGE DES LOCAUX DE DIVERS SITES DE LA VILLE DE VICHY",
        nature: "ATTRIBUTION",
        type_marche: ["SERVICES"],
        descripteur_libelle: ["Nettoyage de locaux"],
        titulaire: ["Saines développement SAS", "Aber propreté azur SAS", "Saines développement SAS"],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Ouverte",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-83186",
        famille_libelle: "Marchés européens",
        perimetre: "DIRECTIVE-24",
        annonce_lie: ["26-40001"],
        donnees: JSON.stringify({
          IDENTITE: { DENOMINATION: "Ville Vichy", CP: "03200", VILLE: "Vichy" },
          OBJET: {
            CPV: { PRINCIPAL: "90911200" },
            LIEU_EXEC_LIVR: { ADRESSE: "Vichy", CODE_NUTS: "FRK11" },
          },
          ATTRIBUTION: {
            DECISION: [
              {
                NUM_LOT: "1",
                TITULAIRE: { DENOMINATION: "Saines développement SAS", ADRESSE: "12 rue des Sources", CP: "03200", VILLE: "Vichy" },
                RENSEIGNEMENT: { DATE_ATTRIBUTION: depuis(20), MONTANT: { "@DEVISE": "EUR", "#text": "120000" } },
              },
              {
                NUM_LOT: "2",
                TITULAIRE: { DENOMINATION: "Aber propreté azur SAS", ADRESSE: "ZI Est", CP: "03300", VILLE: "Cusset" },
                RENSEIGNEMENT: { DATE_ATTRIBUTION: depuis(20), MONTANT: { "@DEVISE": "EUR", "#text": "80000" } },
              },
              {
                NUM_LOT: "3",
                TITULAIRE: { DENOMINATION: "Saines développement SAS", ADRESSE: "12 rue des Sources", CP: "03200", VILLE: "Vichy" },
                RENSEIGNEMENT: { DATE_ATTRIBUTION: depuis(20), MONTANT: { "@DEVISE": "EUR", "#text": "30000" } },
              },
            ],
          },
        }),
      },
      {
        id: "26_83001",
        idweb: "26-83001",
        dateparution: depuis(2),
        datelimitereponse: dans(30),
        nomacheteur: "COMMUNE DE SAINT POURCAIN SUR SIOULE",
        objet: "Travaux d'aménagement de l'entrée Nord de l'agglomération de la Commune de Saint-Pourçain-sur-Sioule",
        nature: "APPEL_OFFRE",
        type_marche: ["TRAVAUX"],
        descripteur_libelle: ["Voirie et réseaux divers"],
        titulaire: [],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Adaptée",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-83001",
        famille_libelle: "Marchés <90 k€ (MAPA)",
        perimetre: "MAPA",
        annonce_lie: [],
        donnees: JSON.stringify({
          IDENTITE: { DENOMINATION: "COMMUNE DE SAINT POURCAIN SUR SIOULE", CP: "03500", VILLE: "Saint-Pourçain-sur-Sioule" },
          OBJET: { CPV: { PRINCIPAL: "45233140" } },
        }),
        renouvellements: [
          {
            titulaire: "DEMO TP BOURBONNAIS",
            codePostal: "03500",
            ville: "Saint-Pourçain-sur-Sioule",
            idwebPrecedent: "22-11111",
            dateParutionPrecedente: "2022-09-01",
            objetPrecedent: "Travaux d'aménagement de l'entrée Sud de l'agglomération",
            montantPrecedent: 210000,
          },
        ],
      },
      {
        id: "26_82900",
        idweb: "26-82900",
        dateparution: depuis(3),
        datelimitereponse: null,
        nomacheteur: "VILLE DE MONTLUCON",
        objet: "Mission de maîtrise d'œuvre pour la restauration de l'église Notre-Dame",
        nature: "RECTIFICATIF",
        type_marche: ["SERVICES"],
        descripteur_libelle: ["Maîtrise d'oeuvre"],
        titulaire: [],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Adaptée",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-82900",
        famille_libelle: "Marchés <90 k€ (MAPA)",
        perimetre: "MAPA",
        annonce_lie: [],
        donnees: null,
      },
    ];
  },
};
