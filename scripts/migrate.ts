import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/lib/db";

const db = getDb();
migrate(db, { migrationsFolder: "./drizzle" });
console.log("[migrate] migrations appliquées");
