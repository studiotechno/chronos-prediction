/** Formatage français partagé par l'UI. */

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function dateCourte(iso: string): string {
  const d = new Date(iso);
  const jour = d.getDate();
  return `${jour === 1 ? "1er" : jour} ${MOIS_FR[d.getMonth()]}`;
}

export function dateRelative(iso: string, now: Date = new Date()): string {
  const jours = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  if (jours < 30) return `il y a ${jours} j`;
  const mois = Math.floor(jours / 30);
  return `il y a ${mois} mois`;
}

export function siretFormate(siret: string): string {
  return `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`;
}

export function heureCourte(iso: string): string {
  const d = new Date(iso);
  return `${dateCourte(iso)} ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}
