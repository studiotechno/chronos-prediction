# Moteur V2 — Strate, Sismo, Tempo

Note de conception détaillée : <https://claude.ai/code/artifact/ee18c40f-168d-4f99-ab9d-b720d302765e>
(diagnostic sur données réelles du 28/08/2026, catalogue des sources, feuille de route).
Ce document décrit ce que le code fait **maintenant**.

## Ce que l'on prédit

Un lead, c'est la réponse à trois questions à la fois :

| Composante | Question | Change | Fichier |
|---|---|---|---|
| **Strate** (0-100, acier) | *qui* — ce secteur, cette taille, cette santé, ce site consomment-ils de l'intérim ? | lentement | `src/lib/scoring/strate.ts` |
| **Sismo** (0-100, ambre) | *quoi vient de bouger* — offres, marchés, permis, accords, capital, chacun avec son horloge | tous les jours | `src/lib/scoring/sismo.ts` |
| **Tempo** (facteur ≈ 1) | *quand* — saison, difficulté de recrutement, conjoncture locale, fenêtre d'appel | tous les jours | `src/lib/scoring/tempo.ts` |

```
Final = 100 × (Strate/100)^α × (Sismo/100)^β × Tempo^γ        (final.ts)
```

**Portée de l'agence** : au-delà de `final.rayon_max_facteur` × rayon (défaut 5), un
établissement part en nurturing quel que soit son score. Les sources départementales
(BODACC, commande publique) ramènent des sièges de toute la France — mesuré sur l'Allier,
deux sociétés parisiennes à 265 km entraient dans les leads chauds sur une simple
augmentation de capital. La distance retenue est celle du besoin quand un signal en porte
un : un siège lointain avec un chantier proche reste chaud.

Multiplicatif : un excellent fit sans déclencheur n'est pas un lead. Tempo est borné
(`tempo.min` … `tempo.max`) : il ordonne les appels de la semaine, il ne décide pas de
la liste. La règle du seuil chaud (`final.seuil_chaud` sur le Sismo) est inchangée.

Un établissement n'est un lead que s'il porte **au moins un déclencheur positif** : une
entreprise connue seulement par sa procédure collective est hors radar, pas en nurturing.

## Strate V2 — composantes

| Composante | Lecture | Source |
|---|---|---|
| Intensité intérim du secteur | Taux de recours par **convention collective (IDCC)**, à défaut par division NAF (`data/reference/idcc-interim.csv`, `dares-interim-naf.csv`). Les agences d'intérim (78, IDCC 2378/1413) sont exclues. | API Recherche (`liste_idcc`) |
| Taille | **Cascade** : tranche INSEE → tranche publiée par France Travail sur une offre rattachée (`trancheEffectifEtab`) → estimation sur le chiffre d'affaires (CA / CA par salarié de la section) → `caractere_employeur` (O : prior `strate.effectif.prior_inconnu`, N : 0) | SIRENE, France Travail, RNE |
| Proximité du besoin | Distance agence → **lieu du besoin** porté par un signal récent (chantier, lieu de travail) quand il est plus proche que l'établissement ; sinon l'établissement. Le détail dit les deux. | signaux (`lieu`) |
| Ancienneté | inchangée | SIRENE |
| Santé | Résultat net du dernier exercice (`strate.sante.malus_resultat_negatif`), CA en baisse ≥ 15 % (`malus_ca_baisse`), accord de restructuration ≤ 1 an (`malus_restructuration`), procédure collective (malus multiplicatif sur tout le Strate) | RNE, ACCO, BODACC |
| Multi-établissements | inchangé | SIRENE |
| Site industriel classé | `strate.site.icpe` points si l'établissement est une ICPE en exploitation | Géorisques |
| Potentiel d'embauche | `strate.lbb.max` × étoiles/5 quand La Bonne Boîte le connaît | France Travail LBB |

Exclusions par NAF (`agence.naf_exclus`, défaut `["78", "84"]`) : ces établissements ne
sont ni scorés ni listés.

## Sismo V2 — signaux, noyaux, corroboration

```
contribution = poids × confiance × facteurs × K_type(âge)
```

**Noyaux** (`sismo.ts` → `noyau()`) :
- *immédiat* : `exp(−ln2 × âge / demi-vie)` — le besoin est maintenant (offres, accords, capital) ;
- *à retard* (`sismo.pic.<TYPE>`, `sismo.largeur.<TYPE>`) : `max(plancher, log-normale centrée
  sur le pic)` — un marché attribué pèse au démarrage du chantier, pas à la signature.
  `sismo.plancher_retard` donne la contribution dès le jour J. La **fenêtre d'appel**
  du lead est celle du signal à retard le plus contributif encore à venir
  (`[pic × e^−largeur, pic × e^+largeur]` jours après le signal).

**Facteurs** :
- ROME hors cibles de l'agence : `sismo.rome_hors_cible` (les `romes` induits priment sur `payload.rome`) ;
- **secteur** : les signaux d'offres sont multipliés par `max(sismo.secteur.plancher,
  min(1, taux / strate.naf.taux_ref))` — le supermarché à 12 offres retombe à sa place ;
- marché : montant / `sismo.marche.montant_ref` (inconnu → 0,6), CPV ou métiers induits hors cible → `sismo.marche.cpv_hors_cible` ;
- multipostes : `nombrePostes / sismo.postes.ref` ; réactualisation : `nbActualisations / sismo.actualisations.ref`.

**Dédoublonnage des marchés** : le BOAMP publie l'attribution le jour même, le DECP
republie le même marché des semaines plus tard avec son montant. Deux `MARCHE_ATTRIBUE`
du même établissement, distants de moins de `sismo.marche.dedup_jours` et dont les objets
se ressemblent (trigrammes ≥ `sismo.marche.dedup_similarite`), ne comptent qu'une fois :
la contribution la plus forte est gardée, les autres passent à zéro tout en restant dans
la chronologie — les deux avis existent bel et bien. Sans objet publié, aucune fusion.

**Corroboration** : les contributions positives sont sommées **par famille de source**
(`FAMILLE_PAR_TYPE` : offres, commande_publique, registre, accords, urbanisme) et
saturées vers `sismo.famille.cap` (`cap × (1 − e^(−somme/cap))`) ; la somme est ensuite
multipliée par `1 + sismo.corroboration.bonus × (familles positives − 1)`. Les malus ne
saturent pas. Puis normalisation logistique inchangée.

| Signal | Source | Noyau | Polarité |
|---|---|---|---|
| OFFRE_DIRECTE, OFFRE_VELOCITE, OFFRE_REPUBLIEE, CDD_COURT_REPETE | France Travail | immédiat | + |
| OFFRE_REACTUALISEE, OFFRE_MANQUE_CANDIDATS, OFFRE_MULTIPOSTES *(nouveaux)* | France Travail | immédiat | + |
| MARCHE_ATTRIBUE | BOAMP (J+0, titulaire rapproché par nom) puis DECP (montant, SIRET) | à retard, pic 75 j | + |
| AO_OUVERT *(nouveau, bassin)* | BOAMP | — (poids 0) | Tempo |
| EFFECTIF_UP, BODACC_CAPITAL | SIRENE, BODACC | immédiat | + |
| CA_CROISSANCE / CA_BAISSE *(nouveaux)* | RNE via API Recherche | immédiat, demi-vie 1 an | + / − |
| BODACC_RISQUE | BODACC | immédiat, demi-vie 1 an | − |
| ACCORD_SURCHARGE / ACCORD_RESTRUCTURATION *(nouveaux)* | ACCO | immédiat | + / − |
| PERMIS_LOCAUX *(moteur prêt, adapter Sitadel à venir)* | Sitadel | à retard, pic 120 j | + |
| MISSION_CONCURRENT | France Travail | — (poids 0) | couverture, Tempo |

Chaque signal peut porter un **lieu** (`signal.lieu` : lat, lon, libellé — lieu de travail
de l'offre, chantier) et des **métiers induits** (`signal.romes` : le ROME de l'offre ;
pour un marché, `reference/metiers.ts` déduit les ROME du descripteur BOAMP ou du CPV).

## Tempo — le « quand »

`tempo = clamp(1 + Σ amplitude × lecture, tempo.min, tempo.max)` avec quatre lectures,
chacune dans [−1, 1] :

| Lecture | Amplitude | Source |
|---|---|---|
| Saison du secteur (× part saisonnière des métiers dans le département) | `tempo.saison.amplitude` | `data/reference/saisonnalite-section.csv`, BMO |
| Difficulté de recrutement des métiers induits dans le département | `tempo.difficulte.amplitude` | `data/reference/bmo-2026-dept-famille.csv` |
| Conjoncture locale : missions d'intérim publiées sur le bassin pour ces métiers, 45 j vs 45 j précédents (muette si < 4 missions ou si la collecte est biaisée) | `tempo.conjoncture.amplitude` | MISSION_CONCURRENT |
| Commande publique ouverte : appels d'offres du département portant sur ces métiers et dont la date limite n'est pas passée. Lecture **positive seulement** — l'absence d'appel d'offres ne dit rien | `tempo.commande_publique.amplitude`, `…ref` | AO_OUVERT |
| Fenêtre d'appel : dedans +1, à moins de 3 semaines +0,5, passée −0,5 | `tempo.fenetre.amplitude` | signaux à retard |

## Sortie : raison, proposition, fenêtre, lieu

`raison.ts` génère toujours la raison d'appeler par templates déterministes, désormais
suivie d'une **proposition** : *« Proposer : maçonnerie, conduite d'engins · Appeler entre
le 15 octobre et le 15 novembre · Besoin à Saint-Pourçain-sur-Sioule (12 km) »*. La table
`lead` porte `tempo`, `proposition_fr`, `fenetre_debut/fin`, `lieu_besoin_fr`,
`distance_besoin_km`, `romes_induits`.

## Mémoire et apprentissage

- `score_snapshot (jour, siret)` : réécrit à chaque `npm run score`, un état par jour.
  C'est la matière du backtest et des tendances.
- `crm_outcome` : chaque changement de statut d'un lead y laisse une ligne avec le score
  et les signaux du moment.
- `.github/workflows/ingestion-quotidienne.yml` : ingestion + scoring tous les jours à
  04:30 UTC (secrets `DATABASE_URL`, `FRANCETRAVAIL_CLIENT_ID/SECRET`).

## Tables de référence embarquées

| Fichier | Contenu | Statut |
|---|---|---|
| `data/reference/idcc-interim.csv` | taux de recours par IDCC (≈ 80 conventions) | approximation ancrée DARES T1 2025, à remplacer |
| `data/reference/dares-interim-naf.csv` | taux par division NAF (repli) | idem |
| `data/reference/saisonnalite-section.csv` | facteur mois × section NAF | calendrier posé à la main, à remplacer par la mesure |
| `data/reference/bmo-2026-dept-famille.csv` | BMO 2026, département × famille de métiers | réel (France Travail, open data) |

## Réparer les métiers après une correction de règle

Un signal fige ses métiers induits à l'ingestion, et l'unicité `(source, raw_ref)` fait
qu'une ré-ingestion ne les met pas à jour : corriger une règle dans
`reference/metiers.ts` ne rattrape pas les signaux déjà en base.
`npx tsx scripts/reparer-metiers.ts` les recalcule depuis leur payload stocké
(simulation par défaut, `--appliquer` pour écrire). Les pièges rencontrés sur le BOAMP
réel — et couverts par des tests — méritent d'être connus avant d'ajouter une règle :

| Objet du marché | Piège | Règle |
|---|---|---|
| « restauration de l'Église Notre-Dame » | homonyme de restauration collective | seuls « restauration collective / scolaire / rapide », « service de restauration », « restaurant », « cantine » comptent |
| « aménagement de l'entrée Nord » | **« aménagement » contient « ménage »** | `\bménage\b` |
| « entretien des installations de chauffage des **bâtiments** » | « bâtiment » seul n'est pas du gros œuvre | gros œuvre exige maçonnerie, construction de, réhabilitation, réfection, façade… |
| « vérifications périodiques obligatoires » | marché de contrôle, aucun ouvrier | liste d'exclusions (maîtrise d'œuvre, contrôle, assurance, fourniture…), prioritaire |
| « AT03_TransportScolaire_19Lots » | objet nommé par une machine, sans espaces | `transport[\s_-]?scolaire` |
| « AT03_TAD_10lots » | `\btad\b` ne mord pas : « _ » est un caractère de mot | `(?<![a-z0-9])tad(?![a-z0-9])` |
| CPV 60 | couvre voyageurs ET marchandises | 6018/6024/6025 fret, 601x/602x voyageurs |

## Ce qui n'est pas encore là

- **Sitadel** (permis de locaux) : le moteur sait scorer `PERMIS_LOCAUX`, l'adapter attend
  les fichiers complets du SDES (l'extrait data.gouv n'a pas le SIRET du demandeur).
- **La Bonne Boîte v2** : le jeton est délivré (`api_labonneboitev2`) mais l'API répond
  403 sur tous les chemins essayés ; l'adapter est prêt, l'endpoint se règle par
  `LBB_ENDPOINT` dès que France Travail confirme le chemin.
- **Poids appris** : `crm_outcome` et `score_snapshot` se remplissent ; la réestimation
  des poids (régression logistique → table `weights`) viendra avec les premières
  conversions.
