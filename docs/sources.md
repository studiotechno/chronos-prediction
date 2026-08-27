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

## France Travail — API Offres d'emploi v2 · **vérifiée** ✅

- **Accès** : compte gratuit sur [francetravail.io](https://francetravail.io), application
  + souscription à l'API « Offres d'emploi v2 ». Quota accordé : **10 appels/seconde**.
- **Endpoint jeton vérifié** (appel réel le 27/08/2026) :
  `POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`
  corps `application/x-www-form-urlencoded` : `grant_type=client_credentials`,
  `client_id`, `client_secret`, `scope=api_offresdemploiv2 o2dsoffre`
  → `{ access_token, expires_in }`, jeton valable ≈ 1 500 s (mis en cache mémoire).
- **Endpoint recherche vérifié** (appel réel le 27/08/2026) :
  `GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search`
  `?departement=&minCreationDate=&maxCreationDate=&range=a-b`
- **Contraintes vérifiées, toutes découvertes par appels réels** :
  - `range` est plafonné à **150 éléments** : `0-199` renvoie `400` ;
  - `minCreationDate` **seul** renvoie `400` — les deux bornes sont obligatoires ;
  - format de date accepté : `YYYY-MM-DDTHH:MM:SSZ` ;
  - réponse paginée en **`206 Partial Content`** avec `Content-Range: offres a-b/total` ;
  - au-delà des résultats disponibles, l'API renvoie **`204` sans corps** (géré par
    `fetchJsonCache`, qui rendrait sinon une erreur de parsing JSON).
- **Trois écarts majeurs entre la documentation et la réalité**, tous corrigés :
  1. **Le SIRET de l'employeur n'est JAMAIS publié** (0 offre sur 150 observées).
     Le rapprochement d'entité n'est donc pas un cas limite mais **le chemin normal**
     de la source principale du système.
  2. **`dureeTravailLibelle` n'est pas la durée du contrat** mais le temps de travail
     hebdomadaire (« 35H/semaine »). La durée réelle est dans **`typeContratLibelle`**
     (« CDD - 12 Mois », « Intérim - 14 Jour(s) »). Lire le mauvais champ rendait le
     signal `CDD_COURT_REPETE` **structurellement impossible à déclencher**.
  3. **`codeNAF` est toujours renseigné** : c'est un critère bien plus fiable que les
     enseignes pour distinguer une offre d'entreprise d'une mission d'agence
     (division 78 = activités liées à l'emploi). Il sert aussi de filtre ICP avant
     tout appel réseau de résolution.
- **DONNÉES PERSONNELLES** : la réponse contient un objet `contact` avec noms,
  téléphones et courriels de personnes physiques (**120 offres sur 150 observées**).
  Le projet ne collecte que des personnes morales : ce champ est **absent du schéma
  Zod**, jamais lu, jamais stocké. `normalize()` construit l'enregistrement en liste
  blanche et un test unitaire vérifie qu'aucune donnée de contact ne peut fuiter.
- Adapter : `src/lib/ingest/adapters/francetravail.ts`.
- **Limite structurelle (cold start), confirmée en production** : l'API ne renvoie que
  les offres **actives**. Une offre clôturée disparaît. Sur un premier import, même en
  remontant 90 jours, `OFFRE_REPUBLIEE` et `OFFRE_VELOCITE` valent **zéro** faute
  d'historique d'observation. Ces deux signaux — les plus prédictifs du modèle —
  ne se déclenchent qu'après plusieurs semaines d'ingestion quotidienne.
  **Conséquence opérationnelle : il faut lancer l'ingestion quotidienne dès maintenant,
  même si personne n'utilise encore l'outil.** Sa valeur s'accumule avec l'observation.

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

## Rapprochement d'entité — mesures sur données réelles

Le brief annonçait le rapprochement comme « le principal poste d'effort d'ingénierie,
largement devant le scoring ». Les mesures sur l'Allier le confirment.

Puisque France Travail ne publie aucun SIRET, **100 % des offres** doivent être
rapprochées. Deux passes successives :

1. **Référentiel local** (gratuit, instantané) — bâti par `ingest:sirene` autour de
   l'agence et filtré par NAF.
2. **Interrogation de SIRENE** quand la passe 1 n'aboutit pas :
   `GET https://recherche-entreprises.api.gouv.fr/search?q=<nom>&departement=<dd>&per_page=5`
   (endpoint vérifié le 27/08/2026). Les candidats renvoyés repassent par le même
   scoring Jaro-Winkler + trigrammes : SIRENE apporte le rappel, notre module garde
   la décision et la précision.

Le filtre `code_postal` a été **essayé puis écarté** : trop strict, il renvoie zéro
résultat sur des entreprises pourtant existantes, parce que le code postal de l'offre
est celui du lieu de travail et non celui du siège.

Garde-fou de volumétrie : seules les offres dont le `codeNAF` appartient aux divisions
cibles de l'agence déclenchent un appel réseau.

| Mesure (Allier, 2 211 offres sur 90 jours) | Passe locale seule | + résolution SIRENE |
|---|---|---|
| Rattachements automatiques | 27 | **74** (dont 31 via SIRENE) |
| File de résolution manuelle | 152 | 13 |
| Rejets | 821 | 37 |
| Écartées avant appel réseau (hors ICP) | — | 882 |

Les 882 offres écartées sont légitimement hors cible : grande distribution, assurance,
hébergement médico-social. Un échantillon manuel de rejets l'a confirmé — sur 275
rejets analysés, 262 concernaient des divisions NAF hors ICP.
