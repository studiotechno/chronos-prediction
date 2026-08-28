import { ActualitesVue } from "@/components/actualites/vue";
import { getActualites } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Actualités du bassin : les marchés publics attribués, les appels d'offres
 * encore ouverts et la vie des entreprises alentour. La page sert le fil
 * complet — le cadrage, la période et la recherche se jouent côté client,
 * où changer d'angle doit être instantané.
 */
export default async function ActualitesPage() {
  const actualites = await getActualites();
  return <ActualitesVue actualites={actualites} />;
}
