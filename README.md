# Chronos Prediction — moteur de leads chauds pour l'intérim

Détecteur de déclencheurs + moteur de priorisation pour une agence de travail temporaire,
alimenté exclusivement par de l'open data et des API publiques gratuites (SIRENE,
France Travail, DECP, BODACC). Pas de ML : des règles explicables, des poids réglables,
et de la latence courte — détecter un besoin de main-d'œuvre dans les 24 à 72 h après
son apparition publique.

Deux scores séparés, un lead chaud à leur intersection :

- **Strate** (0-100, acier) : le fit structurel — secteur (table DARES), taille, distance,
  ancienneté, santé. Change lentement.
- **Sismo** (0-100, ambre) : les déclencheurs datés — offres republiées, marchés gagnés,
  CDD répétés… — avec décroissance exponentielle par demi-vie. Change tous les jours.
- **Score final** = 100 × (Strate/100)^α × (Sismo/100)^β. Multiplicatif : un Strate élevé
  sans Sismo n'est pas un lead, c'est du nurturing.

Chaque lead porte une **raison d'appeler en une phrase**, générée par templates
déterministes depuis ses signaux dominants. Aucun LLM dans le chemin critique.

---

## Démarrage en 2 minutes, sans aucune clé

```bash
npm install
npm run demo
```

puis ouvrir <http://localhost:3000>. La démo charge ~400 établissements et ~1100 signaux
fictifs (bassin de Marseille, étiquetés « fixtures » en base comme dans l'UI), calcule
les scores et sert l'application complète.

Prérequis : Node 20+ (testé sous Node 22).

## Scripts

| Commande | Effet |
|---|---|
| `npm run demo` | migrate + seed fixtures + score + dev — fonctionne sans aucune clé |
| `npm run dev` | serveur de développement Next.js |
| `npm run db:migrate` | applique les migrations Drizzle (`drizzle/`) |
| `npm run db:seed` | poids par défaut + agence + fixtures (idempotent, dates relatives au jour du seed) |
| `npm run score` | recalcule Strate, Sismo et la table `lead` |
| `npm run test` | Vitest — 84 tests (scoring pur, raisons, rapprochement) |
| `npm run ingest:sirene -- --lat=43.30 --lon=5.37 --rayon=30 --naf=41,42,43,49,52` | référentiel du bassin (sans clé, 7 req/s respectées) |
| `npm run ingest:decp -- --depuis=90d --departement=13` | marchés publics attribués (sans clé) |
| `npm run ingest:bodacc -- --depuis=90d --departement=13` | procédures collectives + capital (sans clé) |
| `npm run ingest:offres -- --depuis=14d` | offres France Travail — **clé requise, endpoint non vérifié** (voir ci-dessous) |
| `npm run ingest:all` | les quatre, dans l'ordre |

Les réponses brutes des API sont mises en cache dans `.cache/` (TTL 24 h,
`INGEST_NO_CACHE=1` pour forcer).

## Obtenir les clés

**Aucune clé n'est nécessaire** pour la démo, ni pour SIRENE, DECP et BODACC.

### France Travail — API Offres d'emploi v2 (la seule clé du projet)

1. Créer un compte sur <https://francetravail.io>.
2. Créer une application, puis souscrire à l'API « Offres d'emploi v2 ».
3. Récupérer l'identifiant client et la clé secrète (OAuth2 `client_credentials`).
4. Copier `.env.example` vers `.env` et renseigner `FRANCETRAVAIL_CLIENT_ID` et
   `FRANCETRAVAIL_CLIENT_SECRET`.
5. **Important** : conformément à la règle du projet (« ne devine jamais un endpoint »),
   `fetch()` de l'adapter échoue tant que l'endpoint n'a pas été vérifié par un appel
   réel. La marche à suivre précise est dans [docs/sources.md](docs/sources.md).

L'état de vérification de chaque source (endpoints, filtres et champs vérifiés par
appels réels, blocages, replis) est tenu à jour dans **[docs/sources.md](docs/sources.md)**
et visible dans l'application sur la page **/ingestion**.

## Les pages

| Page | Usage |
|---|---|
| `/` | Fil « Leads de la semaine » : tri par score final, raison d'appeler, badges de signaux, filtres NAF / signal / distance / score. Leads chauds et nurturing nettement séparés. |
| `/lead/[siret]` | Fiche entreprise : timeline des signaux, décomposition chiffrée du score (Strate à gauche, Sismo à droite), statut commercial. |
| `/reglages` | Tous les poids du moteur en sliders, **recalcul du top 20 en direct**, puis « Enregistrer et recalculer ». |
| `/couverture` | Carte de couverture concurrentielle : missions d'intérim des agences concurrentes, agrégées commune × ROME avec décroissance 60 j. |
| `/resolution` | File de rapprochement manuel (similarité 0,62-0,88) : valider un candidat rattache le signal et relance le scoring. |
| `/ingestion` | État de chaque source, dernières exécutions, volumes, erreurs. |

## Architecture

```
src/lib/
  db/            schéma Drizzle (SQLite, portable Postgres : ISO 8601, JSON text, zéro SQL non portable)
  scoring/       moteur pur TS, testé sans réseau ni base — strate, sismo, final, raisons françaises
  fixtures/      générateur déterministe du bassin de démo (RNG seedé, dates relatives)
  ingest/        interface SourceAdapter, exécuteur idempotent, adapters (sirene, decp, bodacc, francetravail),
                 dérivation des signaux offres (republication, vélocité, CDD courts, missions concurrentes)
  matching/      rapprochement d'entité : normalisation, Jaro-Winkler + trigrammes, blocage CP, seuils 0.62/0.88
  reference/     DARES (CSV embarqué), tranches d'effectif INSEE, libellés NAF/ROME
scripts/         migrate, seed, score, ingest/* (CLI)
data/reference/  dares-interim-naf.csv (voir l'avertissement d'approximation en tête de fichier), naf-codes.json
docs/sources.md  état de vérification de chaque endpoint — fait foi
```

Principes tenus :

- **Toutes** les constantes de scoring vivent dans la table `weights` (éditable via
  `/reglages`), aucune valeur magique dans le code.
- Ré-ingestions idempotentes : unicité `signal(source, raw_ref)`.
- Un signal n'est jamais une donnée brute recopiée : c'est une dérivée calculée.
- Les fixtures sont étiquetées comme fixtures, en base (`source = 'fixture:*'`,
  SIREN `900*`) comme dans l'UI (bandeau « Démo — données fictives »).
- Pas de données personnelles : uniquement des personnes morales. Pas de scraping.
- `crm_outcome` existe et reste vide : c'est le futur dataset supervisé de la V2.

## Limites connues de la V0

- **France Travail non branché** (clé + vérification d'endpoint requises) — la source la
  plus importante du système. Fixtures en attendant.
- **Cold start des dérivées d'offres** : une offre clôturée disparaît de l'API, donc
  OFFRE_REPUBLIEE et la baseline d'OFFRE_VELOCITE ne deviennent fiables qu'après
  quelques semaines d'ingestion régulière.
- **Table DARES approximée par division** (ancrée sur les taux réels par grand secteur
  T1 2025) — remplacement manuel documenté dans docs/sources.md.
- **Mono-agence** : les scores sont calculés pour la première agence de la table
  `agence`. Le multi-agences demanderait une clé composite (agence, siret).
