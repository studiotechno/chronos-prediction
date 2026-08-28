import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { IconResolution } from "@/components/shell/icons";
import { getResolutions, type ResolutionEntree } from "@/lib/queries";
import { validerResolution, rejeterResolution } from "@/app/actions";
import { nafLabel } from "@/lib/reference/naf";
import { dateCourte, dateRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/* ── File de rapprochement ───────────────────────────────────────────
   Les signaux dont le rattachement au SIRET est ambigu (similarité entre
   0,62 et 0,88). Un humain trois secondes, et le signal rejoint sa
   véritable entreprise — le scoring repart dans la foulée.

   Deux sources y arrivent, et elles ne se rapprochent pas de la même
   façon : France Travail livre l'EMPLOYEUR d'une offre (le contexte utile
   est le métier et la commune), le BOAMP livre le TITULAIRE d'un marché
   public (le contexte utile est l'objet du marché et son acheteur). D'où
   un contexte affiché par source : décider sans lui, c'est deviner. */

const SOURCES: Record<string, { label: string; famille: string }> = {
  francetravail: { label: "France Travail", famille: "ft" },
  boamp: { label: "BOAMP", famille: "boamp" },
  decp: { label: "DECP", famille: "boamp" },
};

function sourceMeta(source: string) {
  const cle = source.replace("fixture:", "");
  return { ...(SOURCES[cle] ?? { label: cle, famille: "autre" }), fixture: source.startsWith("fixture:") };
}

function texte(payload: Record<string, unknown> | null, cle: string): string | null {
  const v = payload?.[cle];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function nombre(payload: Record<string, unknown> | null, cle: string): number | null {
  const v = payload?.[cle];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function montantCourt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  return `${Math.round(n / 1000).toLocaleString("fr-FR")} k€`;
}

/** Ce qu'on cherche à rattacher, dit dans le vocabulaire de la source. */
function Contexte({ entree }: { entree: ResolutionEntree }) {
  const p = entree.signal?.payload ?? null;
  const type = entree.signal?.type ?? null;

  if (type === "MARCHE_ATTRIBUE" || sourceMeta(entree.source).famille === "boamp") {
    const objet = texte(p, "objet");
    const acheteur = texte(p, "acheteurNom") ?? texte(p, "acheteur");
    const montant = nombre(p, "montant");
    const descripteurs = Array.isArray(p?.descripteurs)
      ? (p.descripteurs as unknown[]).filter((d): d is string => typeof d === "string")
      : [texte(p, "descripteur")].filter((d): d is string => d != null);
    const typeMarche = texte(p, "typeMarche");
    return (
      <div className="rs-ctx" data-source="boamp">
        <span className="lb">Titulaire d’un marché public</span>
        {objet && <p className="ob">{objet}</p>}
        <p className="me">
          {[
            acheteur ? `Acheteur : ${acheteur}` : null,
            montant != null ? montantCourt(montant) : null,
            typeMarche ? typeMarche.toLowerCase() : null,
            descripteurs.length > 0 ? descripteurs.join(", ") : null,
            entree.signal ? `notifié le ${dateCourte(entree.signal.occurredAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    );
  }

  const intitule = texte(p, "intitule");
  const rome = texte(p, "rome");
  const typeContrat = texte(p, "typeContrat");
  return (
    <div className="rs-ctx" data-source="ft">
      <span className="lb">Employeur d’une offre d’emploi</span>
      {intitule && <p className="ob">{intitule}</p>}
      <p className="me">
        {[
          typeContrat,
          rome ? `ROME ${rome}` : null,
          entree.rawCodePostal ? `lieu de travail ${entree.rawCodePostal}` : null,
          entree.rawNaf ? `NAF annoncé ${entree.rawNaf}` : null,
          entree.signal ? `publiée le ${dateCourte(entree.signal.occurredAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Aucun détail publié par la source."}
      </p>
    </div>
  );
}

export default async function ResolutionPage() {
  const entrees = await getResolutions();
  const enAttente = entrees.filter((e) => e.statut === "en_attente");
  const traitees = entrees.filter((e) => e.statut !== "en_attente");

  /* Compteur par source dans le chrome : la file n'a pas de bande de
     filtres, et savoir d'où vient le travail restant suffit à s'organiser. */
  const parSource = new Map<string, number>();
  for (const e of enAttente) {
    const label = sourceMeta(e.source).label;
    parSource.set(label, (parSource.get(label) ?? 0) + 1);
  }
  const detailSources = [...parSource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ");

  return (
    <>
      <PageChrome
        icon={<IconResolution size={18} />}
        title="Rapprochements"
        count={
          enAttente.length > 0
            ? `${enAttente.length} en attente${detailSources ? ` — ${detailSources}` : ""}`
            : "file vide"
        }
      />
      <PageBody>
        <div className="pl-wrap">
          <p className="pl-note">
            <span>
              Le nom vu chez la source ne suffit pas à désigner une entreprise avec certitude.
              Rattacher un candidat rattache le signal <b>et relance le scoring</b> ; « aucun ne
              correspond » écarte définitivement l’entrée.
            </span>
          </p>

          {enAttente.length === 0 && (
            <div className="pl-empty">
              <span className="ico">✓</span>
              <h2>File vide</h2>
              <p>Tous les signaux ambigus ont été tranchés. Les prochains arriveront ici.</p>
            </div>
          )}

          {enAttente.map((e) => {
            const src = sourceMeta(e.source);
            return (
              <section key={e.id} className="rs-carte">
                <div className="hd">
                  <div>
                    <p className="nm">
                      <span>Vu chez la source :</span> {e.rawDenomination}
                      {e.rawCodePostal && <em> · {e.rawCodePostal}</em>}
                    </p>
                    <p className="me">
                      <span className="rs-src" data-famille={src.famille}>
                        {src.label}
                        {src.fixture ? " (fixture)" : ""}
                      </span>
                      {dateRelative(e.createdAt)}
                    </p>
                  </div>
                  <form action={rejeterResolution}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className="rs-ghost">
                      Aucun ne correspond
                    </button>
                  </form>
                </div>
                <Contexte entree={e} />
                <ul>
                  {(e.candidats ?? []).map((c) => (
                    <li key={c.siret}>
                      <span className="sim" data-fort={c.similarite >= 0.8 || undefined}>
                        <i style={{ width: `${c.similarite * 100}%` }} />
                        <b>{(c.similarite * 100).toFixed(0)} %</b>
                      </span>
                      <span className="ct">
                        <span className="a">{c.denomination}</span>
                        <span className="b">
                          {c.commune}
                          {c.naf ? ` · ${nafLabel(c.naf)}` : ""} · {c.siret}
                        </span>
                      </span>
                      <form action={validerResolution}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="siret" value={c.siret} />
                        <button type="submit" className="rs-cta">
                          Rattacher
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {traitees.length > 0 && (
            <section className="rs-traitees">
              <h2>Traitées récemment</h2>
              <ul>
                {traitees.slice(0, 10).map((e) => (
                  <li key={e.id}>
                    <span>
                      <span className="rs-src" data-famille={sourceMeta(e.source).famille}>
                        {sourceMeta(e.source).label}
                      </span>
                      {e.rawDenomination}
                    </span>
                    <em>{e.statut === "resolu" ? `rattachée → ${e.resolvedSiret}` : "rejetée"}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </PageBody>
    </>
  );
}
