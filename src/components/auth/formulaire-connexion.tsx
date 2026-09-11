"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

/* ── Connexion ───────────────────────────────────────────────────────
   Même langage visuel que l'inscription (classes .ins-*) : c'est le même
   moment pour l'utilisateur, la porte de l'outil. La connexion passe par le
   client navigateur, comme sur les autres produits maison : Supabase pose
   lui-même les cookies de session, et le middleware les rafraîchit ensuite. */

/** Motifs d'un retour forcé sur cette page — voir /auth/signout et /auth/callback. */
const MOTIFS: Record<string, string> = {
  "compte-non-rattache": "Ce compte n’est pas rattaché à cette agence.",
  "lien-expire": "Ce lien de réinitialisation a expiré ou a déjà servi. Demandez-en un nouveau.",
  "lien-invalide": "Lien de réinitialisation illisible. Demandez-en un nouveau.",
};

export function FormulaireConnexion({
  nomAgence,
  raison,
}: {
  nomAgence: string;
  /** Motif d'un retour forcé ici — voir /auth/signout. */
  raison?: string;
}) {

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(MOTIFS[raison ?? ""] ?? null);
  const [enCours, setEnCours] = useState(false);

  async function connecter(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: motDePasse,
    });

    if (error) {
      // Un refus d'identifiants garde un message unique : distinguer « email
      // inconnu » de « mot de passe faux » dirait à un inconnu quelles adresses
      // existent. Les autres refus, eux, doivent se dire — un « mot de passe
      // incorrect » affiché alors que Supabase limite le débit envoie chercher
      // le problème exactement là où il n'est pas.
      const limite = error.status === 429 || error.code === "over_request_rate_limit";
      setErreur(
        limite
          ? "Trop de tentatives de connexion. Patientez une minute avant de réessayer."
          : error.code === "invalid_credentials" || error.status === 400
            ? "Email ou mot de passe incorrect."
            : `Connexion impossible (${error.code ?? error.status ?? "erreur"}). Réessayez.`,
      );
      setEnCours(false);
      return;
    }

    // Navigation pleine page plutôt que `router.push` : le cookie vient d'être
    // posé par le client navigateur, et une navigation client réutiliserait le
    // rendu serveur mis en cache, obtenu lui sans session — on repartait alors
    // sur /connexion. Un chargement complet garantit que le middleware et le
    // layout voient la session. C'est une connexion : la page se recharge, et
    // c'est ce qu'attend l'utilisateur.
    window.location.assign("/");
  }

  return (
    <main className="ins">
      <div className="ins-marque">
        Chronos<span>.</span>
        <em>leads intérim</em>
      </div>

      <form className="ins-carte" onSubmit={connecter}>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <div className="cnx-espace">
          <div className="cnx-ligne-lb">
            <label className="ins-lb" htmlFor="motDePasse">
              Mot de passe
            </label>
            <Link href="/mot-de-passe-oublie" className="cnx-oubli">
              Mot de passe oublié ?
            </Link>
          </div>
          <input
            id="motDePasse"
            name="motDePasse"
            type="password"
            className="ins-champ"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {erreur && (
          <p className="ins-erreur" role="alert">
            {erreur}
          </p>
        )}

        <button type="submit" className="ins-cta" disabled={enCours}>
          {enCours ? "Vérification…" : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
