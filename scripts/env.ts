/**
 * Chargement de .env pour les scripts CLI.
 * Next.js charge .env tout seul pour l'application ; `tsx` ne le fait pas.
 * Aucune dépendance : process.loadEnvFile() est natif depuis Node 20.12.
 */
import fs from "node:fs";
import path from "node:path";

const fichier = path.join(process.cwd(), ".env");
if (fs.existsSync(fichier)) {
  process.loadEnvFile(fichier);
}
