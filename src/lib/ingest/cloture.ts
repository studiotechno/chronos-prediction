/**
 * Clôture des offres disparues de la source.
 *
 * France Travail ne renvoie que les offres actives : une offre qui n'est plus
 * dans la réponse a été pourvue ou retirée. Le V2 n'avait jamais posé
 * `closed_at` (0 offre clôturée sur 3 175 le 10/09/2026), parce que l'ingestion
 * ne relisait que les 14 derniers jours de création : une offre plus ancienne
 * n'était plus observable, donc jamais déclarée close. Sans clôture, ni
 * republication, ni conjoncture fiable.
 *
 * Règle : après une lecture COMPLÈTE de la fenêtre [depuis, maintenant], toute
 * offre de cette fenêtre que le run n'a pas revue est close. On ne clôture
 * jamais après une lecture partielle (erreur réseau au milieu) : un jour sans
 * clôture vaut mieux qu'un faux signal de republication.
 */
import { and, gte, isNull, lt, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

export async function cloturerOffresDisparues(
  db: PostgresJsDatabase<typeof schema>,
  opts: { source: string; depuis: Date; vuAvant: string; now?: Date },
): Promise<number> {
  const now = (opts.now ?? new Date()).toISOString();
  const closes = await db
    .update(schema.offreBrute)
    .set({ closedAt: now })
    .where(
      and(
        eq(schema.offreBrute.source, opts.source),
        isNull(schema.offreBrute.closedAt),
        gte(schema.offreBrute.datePublication, opts.depuis.toISOString()),
        lt(schema.offreBrute.lastSeenAt, opts.vuAvant),
      ),
    )
    .returning({ id: schema.offreBrute.id });
  return closes.length;
}
