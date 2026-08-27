# État des sources de données

Règle absolue du projet : **aucun endpoint n'est utilisé sans avoir été vérifié par un
appel réel.** Ce document fait foi. Trois états possibles : `vérifiée`, `à vérifier`,
`bloquée`.

Dernière mise à jour : 27 août 2026.

---

## SIRENE — API Recherche d'entreprises · **vérifiée** ✅

- **Endpoint vérifié** (appel réel le 27/08/2026) :
  `GET https://recherche-entreprises.api.gouv.fr/near_point`
- **Paramètres vérifiés** : `lat`, `long`, `radius` (km), `activite_principale`
  (codes NAF complets, séparés par des virgules — une division seule comme `43` est
  **rejetée**), `page`, `per_page`.
- **Réponse vérifiée** : `results[]` avec `siren`, `nom_raison_sociale`,
  `categorie_entreprise`, `date_creation`, `etat_administratif`, `tranche_effectif_salarie`
  et surtout `matching_etablissements[]` (siret, activite_principale, code_postal,
  libelle_commune, latitude/longitude en chaînes, est_siege, tranche_effectif_salarie).
- **Second endpoint vérifié** (appel réel le 27/08/2026), recherche par SIRET :
  `GET https://recherche-entreprises.api.gouv.fr/search?q=<siret>&per_page=1`
  Il sert à l'enrichissement à la demande (`src/lib/ingest/enrich.ts`) : un titulaire
  de marché public absent du référentiel est récupéré individuellement.
- **Clé** : aucune. **Limite annoncée : 7 req/s — insuffisante en pratique.**
  Constaté en conditions réelles le 27/08/2026 : l'API renvoie des **HTTP 429** sur des
  rafales soutenues même sous 7 req/s. Le client part donc à 5 req/s, reprend
  automatiquement sur 429/5xx (attente exponentielle, en-tête `Retry-After` respecté)
  et **réduit durablement son débit** à chaque 429 (`src/lib/ingest/http.ts`).
  Un ingestion complète du bassin de Vichy (30 km, 121 codes NAF) passe ainsi
  sans erreur : 7 072 entreprises lues, 9 273 établissements écrits.
- La liste complète des 732 codes NAF valides acceptés par le paramètre
  `activite_principale` est versionnée dans `data/reference/naf-codes.json`
  (extraite de la réponse d'erreur de l'API elle-même) : elle sert à développer
  `--naf=41,42` en codes complets.
- Adapter : `src/lib/ingest/adapters/sirene.ts`.

## France Travail — API Offres d'emploi v2 · **à vérifier** ⚠️

- **Accès** : compte gratuit sur [francetravail.io](https://francetravail.io),
  application + souscription à l'API « Offres d'emploi v2 », OAuth2 `client_credentials`.
- **Rien n'a pu être vérifié sans clé.** Conformément à la règle du projet,
  `fetch()` échoue avec un message explicite
  (`[francetravail] endpoint non vérifié, voir docs/sources.md`).
- `normalize()` et `fixture()` sont complets (schéma Zod bâti d'après la documentation
  publique, **à confirmer sur données réelles au premier appel authentifié**).
- **Marche à suivre une fois la clé obtenue** :
  1. Renseigner `FRANCETRAVAIL_CLIENT_ID` / `FRANCETRAVAIL_CLIENT_SECRET` dans `.env`.
  2. Vérifier par un appel réel l'URL du jeton
     (`https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`
     d'après la documentation — à confirmer) puis l'endpoint de recherche d'offres
     (`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search` — à confirmer),
     et comparer la réponse au schéma `ftOffreSchema`.
  3. Implémenter la boucle paginée dans `fetch()` de
     `src/lib/ingest/adapters/francetravail.ts`, mettre à jour ce document et
     `src/lib/ingest/registry.ts` (`etatEndpoint: "verifie"`).
- **Limite structurelle documentée (cold start)** : une offre clôturée disparaît de
  l'API. `OFFRE_REPUBLIEE` et la baseline 90 jours d'`OFFRE_VELOCITE` ne deviennent
  fiables qu'après plusieurs semaines d'ingestion régulière (quotidienne idéalement).
  Les fixtures embarquent l'historique, la démo n'est pas affectée.

## DECP — marchés publics attribués · **vérifiée** ✅

- **Endpoint vérifié** (appel réel le 27/08/2026) :
  `GET https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp-2022-marches-valides/records`
- **Filtres vérifiés** : `where=lieuexecution_code="13" AND lieuexecution_typecode="Code département"
  AND datenotification>=date'YYYY-MM-DD'`, `order_by=datenotification DESC`, `limit`, `offset`.
- **Champs vérifiés** : `objet`, `codecpv`, `montant`, `dureemois`, `datenotification`,
  `acheteur_id`, `titulaire_id_1..3` + `titulaire_typeidentifiant_1..3` (= `"SIRET"` quand
  le SIRET est présent — c'est le cas général, donc pas de rapprochement flou).
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/decp.ts`.
- Note : le jeu correspond à l'arrêté du 22/12/2022. Le nom d'acheteur n'est pas
  fourni, seulement son SIRET (`acheteur_id`).
- **Écueil majeur constaté sur données réelles (27/08/2026)** : le filtre porte sur le
  **lieu d'exécution**, pas sur le siège du titulaire. Sur 90 jours dans l'Allier,
  **71 marchés sur 72** étaient attribués à des entreprises absentes d'un référentiel
  SIRENE bâti autour de l'agence — le signal ne scorait donc quasiment personne.
  Correctif appliqué : `scripts/ingest/decp.ts` enrichit le référentiel à la demande
  via la recherche SIRENE par SIRET. Après correctif : **72/72 rattachés**.
- **Question de conception ouverte** : ces titulaires sont souvent domiciliés hors du
  bassin (Clermont-Ferrand, Lyon, région parisienne) alors que le chantier, lui, est
  dans le département. La composante « distance » du Strate les pénalise sur la
  position de leur siège, alors que le besoin de main-d'œuvre est local. À trancher :
  mesurer la distance sur le lieu d'exécution du marché plutôt que sur le siège.

## BODACC — annonces civiles et commerciales · **vérifiée** ✅

- **Endpoint vérifié** (appel réel le 27/08/2026) :
  `GET https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records`
- **Filtres vérifiés** : `familleavis="collective"` (procédures collectives),
  `familleavis="modification"`, `numerodepartement="13"`, `dateparution>=date'...'`,
  `registre like "<siren>"`, `order_by=dateparution DESC`.
- **Champs vérifiés** : `id`, `dateparution`, `tribunal`, `commercant`, `registre`
  (tableau contenant le SIREN), `jugement` (JSON en chaîne, clé `nature`),
  `modificationsgenerales` (JSON en chaîne, clé `descriptif`).
- **Heuristique documentée** : une annonce `modification` ne devient un signal
  `BODACC_CAPITAL` que si son descriptif mentionne « capital » (fusion si « fusion »).
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/bodacc.ts`.
- Les signaux BODACC ne portent qu'un SIREN : ils sont rattachés au **siège** de
  l'entreprise si elle est dans le référentiel du bassin (voir `src/lib/ingest/run.ts`).

## DARES — taux de recours à l'intérim · **bloquée** (repli embarqué) 🟧

- **Objectif** : taux de recours à l'intérim par NAF × région, en CSV versionné
  (`data/reference/dares-interim-naf.csv`).
- **Blocage constaté le 27/08/2026** : le site dares.travail-emploi.gouv.fr est derrière
  une vérification anti-robot (CAPTCHA Cegedim.cloud) qui empêche le téléchargement
  automatisé des données détaillées.
- **Repli appliqué (validé)** : le CSV embarqué est **ancré sur les taux réels par grand
  secteur publiés par la DARES (T1 2025)** — construction 8,3 %, industrie 6,9 %,
  tertiaire marchand 2,7 %, tertiaire non marchand 0,5 % — et la ventilation par
  division NAF est une **approximation cohérente clairement étiquetée** dans l'en-tête
  du fichier (`niveau_source = approx_division`).
- **À faire** : récupérer manuellement la ventilation détaillée (NAF 88 × région) sur le
  site DARES (série « L'intérim », données trimestrielles DSN) et remplacer le CSV en
  conservant le format `naf_division;libelle;taux_pct;niveau_source`.

---

## Idempotence et cache

- Toute ré-ingestion est idempotente : contrainte d'unicité `signal(source, raw_ref)`
  + `onConflictDoNothing`, upsert sur `entreprise`/`etablissement`/`offre_brute`.
- Les réponses brutes des API sont mises en cache disque dans `.cache/<source>/`
  (TTL 24 h) pour ne pas retaper les API pendant le développement.
  `INGEST_NO_CACHE=1` pour forcer les appels réels.
