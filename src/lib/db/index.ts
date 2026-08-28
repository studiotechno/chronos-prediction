/**
 * Connexion PostgreSQL (Supabase).
 *
 * Le pool est mémorisé sur globalThis : en développement Next recharge les
 * modules à chaque édition, et sans ce cache chaque rechargement ouvrirait un
 * nouveau pool jusqu'à saturer les connexions autorisées par Supabase.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Le pooler Supabase en mode transaction (port 6543) ne supporte pas les
 * requêtes préparées ; la connexion directe (5432), si.
 */
function utilisePooler(url: string): boolean {
  return url.includes("pooler.supabase.com") || url.includes(":6543");
}

type Cache = {
  sql?: ReturnType<typeof postgres>;
  db?: PostgresJsDatabase<typeof schema>;
};

const cache = globalThis as unknown as { __chronosDb?: Cache };
cache.__chronosDb ??= {};

/** Connexion paresseuse et unique (réutilisée entre requêtes Next et scripts CLI). */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cache.__chronosDb!.db) return cache.__chronosDb!.db;
  // Lue à l'appel, pas au chargement du module : les scripts CLI chargent .env
  // eux-mêmes et l'ordre des imports ne doit pas décider du résultat.
  const URL_DB = process.env.DATABASE_URL;
  if (!URL_DB) {
    throw new Error(
      "DATABASE_URL manquante — renseignez l'URL PostgreSQL dans .env (gabarit : .env.example).",
    );
  }
  const sql = postgres(URL_DB, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: !utilisePooler(URL_DB),
  });
  const db = drizzle(sql, { schema });
  cache.__chronosDb!.sql = sql;
  cache.__chronosDb!.db = db;
  return db;
}

/** Ferme le pool — utile aux scripts CLI, qui sinon ne rendent jamais la main. */
export async function closeDb(): Promise<void> {
  const sql = cache.__chronosDb?.sql;
  if (!sql) return;
  cache.__chronosDb!.sql = undefined;
  cache.__chronosDb!.db = undefined;
  await sql.end();
}

export { schema };
