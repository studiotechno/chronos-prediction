"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Nouveau mot de passe ────────────────────────────────────────────
   Atteignable avec la session courte ouverte par le lien reçu par email.
   `updateUser` l'applique au compte connecté — aucun ancien mot de passe à
   redemander, le lien fait foi. */

const LONGUEUR_MIN = 8;

export function FormulaireNouveauMotDePasse() {
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    setErreur(null);

    if (motDePasse.length < LONGUEUR_MIN) {
      setErreur(`Mot de passe trop court — ${LONGUEUR_MIN} caractères minimum.`);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur("Les deux saisies ne correspondent pas.");
      return;
    }

    setEnCours(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: motDePasse });

    if (error) {
      setErreur(
        error.code === "same_password"
          ? "Choisissez un mot de passe différent de l’actuel."
          : `Enregistrement impossible (${error.code ?? error.status ?? "erreur"}).`,
      );
      setEnCours(false);
      return;
    }

    // Navigation pleine page : le cookie de session vient d'être renouvelé côté
    // navigateur, et le layout est rendu côté serveur.
    window.location.assign("/");
  }

  return (
    <main className="ins">
      <div className="ins-marque">
        Chronos<span>.</span>
        <em>leads intérim</em>
      </div>

      <form className="ins-carte" onSubmit={enregistrer}>
        <h1>Nouveau mot de passe</h1>
        <p className="ins-sous">
          Choisissez-en un nouveau : il remplace l’ancien immédiatement, et vous entrez dans l’outil
          dans la foulée.
        </p>

        <label className="ins-lb" htmlFor="motDePasse">
          Mot de passe <span>({LONGUEUR_MIN} caractères minimum)</span>
        </label>
        <input
          id="motDePasse"
          name="motDePasse"
          type="password"
          className="ins-champ"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="new-password"
          autoFocus
          required
        />

        <div className="cnx-espace">
          <label className="ins-lb" htmlFor="confirmation">
            Confirmation
          </label>
          <input
            id="confirmation"
            name="confirmation"
            type="password"
            className="ins-champ"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        {erreur && (
          <p className="ins-erreur" role="alert">
            {erreur}
          </p>
        )}

        <button type="submit" className="ins-cta" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer et entrer"}
        </button>
      </form>
    </main>
  );
}
