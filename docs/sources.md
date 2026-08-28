# État des sources de données

Règle absolue du projet : **aucun endpoint n'est utilisé sans avoir été vérifié par un
appel réel.** Ce document fait foi. États possibles : `vérifiée`, `à vérifier`,
`à autoriser`, `bloquée`, `embarquée`.

Dernière mise à jour : 28 août 2026 (moteur V2).

---

## SIRENE — API Recherche d'entreprises · **vérifiée** ✅

- **Endpoint vérifié** (appels réels les 27 et 28/08/2026) :
  `GET https://recherche-entreprises.api.gouv.fr/near_point`
- **Paramètres vérifiés** : `lat`, `long`, `radius` (km), `activite_principale`
  (codes NAF complets, séparés par des virgules — une division seule comme `43` est
  **rejetée**), `page`, `per_page`, et depuis la V2 :
  **`minimal=true&include=finances,complements,siege,matching_etablissements`**.
  Piège vérifié : `include` sans `minimal=true` est refusé (« Veuillez indiquer si vous
  souhaitez une réponse minimale avec le filtre minimal=True »).
- **Réponse vérifiée** : `results[]` avec `siren`, `nom_raison_sociale`,
  `categorie_entreprise`, `date_creation`, `etat_administratif`, `tranche_effectif_salarie`,
  `caractere_employeur` (O/N), `nombre_etablissements_ouverts`,
  **`finances`** (`{ "2024": { ca, resultat_net }, "2023": … }` — `ca: 0` vaut inconnu),
  **`complements`** (`liste_idcc`, `convention_collective_renseignee`, `egapro_renseignee`,
  `est_rge`, `est_siae`, `est_qualiopi`…), `dirigeants` (**jamais stocké** : personnes
  physiques), et `matching_etablissements[]` (siret, activite_principale, code_postal,
  `commune` = code INSEE, libelle_commune, latitude/longitude en chaînes, est_siege,
  tranche_effectif_salarie, `caractere_employeur`, `liste_idcc`, `liste_enseignes`,
  `nom_commercial`, `date_debut_activite`).
- **Constat sur l'Allier** : la tranche d'effectif est `NN` (non renseignée) pour 82 %
  des établissements du référentiel (3 021 sur 3 675) ; sur un échantillon BTP autour de
  Moulins, 37 `NN` sur 51 — mais `caractere_employeur` est renseigné (32 O / 19 N) et
  les finances existent pour la plupart des sociétés. D'où la **cascade de taille** du
  Strate V2 (tranche INSEE → tranche France Travail → CA → caractère employeur).
- **Second endpoint vérifié**, recherche par SIRET ou SIREN :
  `GET https://recherche-entreprises.api.gouv.fr/search?q=<siret|siren>&per_page=1&minimal=true&include=…`
  Sert à l'enrichissement à la demande (`src/lib/ingest/enrich.ts`) : titulaires DECP,
  SIREN des annonces BODACC, candidats du rapprochement.
- **Filtres de `/search` vérifiés** : `departement`, `section_activite_principale`,
  `tranche_effectif_salarie`, `ca_min`/`ca_max`, `code_commune`,
  `id_convention_collective`, `est_rge`… (`departement=03&section_activite_principale=F&tranche_effectif_salarie=12&ca_min=2000000` → 27 résultats).
- **Clé** : aucune. **Limite annoncée : 7 req/s — insuffisante en pratique.**
  Constaté en conditions réelles : l'API renvoie des **HTTP 429** sur des rafales
  soutenues même sous 7 req/s. Le client part à 5 req/s, reprend automatiquement sur
  429/5xx (attente exponentielle, en-tête `Retry-After` respecté) et **réduit
  durablement son débit** à chaque 429 (`src/lib/ingest/http.ts`).
- La liste complète des 732 codes NAF valides acceptés par `activite_principale` est
  versionnée dans `data/reference/naf-codes.json`.
- Adapter : `src/lib/ingest/adapters/sirene.ts`. Dérivées calculées à l'import :
  `EFFECTIF_UP` (tranche supérieure entre deux imports), `CA_CROISSANCE` / `CA_BAISSE`
  (deux exercices connus, variation ≥ 15 %, datés du 1er juillet de l'année suivant
  l'exercice).

## France Travail — API Offres d'emploi v2 · **vérifiée** ✅

- **Accès** : compte gratuit sur [francetravail.io](https://francetravail.io), application
  + souscription à l'API « Offres d'emploi v2 ». Quota accordé : **10 appels/seconde**.
- **Endpoint jeton vérifié** :
  `POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`
  corps `application/x-www-form-urlencoded` : `grant_type=client_credentials`,
  `client_id`, `client_secret`, `scope=api_offresdemploiv2 o2dsoffre`
  → `{ access_token, expires_in }`, jeton valable ≈ 1 500 s (mis en cache mémoire).
- **Endpoint recherche vérifié** :
  `GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search`
  `?departement=&minCreationDate=&maxCreationDate=&range=a-b`
- **Contraintes vérifiées** : `range` plafonné à **150** ; `minCreationDate` seul → 400 ;
  dates au format `YYYY-MM-DDTHH:MM:SSZ` ; réponse `206 Partial Content` ; `204` sans
  corps au-delà des résultats.
- **Écarts documentation / réalité** (tous corrigés) : le SIRET de l'employeur n'est
  **jamais** publié ; `dureeTravailLibelle` est le temps de travail hebdomadaire, la
  durée du contrat est dans `typeContratLibelle` ; `codeNAF` est renseigné (50/50 le
  28/08) — les 598 offres sans NAF en base venaient d'un import antérieur à l'ajout du
  champ, **le payload est désormais rafraîchi à chaque ré-ingestion**.
- **Champs exploités depuis la V2** (vérifiés sur 50 puis 150 offres réelles de l'Allier) :
  `nombrePostes` (150/150), `offresManqueCandidats` (booléen, 150/150),
  `dateActualisation` (réactualisation par l'employeur → `OFFRE_REACTUALISEE`, qui mesure
  le temps sur le marché **sans attendre la clôture**), `trancheEffectifEtab` (147/150,
  en **libellé** « 20 à 49 salariés », converti en code INSEE — propagée aux
  établissements sans tranche), `lieuTravail.commune` (code INSEE), `experienceExige`,
  `qualificationCode`, `secteurActivite`, `natureContrat`, `alternance`. Offres
  partenaires (`origineOffre = 2`) : 0 sur 50 observées.
- **Contenu de l'annonce** (ajouté pour la fiche lead, taux mesurés sur **15 011 offres
  réelles** de l'Allier, cache d'ingestion, 0 rejet de schéma) : `description` (100 %),
  `origineOffre.urlOrigine` (100 %, l'URL publique servie par la source plutôt que
  reconstruite), `appellationlibelle` (100 %), `experienceLibelle` (100 %),
  `dureeTravailLibelle` et `contexteTravail.horaires` (65 %), `salaire.libelle` (46 %),
  `competences` (41 %), `formations` (17 %), `permis` (12 %), `salaire.listeComplements`
  (14 %), `qualitesProfessionnelles` (20 %), `langues` (4 %). Stockés dans
  `offre_brute.payload`, servis à la chronologie dépliable de la fiche lead.
  Offres partenaires (`origineOffre = 2`) : 51 % sur ce volume.
- **DONNÉES PERSONNELLES** : l'objet `contact` (noms, téléphones, courriels) est absent
  du schéma Zod, jamais lu, jamais stocké ; `normalize()` construit l'enregistrement en
  liste blanche et un test le vérifie. Les deux textes libres (`description`,
  `entreprise.description`) échappent par nature à une liste blanche de champs :
  **0,5 % portent un courriel ou un téléphone de recruteur** (79 et 98 occurrences sur
  15 011). Ils passent par `caviarder()` avant stockage — courriels et numéros remplacés,
  texte conservé, testé.
- Adapter : `src/lib/ingest/adapters/francetravail.ts`. Dérivation :
  `src/lib/ingest/derive-offres.ts` (OFFRE_DIRECTE, OFFRE_REPUBLIEE, OFFRE_VELOCITE,
  CDD_COURT_REPETE, OFFRE_REACTUALISEE, OFFRE_MANQUE_CANDIDATS, OFFRE_MULTIPOSTES,
  MISSION_CONCURRENT), chaque signal portant le **lieu de travail** et le **ROME**.
- **Cold start** : l'API ne renvoie que les offres actives ; `OFFRE_REPUBLIEE` et
  `OFFRE_VELOCITE` exigent l'observation quotidienne (`.github/workflows/ingestion-quotidienne.yml`).
  `OFFRE_REACTUALISEE` n'a pas cette limite.

## BOAMP — annonces de marchés publics · **vérifiée** ✅ (V2)

- **Endpoint vérifié** (appel réel le 28/08/2026) :
  `GET https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records`
- **Piège vérifié** : `code_departement` est un **tableau de chaînes sans zéro initial**
  (`["3"]` pour l'Allier). `where=code_departement="03"` → 0 résultat ;
  **`refine=code_departement:3`** → 9 362 avis.
- **Filtres vérifiés** : `refine=nature:ATTRIBUTION` (41 avis dans l'Allier depuis le
  1er juin 2026), `where=datelimitereponse>=date'2026-08-28'` (65 appels d'offres ouverts),
  `order_by=dateparution DESC`, `limit`, `offset`, `select`.
- **Champs vérifiés** : `idweb`, `dateparution` (dernier avis daté du jour même),
  `datelimitereponse`, `nomacheteur`, `objet`, `nature` (APPEL_OFFRE / ATTRIBUTION…),
  `type_marche` (liste : TRAVAUX / SERVICES / FOURNITURES), `descripteur_libelle` (liste),
  `titulaire` (liste de noms **sans SIRET** → rapprochement par raison sociale),
  `procedure_libelle`, `url_avis`. Exemple lu : *Ville de Vichy, nettoyage des locaux →
  Saines Développement SAS, Aber Propreté Azur (27/08/2026)*.
- **Natures sur l'Allier** (tout l'historique) : APPEL_OFFRE 6 982, ATTRIBUTION 2 009,
  RECTIFICATIF 332, PRE-INFORMATION 32. `refine` filtre les tableaux, `where` non ; un
  avis peut lister plusieurs départements ; `titulaire` contient des doublons.
- **Signaux** : `MARCHE_ATTRIBUE` par titulaire distinct (J+0, montant inconnu → facteur
  0,6 ; le DECP arrive ensuite avec le montant et le SIRET), `AO_OUVERT` (signal de
  bassin, poids 0, lu par Tempo ; date limite future ou passée de moins de 30 jours).
  Métiers induits par le descripteur et l'objet (`reference/metiers.ts`).
- **Run réel** (Allier, 90 jours, 28/08/2026) : 192 avis lus, 158 signaux — 66
  `MARCHE_ATTRIBUE` (22 rattachés : 11 au référentiel, 11 via SIRENE ; 19 en file de
  résolution ; 25 rejets, surtout des groupes nationaux hors département) et 92 `AO_OUVERT`.
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/boamp.ts`.

## DECP — marchés publics attribués · **vérifiée** ✅

- **Endpoint vérifié** :
  `GET https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp-2022-marches-valides/records`
- **Filtres vérifiés** : `where=lieuexecution_code="03" AND lieuexecution_typecode="Code département"
  AND datenotification>=date'YYYY-MM-DD'`, `order_by=datenotification DESC`, `limit`, `offset`.
- **Champs vérifiés** : `objet`, `codecpv`, `montant`, `dureemois`, `datenotification`,
  `acheteur_id`, `titulaire_id_1..3` + `titulaire_typeidentifiant_1..3` (= `"SIRET"`).
- **Écueil constaté** : le filtre porte sur le **lieu d'exécution** ; 71 titulaires sur 72
  étaient absents du référentiel → enrichissement à la demande (72/72 rattachés).
- V2 : le signal porte les métiers induits par le CPV. Le lieu d'exécution n'est donné
  qu'au département (pas de coordonnées) : la distance au besoin vient du BOAMP/offres.
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/decp.ts`.

## BODACC — annonces civiles et commerciales · **vérifiée** ✅

- **Endpoint vérifié** :
  `GET https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records`
- **Filtres vérifiés** : `familleavis="collective"`, `familleavis="modification"`,
  `numerodepartement="03"`, `dateparution>=date'...'`, `registre like "<siren>"`.
- **Champs vérifiés** : `id`, `dateparution`, `tribunal`, `commercant`, `registre`
  (tableau contenant le SIREN), `jugement` (JSON en chaîne, clé `nature`),
  `modificationsgenerales` (JSON en chaîne, clé `descriptif`).
- **Constat V0** : 446 signaux BODACC pour **4 rattachés** — les signaux arrivent au
  SIREN sur tout le département, le référentiel ne couvrait que 10 km × 37 NAF.
  **Correctif V2** : les SIREN des `BODACC_CAPITAL` absents du référentiel sont
  récupérés chez SIRENE (siège) après l'ingestion ; les signaux orphelins sont rattachés
  au siège dès qu'il existe, à l'ingestion comme au scoring (`scoring/run.ts`).
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/bodacc.ts`.

## Géorisques — installations classées (ICPE) · **vérifiée** ✅ (V2)

- **Endpoint vérifié** (appel réel le 28/08/2026) :
  `GET https://georisques.gouv.fr/api/v1/installations_classees?latlon=<lon>,<lat>&rayon=<m>&page=&page_size=1000`
  (**longitude d'abord** ; rayon max **20 000 m**, HTTP 500 au-delà ; `page_size=1000`
  accepté ; réponse `{ results, page, total_pages, next, data[] }`). Un rayon d'agence
  supérieur est couvert par une grille de centres au pas de 28 km, dédoublonnée par SIRET.
  100 installations à 10 km de Vichy ; sur Moulins (10 km) : 71 lues, 9 établissements
  du référentiel marqués ICPE.
- **Champs vérifiés** : `siret` (parfois nul), `raisonSociale`, `codeInsee`, `commune`,
  `regime` (Enregistrement / Autorisation / Déclaration, mais aussi « Non ICPE » et
  « Autres régimes », écartés), `statutSeveso`, `etatActivite` (nul dans ~50 % des cas ;
  « En fin d'exploitation » écarté), `codeNaf`.
- **Usage** : attribut d'établissement (`etablissement.icpe`, `icpe_regime`) → composante
  « site industriel classé » du Strate. Pas de signal.
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/georisques.ts`.

## ACCO — accords d'entreprise (DILA) · **vérifiée** ✅ (V2)

- **Source vérifiée** (28/08/2026) : `https://echanges.dila.gouv.fr/OPENDATA/ACCO/` —
  livraisons hebdomadaires `ACCO_YYYYMMDD-HHMMSS.tar.gz` (**≈ 390 Mo**, 1 469 accords
  dans celle du 24/08) et un Freemium global.
- **Structure XML vérifiée** : `META_ACCO` → `SIRET`, `CODE_APE`, `CODE_IDCC`,
  `RAISON_SOCIALE`, `NATURE` (ACCORD / AVENANT), `DATE_TEXTE`, `DATE_EFFET`, `DATE_FIN`,
  `DATE_DIFFUSION`, `THEMES/THEME/{CODE, LIBELLE}`, `ADRESSES_POSTALES`. Les signataires
  et négociateurs (personnes physiques) ne sont **jamais** lus.
- **Thèmes exploités** : 051 durée collective, 052 heures supplémentaires, 053 CET,
  054 dimanche, 055 nuit, 059 modulation/annualisation → `ACCORD_SURCHARGE` ;
  075 PSE, 079 rupture conventionnelle collective, 080 maintien dans l'emploi →
  `ACCORD_RESTRUCTURATION`. Volume de la semaine du 24/08 : 059 × 150, 052 × 116,
  051 × 62, 055 × 21, 054 × 19, 075 × 7, 079 × 3 — **0 dans l'Allier** : rare, mais
  spécifique.
- **Run réel** (livraison du 24/08, `--depuis=7d`) : 86 s téléchargement compris,
  1 469 accords lus, 9 dans la zone (code postal 03 ou SIREN du référentiel), 3 signaux
  (2 surcharge, 1 restructuration), tous rattachés.
- **Cache** : l'archive est conservée dans `.cache/acco/` (une par livraison, ~390 Mo),
  l'extraction est supprimée après lecture, les archives hors fenêtre sont purgées.
  Fenêtre par défaut : 14 jours (deux livraisons).
- **Clé** : aucune. Adapter : `src/lib/ingest/adapters/acco.ts` (filtrage sur le
  département et les SIREN du référentiel).

## La Bonne Boîte v2 (France Travail) · **à autoriser** 🟧

- **Jeton vérifié** (28/08/2026) : le même endpoint OAuth2 délivre un jeton avec
  `scope=api_labonneboitev2` (1 499 s) — la souscription existe donc côté application.
- **Endpoint non trouvé** : `GET https://api.francetravail.io/partenaire/labonneboite/v2/recherche`
  → **403 « Invalid scope »** (y compris avec les scopes combinés `o2dsoffre`,
  `api_offresdemploiv2`) ; `/v2/entreprises`, `/v2/company/`, `/v1/company/` → 403 sans
  message. La documentation est servie par une application Angular (francetravail.io)
  que le projet ne peut pas lire automatiquement.
- **À faire** : relever sur francetravail.io (onglet Documentation de « La Bonne Boîte
  v2 ») le chemin exact et les paramètres, les poser dans `LBB_ENDPOINT` (`.env`) et
  vérifier avec `npm run ingest:lbb`. L'adapter (`src/lib/ingest/adapters/labonneboite.ts`)
  et la composante Strate « potentiel d'embauche » sont prêts.
- Méthode LBB (publique) : DPAE des 12 derniers mois → potentiel d'embauche à 3 mois,
  1 à 5 étoiles par établissement.

## URSSAF open data · **vérifiée** ✅ (référence)

- **Endpoint vérifié** (28/08/2026) :
  `GET https://open.urssaf.fr/api/explore/v2.1/catalog/datasets/etablissements-et-effectifs-salaries-au-niveau-commune-x-ape-last/records?where=code_commune="03310"`
  → 299 lignes ; 1,23 M lignes au total, modifié le 29/05/2026 ; effectifs et nombre
  d'établissements 2006-2025 par commune × APE. L'APE **7820Z** donne le volume
  d'intérim par commune (Vichy 2025 : 30 agences, 442 intérimaires).
- `dpae-par-departement-x-grand-secteur` : trimestriel, dernière modification
  22/10/2025 — série **suspendue** depuis mars 2025 (erreurs déclaratives sur le type
  de contrat, selon l'URSSAF).
- Usage V2 : documentation et calibration ; pas encore d'adapter (la saisonnalité et la
  taille du marché local viennent, pour l'instant, des tables embarquées et de la
  couverture concurrentielle).

## BMO 2026 (France Travail) · **embarquée** ✅

- **Fichier vérifié** : `Base-open-data-BMO-2026.xlsx` (francetravail.org, 3,7 Mo,
  53 786 lignes) — colonnes `Code métier BMO` (FAP), `Dept`, `BE26` (bassin d'emploi),
  `met` (projets), `xmet` (difficiles), `smet` (saisonniers) ; cellules secrétisées « * ».
- Agrégé par **département × famille de métiers** (8 familles dans l'open data) dans
  `data/reference/bmo-2026-dept-famille.csv`. Lu par Tempo (difficulté, part saisonnière).

## DARES — taux de recours à l'intérim · **bloquée** (repli embarqué) 🟧

- **Blocage** : le site dares.travail-emploi.gouv.fr est derrière un CAPTCHA ; le jeu
  data.gouv « Les statistiques d'emploi intérimaire » date de **2014** (écarté).
- **Repli** : ancrage sur les taux par grand secteur (T1 2025 — construction 8,3 %,
  industrie 6,9 %, tertiaire marchand 2,7 %, non marchand 0,5 %), ventilé en deux tables
  approximées et étiquetées comme telles : `data/reference/idcc-interim.csv` (par
  convention collective, prioritaire) et `dares-interim-naf.csv` (par division NAF).
- **À faire** : remplacer les ventilations par la donnée détaillée dès récupération
  manuelle ; à terme, mesurer l'intensité sur les missions publiées (couverture) et
  l'URSSAF 7820Z.

## Sitadel — permis de construire (SDES) · **à vérifier** 🟨

- La page SDES confirme une **mise à jour mensuelle** (dernière : 28/08/2026) des listes
  de permis (logements, locaux non résidentiels, PA, PD) avec identification du
  demandeur personne morale (SIRET), surfaces et destinations.
- L'extrait publié sur data.gouv (`liste-des-pc-dp-creant-des-locaux-non-residentiels…t2-2026.csv`)
  ne fait que 2 261 lignes et **n'a pas de colonne SIRET** : les fichiers complets sont
  à récupérer sur le site SDES et à vérifier.
- Le moteur sait déjà scorer `PERMIS_LOCAUX` (noyau à retard, métiers de chantier puis
  d'exploitation via `reference/metiers.ts`) ; l'adapter viendra avec les fichiers.

---

## Idempotence et cache

- Toute ré-ingestion est idempotente : contrainte d'unicité `signal(source, raw_ref)`
  + `onConflictDoNothing`, upsert sur `entreprise`/`etablissement`/`offre_brute`
  (dont, depuis la V2, **le rafraîchissement du payload et des champs dérivés d'une offre revue**).
- Les réponses brutes des API sont mises en cache disque dans `.cache/<source>/`
  (TTL 24 h) ; `INGEST_NO_CACHE=1` pour forcer les appels réels — indispensable après
  un changement de paramètres d'appel (ex. `include=` sur SIRENE).

## Rapprochement d'entité

Puisque ni France Travail ni le BOAMP ne publient de SIRET, le rapprochement est le
chemin normal de deux sources sur trois. Module partagé `src/lib/ingest/rapprocher.ts` :

1. **Référentiel local**, chaque établissement indexé sous sa raison sociale **et sous
   ses enseignes / son nom commercial** (« Intermarché Cusset » ↔ « SAS CUSDIS ») ;
2. **Interrogation de SIRENE** par nom + département quand la passe 1 n'aboutit pas
   (`GET /search?q=<nom>&departement=<dd>&per_page=5`), candidats rescorés localement.

Décisions : ≥ 0,88 rattachement automatique, 0,62-0,88 file de résolution manuelle
(`/resolution`), en dessous rejet compté. Garde-fou : seules les offres dont le NAF
appartient aux divisions cibles de l'agence déclenchent un appel réseau.

| Mesure (Allier, 2 211 offres sur 90 jours, V0) | Passe locale seule | + résolution SIRENE |
|---|---|---|
| Rattachements automatiques | 27 | **74** (dont 31 via SIRENE) |
| File de résolution manuelle | 152 | 13 |
| Rejets | 821 | 37 |
| Écartées avant appel réseau (hors ICP) | — | 882 |

Les mesures V2 (enseignes indexées, tranches propagées) sont dans le README.
