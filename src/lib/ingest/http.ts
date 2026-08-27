/**
 * HTTP outillé pour l'ingestion :
 * - limiteur de débit par source (fenêtre glissante d'une seconde) ;
 * - reprise sur 429 et 5xx, avec ralentissement durable du limiteur ;
 * - cache disque des réponses brutes dans .cache/<source>/ pour ne pas retaper
 *   les API pendant le développement.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_TTL_MS = 24 * 3600 * 1000;

export class RateLimiter {
  private appels: number[] = [];
  private plafond: number;

  constructor(
    maxParSeconde: number,
    /** Plancher sous lequel le ralentissement automatique ne descend pas. */
    private readonly minParSeconde = 1,
  ) {
    this.plafond = maxParSeconde;
  }

  get debitActuel(): number {
    return this.plafond;
  }

  /**
   * Réduit durablement le débit après un 429. Le quota réel d'une API publique
   * n'est pas toujours celui qu'elle documente : on s'aligne sur l'observation.
   */
  ralentir(): void {
    this.plafond = Math.max(this.minParSeconde, Math.floor(this.plafond / 2) || this.minParSeconde);
  }

  async attendre(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.appels = this.appels.filter((t) => now - t < 1000);
      if (this.appels.length < this.plafond) {
        this.appels.push(now);
        return;
      }
      const attente = 1000 - (now - this.appels[0]) + 5;
      await new Promise((r) => setTimeout(r, attente));
    }
  }
}

function cheminCache(sourceId: string, url: string): string {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 20);
  return path.join(CACHE_DIR, sourceId, `${hash}.json`);
}

export type FetchOptions = {
  ttlMs?: number;
  headers?: Record<string, string>;
  maxTentatives?: number;
};

/** GET JSON avec cache disque, limiteur de débit et reprise sur erreur passagère. */
export async function fetchJsonCache(
  sourceId: string,
  url: string,
  limiter: RateLimiter,
  opts: FetchOptions = {},
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

  // Vérifié en conditions réelles : SIRENE renvoie des 429 même sous les 7 req/s
  // qu'elle annonce. Un limiteur de débit seul ne suffit pas, il faut reprendre.
  const maxTentatives = opts.maxTentatives ?? 5;
  let derniereErreur = "";

  for (let tentative = 1; tentative <= maxTentatives; tentative++) {
    await limiter.attendre();

    let res: Response;
    try {
      res = await fetch(url, { headers: opts.headers });
    } catch (e) {
      // panne réseau : même politique de reprise que pour un 5xx
      derniereErreur = e instanceof Error ? e.message : String(e);
      if (tentative === maxTentatives) break;
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** (tentative - 1))));
      continue;
    }

    if (res.ok) {
      const body = await res.json();
      fs.mkdirSync(path.dirname(fichier), { recursive: true });
      fs.writeFileSync(fichier, JSON.stringify({ url, fetchedAt: Date.now(), body }));
      return body;
    }

    derniereErreur = `HTTP ${res.status}`;
    const recuperable = res.status === 429 || res.status >= 500;
    if (!recuperable || tentative === maxTentatives) break;

    if (res.status === 429) limiter.ralentir();
    const retryAfter = Number(res.headers.get("retry-after"));
    const attente =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30000, 1000 * 2 ** (tentative - 1));
    console.warn(
      `[${sourceId}] ${derniereErreur}, nouvelle tentative dans ${Math.round(attente / 1000)} s ` +
        `(débit ramené à ${limiter.debitActuel}/s)`,
    );
    await new Promise((r) => setTimeout(r, attente));
  }

  throw new Error(`[${sourceId}] ${derniereErreur} sur ${url}`);
}
