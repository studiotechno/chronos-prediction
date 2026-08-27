/**
 * HTTP outillé pour l'ingestion :
 * - limiteur de débit par source (token bucket simple) — 7 req/s STRICT sur SIRENE ;
 * - cache disque des réponses brutes dans .cache/<source>/ pour ne pas retaper
 *   les API pendant le développement.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_TTL_MS = 24 * 3600 * 1000;

export class RateLimiter {
  private dernierAppels: number[] = [];
  constructor(private maxParSeconde: number) {}

  async attendre(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.dernierAppels = this.dernierAppels.filter((t) => now - t < 1000);
      if (this.dernierAppels.length < this.maxParSeconde) {
        this.dernierAppels.push(now);
        return;
      }
      const attente = 1000 - (now - this.dernierAppels[0]) + 5;
      await new Promise((r) => setTimeout(r, attente));
    }
  }
}

function cheminCache(sourceId: string, url: string): string {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 20);
  return path.join(CACHE_DIR, sourceId, `${hash}.json`);
}

/** GET JSON avec cache disque et limiteur de débit. */
export async function fetchJsonCache(
  sourceId: string,
  url: string,
  limiter: RateLimiter,
  opts: { ttlMs?: number; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const fichier = cheminCache(sourceId, url);
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;

  if (process.env.INGEST_NO_CACHE !== "1" && fs.existsSync(fichier)) {
    try {
      const entree = JSON.parse(fs.readFileSync(fichier, "utf8"));
      if (Date.now() - entree.fetchedAt < ttl) return entree.body;
    } catch {
      // cache corrompu : on retape l'API
    }
  }

  await limiter.attendre();
  const res = await fetch(url, { headers: opts.headers });
  if (!res.ok) {
    throw new Error(`[${sourceId}] HTTP ${res.status} sur ${url}`);
  }
  const body = await res.json();

  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, JSON.stringify({ url, fetchedAt: Date.now(), body }));
  return body;
}
