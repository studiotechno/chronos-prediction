import { notFound } from "next/navigation";
import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { IconChevronDown, IconEntreprise } from "@/components/shell/icons";
import { DetailSignalPanneau, PuceSignal, familleSignal } from "@/components/signaux";
import { StatutSelect } from "@/components/statut-select";
import { getLeadDetail, type PointHistorique } from "@/lib/queries";
import { nafLabel } from "@/lib/reference/naf";
import { trancheByCode } from "@/lib/reference/tranches";
import { tauxRecoursInterim } from "@/lib/reference/dares";
import {
  dateCourte,
  dateRelative,
  distanceLisible,
  etatFenetre,
  siretFormate,
  tempoLisible,
} from "@/lib/format";
import type { ScoreComponent } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/* ── Fiche entreprise ────────────────────────────────────────────────
   Ce que le commercial a sous les yeux en composant le numéro : la
   phrase à dire, ce qu'on propose et quand, les trois couches du score
   et d'où elles viennent, puis la chronologie des signaux. Rien n'est
   affiché sans son origine — un score sans décomposition ne se défend
   pas au téléphone. */

type Couche = "strate" | "sismo" | "tempo";

function Composante({ c, couche, total }: { c: ScoreComponent; couche: Couche; total: number }) {
  const negatif = c.contribution < 0;
  const largeur = c.max
    ? Math.min(100, (Math.abs(c.contribution) / c.max) * 100)
    : Math.min(100, (Math.abs(c.contribution) / Math.max(1, total)) * 100);
  // Tempo : chaque composante est un delta autour de 1, lisible à deux décimales.
  const valeur =
    couche === "tempo"
      ? `${negatif ? "−" : "+"}${Math.abs(c.contribution).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${negatif ? "" : "+"}${c.contribution.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`;

  return (
    <div className="fi-comp" data-couche={couche} data-negatif={negatif || undefined}>
      <div className="hd">
        <span className="lb">{c.labelFr}</span>
        <span className="vl">
          {valeur}
          {c.max ? (
            <em>
              {" "}
              / {couche === "tempo" ? `±${c.max.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}` : c.max}
            </em>
          ) : null}
        </span>
      </div>
      <span className="trk">
        <i style={{ width: `${largeur}%` }} />
      </span>
      {c.detailFr && <p className="dt">{c.detailFr}</p>}
    </div>
  );
}

/* Tendance du score : la mémoire du moteur, lue en un trait. Moins de trois
   points, on le dit en chiffres ; au-delà, une courbe sobre suffit. */
function Tendance({ historique }: { historique: PointHistorique[] }) {
  if (historique.length === 0) {
    return <span className="fi-tend-vide">Historique à partir du prochain recalcul quotidien.</span>;
  }
  const premier = historique[0];
  const dernier = historique[historique.length - 1];
  const delta = Math.round(dernier.scoreFinal - premier.scoreFinal);
  const jours = Math.max(
    1,
    Math.round((new Date(dernier.jour).getTime() - new Date(premier.jour).getTime()) / 86400000),
  );
  const texte =
    historique.length < 2
      ? `Premier point le ${dateCourte(premier.jour)}`
      : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} pt${Math.abs(delta) > 1 ? "s" : ""} sur ${jours} j`;

  if (historique.length < 3) {
    return (
      <span className="fi-tend" data-sens={delta > 0 ? "haut" : delta < 0 ? "bas" : "plat"}>
        {texte}
      </span>
    );
  }

  const w = 120;
  const h = 28;
  const pas = w / (historique.length - 1);
  const y = (v: number) => h - 2 - (Math.min(100, Math.max(0, v)) / 100) * (h - 4);
  const chemin = historique.map((p, i) => `${i === 0 ? "M" : "L"}${(i * pas).toFixed(1)},${y(p.scoreFinal).toFixed(1)}`).join(" ");
  const aire = `${chemin} L${w},${h} L0,${h} Z`;

  return (
    <span className="fi-tend" data-sens={delta > 0 ? "haut" : delta < 0 ? "bas" : "plat"}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
        <path className="aire" d={aire} />
        <path className="trait" d={chemin} />
        <circle className="fin" cx={w} cy={y(dernier.scoreFinal)} r={2.2} />
      </svg>
      <b>{texte}</b>
    </span>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ siret: string }> }) {
  const { siret } = await params;
  const detail = await getLeadDetail(siret);
  if (!detail) notFound();

  const { etab, entreprise, lead, strate, sismo, tempo, signaux, historique, distanceKm } = detail;
  const tranche = trancheByCode(etab.trancheEffectif);
  const taux = tauxRecoursInterim(etab.naf);
  const totalSismoPositif = (sismo?.components ?? [])
    .filter((c) => c.contribution > 0)
    .reduce((s, c) => s + c.contribution, 0);
  const chaud = lead?.segment === "chaud";
  const now = new Date();
  const fenetre = lead ? etatFenetre(lead.fenetreDebut, lead.fenetreFin, now) : null;
  const tempoValeur = lead && Number.isFinite(lead.tempo) ? lead.tempo : (tempo?.score ?? null);
  const distanceBesoin = lead && Number.isFinite(lead.distanceBesoinKm) ? lead.distanceBesoinKm : null;
  const besoinAilleurs =
    lead?.lieuBesoinFr != null &&
    distanceBesoin != null &&
    (distanceKm == null || Math.abs(distanceBesoin - distanceKm) > 0.5);

  const idcc = etab.idcc && etab.idcc.length > 0 ? etab.idcc : (entreprise?.idcc ?? []);
  const finances: string[] = [];
  if (entreprise?.ca != null && entreprise.ca > 0) {
    finances.push(
      `CA ${montantCourt(entreprise.ca)}${entreprise.caAnnee ? ` (${entreprise.caAnnee})` : ""}` +
        (entreprise.caPrecedent != null && entreprise.caPrecedent > 0
          ? `, ${deltaPct(entreprise.ca, entreprise.caPrecedent)}`
          : ""),
    );
  }
  if (entreprise?.resultatNet != null) {
    finances.push(`résultat ${entreprise.resultatNet < 0 ? "négatif" : "positif"} (${montantCourt(entreprise.resultatNet)})`);
  }

  return (
    <>
      <PageChrome
        icon={<IconEntreprise size={18} />}
        parent={{ label: "Leads", href: "/" }}
        title={etab.denomination}
        count={`${etab.commune ?? "—"} · ${nafLabel(etab.naf)}`}
        actions={lead ? <StatutSelect siret={etab.siret} statut={lead.statut} /> : undefined}
      />

      <PageBody>
        <div className="pl-wrap">
          {/* Pourquoi appeler — la phrase, puis ce qu'on propose, avant les chiffres. */}
          {lead && (
            <section className="fi-raison" data-segment={lead.segment}>
              <span className="pp-meta">Pourquoi appeler</span>
              <p>{lead.raisonFr}</p>
              {(lead.propositionFr || fenetre || lead.lieuBesoinFr) && (
                <div className="fi-prop">
                  {lead.propositionFr && (
                    <span className="fi-prop-txt" title="Ce qu'on propose au téléphone : les métiers induits par les signaux">
                      {lead.propositionFr}
                    </span>
                  )}
                  <span className="fi-prop-tags">
                    {fenetre && lead.fenetreDebut && lead.fenetreFin && (
                      <span className="fi-fen" data-etat={fenetre}>
                        <i aria-hidden />
                        {fenetre === "maintenant"
                          ? `Fenêtre d'appel : maintenant, jusqu'au ${dateCourte(lead.fenetreFin)}`
                          : fenetre === "a_venir"
                            ? `Fenêtre d'appel : du ${dateCourte(lead.fenetreDebut)} au ${dateCourte(lead.fenetreFin)}`
                            : `Fenêtre d'appel passée depuis le ${dateCourte(lead.fenetreFin)}`}
                      </span>
                    )}
                    {!fenetre && sismo && (sismo.components?.length ?? 0) > 0 && (
                      <span className="fi-fen" data-etat="maintenant">
                        <i aria-hidden />
                        Besoin immédiat
                      </span>
                    )}
                    {lead.lieuBesoinFr && (
                      <span className="fi-lieu" title="Lieu du besoin : chantier, lieu de travail ou site — pas le siège">
                        Besoin à {lead.lieuBesoinFr}
                        {distanceBesoin != null ? ` · ${distanceLisible(distanceBesoin)}` : ""}
                        {besoinAilleurs && distanceKm != null ? ` (établissement à ${distanceLisible(distanceKm)})` : ""}
                      </span>
                    )}
                  </span>
                </div>
              )}
              <span className="fi-seg">{chaud ? "Lead chaud" : "Lead tiède"}</span>
            </section>
          )}

          {/* Les chiffres, et de quoi les situer. */}
          <div className="pl-kpis" data-cols="5">
            <div className="pl-kpi king">
              <span className="k">Score final</span>
              <span className="vrow">
                <span className="v">{lead ? Math.round(lead.scoreFinal) : "—"}</span>
                <span className="of">/ 100</span>
              </span>
              <span className="sub">
                100 × (Socle/100)<sup>α</sup> × (Pouls/100)<sup>β</sup> × Tempo<sup>γ</sup> —
                multiplicatif : Socle ou Pouls à zéro annule le tout, Tempo déplace dans la
                semaine.
              </span>
              <Tendance historique={historique} />
            </div>
            <div className="pl-kpi">
              <span className="k">Socle — structurel</span>
              <span className="vrow">
                <span className="v" style={{ color: "var(--strate)" }}>
                  {strate ? Math.round(strate.score) : "—"}
                </span>
                <span className="of">/ 100</span>
              </span>
              <div className="pl-meter">
                <span className="pl-trk">
                  <i style={{ width: `${Math.min(100, strate?.score ?? 0)}%`, background: "var(--strate)" }} />
                </span>
              </div>
            </div>
            <div className="pl-kpi">
              <span className="k">Pouls — déclencheurs</span>
              <span className="vrow">
                <span className="v" style={{ color: "var(--sismo)" }}>
                  {sismo ? Math.round(sismo.score) : "—"}
                </span>
                <span className="of">/ 100</span>
              </span>
              <div className="pl-meter">
                <span className="pl-trk">
                  <i style={{ width: `${Math.min(100, sismo?.score ?? 0)}%`, background: "var(--sismo)" }} />
                </span>
              </div>
            </div>
            <div className="pl-kpi">
              <span className="k">Tempo — le quand</span>
              <span className="vrow">
                <span className="v" style={{ color: "var(--tempo)" }}>
                  {tempoValeur != null ? tempoLisible(tempoValeur) : "—"}
                </span>
              </span>
              <span className="sub">
                {tempoValeur == null
                  ? "Pas encore calculé."
                  : tempoValeur > 1.02
                    ? "Le moment est favorable : saison, difficultés de recrutement ou fenêtre d'appel."
                    : tempoValeur < 0.98
                      ? "Moment moins favorable : mois creux ou fenêtre passée."
                      : "Moment neutre."}
              </span>
            </div>
            <div className="pl-kpi">
              <span className="k">L’établissement</span>
              <span className="sub">
                SIRET <b>{siretFormate(etab.siret)}</b>
                <br />
                {tranche
                  ? `${tranche.labelFr}${etab.trancheEffectifSource === "francetravail" ? " (France Travail)" : ""}`
                  : etab.caractereEmployeur === "O"
                    ? "Employeur, effectif non publié"
                    : etab.caractereEmployeur === "N"
                      ? "Sans salarié (INSEE)"
                      : "Effectif inconnu"}
                {etab.dateCreation ? ` · créé en ${etab.dateCreation.slice(0, 4)}` : ""}
                <br />
                {Number.isFinite(distanceKm) ? `${distanceLisible(distanceKm)} de l'agence` : "Distance inconnue"} ·
                recours intérim du secteur <b>{taux.toLocaleString("fr-FR")} %</b>
                {idcc.length > 0 && (
                  <>
                    <br />
                    Convention{idcc.length > 1 ? "s" : ""} collective{idcc.length > 1 ? "s" : ""} IDCC{" "}
                    {idcc.join(", ")}
                  </>
                )}
                {finances.length > 0 && (
                  <>
                    <br />
                    {finances.join(" · ")}
                  </>
                )}
                {etab.icpe === 1 && (
                  <>
                    <br />
                    Site industriel classé (ICPE{etab.icpeRegime ? `, ${etab.icpeRegime.toLowerCase()}` : ""})
                  </>
                )}
              </span>
            </div>
          </div>

          {/* D'où viennent les trois couches. */}
          <section className="fi-cols" data-cols="3">
            <div className="fi-col">
              <h2 className="fi-h2" data-couche="strate">
                Décomposition Socle
              </h2>
              {(strate?.components ?? []).map((c) => (
                <Composante key={c.key} c={c} couche="strate" total={100} />
              ))}
              {!strate && <p className="fi-vide">Pas encore scoré.</p>}
            </div>
            <div className="fi-col">
              <h2 className="fi-h2" data-couche="sismo">
                Décomposition Pouls
              </h2>
              {(sismo?.components ?? []).map((c) => (
                <Composante key={c.key} c={c} couche="sismo" total={totalSismoPositif} />
              ))}
              {sismo && (sismo.components?.length ?? 0) === 0 && (
                <p className="fi-vide">Aucun signal scorable — c’est ce qui laisse ce lead tiède.</p>
              )}
              {sismo && (sismo.components?.length ?? 0) > 0 && (
                <p className="fi-vide">
                  Contributions après noyaux temporels, saturation par famille de source et corroboration
                  (somme{" "}
                  {sismo.components
                    ?.reduce((s, c) => s + c.contribution, 0)
                    .toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
                  ), avant normalisation logistique.
                </p>
              )}
            </div>
            <div className="fi-col">
              <h2 className="fi-h2" data-couche="tempo">
                Décomposition Tempo
              </h2>
              {(tempo?.components ?? []).map((c) => (
                <Composante key={c.key} c={c} couche="tempo" total={1} />
              ))}
              {tempo && (tempo.components?.length ?? 0) === 0 && (
                <p className="fi-vide">Aucune lecture de calendrier ou de conjoncture pour ce lead : Tempo neutre.</p>
              )}
              {!tempo && <p className="fi-vide">Pas encore calculé.</p>}
              {tempo && (tempo.components?.length ?? 0) > 0 && (
                <p className="fi-vide">
                  Facteur {tempoLisible(tempo.score)} = 1 + somme des deltas, borné. Il ordonne les appels dans la
                  semaine, il ne décide pas de la liste.
                </p>
              )}
            </div>
          </section>

          {/* La chronologie : le détail daté, source par source. */}
          <section className="fi-tl-wrap">
            <h2 className="fi-h2">
              Chronologie des signaux <span>({signaux.length})</span>
            </h2>
            {signaux.length === 0 ? (
              <p className="fi-vide">Aucun signal rattaché à cet établissement.</p>
            ) : (
              <ol className="fi-tl">
                {signaux.map((s) => {
                  // <summary> n'admet que du contenu de phrasé : des <span>, pas
                  // des <div>/<p>, pour que le repli reste du HTML valide.
                  const meta = (
                    <span className="mt">
                      {dateRelative(s.occurredAt)} · source {s.source.replace("fixture:", "")}
                      {s.source.startsWith("fixture:") ? " (fixture)" : ""}
                      {s.confidence < 1 ? ` · rapprochement à ${Math.round(s.confidence * 100)} %` : ""}
                      {s.lieu?.libelle ? ` · lieu : ${s.lieu.libelle}` : ""}
                    </span>
                  );
                  const entete = (
                    <>
                      <span className="hd">
                        <PuceSignal type={s.type} />
                        <span className="rs">{s.resumeFr}</span>
                      </span>
                      {meta}
                    </>
                  );
                  return (
                    <li key={s.id} data-famille={familleSignal(s.type)}>
                      <span className="pt" aria-hidden />
                      <span className="dt">{dateCourte(s.occurredAt)}</span>
                      {s.detail ? (
                        /* <details open> : le détail est visible d'emblée — au
                           téléphone, on lit, on ne clique pas. Le repli tient sans
                           JavaScript et reste atteignable au clavier. */
                        <details className="ct" open>
                          <summary>
                            {entete}
                            <span className="chv" aria-hidden>
                              <IconChevronDown size={14} />
                            </span>
                          </summary>
                          <DetailSignalPanneau detail={s.detail} />
                        </details>
                      ) : (
                        <div className="ct">{entete}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}

function montantCourt(n: number): string {
  const abs = Math.abs(n);
  const signe = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${signe}${(abs / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  return `${signe}${Math.round(abs / 1000).toLocaleString("fr-FR")} k€`;
}

function deltaPct(ca: number, precedent: number): string {
  const d = Math.round(((ca - precedent) / precedent) * 100);
  return d >= 0 ? `+${d} % sur un an` : `${d} % sur un an`;
}
