import "./env";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/lib/db";
import { getSupabaseAdmin } from "../src/lib/supabase/admin";

/**
 * Rattache un compte Supabase Auth à l'agence — création ou changement de mot
 * de passe, selon que l'adresse existe déjà.
 *
 *     npm run compte -- --email=agence@exemple.fr
 *     npm run compte -- --email=agence@exemple.fr --mdp='…'   (non interactif)
 *
 * Le mot de passe est demandé sur l'entrée standard si `--mdp` est absent :
 * c'est le mode à préférer, un argument de ligne de commande restant visible
 * dans l'historique du shell et dans la liste des processus.
 *
 * Passe par la clé de service (service_role), qui contourne les RLS et autorise
 * l'API d'administration : elle ne doit JAMAIS être exposée au navigateur ni
 * posée sur Vercel — ce script ne tourne qu'en local.
 */

/** Plancher volontairement bas : Supabase impose 6, l'outil demande un peu plus. */
const MDP_MIN = 8;

function argument(nom: string): string | null {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : null;
}

async function demanderMotDePasse(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Mot de passe du compte : ")).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const email = argument("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Usage : npm run compte -- --email=agence@exemple.fr [--mdp='…']");
  }

  const motDePasse = argument("mdp") ?? (await demanderMotDePasse());
  if (motDePasse.length < MDP_MIN) {
    throw new Error(`Mot de passe trop court — ${MDP_MIN} caractères minimum.`);
  }

  const admin = getSupabaseAdmin();

  const db = getDb();
  const agence = (await db.select().from(schema.agence).limit(1))[0];
  if (!agence) {
    throw new Error("Aucune agence en base — faites d'abord l'inscription dans l'application.");
  }

  // L'API d'administration n'a pas de « rechercher par email » : on pagine.
  // Un projet mono-agence en compte une poignée, la première page suffit.
  const { data: liste, error: erreurListe } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (erreurListe) throw erreurListe;
  const existant = liste.users.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  if (existant) {
    const { error } = await admin.auth.admin.updateUserById(existant.id, { password: motDePasse });
    if (error) throw error;
    userId = existant.id;
    console.log(`[compte] mot de passe mis à jour pour ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: motDePasse,
      // Pas de vérification par email : le compte est créé par un administrateur,
      // il n'y a personne à qui envoyer un lien de confirmation.
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`[compte] compte créé : ${email}`);
  }

  await db
    .update(schema.agence)
    .set({ email, authUserId: userId })
    .where(eq(schema.agence.id, agence.id));

  console.log(`[compte] rattaché à l'agence « ${agence.nom} » (auth_user_id ${userId})`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
