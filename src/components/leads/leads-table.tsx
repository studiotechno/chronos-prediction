"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { LectureScore } from "@/components/score";
import { PucesSignaux } from "@/components/signaux";
import { useMediaQuery } from "@/lib/client-state";
import { distanceLisible, etatFenetre, fenetreLisible } from "@/lib/format";
import { STATUT_LABELS } from "@/lib/leads/filtres";
import { nafLabel } from "@/lib/reference/naf";
import type { LeadListe } from "@/lib/queries";

/* ── Tableau des leads ───────────────────────────────────────────────
   Une ligne = une entreprise à appeler. L'ordre par défaut est celui du
   score final, et la colonne « Pourquoi appeler » est la plus large :
   c'est la phrase que le commercial lit avant de décrocher, pas le score.
   Les leads en nurturing, quand ils sont affichés, sont séparés par une
   bande — ils ne se mélangent jamais au flux chaud.

   Les colonnes d'appoint ne sont pas masquées en CSS mais RETIRÉES du
   DOM : en `table-layout: fixed`, une colonne en `display: none` continue
   de réclamer sa part de largeur, et « Pourquoi appeler » se retrouvait
   réduite à trente pixels sur un écran étroit. */

type Tri = "score" | "nom" | "distance" | "fraicheur";
type ColId = "rang" | "nom" | "score" | "raison" | "signaux" | "fraicheur" | "distance" | "statut";

interface EtatTri {
  cle: Tri;
  sens: 1 | -1;
}

interface Colonne {
  id: ColId;
  label: string;
  tri?: Tri;
  droite?: boolean;
  /** Largeur en layout fixe ; la colonne sans largeur prend le reste. */
  largeur?: string;
}

/** Colonnes par palier de largeur : l'essentiel d'abord, le confort ensuite. */
function colonnesPour(compact: boolean, moyen: boolean): Colonne[] {
  if (compact) {
    return [
      { id: "nom", label: "Entreprise", tri: "nom", largeur: "44%" },
      { id: "score", label: "Score", tri: "score", largeur: "92px" },
      { id: "raison", label: "Pourquoi appeler" },
    ];
  }
  const base: Colonne[] = [
    { id: "rang", label: "", largeur: "46px" },
    { id: "nom", label: "Entreprise", tri: "nom", largeur: "24%" },
    { id: "score", label: "Score", tri: "score", largeur: "118px" },
    { id: "raison", label: "Pourquoi appeler" },
    { id: "signaux", label: "Signaux", largeur: "210px" },
    { id: "fraicheur", label: "Dernier signal", tri: "fraicheur", droite: true, largeur: "128px" },
  ];
  if (moyen) return base;
  return [
    ...base,
    { id: "distance", label: "Dist.", tri: "distance", droite: true, largeur: "84px" },
    { id: "statut", label: "Statut", largeur: "96px" },
  ];
}

/** Jours depuis le signal le plus récent du lead ; null si aucun. */
export function fraicheurJours(l: LeadListe, maintenant = Date.now()): number | null {
  let recent = 0;
  for (const s of l.topSignals) {
    const t = new Date(s.occurredAt).getTime();
    if (Number.isFinite(t) && t > recent) recent = t;
  }
  if (recent === 0) return null;
  return Math.max(0, Math.floor((maintenant - recent) / 86400000));
}

function seau(jours: number | null): { id: string; court: string; long: string } {
  if (jours == null) return { id: "aucun", court: "—", long: "Aucun signal daté" };
  if (jours <= 2) return { id: "today", court: "Frais", long: "Détecté il y a moins de 3 jours" };
  if (jours <= 7) return { id: "recent", court: "7 j", long: "Détecté dans la semaine" };
  if (jours <= 30) return { id: "week", court: "30 j", long: "Détecté dans le mois" };
  return { id: "old", court: "+30 j", long: "Plus d'un mois" };
}

function compare(a: LeadListe, b: LeadListe, cle: Tri): number {
  switch (cle) {
    case "nom":
      return a.denomination.localeCompare(b.denomination, "fr");
    case "score":
      return a.scoreFinal - b.scoreFinal;
    case "distance":
      return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
    case "fraicheur":
      return (fraicheurJours(a) ?? 1e9) - (fraicheurJours(b) ?? 1e9);
  }
}

export function LeadsTable({
  leads,
  videHint,
  masques,
  onAfficherNurturing,
}: {
  leads: LeadListe[];
  videHint: string;
  /** Leads en nurturing volontairement hors du flux, et le moyen de les voir. */
  masques: number;
  onAfficherNurturing: () => void;
}) {
  const router = useRouter();
  const [tri, setTri] = useState<EtatTri>({ cle: "score", sens: -1 });
  const compact = useMediaQuery("(max-width: 620px)");
  const moyen = useMediaQuery("(max-width: 900px)");
  const colonnes = useMemo(() => colonnesPour(compact, moyen), [compact, moyen]);

  /* Le segment prime toujours sur le tri : trier par distance ne doit pas
     faire remonter un lead de nurturing au-dessus d'un lead chaud. */
  const triees = useMemo(() => {
    const copie = [...leads];
    copie.sort((a, b) => {
      if (a.segment !== b.segment) return a.segment === "chaud" ? -1 : 1;
      return compare(a, b, tri.cle) * tri.sens;
    });
    return copie;
  }, [leads, tri]);

  function trier(cle: Tri) {
    setTri((p) =>
      p.cle === cle
        ? { cle, sens: p.sens === 1 ? -1 : 1 }
        : { cle, sens: cle === "nom" || cle === "distance" || cle === "fraicheur" ? 1 : -1 },
    );
  }

  let segmentPrecedent: string | null = null;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <table className="pp-tab w-full border-separate border-spacing-0" data-compact={compact || undefined}>
        <colgroup>
          {colonnes.map((c) => (
            <col key={c.id} style={c.largeur ? { width: c.largeur } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {colonnes.map((c) => (
              <th
                key={c.id}
                className={`pp-th${c.tri ? " pp-th-sort" : ""}${c.droite ? " pp-th-r" : ""}`}
                onClick={c.tri ? () => trier(c.tri!) : undefined}
                aria-sort={
                  c.tri && tri.cle === c.tri ? (tri.sens === -1 ? "descending" : "ascending") : undefined
                }
              >
                {c.label}
                {c.tri && (
                  <span className={`pp-th-ind${tri.cle === c.tri ? " on" : ""}`}>
                    {tri.cle === c.tri ? (tri.sens === -1 ? "↓" : "↑") : "↕"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {triees.map((l, i) => {
            const nouveauSegment = l.segment !== segmentPrecedent;
            segmentPrecedent = l.segment;
            const ouvrir = () => router.push(`/lead/${l.siret}`);

            return (
              <Fragment key={l.siret}>
                {nouveauSegment && (
                  <tr>
                    <td colSpan={colonnes.length} className="p-0">
                      <div className="pp-seg" data-segment={l.segment}>
                        <b>{l.segment === "chaud" ? "Leads chauds" : "Leads tièdes"}</b>
                        <span className="ex">
                          {l.segment === "chaud"
                            ? "un déclencheur daté vient de parler — à appeler cette semaine"
                            : "bon profil structurel, aucun déclencheur assez récent"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                <tr
                  className="pp-tr"
                  data-segment={l.segment}
                  /* Cascade d'arrivée : la liste se remplit sous les yeux
                     plutôt que d'apparaître d'un bloc. */
                  style={{ "--i": i } as React.CSSProperties}
                  onClick={ouvrir}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") ouvrir();
                  }}
                >
                  {colonnes.map((c) => (
                    <Cellule key={c.id} colonne={c} lead={l} rang={i + 1} />
                  ))}
                </tr>
              </Fragment>
            );
          })}
          {masques > 0 && (
            <tr>
              <td colSpan={colonnes.length} className="p-0">
                <div className="pp-masques">
                  <span>
                    <b>{masques.toLocaleString("fr-FR")}</b> entreprise
                    {masques > 1 ? "s" : ""} au bon profil structurel n’{masques > 1 ? "ont" : "a"}{" "}
                    aucun déclencheur récent — elles restent hors du flux d’appels.
                  </span>
                  <button type="button" onClick={onAfficherNurturing}>
                    Afficher les tièdes
                  </button>
                </div>
              </td>
            </tr>
          )}
          {triees.length === 0 && (
            <tr>
              <td colSpan={colonnes.length} className="px-6 py-16 text-center">
                <div className="text-[14px] font-semibold text-foreground">Aucun lead</div>
                <div className="mx-auto mt-1 max-w-[440px] text-[12px] leading-relaxed text-muted-foreground">
                  {videHint}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Deux lettres tirées de la raison sociale, pour la vignette de ligne. */
function initiales(nom: string): string {
  const mots = nom
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((m) => m.length > 1);
  if (mots.length === 0) return nom.slice(0, 2).toUpperCase();
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}

/** Une cellule, choisie par identifiant de colonne. */
function Cellule({ colonne, lead: l, rang }: { colonne: Colonne; lead: LeadListe; rang: number }): ReactNode {
  switch (colonne.id) {
    case "rang":
      return <td className="pp-td pp-td-rang">{String(rang).padStart(2, "0")}</td>;
    case "nom":
      return (
        <td className="pp-td pp-td-nom">
          {/* La vignette d'initiales donne à chaque ligne un visage : on
              retrouve une entreprise dans la liste avant même de lire son nom,
              et la teinte redit le segment sans ajouter de filet.
              La mise en ligne se fait dans un conteneur INTERNE : une cellule
              de tableau passée en `display: flex` quitte la mise en page du
              tableau et emporte avec elle l'alignement de toute la rangée. */}
          <div className="wr">
            <span className="pp-av" data-segment={l.segment} aria-hidden>
              {initiales(l.denomination)}
            </span>
            <span className="ct">
              <span className="nm">{l.denomination}</span>
              <span className="sub">
                {[l.commune, nafLabel(l.naf), l.effectifEstime ? `≈ ${l.effectifEstime} sal.` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
        </td>
      );
    case "score":
      return (
        <td className="pp-td">
          <LectureScore
            score={l.scoreFinal}
            strate={l.strate}
            sismo={l.sismo}
            segment={l.segment === "chaud" ? "chaud" : "nurturing"}
          />
        </td>
      );
    case "raison": {
      const etat = etatFenetre(l.fenetreDebut, l.fenetreFin);
      const fenetre = fenetreLisible(l.fenetreDebut, l.fenetreFin);
      return (
        <td className="pp-td pp-td-raison">
          <span>{l.raisonFr}</span>
          {(l.propositionFr || fenetre) && (
            <span className="pp-prop">
              {fenetre && etat && (
                <span className="pp-fen" data-etat={etat} title="Fenêtre d'appel dérivée des signaux à retard">
                  {fenetre}
                </span>
              )}
              {l.propositionFr && <span className="pp-prop-txt">{l.propositionFr}</span>}
            </span>
          )}
        </td>
      );
    }
    case "signaux":
      return (
        <td className="pp-td">
          <PucesSignaux topSignals={l.topSignals} />
        </td>
      );
    case "fraicheur": {
      const j = fraicheurJours(l);
      const s = seau(j);
      return (
        <td className="pp-td pp-td-r">
          <span className="pp-time-badge" data-bucket={s.id} title={s.long}>
            {s.court}
          </span>
          {j != null && <span className="pp-jn">J-{j}</span>}
        </td>
      );
    }
    case "distance": {
      const ailleurs =
        l.lieuBesoinFr != null &&
        l.distanceKm != null &&
        (l.distanceEtabKm == null || Math.abs(l.distanceKm - l.distanceEtabKm) > 0.5);
      return (
        <td
          className="pp-td pp-td-r pp-num"
          title={
            ailleurs
              ? `Lieu du besoin : ${l.lieuBesoinFr}${l.distanceEtabKm != null ? ` — établissement à ${distanceLisible(l.distanceEtabKm)}` : ""}`
              : undefined
          }
        >
          {distanceLisible(l.distanceKm)}
          {ailleurs && <span className="pp-dist-lieu" aria-hidden>◦</span>}
        </td>
      );
    }
    case "statut":
      return (
        <td className="pp-td">
          <span className="pp-statut" data-statut={l.statut}>
            {STATUT_LABELS[l.statut] ?? l.statut}
          </span>
        </td>
      );
  }
}
