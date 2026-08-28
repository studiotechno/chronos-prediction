# Chronos Prediction — moteur de leads chauds pour l'intérim

Détecteur de déclencheurs + moteur de priorisation pour **n'importe quelle agence de
travail temporaire**, alimenté exclusivement par de l'open data et des API publiques
gratuites (SIRENE et RNE, France Travail, BOAMP, DECP, BODACC, Géorisques, ACCO).
Pas de ML dans le chemin critique : des règles explicables, des poids réglables, une
mémoire quotidienne des scores pour les apprendre, et de la latence courte — détecter
un besoin de main-d'œuvre dans les 24 à 72 h après son apparition publique, et dire
**quand** appeler.

Trois composantes, un lead chaud à leur intersection :

- **Strate** (0-100, acier) : le fit structurel — secteur lu sur la convention
  collective, taille reconstruite en cascade (INSEE → France Travail → chiffre
  d'affaires → caractère employeur), santé sur comptes déposés, site industriel,
  proximité **du besoin** (le chantier, pas le siège). Change lentement.
- **Sismo** (0-100, ambre) : les déclencheurs datés — offres réactualisées ou en manque
  de candidats, marchés attribués, accords d'heures supplémentaires, capital… — chacun
  avec son horloge : décroissance exponentielle pour l'immédiat, **noyau à retard**
  pour un marché ou un permis dont le chantier démarre plus tard. Saturation par famille
  de source et bonus de **corroboration**. Change tous les jours.
- **Tempo** (facteur autour de 1) : le *quand* — saison du secteur, difficulté de
  recrutement du département (BMO), conjoncture locale, **fenêtre d'appel**.
- **Score final** = 100 × (Strate/100)^α × (Sismo/100)^β × Tempo^γ. Multiplicatif : un
  Strate élevé sans Sismo n'est pas un lead, c'est du nurturing.

Chaque lead porte une **raison d'appeler en une phrase** et une **proposition** —
métiers à proposer, fenêtre, lieu du besoin — générées par templates déterministes.
Détail du moteur : [docs/moteur-v2.md](docs/moteur-v2.md). Note de conception et
diagnostic sur données réelles : <https://claude.ai/code/artifact/ee18c40f-168d-4f99-ab9d-b720d302765e>.

---

## Démarrage en 2 minutes, sans aucune clé

```bash
npm install
npm run demo
```

puis ouvrir <http://localhost:3000>. La démo charge ~400 établissements et ~1200 signaux
fictifs (bassin de Vichy, dans l'Allier, étiquetés « fixtures » en base comme dans l'UI),
calcule les scores et sert l'application complète.

Prérequis : Node 20+ (testé sous Node 22).

## Scripts

| Commande | Effet |
|---|---|
| `npm run demo` | migrate + seed fixtures + score + dev — fonctionne sans aucune clé |
| `npm run dev` | serveur de développement Next.js |
| `npm run db:migrate` | applique les migrations Drizzle (`drizzle/`) |
| `npm run db:seed` | poids par défaut + fixtures, et l'agence de démo s'il n'y en a pas (idempotent) |
| `npm run db:seed -- --sans-fixtures` | base vierge prête pour des données réelles : les poids seulement, aucune agence |
| `npm run score` | recalcule Strate, Sismo, Tempo, la table `lead` et le snapshot du jour |
| `npm run test` | Vitest — scoring pur, Tempo, références, raisons, rapprochement, parsing des sources |
| `npm run ingest:sirene` | référentiel du bassin, finances et conventions collectives comprises (sans clé) |
| `npm run ingest:offres` | offres France Travail — **clé requise**, puis rapprochement et dérivation |
| `npm run ingest:boamp` | avis d'attribution et appels d'offres ouverts (sans clé) |
| `npm run ingest:decp` | marchés publics attribués avec montant et SIRET (sans clé) |
| `npm run ingest:bodacc` | procédures collectives + capital, SIREN enrichis à la demande (sans clé) |
| `npm run ingest:georisques` | sites industriels classés autour de l'agence (sans clé) |
| `npm run ingest:acco` | accords d'entreprise de la semaine, filtrés sur le département (sans clé, ~400 Mo) |
| `npm run ingest:all` | toutes les sources ci-dessus, dans l'ordre |
| `npm run ingest:lbb` | potentiel d'embauche La Bonne Boîte — endpoint à confirmer (voir docs/sources.md) |
| `npm run backtest` | précision@20 et lift sur étiquette proxy, dès que 60 jours de snapshots existent |
| `npx tsx scripts/reparer-metiers.ts` | recalcule les métiers induits des marchés déjà en base après une correction de règle (simulation par défaut, `--appliquer` pour écrire) |

**Les ingestions suivent la zone de l'agence inscrite** — position, rayon, secteurs NAF
et département sont lus en base. Les options ne servent qu'à s'en écarter ponctuellement :

```bash
npm run ingest:sirene -- --lat=46.13 --lon=3.43 --rayon=30 --naf=41,42,43,49,52
npm run ingest:boamp -- --depuis=90d --departement=03
npm run ingest:offres -- --depuis=90d
```

Les réponses brutes des API sont mises en cache dans `.cache/` (TTL 24 h,
`INGEST_NO_CACHE=1` pour forcer).

## Faire tourner le moteur tous les jours

La valeur de l'outil s'accumule avec l'observation : les dérivées d'offres
(republication, vélocité) n'existent qu'en comparant les jours, et l'historique des
scores (`score_snapshot`) est la matière du backtest et des tendances.
`.github/workflows/ingestion-quotidienne.yml` lance `db:migrate`, `ingest:all` et
`score` chaque jour à 04:30 UTC ; il suffit de renseigner les secrets `DATABASE_URL`,
`FRANCETRAVAIL_CLIENT_ID` et `FRANCETRAVAIL_CLIENT_SECRET` dans le dépôt.

## Obtenir les clés

### Base de données — PostgreSQL (requise)

Le projet écrit dans PostgreSQL ; sur Supabase, prendre l'URL de connexion
**directe** (port 5432) dans *Project settings → Database → Connection string*, et la
renseigner dans `.env` :

```
DATABASE_URL=postgresql://postgres:<mdp>@db.<ref>.supabase.co:5432/postgres
```

Cet hôte ne résout qu'en **IPv6**. Depuis un réseau ou un hébergeur sans IPv6
(Vercel, par exemple), utiliser l'URL du **pooler en mode transaction** (port 6543) :
le code y désactive automatiquement les requêtes préparées. Les migrations passent par
la connexion directe.

```bash
npm run db:migrate
```

**Aucune autre clé n'est nécessaire** pour la démo, ni pour SIRENE, BOAMP, DECP, BODACC,
Géorisques et ACCO.

### France Travail — API Offres d'emploi v2 (la seule clé du projet)

1. Créer un compte sur <https://francetravail.io>.
2. Créer une application, puis souscrire à l'API « Offres d'emploi v2 » (et « La Bonne
   Boîte v2 » si vous voulez le potentiel d'embauche).
3. Récupérer l'identifiant client et la clé secrète (OAuth2 `client_credentials`).
4. Copier `.env.example` vers `.env` et renseigner `FRANCETRAVAIL_CLIENT_ID` et
   `FRANCETRAVAIL_CLIENT_SECRET`.

Les endpoints ont été **vérifiés par appels réels** : voir [docs/sources.md](docs/sources.md)
pour les contraintes exactes de chaque API et les écarts entre documentation et réalité.

### Monter une base 100 % réelle

```bash
cp .env.example .env        # puis renseigner DATABASE_URL et les deux clés France Travail
npm run db:migrate
npm run db:seed -- --sans-fixtures   # les poids seulement : aucune donnée fictive, aucune agence
npm run dev                 # puis inscrire l'agence sur /inscription (elle définit la zone)
npm run ingest:all
npm run score
```

L'inscription vient avant l'ingestion : c'est elle qui dit à `ingest:all` **où**
moissonner et au moteur quels métiers et quels secteurs viser (et lesquels exclure :
par défaut les agences d'intérim et l'administration publique). Le bandeau « Démo —
données fictives » disparaît dès qu'aucune fixture n'est en base.

## L'application

L'outil s'utilise comme un poste de travail d'agence : une barre latérale fixe porte
l'identité de l'agence et sa zone, chaque page a le même chrome, `⌘K` pour la recherche.

| Page | Usage |
|---|---|
| `/inscription` | Création de l'agence et de sa zone : commune, rayon, secteurs travaillés, métiers placés. |
| `/` | Les leads : liste ou carte, filtres (recherche, secteur, signal, score, distance au besoin, statut), leads chauds et nurturing séparés. Chaque ligne : raison d'appeler, proposition, fenêtre d'appel. |
| `/lead/[siret]` | Fiche : raison et proposition en tête, les trois couches du score et leur décomposition, la tendance du score, la chronologie datée des signaux avec leur source et leur lieu. |
| `/zone` | Modification de la zone de prospection ; enregistrer relance le scoring. |
| `/couverture` | Couverture concurrentielle : missions d'intérim des agences, agrégées commune × ROME avec décroissance 60 j. |
| `/reglages` | Tous les poids du moteur en curseurs — Strate, Sismo (poids, demi-vies, noyaux à retard, corroboration), Tempo, score final — **recalcul du top 20 en direct**. |
| `/resolution` | File de rapprochement manuel (similarité 0,62-0,88), offres et titulaires de marchés confondus. |
| `/ingestion` | État de chaque source, dernières exécutions, volumes, erreurs. |

Changer le statut d'un lead (contacté, qualifié, gagné, perdu) écrit un retour dans
`crm_outcome` avec le score et les signaux du moment : c'est le futur jeu de données
supervisé du moteur.

## Architecture

```
src/lib/
  db/            schéma Drizzle (PostgreSQL) — référentiel enrichi (finances, IDCC, employeur,
                 enseignes, ICPE, LBB), signaux avec lieu et métiers induits, score_tempo,
                 score_snapshot (mémoire quotidienne), crm_outcome
  scoring/       moteur pur TS, testé sans réseau ni base — strate, sismo (noyaux, corroboration),
                 tempo, final, raisons et propositions en français ; run.ts = pont base
  reference/     tables embarquées : taux d'intérim par IDCC et par NAF, saisonnalité, BMO 2026,
                 métiers induits (descripteur BOAMP / CPV / permis → ROME), tranches INSEE, libellés
  ingest/        interface SourceAdapter, exécuteur idempotent (rafraîchit les offres revues,
                 dérive EFFECTIF_UP et CA_*), rapprocheur partagé (enseignes + SIRENE),
                 adapters : sirene, francetravail, boamp, decp, bodacc, georisques, acco, labonneboite
  matching/      normalisation, Jaro-Winkler + trigrammes, blocage CP, seuils 0.62/0.88
  fixtures/      générateur déterministe du bassin de démo — Vichy, Allier
  couverture/    agrégats de la carte de couverture ; leads/ filtres ; geo/ recherche de commune
scripts/         migrate, seed, score, backtest, ingest/* (CLI)
data/reference/  idcc-interim.csv, dares-interim-naf.csv, saisonnalite-section.csv,
                 bmo-2026-dept-famille.csv, naf-codes.json
docs/            sources.md (état de vérification — fait foi), moteur-v2.md (le moteur)
.github/         ingestion-quotidienne.yml (cron)
```

Principes tenus :

- **Toutes** les constantes de scoring vivent dans la table `weights` (éditable via
  `/reglages`), aucune valeur magique dans le code — noyaux, saturations et amplitudes
  de Tempo compris.
- Ré-ingestions idempotentes : unicité `signal(source, raw_ref)`.
- Un signal n'est jamais une donnée brute recopiée : c'est une dérivée calculée, datée,
  sourcée, avec son lieu et ses métiers.
- Les fixtures sont étiquetées comme fixtures, en base comme dans l'UI.
- Pas de données personnelles : uniquement des personnes morales (contacts France
  Travail, dirigeants SIRENE, signataires ACCO ne sont jamais lus). Pas de scraping.
- Un jour = un snapshot : le moteur se souvient de ce qu'il a dit.

## Limites connues

- **Cold start des dérivées d'offres** : `OFFRE_REPUBLIEE` et `OFFRE_VELOCITE` exigent
  l'observation quotidienne. `OFFRE_REACTUALISEE` (date d'actualisation publiée par
  France Travail) le contourne en partie. **Lancer le cron dès maintenant.**
- **Le rapprochement d'entité reste le facteur limitant** : ni France Travail ni le BOAMP
  ne publient de SIRET. Les enseignes indexées et la tranche d'effectif propagée depuis
  les offres améliorent le rappel ; les mesures à jour sont sur `/ingestion`.
- **La Bonne Boîte v2** : le jeton est délivré mais l'endpoint répond 403 sur tous les
  chemins essayés ; l'adapter attend le chemin exact (`LBB_ENDPOINT`).
- **Sitadel** (permis de construire) : le moteur sait scorer `PERMIS_LOCAUX`, l'adapter
  attend les fichiers complets du SDES.
- **Tables sectorielles approximées** (IDCC, NAF, saisonnalité) — ancrées sur les taux
  réels DARES par grand secteur, ventilations à remplacer ; voir docs/sources.md.
- **Poids réglés, pas encore appris** : `crm_outcome` et `score_snapshot` se remplissent
  d'abord ; la réestimation viendra avec les premières conversions.
- **Mono-agence** : les scores sont calculés pour la première agence de la table `agence`.
