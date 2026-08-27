import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";

export type SeedStats = {
  entreprises: number;
  etablissements: number;
  signaux: number;
  offres: number;
  resolutions: number;
};

/** Fixtures réalistes du bassin de Marseille — implémentées en phase 2. */
export function seedFixtures(_db: BetterSQLite3Database<typeof schema>): SeedStats {
  return { entreprises: 0, etablissements: 0, signaux: 0, offres: 0, resolutions: 0 };
}
