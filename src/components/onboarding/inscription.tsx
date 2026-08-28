"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { enregistrerAgence } from "@/app/actions";
import { ZoneEditor, type ZonePayload } from "@/components/onboarding/zone-editor";

/* ── Inscription ─────────────────────────────────────────────────────
   Deux étapes, plein écran : l'agence, puis sa zone. Rien n'est écrit en
   base avant la fin — l'inscription est une seule transaction, on ne
   laisse pas derrière soi un compte sans territoire. Le garde
   `beforeunload` protège une saisie en cours : ce paramétrage décide de
   tout ce que l'outil affichera ensuite. */

const ETAPES = ["Votre agence", "Votre zone de prospection"] as const;

export function Inscription({
  secteurs,
  metiers,
  secteursSuggeres,
  metiersSuggeres,
}: {
  secteurs: { code: string; label: string; taux: number }[];
  metiers: { code: string; label: string }[];
  /** Présélection de départ : les secteurs où l'intérim pèse le plus. */
  secteursSuggeres: string[];
  metiersSuggeres: string[];
}) {
  const router = useRouter();
  const [etape, setEtape] = useState<1 | 2>(1);
  const [nom, setNom] = useState("");
  const [responsable, setResponsable] = useState("");
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [termine, setTermine] = useState(false);

  const enSaisie =
    !termine && (etape === 2 || [nom, responsable, email].some((v) => v.trim() !== ""));

  useEffect(() => {
    if (!enSaisie) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enSaisie]);

  function validerAgence(e: FormEvent) {
    e.preventDefault();
    if (nom.trim().length < 2) {
      setErreur("Indiquez le nom de votre agence.");
      return;
    }
    setErreur(null);
    setEtape(2);
  }

  async function enregistrerZone(zone: ZonePayload) {
    const res = await enregistrerAgence({
      nom: nom.trim(),
      responsable: responsable.trim() || undefined,
      email: email.trim() || undefined,
      ...zone,
    });
    if (!res.ok) throw new Error(res.message);
    setTermine(true);
    router.push("/");
    router.refresh();
  }

  return (
    <main className={`ins ${etape === 2 ? "ins--large" : ""}`}>
      <div className="ins-marque">
        Chronos<span>.</span>
        <em>leads intérim</em>
      </div>

      <ol className="ins-etapes" aria-label="Progression de l’inscription">
        {ETAPES.map((label, i) => {
          const n = (i + 1) as 1 | 2;
          return (
            <li key={label} data-atteinte={n <= etape} aria-current={n === etape ? "step" : undefined}>
              <span className="lb">
                {n} · {label}
              </span>
              <span className="bar" />
            </li>
          );
        })}
      </ol>

      {etape === 1 ? (
        <form className="ins-carte" onSubmit={validerAgence}>
          <h1>Votre agence</h1>
          <p className="ins-sous">
            Chronos travaille pour une agence à la fois : ce nom apparaîtra en tête de l’outil, la
            zone arrive juste après.
          </p>

          <label className="ins-lb" htmlFor="nom">
            Nom de l’agence
          </label>
          <input
            id="nom"
            className="ins-champ"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Agence de Vichy"
            autoComplete="organization"
            required
          />

          <div className="ins-duo">
            <div>
              <label className="ins-lb" htmlFor="responsable">
                Responsable <span>(optionnel)</span>
              </label>
              <input
                id="responsable"
                className="ins-champ"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder="Camille Durand"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="ins-lb" htmlFor="email">
                Email <span>(optionnel)</span>
              </label>
              <input
                id="email"
                type="email"
                className="ins-champ"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agence@exemple.fr"
                autoComplete="email"
              />
            </div>
          </div>

          {erreur && <p className="ins-erreur">{erreur}</p>}

          <button type="submit" className="ins-cta">
            Continuer vers la zone →
          </button>

          <p className="ins-note">
            V0 mono-agence : aucun mot de passe, aucune donnée personnelle collectée. Ces champs
            servent à nommer le compte et la zone qui alimentent le moteur.
          </p>
        </form>
      ) : (
        <section className="ins-carte">
          <h1>Votre zone de prospection</h1>
          <p className="ins-sous">
            Une agence, une zone. Elle décide de ce que l’outil ingère, rapproche et vous montre —
            et elle reste modifiable ensuite depuis « Ma zone ».
          </p>
          <ZoneEditor
            secteurs={secteurs}
            metiers={metiers}
            initiale={{
              commune: null,
              codePostal: null,
              departement: null,
              lat: 46.13,
              lon: 3.43,
              rayonKm: 30,
              nafCibles: secteursSuggeres,
              romeCibles: metiersSuggeres,
            }}
            saveLabel="Ouvrir mon tableau des leads"
            onSave={enregistrerZone}
          />
        </section>
      )}
    </main>
  );
}
