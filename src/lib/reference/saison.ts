/**
 * Saisonnalité par section NAF × mois (data/reference/saisonnalite-section.csv).
 * Facteur autour de 1, lu par Tempo. Approximation posée à la main et documentée
 * en tête de fichier ; à remplacer par la saisonnalité mesurée sur les missions.
 */
import fs from "node:fs";
import path from "node:path";

let _table: Map<string, number[]> | null = null;

export function loadSaisonTable(): Map<string, number[]> {
  if (_table) return _table;
  const file = path.join(process.cwd(), "data", "reference", "saisonnalite-section.csv");
  const table = new Map<string, number[]>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("section;")) continue;
      const [section, ...mois] = trimmed.split(";");
      const valeurs = mois.map(Number);
      if (valeurs.length !== 12 || valeurs.some((v) => !Number.isFinite(v))) continue;
      table.set(section, valeurs);
    }
  }
  _table = table;
  return table;
}

/** Section NAF (lettre) d'une division : 01-03 A, 05-09 B, 10-33 C, 35 D, 36-39 E, 41-43 F, … */
export function sectionNaf(naf: string): string {
  const d = Number(naf.replace(/[^0-9]/g, "").slice(0, 2));
  if (!Number.isFinite(d)) return "DEFAULT";
  if (d <= 3) return "A";
  if (d <= 9) return "B";
  if (d <= 33) return "C";
  if (d === 35) return "D";
  if (d <= 39) return "E";
  if (d <= 43) return "F";
  if (d <= 47) return "G";
  if (d <= 53) return "H";
  if (d <= 56) return "I";
  if (d <= 63) return "J";
  if (d <= 66) return "K";
  if (d === 68) return "L";
  if (d <= 75) return "M";
  if (d <= 82) return "N";
  if (d === 84) return "O";
  if (d === 85) return "P";
  if (d <= 88) return "Q";
  if (d <= 93) return "R";
  if (d <= 96) return "S";
  return "DEFAULT";
}

/** Facteur saisonnier du secteur pour le mois de `date` (1 = neutre). */
export function facteurSaison(naf: string, date: Date): number {
  const table = loadSaisonTable();
  const serie = table.get(sectionNaf(naf)) ?? table.get("DEFAULT");
  if (!serie) return 1;
  return serie[date.getUTCMonth()] ?? 1;
}
