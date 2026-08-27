/**
 * Table de référence DARES : taux de recours à l'intérim par division NAF.
 * Chargée depuis data/reference/dares-interim-naf.csv (versionné dans le repo, pas d'API).
 */
import fs from "node:fs";
import path from "node:path";

export type DaresRow = {
  nafDivision: string;
  libelle: string;
  tauxPct: number;
  niveauSource: string;
};

let _table: Map<string, DaresRow> | null = null;
let _default: DaresRow = {
  nafDivision: "DEFAULT",
  libelle: "Divisions non listées",
  tauxPct: 1.5,
  niveauSource: "approx_defaut",
};

export function loadDaresTable(): Map<string, DaresRow> {
  if (_table) return _table;
  const file = path.join(process.cwd(), "data", "reference", "dares-interim-naf.csv");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const table = new Map<string, DaresRow>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("naf_division;")) continue;
    const [nafDivision, libelle, taux, niveauSource] = trimmed.split(";");
    const row: DaresRow = {
      nafDivision,
      libelle,
      tauxPct: Number(taux),
      niveauSource,
    };
    if (nafDivision === "DEFAULT") _default = row;
    else table.set(nafDivision, row);
  }
  _table = table;
  return table;
}

/** Taux de recours à l'intérim (%) pour un code NAF complet (ex: « 43.99C »). */
export function tauxRecoursInterim(naf: string): number {
  const table = loadDaresTable();
  const division = naf.replace(/[^0-9]/g, "").slice(0, 2);
  return (table.get(division) ?? _default).tauxPct;
}
