/**
 * Enquête BMO 2026 (France Travail), agrégée par département × famille de métiers FAP
 * (data/reference/bmo-2026-dept-famille.csv). Deux lectures pour Tempo :
 *   · part des projets jugés DIFFICILES — un métier que les employeurs du département
 *     peinent à pourvoir se sous-traite à l'intérim ;
 *   · part des projets SAISONNIERS — le besoin a une saison.
 * Le pont ROME → famille FAP est une correspondance par grands domaines.
 */
import fs from "node:fs";
import path from "node:path";

export type BmoRow = {
  dept: string;
  famille: string;
  libelle: string;
  projets: number;
  difficiles: number;
  saisonniers: number;
};

let _table: Map<string, BmoRow> | null = null;

export function loadBmoTable(): Map<string, BmoRow> {
  if (_table) return _table;
  const file = path.join(process.cwd(), "data", "reference", "bmo-2026-dept-famille.csv");
  const table = new Map<string, BmoRow>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("dept;")) continue;
      const [dept, famille, libelle, projets, difficiles, saisonniers] = trimmed.split(";");
      const row: BmoRow = {
        dept,
        famille,
        libelle,
        projets: Number(projets),
        difficiles: Number(difficiles),
        saisonniers: Number(saisonniers),
      };
      if (!Number.isFinite(row.projets)) continue;
      table.set(`${dept}|${famille}`, row);
    }
  }
  _table = table;
  return table;
}

/**
 * Famille de métiers BMO correspondant à un code ROME. L'open data BMO 2026 ne
 * ventile que huit familles : A fonctions administratives, C encadrement,
 * I ouvriers de l'industrie, O ouvriers de la construction, S social et
 * médico-social, T autres techniciens et employés, V vente, tourisme et
 * services, Z autres métiers (agriculture, transport-logistique…).
 */
export function famillesFapDeRome(rome: string): string[] {
  const lettre = rome.charAt(0).toUpperCase();
  const deux = rome.slice(0, 2).toUpperCase(); // « K1 »
  switch (lettre) {
    case "A":
      return ["Z"];
    case "B":
      return ["Z"];
    case "C":
      return ["A"];
    case "D":
      return ["V"];
    case "E":
      return ["T"];
    case "F":
      return ["O"];
    case "G":
      return ["V"];
    case "H":
      return ["I"];
    case "I":
      return ["I"];
    case "J":
      return ["S"];
    case "K":
      return deux === "K1" ? ["S"] : ["V"];
    case "L":
      return ["Z"];
    case "M":
      return ["A"];
    case "N":
      return ["Z"];
    default:
      return [];
  }
}

export type BmoLecture = {
  /** Part des projets jugés difficiles (0..1). */
  partDifficile: number;
  /** Part des projets saisonniers (0..1). */
  partSaisonniere: number;
  projets: number;
  libelles: string[];
};

/** Lecture BMO pour un département et une liste de ROME (moyenne pondérée par les projets). */
export function lectureBmo(dept: string | null | undefined, romes: string[]): BmoLecture | null {
  if (!dept || romes.length === 0) return null;
  const table = loadBmoTable();
  const familles = new Set(romes.flatMap(famillesFapDeRome));
  let projets = 0;
  let difficiles = 0;
  let saisonniers = 0;
  const libelles: string[] = [];
  for (const f of familles) {
    const row = table.get(`${dept}|${f}`);
    if (!row || row.projets <= 0) continue;
    projets += row.projets;
    difficiles += row.difficiles;
    saisonniers += row.saisonniers;
    libelles.push(row.libelle);
  }
  if (projets <= 0) return null;
  return {
    partDifficile: difficiles / projets,
    partSaisonniere: saisonniers / projets,
    projets,
    libelles,
  };
}
