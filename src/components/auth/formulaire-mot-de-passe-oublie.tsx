"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Mot de passe oublié ─────────────────────────────────────────────
   Supabase envoie le lien de réinitialisation ; il revient sur
   /auth/callback, qui ouvre une session courte et mène au choix du nouveau
   mot de passe. */

export function FormulaireMotDePasseOublie() {
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function demander(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      // Cette URL doit figurer dans Supabase → Authentication → URL
      // Configuration → Redirect URLs, sinon le lien reçu ne mène nulle part.
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    if (error) {
      setErreur(
        error.status === 429
          ? "Trop de demandes. Patientez quelques minutes avant de réessayer."
          : `Envoi impossible (${error.code ?? error.status ?? "erreur"}).`,
      );
      setEnCours(false);
      return;
    }

    setEnvoye(true);
    setEnCours(false);
  }

  return (
    <main className="ins">
      <div className="ins-marque">
        Chronos<span>.</span>
        <em>leads intérim</em>
      </div>

      {envoye ? (
        <section className="ins-carte">
          <h1>Vérifiez vos emails</h1>
          <p className="ins-sous">
            Si un compte existe pour <strong>{email.trim().toLowerCase()}</strong>, un lien de
            réinitialisation vient d’y être envoyé. Il est valable une heure.
          </p>
          <p className="ins-note">
            Rien reçu ? Regardez les indésirables. L’absence de message signifie aussi que cette
            adresse n’a pas de compte — nous ne le disons pas à l’écran pour ne pas révéler qui est
            inscrit.
          </p>
          <Link href="/connexion" className="cnx-lien">
            ← Retour à la connexion
          </Link>
        </section>
      ) : (
        <form className="ins-carte" onSubmit={demander}>
          <h1>Mot de passe oublié</h1>
          <p className="ins-sous">
            Indiquez l’adresse du compte : Supabase envoie un lien pour en choisir un nouveau.
          </p>

          <label className="ins-lb" htmlFor="email">
            Adresse email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="ins-champ"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />

          {erreur && (
            <p className="ins-erreur" role="alert">
              {erreur}
            </p>
          )}

          <button type="submit" className="ins-cta" disabled={enCours}>
            {enCours ? "Envoi…" : "Envoyer le lien"}
          </button>

          <Link href="/connexion" className="cnx-lien">
            ← Retour à la connexion
          </Link>
        </form>
      )}
    </main>
  );
}
