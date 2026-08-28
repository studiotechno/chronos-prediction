/**
 * Zone de prospection effective des scripts d'ingestion.
 *
 * La règle : c'est l'agence inscrite dans l'application qui décide où l'on
 * ingère. Sans cela, `npm run ingest:all` sans argument moissonnerait le bassin
 * de démonstration (Vichy) quelle que soit l'implantation réelle du compte —
 * l'utilisateur croirait prospecter chez lui et lirait les leads d'ailleurs.
 *
 * Priorité : argument CLI > agence en base > agence de démonstration.
 */
import { getDb, schema } from "../src/lib/db";
import { AGENCE_DEMO } from "../src/lib/fixtures/agence";

export type Zone = {
  nom: string;
  lat: number;
  lon: number;
  rayonKm: number;
  /** Divisions NAF ou codes complets ciblés. Vide = aucun filtre. */
  nafCibles: string[];
  /** Département sur deux caractères (Corse comprise : 2A / 2B). */
  departement: string;
  origine: "agence" | "demo";
};

/** Département de l'agence, à défaut déduit de son code postal. */
function departementDe(agence: typeof schema.agence.$inferSelect): string | null {
  const declare = agence.departement?.trim();
  if (declare) return declare;
  const cp = agence.codePostal?.trim();
  return cp && cp.length >= 2 ? cp.slice(0, 2) : null;
}

/**
 * Charge la zone à ingérer. Sans agence inscrite, retombe sur le bassin de
 * démonstration en le disant clairement : ingérer Vichy en croyant ingérer sa
 * propre zone est le genre d'erreur qui ne se voit qu'au bout de trois jours.
 */
export async function chargerZone(): Promise<Zone> {
  const db = getDb();
  const agence = (await db.select().from(schema.agence).limit(1))[0];

  if (!agence) {
    console.warn(
      "[zone] aucune agence inscrite — repli sur le bassin de démonstration " +
        `(${AGENCE_DEMO.nom}). Inscrivez la vôtre dans l'application (/inscription), ` +
        "ou passez --lat/--lon/--rayon/--naf/--departement.",
    );
    return {
      nom: AGENCE_DEMO.nom,
      lat: AGENCE_DEMO.lat,
      lon: AGENCE_DEMO.lon,
      rayonKm: AGENCE_DEMO.rayonKm,
      nafCibles: AGENCE_DEMO.nafCibles,
      departement: "03",
      origine: "demo",
    };
  }

  const departement = departementDe(agence);
  if (!departement) {
    console.warn(
      `[zone] l'agence « ${agence.nom} » n'a ni département ni code postal — ` +
        "les sources départementales (DECP, BODACC) exigent --departement.",
    );
  }

  return {
    nom: agence.nom,
    lat: agence.lat,
    lon: agence.lon,
    rayonKm: agence.rayonKm,
    nafCibles: agence.nafCibles ?? [],
    departement: departement ?? "",
    origine: "agence",
  };
}

/** Trace d'où viennent les paramètres, pour que l'opérateur le vérifie d'un coup d'œil. */
export function decrireZone(zone: Zone): string {
  return zone.origine === "agence"
    ? `zone de l'agence « ${zone.nom} »`
    : `bassin de démonstration « ${zone.nom} »`;
}
