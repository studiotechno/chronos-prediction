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

/**
 * Distance à l'agence, ou tiret. Le calcul rend NaN quand l'établissement n'a
 * pas de position — les entreprises « non diffusibles » de l'INSEE sont
 * publiées sans coordonnées : un simple `!= null` afficherait « NaN km ».
 */
export function distanceLisible(km: number | null | undefined): string {
  return Number.isFinite(km) ? `${(km as number).toLocaleString("fr-FR")} km` : "–";
}

export function siretFormate(siret: string): string {
  return `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`;
}

export function heureCourte(iso: string): string {
  const d = new Date(iso);
  return `${dateCourte(iso)} ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}

/** « 15 oct. » — la forme courte des dates de fenêtre, pour tenir dans une pastille. */
export function dateAbregee(iso: string): string {
  const d = new Date(iso);
  const mois = MOIS_FR[d.getMonth()];
  const abrege = mois.length > 4 ? `${mois.slice(0, 4)}.` : mois;
  return `${d.getDate()} ${abrege}`;
}

export type EtatFenetre = "maintenant" | "a_venir" | "passee";

/**
 * Fenêtre d'appel dérivée des signaux à retard : où en est-on ?
 * Absente = le besoin est maintenant (signaux immédiats).
 */
export function etatFenetre(
  debut: string | null | undefined,
  fin: string | null | undefined,
  now: Date = new Date(),
): EtatFenetre | null {
  if (!debut || !fin) return null;
  const t = now.getTime();
  const d = new Date(debut).getTime();
  const f = new Date(fin).getTime();
  if (!Number.isFinite(d) || !Number.isFinite(f)) return null;
  if (t < d) return "a_venir";
  if (t <= f) return "maintenant";
  return "passee";
}

/** Libellé court d'une fenêtre : « maintenant → 15 nov. », « 15 oct. → 15 nov. », « passée ». */
export function fenetreLisible(
  debut: string | null | undefined,
  fin: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const etat = etatFenetre(debut, fin, now);
  if (!etat || !debut || !fin) return null;
  if (etat === "maintenant") return `maintenant → ${dateAbregee(fin)}`;
  if (etat === "a_venir") return `${dateAbregee(debut)} → ${dateAbregee(fin)}`;
  return `passée (${dateAbregee(fin)})`;
}

/** « ×1,12 » — le facteur Tempo, toujours avec deux décimales. */
export function tempoLisible(tempo: number | null | undefined): string {
  const v = Number.isFinite(tempo) ? (tempo as number) : 1;
  return `×${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
