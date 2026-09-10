"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connexion, type ResultatConnexion } from "@/app/auth-actions";

/* ── Connexion ───────────────────────────────────────────────────────
   Même langage visuel que l'inscription (classes .ins-*) : c'est le même
   moment pour l'utilisateur, la porte de l'outil. L'action serveur redirige
   elle-même en cas de succès ; elle ne revient ici que pour refuser. */

export function FormulaireConnexion({ nomAgence }: { nomAgence: string }) {
  const [etat, action] = useActionState<ResultatConnexion | null, FormData>(connexion, null);

  return (
    <main className="ins">
      <div className="ins-marque">
        Chronos<span>.</span>
        <em>leads intérim</em>
      </div>

      <form className="ins-carte" action={action}>
        <h1>Connexion</h1>
        <p className="ins-sous">
          {nomAgence} — identifiez-vous pour accéder aux leads, à la zone et au moteur.
        </p>

        <label className="ins-lb" htmlFor="email">
          Adresse email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="ins-champ"
          autoComplete="username"
          autoFocus
          required
        />

        <div className="cnx-espace">
          <label className="ins-lb" htmlFor="motDePasse">
            Mot de passe
          </label>
          <input
            id="motDePasse"
            name="motDePasse"
            type="password"
            className="ins-champ"
            autoComplete="current-password"
            required
          />
        </div>

        {etat && !etat.ok && (
          <p className="ins-erreur" role="alert">
            {etat.message}
          </p>
        )}

        <BoutonConnexion />

        <p className="ins-note">
          Mot de passe oublié : il n’est pas récupérable — il est haché en base. Un nouveau se pose
          en ligne de commande avec <code>npm run compte</code>.
        </p>
      </form>
    </main>
  );
}

/** `useFormStatus` doit vivre dans un enfant du <form> pour observer son envoi. */
function BoutonConnexion() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ins-cta" disabled={pending}>
      {pending ? "Vérification…" : "Se connecter"}
    </button>
  );
}
