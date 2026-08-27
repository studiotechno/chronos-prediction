import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { PoidsEditeur } from "@/components/poids-editeur";

export const dynamic = "force-dynamic";

export default function ReglagesPage() {
  const db = getDb();
  const poids = db.select().from(schema.weights).all();
  const topInitial = db
    .select({ siret: schema.lead.siret })
    .from(schema.lead)
    .orderBy(desc(schema.lead.scoreFinal))
    .limit(20)
    .all();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Réglages du scoring</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Tous les poids du moteur vivent ici — aucune constante magique dans le code. Déplacez un
          curseur pour voir le top 20 se recalculer en direct, puis enregistrez pour appliquer à
          toute la base.
        </p>
      </div>
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
  );
}
