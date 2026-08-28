import { desc } from "drizzle-orm";
import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { IconReglages } from "@/components/shell/icons";
import { getDb, schema } from "@/lib/db";
import { PoidsEditeur } from "@/components/poids-editeur";

export const dynamic = "force-dynamic";

export default async function ReglagesPage() {
  const db = getDb();
  const poids = await db.select().from(schema.weights);
  const topInitial = await db
    .select({ siret: schema.lead.siret })
    .from(schema.lead)
    .orderBy(desc(schema.lead.scoreFinal))
    .limit(20);

  return (
    <>
      <PageChrome
        icon={<IconReglages size={18} />}
        title="Poids du moteur"
        count={`${poids.length} constantes réglables`}
      />
      <PageBody>
        <div className="pl-wrap">
          <p className="pl-note">
            <span>
              <b>Aucune constante magique dans le code.</b> Tous les poids du scoring vivent en base
              et se règlent ici : déplacez un curseur pour voir le top 20 se recalculer en direct,
              puis enregistrez pour appliquer à toute la base.
            </span>
          </p>
          <PoidsEditeur
            poids={poids.map((p) => ({
              key: p.key,
              value: p.value,
              min: p.min,
              max: p.max,
              labelFr: p.labelFr,
              descriptionFr: p.descriptionFr,
            }))}
            topInitial={topInitial}
          />
        </div>
      </PageBody>
    </>
  );
}
