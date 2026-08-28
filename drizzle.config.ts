import fs from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit ne passe pas par Next : il faut charger .env nous-mêmes.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
