/** Accès aux données pour les pages (server components). */
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { distanceKm } from "./scoring/geo";
import { resumeSignal } from "./scoring/raison";
import type { TopSignal } from "./db/schema";

export type LeadListe = {
  siret: string;
  denomination: string;
  commune: string | null;
  codePostal: string | null;
  naf: string;
  effectifEstime: number | null;
  distanceKm: number | null;
  scoreFinal: number;
  strate: number;
  sismo: number;
  statut: string;
  segment: string;
  raisonFr: string;
  topSignals: TopSignal[];
};

export type FiltresLeads = {
  naf?: string; // division (2 chiffres)
  type?: string; // type de signal présent
  dmax?: number; // distance max en km
  smin?: number; // score final minimum
  smax?: number;
};

export function getAgence() {
  const db = getDb();
  return db.select().from(schema.agence).limit(1).all()[0] ?? null;
}

export function getLeads(filtres: FiltresLeads = {}): { chauds: LeadListe[]; nurturing: LeadListe[] } {
  const db = getDb();
  const agence = getAgence();
  const rows = db
    .select({
      lead: schema.lead,
      etab: schema.etablissement,
    })
    .from(schema.lead)
    .innerJoin(schema.etablissement, eq(schema.etablissement.siret, schema.lead.siret))
    .orderBy(desc(schema.lead.scoreFinal))
    .all();

  const liste: LeadListe[] = rows.map(({ lead, etab }) => ({
    siret: lead.siret,
    denomination: etab.denomination,
    commune: etab.commune,
    codePostal: etab.codePostal,
    naf: etab.naf,
    effectifEstime: etab.effectifEstime,
    distanceKm:
      agence && etab.lat != null && etab.lon != null
        ? Math.round(distanceKm(etab.lat, etab.lon, agence.lat, agence.lon) * 10) / 10
        : null,
    scoreFinal: lead.scoreFinal,
    strate: lead.strate,
    sismo: lead.sismo,
    statut: lead.statut,
    segment: lead.segment,
    raisonFr: lead.raisonFr,
    topSignals: lead.topSignals ?? [],
  }));

  const filtree = liste.filter((l) => {
    if (filtres.naf && !l.naf.replace(/[^0-9]/g, "").startsWith(filtres.naf)) return false;
    if (filtres.type && !l.topSignals.some((s) => s.type === filtres.type)) return false;
    if (filtres.dmax != null && (l.distanceKm == null || l.distanceKm > filtres.dmax)) return false;
    if (filtres.smin != null && l.scoreFinal < filtres.smin) return false;
    if (filtres.smax != null && l.scoreFinal > filtres.smax) return false;
    return true;
  });

  return {
    chauds: filtree.filter((l) => l.segment === "chaud"),
    nurturing: filtree.filter((l) => l.segment === "nurturing"),
  };
}

export function getLeadDetail(siret: string) {
  const db = getDb();
  const etab = db.select().from(schema.etablissement).where(eq(schema.etablissement.siret, siret)).all()[0];
  if (!etab) return null;

  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.siren, etab.siren)).all()[0];
  const lead = db.select().from(schema.lead).where(eq(schema.lead.siret, siret)).all()[0] ?? null;
  const strate = db.select().from(schema.scoreStrate).where(eq(schema.scoreStrate.siret, siret)).all()[0] ?? null;
  const sismo = db.select().from(schema.scoreSismo).where(eq(schema.scoreSismo.siret, siret)).all()[0] ?? null;
  const agence = getAgence();

  const signaux = db
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.siret, siret))
    .orderBy(desc(schema.signal.occurredAt))
    .all()
    .map((s) => ({
      ...s,
      resumeFr: resumeSignal({
        id: s.id,
        type: s.type,
        occurredAt: s.occurredAt,
        confidence: s.confidence,
        payload: s.payload ?? null,
      }),
    }));

  return {
    etab,
    entreprise: entreprise ?? null,
    lead,
    strate,
    sismo,
    signaux,
    distanceKm:
      agence && etab.lat != null && etab.lon != null
        ? Math.round(distanceKm(etab.lat, etab.lon, agence.lat, agence.lon) * 10) / 10
        : null,
  };
}

export type CelluleCouverture = { commune: string; rome: string; intensite: number; nb: number };

export function getCouverture() {
  const db = getDb();
  const rows = db.select().from(schema.signal).where(eq(schema.signal.type, "MISSION_CONCURRENT")).all();
  const now = Date.now();
  const demiVieRow = db.select().from(schema.weights).where(eq(schema.weights.key, "sismo.demivie.MISSION_CONCURRENT")).all()[0];
  const demiVie = demiVieRow?.value ?? 60;

  const cellules = new Map<string, CelluleCouverture>();
  const parRome = new Map<string, number>();
  const parCommune = new Map<string, number>();
  const parAgence = new Map<string, number>();

  for (const s of rows) {
    const commune = typeof s.payload?.commune === "string" ? (s.payload.commune as string) : "?";
    const rome = typeof s.payload?.rome === "string" ? (s.payload.rome as string) : "?";
    const agenceNom = typeof s.payload?.agenceInterim === "string" ? (s.payload.agenceInterim as string) : "?";
    const ageJours = Math.max(0, (now - new Date(s.occurredAt).getTime()) / 86400000);
    const poids = Math.exp((-Math.LN2 * ageJours) / demiVie);

    const cle = `${commune}|${rome}`;
    const cell = cellules.get(cle) ?? { commune, rome, intensite: 0, nb: 0 };
    cell.intensite += poids;
    cell.nb += 1;
    cellules.set(cle, cell);
    parRome.set(rome, (parRome.get(rome) ?? 0) + poids);
    parCommune.set(commune, (parCommune.get(commune) ?? 0) + poids);
    parAgence.set(agenceNom, (parAgence.get(agenceNom) ?? 0) + 1);
  }

  const romes = [...parRome.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const communes = [...parCommune.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const agences = [...parAgence.entries()].sort((a, b) => b[1] - a[1]);
  const maxIntensite = Math.max(0.001, ...[...cellules.values()].map((c) => c.intensite));

  return { cellules, romes, communes, agences, maxIntensite, total: rows.length };
}

export function getResolutions() {
  const db = getDb();
  return db
    .select()
    .from(schema.resolutionQueue)
    .orderBy(desc(schema.resolutionQueue.createdAt))
    .all();
}

export function getIngestion() {
  const db = getDb();
  return db.select().from(schema.ingestionRun).orderBy(desc(schema.ingestionRun.startedAt)).limit(50).all();
}
