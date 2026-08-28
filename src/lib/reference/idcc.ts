/**
 * Table de référence : taux de recours à l'intérim par convention collective (IDCC).
 * Chargée depuis data/reference/idcc-interim.csv (versionné, pas d'API).
 * Complète la table par division NAF : l'IDCC dit l'activité réelle
 * (« bâtiment ouvriers » vs « bâtiment cadres » sous le même NAF 43).
 */
import fs from "node:fs";
import path from "node:path";

export type IdccRow = {
  idcc: string;
  libelle: string;
  tauxPct: number;
  niveauSource: string;
};

let _table: Map<string, IdccRow> | null = null;

export function loadIdccTable(): Map<string, IdccRow> {
  if (_table) return _table;
  const file = path.join(process.cwd(), "data", "reference", "idcc-interim.csv");
  const table = new Map<string, IdccRow>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("idcc;")) continue;
      const [idcc, libelle, taux, niveauSource] = trimmed.split(";");
      const tauxPct = Number(taux);
      if (!idcc || !Number.isFinite(tauxPct)) continue;
      table.set(normaliserIdcc(idcc), { idcc: normaliserIdcc(idcc), libelle, tauxPct, niveauSource });
    }
  }
  _table = table;
  return table;
}

/** « 0016 », « 16 », « 16.0 » → « 16 ». */
export function normaliserIdcc(brut: string): string {
  const n = String(brut).replace(/[^0-9]/g, "").replace(/^0+/, "");
  return n.length > 0 ? n : "0";
}

/**
 * Taux de recours (%) le plus élevé parmi les conventions déclarées, ou null si
 * aucune n'est connue de la table. Une entreprise du bâtiment déclare souvent
 * plusieurs IDCC (ouvriers + ETAM + cadres) : c'est la convention ouvrière,
 * la plus intense, qui décrit son besoin de main-d'œuvre.
 */
export function tauxRecoursIdcc(idccs: string[] | null | undefined): IdccRow | null {
  if (!idccs || idccs.length === 0) return null;
  const table = loadIdccTable();
  let meilleur: IdccRow | null = null;
  for (const brut of idccs) {
    const row = table.get(normaliserIdcc(brut));
    if (!row) continue;
    if (row.niveauSource === "exclu") return row;
    if (!meilleur || row.tauxPct > meilleur.tauxPct) meilleur = row;
  }
  return meilleur;
}
