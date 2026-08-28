/**
 * ACCO — accords d'entreprise (DILA, Légifrance), livraisons hebdomadaires en open data.
 * SOURCE VÉRIFIÉE le 28/08/2026 (voir docs/sources.md) :
 *   listing https://echanges.dila.gouv.fr/OPENDATA/ACCO/  → liens ACCO_YYYYMMDD-HHMMSS.tar.gz
 *   (~390 Mo par semaine, ~1 500 accords ; plus un « Freemium » global).
 *
 * Structure XML vérifiée (META_ACCO) : NUMERO, SIRET, CODE_APE, CODE_IDCC,
 * RAISON_SOCIALE, NATURE (ACCORD / AVENANT), DATE_TEXTE, DATE_EFFET, DATE_FIN,
 * DATE_DIFFUSION, THEMES/THEME/CODE + LIBELLE, ADRESSES_POSTALES/ADRESSE_POSTALE/CODE_POSTAL.
 * Le fichier contient aussi noms de signataires et de négociateurs : ils ne sont
 * JAMAIS lus — seules les balises listées ci-dessus sont extraites (regex, pas de
 * dépendance XML).
 *
 * La livraison est nationale : on ne garde qu'un accord dont le code postal est
 * dans le département, ou dont le SIREN est dans le référentiel du bassin.
 * Le signal : thèmes de surcharge (heures supplémentaires, modulation, nuit,
 * dimanche, durée collective, CET) → ACCORD_SURCHARGE ; PSE, RCC, maintien dans
 * l'emploi → ACCORD_RESTRUCTURATION (prioritaire).
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const LISTING = "https://echanges.dila.gouv.fr/OPENDATA/ACCO/";
const CACHE_DIR = path.join(process.cwd(), ".cache", "acco");

export const THEMES_SURCHARGE: Record<string, string> = {
  "051": "durée collective du temps de travail",
  "052": "heures supplémentaires",
  "053": "compte épargne temps",
  "054": "travail du dimanche",
  "055": "travail de nuit",
  "059": "aménagement du temps de travail (modulation, annualisation)",
};

export const THEMES_RESTRUCTURATION: Record<string, string> = {
  "075": "accord de méthode PSE",
  "079": "rupture conventionnelle collective",
  "080": "accord de maintien dans l'emploi",
};

export type AccoRaw = {
  numero: string;
  siret: string;
  codeApe: string | null;
  codeIdcc: string | null;
  raisonSociale: string | null;
  nature: string | null;
  dateTexte: string | null;
  dateEffet: string | null;
  dateFin: string | null;
  dateDiffusion: string | null;
  codePostal: string | null;
  themes: { code: string; libelle: string }[];
};

function balise(xml: string, nom: string): string | null {
  const m = xml.match(new RegExp(`<${nom}>([^<]*)</${nom}>`));
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** Extrait les seules métadonnées utiles d'un XML ACCO. Aucune personne physique n'est lue. */
export function parseAccoXml(xml: string): AccoRaw | null {
  const meta = xml.match(/<META_ACCO>([\s\S]*?)<\/META_ACCO>/)?.[1];
  if (!meta) return null;
  const numero = balise(meta, "NUMERO");
  const siret = balise(meta, "SIRET")?.replace(/\D/g, "") ?? null;
  if (!numero || !siret || siret.length !== 14) return null;
  const themes: { code: string; libelle: string }[] = [];
  const bloc = meta.match(/<THEMES>([\s\S]*?)<\/THEMES>/)?.[1] ?? "";
  for (const t of bloc.matchAll(/<THEME>([\s\S]*?)<\/THEME>/g)) {
    const code = balise(t[1], "CODE");
    if (!code) continue;
    themes.push({ code, libelle: balise(t[1], "LIBELLE") ?? code });
  }
  const adresse = meta.match(/<ADRESSE_POSTALE>([\s\S]*?)<\/ADRESSE_POSTALE>/)?.[1] ?? "";
  const cp = balise(adresse, "CODE_POSTAL");
  return {
    numero,
    siret,
    codeApe: balise(meta, "CODE_APE"),
    codeIdcc: balise(meta, "CODE_IDCC"),
    raisonSociale: balise(meta, "RAISON_SOCIALE"),
    nature: balise(meta, "NATURE"),
    dateTexte: balise(meta, "DATE_TEXTE"),
    dateEffet: balise(meta, "DATE_EFFET"),
    dateFin: balise(meta, "DATE_FIN"),
    dateDiffusion: balise(meta, "DATE_DIFFUSION"),
    codePostal: cp && /^\d{5}$/.test(cp) && cp !== "00000" ? cp : null,
    themes,
  };
}

/** Préfixe de code postal d'un département (« 03 » → « 03 », « 2A »/« 2B » → « 20 », « 971 » → « 971 »). */
export function prefixeCodePostal(departement: string): string {
  const d = departement.trim().toUpperCase();
  if (/^2[AB]$/.test(d)) return "20";
  return d.padStart(2, "0");
}

/** L'accord concerne-t-il la zone : code postal du département, ou SIREN connu du référentiel. */
export function concerneZone(raw: AccoRaw, departement: string | null, sirens: Set<string>): boolean {
  if (sirens.has(raw.siret.slice(0, 9))) return true;
  if (departement && raw.codePostal && raw.codePostal.startsWith(prefixeCodePostal(departement))) return true;
  return false;
}

type Livraison = { nom: string; date: Date; url: string };

async function listerLivraisons(): Promise<Livraison[]> {
  const res = await fetch(LISTING);
  if (!res.ok) throw new Error(`[acco] listing HTTP ${res.status} sur ${LISTING}`);
  const html = await res.text();
  const out: Livraison[] = [];
  for (const m of html.matchAll(/href="(ACCO_(\d{4})(\d{2})(\d{2})-\d{6}\.tar\.gz)"/g)) {
    out.push({ nom: m[1], date: new Date(`${m[2]}-${m[3]}-${m[4]}T00:00:00Z`), url: LISTING + m[1] });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function telecharger(livraison: Livraison): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const fichier = path.join(CACHE_DIR, livraison.nom);
  if (fs.existsSync(fichier) && fs.statSync(fichier).size > 0) return fichier;
  console.log(`[acco] téléchargement de ${livraison.nom} (~400 Mo)…`);
  const res = await fetch(livraison.url);
  if (!res.ok || !res.body) throw new Error(`[acco] HTTP ${res.status} sur ${livraison.url}`);
  const tmp = `${fichier}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, fichier);
  return fichier;
}

function extraire(fichier: string): string {
  const dossier = fichier.replace(/\.tar\.gz$/, "");
  const marqueur = path.join(dossier, ".extrait");
  if (fs.existsSync(marqueur)) return dossier;
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  execFileSync("tar", ["-xzf", fichier, "-C", dossier], { stdio: "ignore" });
  fs.writeFileSync(marqueur, new Date().toISOString());
  return dossier;
}

/** Ne garde dans le cache que les archives de la fenêtre courante (une livraison ≈ 390 Mo). */
function purgerArchives(gardees: string[]): void {
  if (!fs.existsSync(CACHE_DIR)) return;
  const garde = new Set(gardees);
  for (const nom of fs.readdirSync(CACHE_DIR)) {
    const chemin = path.join(CACHE_DIR, nom);
    if (/^ACCO_.*\.tar\.gz$/.test(nom) && !garde.has(nom)) fs.rmSync(chemin, { force: true });
    if (/^ACCO_[^.]+$/.test(nom) && fs.statSync(chemin).isDirectory()) fs.rmSync(chemin, { recursive: true, force: true });
  }
}

function* fichiersXml(dossier: string): Generator<string> {
  const entrees = fs.readdirSync(dossier, { withFileTypes: true, recursive: true });
  for (const e of entrees) {
    if (!e.isFile() || !e.name.endsWith(".xml")) continue;
    const parent = (e as { parentPath?: string; path?: string }).parentPath ?? (e as { path?: string }).path ?? dossier;
    yield path.join(parent, e.name);
  }
}

export const accoAdapter: SourceAdapter<AccoRaw> = {
  id: "acco",

  async *fetch(params: FetchParams): AsyncIterable<AccoRaw> {
    const depuis = Date.now() - (params.depuisJours ?? 14) * 86400000;
    const departement = params.departement ?? null;
    const sirens = new Set((params.sirets ?? []).map((s) => s.replace(/\D/g, "").slice(0, 9)));
    const livraisons = (await listerLivraisons()).filter((l) => l.date.getTime() >= depuis);
    if (livraisons.length === 0) {
      console.warn("[acco] aucune livraison hebdomadaire dans la fenêtre demandée");
      return;
    }
    for (const livraison of livraisons) {
      const fichier = await telecharger(livraison);
      const dossier = extraire(fichier);
      let lus = 0;
      let gardes = 0;
      for (const xml of fichiersXml(dossier)) {
        lus++;
        const raw = parseAccoXml(fs.readFileSync(xml, "utf8"));
        if (!raw || !concerneZone(raw, departement, sirens)) continue;
        gardes++;
        yield raw;
      }
      console.log(`[acco] ${livraison.nom} : ${lus} accords lus, ${gardes} dans la zone`);
      // L'extraction pèse ~400 Mo par livraison : on ne garde que l'archive.
      fs.rmSync(dossier, { recursive: true, force: true });
    }
    purgerArchives(livraisons.map((l) => l.nom));
  },

  normalize(raw: AccoRaw): NormalizedRecord[] {
    const codes = raw.themes.map((t) => t.code);
    const restructuration = codes.filter((c) => c in THEMES_RESTRUCTURATION);
    const surcharge = codes.filter((c) => c in THEMES_SURCHARGE);
    let type: string;
    let retenus: string[];
    let libelles: string[];
    if (restructuration.length > 0) {
      type = "ACCORD_RESTRUCTURATION";
      retenus = restructuration;
      libelles = restructuration.map((c) => THEMES_RESTRUCTURATION[c]);
    } else if (surcharge.length > 0) {
      type = "ACCORD_SURCHARGE";
      retenus = surcharge;
      libelles = surcharge.map((c) => THEMES_SURCHARGE[c]);
    } else {
      return [];
    }
    const date = raw.dateEffet ?? raw.dateTexte ?? raw.dateDiffusion;
    if (!date) return [];
    return [
      {
        kind: "signal",
        signal: {
          siret: raw.siret,
          siren: raw.siret.slice(0, 9),
          type,
          source: "acco",
          occurredAt: `${date.slice(0, 10)}T00:00:00.000Z`,
          confidence: 1,
          payload: {
            numero: raw.numero,
            nature: raw.nature,
            themes: retenus,
            themesFr: libelles.join(", "),
            idcc: raw.codeIdcc,
            ape: raw.codeApe,
            raisonSociale: raw.raisonSociale,
            dateFin: raw.dateFin,
          },
          rawRef: `acco-${raw.numero}`,
          lieu: null,
          romes: null,
        },
      },
    ];
  },

  fixture(): AccoRaw[] {
    const depuis = (j: number) => new Date(Date.now() - j * 86400000).toISOString().slice(0, 10);
    return [
      {
        numero: "T00326000001",
        siret: "90090000100019",
        codeApe: "4399C",
        codeIdcc: "1597",
        raisonSociale: "DEMO BATIMENT BOURBONNAIS",
        nature: "ACCORD",
        dateTexte: depuis(20),
        dateEffet: depuis(15),
        dateFin: null,
        dateDiffusion: depuis(5),
        codePostal: "03200",
        themes: [
          { code: "052", libelle: "Heures supplémentaires (contingent, majoration)" },
          { code: "059", libelle: "Aménagement du temps de travail (modulation, annualisation, cycles)" },
          { code: "081", libelle: "Egalité salariale F/H" },
        ],
      },
      {
        numero: "T00326000002",
        siret: "90090000200018",
        codeApe: "5210B",
        codeIdcc: "16",
        raisonSociale: "DEMO LOGISTIQUE ALLIER",
        nature: "ACCORD",
        dateTexte: depuis(40),
        dateEffet: depuis(30),
        dateFin: null,
        dateDiffusion: depuis(10),
        codePostal: "03150",
        themes: [
          { code: "075", libelle: "Accords de méthode (PSE)" },
          { code: "052", libelle: "Heures supplémentaires (contingent, majoration)" },
        ],
      },
      {
        numero: "T00326000003",
        siret: "90090000300017",
        codeApe: "2562B",
        codeIdcc: "3248",
        raisonSociale: "DEMO METALLERIE",
        nature: "AVENANT",
        dateTexte: depuis(12),
        dateEffet: depuis(10),
        dateFin: null,
        dateDiffusion: depuis(2),
        codePostal: "03800",
        themes: [{ code: "011", libelle: "Intéressement" }],
      },
    ];
  },
};
