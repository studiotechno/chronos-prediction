import "./env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../src/lib/db";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations appliquées");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
