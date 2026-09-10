import { signalTypeLabel } from "@/lib/scoring/labels";
import { POIDS_DEFAUT_PAR_TYPE } from "@/lib/scoring/weights-defaults";
import { IconLienExterne } from "@/components/shell/icons";
import type { DetailSignal } from "@/lib/signal-detail";

/* ── Puces de signaux ────────────────────────────────────────────────
   Trois familles, trois couleurs, jamais plus : AMBRE ce qui bouge
   (offres, CDD courts, manque de candidats), ACIER ce qui installe
   (marché gagné, effectif, capital, permis, accord de surcharge), ROUGE
   ce qui alerte (procédure collective, CA en baisse, restructuration).
   Le reste est neutre — une mission d'un concurrent ou un appel d'offres
   ouvert n'est pas un signal de l'entreprise, c'est du contexte de bassin. */

type Famille = "sismo" | "strate" | "risque" | "neutre";

const FAMILLE_PAR_TYPE: Record<string, Famille> = {
  OFFRE_DIRECTE: "sismo",
  OFFRE_VELOCITE: "sismo",
  OFFRE_REPUBLIEE: "sismo",
  OFFRE_REACTUALISEE: "sismo",
  OFFRE_MANQUE_CANDIDATS: "sismo",
  OFFRE_MULTIPOSTES: "sismo",
  CDD_COURT_REPETE: "sismo",
  MARCHE_ATTRIBUE: "strate",
  EFFECTIF_UP: "strate",
  CA_CROISSANCE: "strate",
  BODACC_CAPITAL: "strate",
  ACCORD_SURCHARGE: "strate",
  PERMIS_LOCAUX: "strate",
  BODACC_RISQUE: "risque",
  CA_BAISSE: "risque",
  ACCORD_RESTRUCTURATION: "risque",
  MISSION_CONCURRENT: "neutre",
  AO_OUVERT: "neutre",
};

export function familleSignal(type: string): Famille {
  return FAMILLE_PAR_TYPE[type] ?? "neutre";
}

/**
 * Deux intensités dans chaque famille, pas une quatrième couleur : le fond plein
 * est réservé aux signaux que le moteur paie 20 points ou plus (offre en manque de
 * candidats, offre republiée, marché attribué, procédure collective, accord de
 * restructuration). Dans une chronologie où toutes les offres sont ambre, c'est ce
 * qui distingue « ils recrutent » de « ils n'y arrivent pas ».
 */
export function intensiteSignal(type: string): "fort" | "normal" {
  return Math.abs(POIDS_DEFAUT_PAR_TYPE[type] ?? 0) >= 20 ? "fort" : "normal";
}

export function PuceSignal({
  type,
  count,
  titre,
}: {
  type: string;
  count?: number;
  titre?: string;
}) {
  return (
    <span
      className="pp-sig"
      data-famille={familleSignal(type)}
      data-intensite={intensiteSignal(type)}
      title={titre ?? signalTypeLabel(type)}
    >
      <span className="lb">{signalTypeLabel(type)}</span>
      {count != null && count > 1 && <b>×{count}</b>}
    </span>
  );
}

/** Puces agrégées par type à partir des signaux dominants d'un lead. */
export function PucesSignaux({ topSignals, max = 2 }: { topSignals: { type: string }[]; max?: number }) {
  const parType = new Map<string, number>();
  for (const s of topSignals) parType.set(s.type, (parType.get(s.type) ?? 0) + 1);
  const entrees = [...parType.entries()].slice(0, max);
  const reste = parType.size - entrees.length;

  if (entrees.length === 0) return <span className="text-muted-foreground">–</span>;

  return (
    <span className="pp-sigs">
      {entrees.map(([type, count]) => (
        <PuceSignal key={type} type={type} count={count} />
      ))}
      {reste > 0 && <span className="pp-sig-plus">+{reste}</span>}
    </span>
  );
}

/* ── Détail d'un signal ──────────────────────────────────────────────
   Ce qui s'ouvre sous une ligne de chronologie : d'abord les faits qui
   se lisent d'un œil (contrat, salaire, expérience), puis l'annonce telle
   que l'employeur l'a écrite, puis ce qu'elle exige, puis les liens vers
   la source. Rien n'est reformulé : tout vient de la source, ou du
   compteur de dérivation qui a créé le signal. */
export function DetailSignalPanneau({ detail }: { detail: DetailSignal }) {
  return (
    <div className="sg-dv">
      {detail.faits.length > 0 && (
        <dl className="sg-faits">
          {detail.faits.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.valeur}</dd>
            </div>
          ))}
        </dl>
      )}

      {detail.textes.map((t) => (
        <section className="sg-txt" key={t.titre}>
          <h4>{t.titre}</h4>
          <div className="cps">
            {t.corps
              .split(/\n+/)
              .map((par) => par.trim())
              .filter(Boolean)
              .map((par, i) => (
                <p key={i}>{par}</p>
              ))}
          </div>
        </section>
      ))}

      {detail.listes.length > 0 && (
        <div className="sg-listes">
          {detail.listes.map((b) => (
            <section key={b.titre}>
              <h4>{b.titre}</h4>
              <ul>
                {b.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {detail.liens.length > 0 && (
        <div className="sg-liens">
          {detail.liens.map((l) => (
            <a
              key={l.href}
              className="lien"
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              title={`${l.label} (nouvel onglet)`}
            >
              <IconLienExterne size={12} />
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
