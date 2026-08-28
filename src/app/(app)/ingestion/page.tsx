import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { IconIngestion } from "@/components/shell/icons";
import { getIngestion } from "@/lib/queries";
import { SOURCES } from "@/lib/ingest/registry";
import { heureCourte, dateRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/* ── État des sources ────────────────────────────────────────────────
   Une page d'honnêteté : ce qui est branché pour de vrai, ce qui ne
   l'est pas encore, et ce que la dernière exécution a réellement ramené.
   L'état de vérification fait foi dans docs/sources.md. */

const ETAT: Record<string, { label: string; famille: string }> = {
  verifie: { label: "Endpoint vérifié", famille: "ok" },
  non_verifie: { label: "Non vérifié — fixtures seulement", famille: "attente" },
  embarquee: { label: "Embarquée dans le dépôt", famille: "locale" },
  a_autoriser: { label: "Accès à autoriser", famille: "attente" },
};

export default async function IngestionPage() {
  const runs = await getIngestion();
  const dernierParSource = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const cle = r.source.replace("fixture:", "");
    if (!dernierParSource.has(cle)) dernierParSource.set(cle, r);
  }

  return (
    <>
      <PageChrome
        icon={<IconIngestion size={18} />}
        title="Sources"
        count={`${SOURCES.length} adapters · ${runs.length} exécutions journalisées`}
      />
      <PageBody>
        <div className="pl-wrap">
          <div className="src-grid">
            {SOURCES.map((s) => {
              const etat = ETAT[s.etatEndpoint];
              const dernier = dernierParSource.get(s.id);
              return (
                <section key={s.id} className="src-carte">
                  <div className="hd">
                    <h2>{s.nomFr}</h2>
                    <span className="etat" data-famille={etat.famille}>
                      {etat.label}
                    </span>
                  </div>
                  <p className="de">{s.descriptionFr}</p>
                  {s.notesFr && <p className="no">{s.notesFr}</p>}
                  <p className="me">
                    {s.sansCle ? "Sans clé d’API" : "Clé requise"}
                    {dernier
                      ? ` · dernière exécution ${dateRelative(dernier.startedAt)}${
                          dernier.source.startsWith("fixture:") ? " (fixtures)" : ""
                        }`
                      : " · jamais exécutée"}
                  </p>
                </section>
              );
            })}
          </div>

          <section className="pl-tab">
            <div className="pl-row head src-row">
              <span>Source</span>
              <span>Début</span>
              <span>Lus</span>
              <span>Retenus</span>
              <span>Erreurs</span>
            </div>
            {runs.length === 0 && <div className="src-vide">Aucune exécution enregistrée.</div>}
            {runs.map((r) => (
              <div key={r.id} className="pl-row src-row">
                <span className="pl-nm">
                  {r.source.replace("fixture:", "")}
                  {r.source.startsWith("fixture:") && <em> (fixtures)</em>}
                </span>
                <span className="pl-val">{heureCourte(r.startedAt)}</span>
                <span className="pl-val">{r.recordsIn.toLocaleString("fr-FR")}</span>
                <span className="pl-val">{r.recordsOut.toLocaleString("fr-FR")}</span>
                <span className="pl-val" data-alerte={(r.errors?.length ?? 0) > 0 || undefined}>
                  {r.errors?.length ?? 0}
                </span>
              </div>
            ))}
          </section>
        </div>
      </PageBody>
    </>
  );
}
