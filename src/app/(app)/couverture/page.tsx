import { Couverture } from "@/components/couverture/vue";
import { getCouverture } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Couverture concurrentielle : les missions d'intérim postées par des agences
 * sur le bassin. La page ne fait que servir le jeu complet — la grille, les
 * filtres et les trois angles de lecture vivent côté client, où changer de
 * fenêtre ou d'enseigne doit être instantané.
 */
export default async function CouverturePage() {
  const { missions, enseigneAgence, libellesRome, romeCibles, demiVie, total, tronque } =
    await getCouverture();

  return (
    <Couverture
      missions={missions}
      enseigneAgence={enseigneAgence}
      libellesRome={libellesRome}
      romeCibles={romeCibles}
      demiVie={demiVie}
      total={total}
      tronque={tronque}
    />
  );
}
