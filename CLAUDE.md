# Stephanie Weyman — Site courtière hypothécaire

Site Astro 6 hybride (SSR + statique) déployé sur Netlify. Taux hypothécaires en temps réel scrapés depuis hypotheca.ca, outils de calcul interactifs, et intégration Google Reviews.

## Stack
- **Astro 6.0.8** avec adapter `@astrojs/netlify` (SSR)
- **TypeScript** strict (`noUncheckedIndexedAccess` activé)
- **Netlify Blobs** pour cache des taux et des avis en production
- **Vitest 4** pour les tests unitaires
- Pas de framework UI (composants `.astro` natifs), pas de Tailwind — CSS dans `src/styles/global.css`
- Langue : français (fr-CA)

## Commandes
- `npm run dev` — serveur dev sur http://localhost:4321 (cache taux dans `.cache/`)
- `npm run build` — build production dans `dist/`
- `npm run preview` — preview du build
- `npm run check` — type-check Astro/TS
- `npx vitest run` — lance les tests unitaires (ou `npx vitest`)
- `netlify dev` — émule l'environnement Netlify (Blobs) sur http://localhost:8888

## Structure du projet

```
src/
├── assets/           # Images statiques (stephanie.jpg/.webp)
├── components/       # Composants Astro réutilisables
├── config/           # siteConfig.json + types TypeScript
├── data/             # Données statiques (prêteurs, avis fallback)
├── layouts/          # MainLayout.astro (unique layout)
├── lib/              # Logique métier pure + tests
├── pages/            # Routes Astro (pages + API endpoints)
├── services/         # Fetch/cache external data (taux, avis)
├── styles/           # global.css
├── types/            # Déclarations de types supplémentaires
├── utils/            # Fonctions utilitaires pures
└── middleware.ts     # Vérification d'origine (CSRF) — voir « Réseau de partenaires »
```

## Pages et routes

| Route | Rendu | Description |
|-------|-------|-------------|
| `/` | SSR | Accueil (taux live, hero, services, avis, FAQ) |
| `/outils` | SSR | Hub outils avec onglets (`#simulateur`, `#calculateur`, `#comparateur`) |
| `/outils/calculateur-penalite-hypothecaire` | SSR | Calculateur de pénalité dédié |
| `/amortissement` | Statique | Tableau d'amortissement |
| `/rappel` | Statique | Formulaire de prise de rappel |
| `/profil-emprunteur` | Statique | Formulaire AMF « Profil des emprunteurs » en tuiles + signature dessinée (noindex, sans Nav/Footer) |
| `/preparer-profil` | SSR | Préparation du lien « Profil des emprunteurs » avec les noms et courriels — réservé à la courtière, protégé par mot de passe (noindex) |
| `/signer` | SSR | Co-signature à distance par lien nominatif (noindex, sans Nav/Footer) |
| `/tableau-de-bord` | SSR | Cockpit de la courtière : ce qui presse aujourd'hui (tous carnets) + accès aux outils — réservé à la courtière, protégé par mot de passe (noindex) |
| `/contrat` | SSR | Générateur du contrat de courtage — réservé à la courtière, protégé par mot de passe (noindex) |
| `/signer-contrat` | SSR | Lecture, réponses et signature du contrat par lien nominatif (noindex, sans Nav/Footer) |
| `/finaliser-contrat` | SSR | Relecture et signature finale par la courtière (noindex, protégé par mot de passe) |
| `/reseau` | SSR | Carnet de prospection des partenaires — réservé à la courtière, protégé par mot de passe (noindex, sans Nav/Footer) |
| `/dossiers` | SSR | Suivi des dossiers clients — réservé à la courtière, protégé par mot de passe (noindex) |
| `/mon-dossier` | SSR | Portail du client : étape de son dossier et documents attendus, accès par lien magique (noindex, sans Nav/Footer) |
| `/refinancement` | Statique | Landing publicitaire V1 (funnel quiz 4 étapes, noindex, sans Nav/Footer) |
| `/refinancement-v2` | Statique | Landing publicitaire V2 (funnel 5 étapes sans chiffre exact, noindex, sans Nav/Footer) |
| `/refinancement/merci` | Statique | Page de remerciement du funnel V2 (noindex, sans Nav/Footer) |
| `/services/premier-achat` | Statique | Page clientèle premier achat |
| `/services/renouvellement` | Statique | Page renouvellement |
| `/services/refinancement` | Statique | Page refinancement |
| `/services/travailleur-autonome` | Statique | Page travailleur autonome |
| `/services/dossier-refuse` | Statique | Page dossier refusé |
| `/services/nouveaux-arrivants` | Statique | Page nouveaux arrivants |
| `/villes/courtier-hypothecaire-repentigny` | Statique | Landing page géolocalisée |
| `/conditions` | Statique | Conditions d'utilisation |
| `/confidentialite` | Statique | Politique de confidentialité |
| `/404` | Statique | Page d'erreur |
| `/api/bdc-rate` | API | Taux directeur Banque du Canada (proxy, cache 6h) |
| `/api/rappel-submit` | API | Soumission formulaire de rappel (`/rappel`) |
| `/api/contact-submit` | API | Soumission formulaire de contact / quiz (accueil, section `#contact`) |
| `/api/calculateur-submit` | API | Soumission capture courriel/texto du calculateur de versement |
| `/api/penalite-submit` | API | Soumission capture de rapport du calculateur de pénalité |
| `/api/outils-submit` | API | Soumission formulaire de contact du hub d'outils (`/outils`) |
| `/api/partenaires-submit` | API | Soumission formulaire de référence partenaire (`/partenaires`) |
| `/api/demande-submit` | API | Soumission formulaire de demande de financement (`/demande`) |
| `/api/refinancement-submit` | API | Soumission du funnel publicitaire V1 (`/refinancement`) |
| `/api/refinancement-v2-submit` | API | Soumission du funnel publicitaire V2 (`/refinancement-v2`), équité déduite des tranches |
| `/api/profil-submit` | API | Soumission du profil des emprunteurs — estampe le PDF officiel, ou ouvre un dossier de co-signature |
| `/api/profil-cosigner` | API | Signature (ou désaccord) d'un co-emprunteur via son lien nominatif |
| `/api/contrat-acces` | API | Ouverture de session sur `/contrat` (mot de passe partagé → cookie signé) |
| `/api/contrat-creer` | API | Création du contrat de courtage — estampe le modèle, ou ouvre un dossier de signature |
| `/api/contrat-apercu` | API | Sert le contrat intégral (PDF) au signataire, via son jeton — sans le consommer |
| `/api/contrat-previsualiser` | API | Aperçu PDF du contrat en cours de saisie, pour la courtière — rien n'est envoyé ni stocké |
| `/api/contrat-reglages` | API | Signature mémorisée et valeurs par défaut de la courtière (GET/PUT/DELETE) |
| `/api/contrat-signer` | API | Réponses, signature (ou refus) d'un emprunteur via son lien nominatif |
| `/api/contrat-apercu-courtiere` | API | Aperçu d'un dossier à finaliser, servi à la courtière par mot de passe |
| `/api/contrat-finaliser` | API | Signature finale de la courtière — produit le PDF, l'envoie, supprime le dossier |
| `/api/contrat-dossiers` | API | Résumés des contrats en cours, pour l'écran de suivi de `/contrat` |
| `/api/contrat-relancer` | API | Réémet le lien du signataire courant — l'ancien cesse aussitôt de valoir |
| `/api/reseau-contacts` | API | Le carnet du réseau, en lecture (résumés + envois du jour) |
| `/api/reseau-contact` | API | Écriture dans le carnet : créer, corriger, supprimer, état, note, relance, import |
| `/api/reseau-envoi` | API | Aperçu d'un gabarit (GET) et envoi de l'approche (POST), puis journalisation |
| `/api/reseau-gabarit` | API | Lecture, réécriture et retour au modèle d'origine d'un gabarit de courriel |
| `/api/reseau-retrait` | API | Désabonnement d'un contact par son lien — **la seule route du réseau qui soit publique** |
| `/api/crm-dossiers` | API | Les dossiers clients, en lecture (fiches complètes pour l'écran de suivi) |
| `/api/crm-dossier` | API | Écriture d'un dossier : créer, corriger, supprimer, étape, note, relance, documents |
| `/api/crm-prevenir` | API | Envoie au client l'état de son dossier et un lien d'accès — sur geste de la courtière |
| `/api/dossier-acces` | API | Demande d'un lien d'accès au portail — **la seule route publique du CRM** |
| `/api/crm-lien` | API | Ce que les autres carnets savent d'une même personne (résolution paresseuse) |

**Le défaut est le statique, pas le SSR.** `astro.config.mjs` ne définit pas `output`, donc Astro 6
prérend chaque page au build sauf si elle déclare `export const prerender = false`.

- Page qui lit des données à l'exécution (taux, avis) ou route API → `export const prerender = false` **obligatoire**.
  Sans cette ligne, les taux sont figés au moment du déploiement — et si le scraping échoue pendant
  le build, le site sert « taux indisponibles » jusqu'au prochain déploiement.
- Page purement statique → `export const prerender = true` (explicite, même si c'est le défaut).

Toute page du tableau ci-dessus marquée « SSR » doit donc porter `prerender = false`.

## Composants principaux

**Navigation & structure :**
- `Nav.astro` — Navigation principale
- `Footer.astro` — Pied de page
- `SEO.astro` — Meta tags, JSON-LD (LocalBusiness, FAQSchema, AggregateRating)
- `MainLayout.astro` — Layout global (Nav + Footer + scripts analytics/consent)
- `ConnexionCourtiere.astro` — L'écran de connexion partagé par les cinq pages réservées à la
  courtière (`/tableau-de-bord`, `/contrat`, `/finaliser-contrat`, `/reseau`, `/dossiers`).
  Auparavant copié-collé cinq fois ; une seule copie évite qu'une page finisse par diverger.
- `BarreCourtiere.astro` — Le bandeau de navigation entre les écrans privés, rendu seulement
  quand l'accès est accordé. `/finaliser-contrat` le porte sans y figurer (on y arrive par lien).

**Marketing :**
- `Hero.astro`, `About.astro`, `Services.astro`, `Testimonials.astro`, `Faq.astro`
- `RappelCTA.astro` — Call-to-action prise de rendez-vous
- `TauxSection.astro` — Affichage des taux live (depuis `ratesService`)
- `ConsentBanner.astro`, `MessengerBtn.astro`

**Outils interactifs (scripts inline) :**
- `Calculator.astro` — Calculateur de paiement (sliders)
- `Simulator.astro` — Simulateur d'accessibilité (basé sur le revenu)
- `Comparateur.astro` — Comparateur de scénarios hypothécaires
- `RefinancementSimulator.astro` — Simulateur de refinancement
- `PenaliteCalculator.astro` — Calculateur de pénalité de remboursement anticipé

## Services (fetch + cache)

### `src/services/ratesService.ts`
Scrape les taux depuis hypotheca.ca, cache 24h via Netlify Blobs (fichier en dev). Après un échec de fetch (ex. 429), cooldown de 15 min pendant lequel le cache périmé (< 30 jours) est servi sans retenter l'upstream.

**Flux :** `hypotheca.ca` → parse HTML → Netlify Blob (store `rates`, TTL 24h) → pages SSR → CDN (`s-maxage=21600, stale-while-revalidate=3600`)

**Règles critiques :**
- **Jamais de faux taux en fallback.** Si fetch échoue et qu'aucun cache stale < 30 jours n'existe, retourner `null` et afficher un lien vers hypotheca.ca.
- Parsing en cascade : `<tr>` HTML visible → `occ(...)` obfusqué → markdown (proxy r.jina.ai).
- Le proxy r.jina.ai est désactivé par défaut (`ENABLE_RATES_PROXY=1` pour l'activer).
- Validation des taux : entre 0.5 % et 20 %.

**Type retourné : `HypothecaRates | null`**
```typescript
interface HypothecaRates {
  fixe_5ans: number | null  // taux Hypotheca
  affiche_fixe_5ans: number | null  // taux affiché (big banks)
  // ...autres termes: fixe_1-4ans, fixe_6-10ans, variable
  rows: RateEntry[]
  source: 'live' | 'fallback'
  fetchedAt: string
}
```

### `src/services/reviewsService.ts`
Fetch les avis Google via l'API Google Places (New), cache 24h via Netlify Blobs.
- Fallback : `src/data/fallbackReviews.json` (avis statiques)
- Variables d'env requises : `GOOGLE_PLACES_API_KEY` + `google_place_id` dans siteConfig.json

## Logique métier

### `src/lib/penalite.ts` (531 lignes)
Calcul complet des pénalités de remboursement anticipé hypothécaire.

**Méthodes supportées :**
- **3 mois d'intérêt** — prêts variables et certaines banques
- **IRD (Différentiel de taux d'intérêt)** — 3 variantes :
  - `taux_affiche` — Grandes banques (RBC, TD, BMO, CIBC, Scotia) : IRD basé sur taux affiché
  - `taux_reel` — Prêteurs monolines (MCAP, First National…) : IRD basé sur taux réel
  - `taux_obligataire` — Méthode hybride (Desjardins, Caisse pop)

**Fonctions exportées :**
- `calculerPenalite(params)` — Fonction principale, retourne le max(3 mois, IRD)
- `calculerPenalite3Mois(solde, taux, freq)` — Pénalité 3 mois d'intérêt
- `calculerIRD(params)` — Calcul IRD selon la méthode du prêteur
- `calculerMoisRestants(dateEcheance, dateRef?)` — Mois restants au terme
- `termeLePlusProche(moisRestants, taux, preteur)` — Terme de référence pour IRD

**Tests :** `src/lib/penalite.test.ts` (446 lignes, 35+ cas de test)

### `src/utils/mortgageCalc.ts` (184 lignes)
Calculs mathématiques hypothécaires partagés entre composants.

- `tauxPeriodique(tauxAnnuel, freq)` — Taux périodique (capitalisation semi-annuelle canadienne)
- `calcPaiement(pretTotal, tauxAnnuel, amortAns, freq)` — Paiement périodique
- `calculateSCHL(prix, mise)` — Assurance SCHL (mise < 20%)
- `miseMinimale(prix)` — Mise minimale par tranche (5% ≤500k, 10% 500k–1M, 20% ≥1M)
- `prixMaxParMise(mise)` — Prix max à partir d'une mise donnée
- `droitsMutation(prix)` — Taxe de bienvenue Québec (5 tranches, max 2%)
- `calcAbsoluteMax(pretMax)` — Prix max finançable (boucle de convergence assuré/conventionnel)

### `src/data/preteurs.ts`
Base de données des prêteurs pour le calculateur de pénalité.
- 12+ prêteurs majeurs (RBC, TD, BMO, CIBC, Scotia, Desjardins, MCAP, First National…)
- Chaque prêteur : nom, méthode IRD, notes sur les particularités de calcul

### `src/utils/hypothecaDecoder.ts`
Décode l'obfuscation `occ(...)` utilisée sur hypotheca.ca : ROT13 (lettres) + ROT5 (chiffres) + caractères spéciaux.

### `src/utils/formatters.ts`
- `formatCAD(n)` → `"300 000 $"` (fr-CA, sans décimales)
- `formatNumber(n)` → `"300 000"` (fr-CA)
- `formatDateLong(d)` → `"1 juin 2028"` (fr-CA)

### `src/utils/profilEmprunteurs.ts`
Source de vérité du formulaire AMF « Profil des emprunteurs », partagée entre `/profil-emprunteur`,
`/signer` et les deux endpoints.
- `QUESTIONS` — les 8 questions, leurs options, et **les coordonnées des 30 cases à cocher du modèle PDF**
- `ZONES_SIGNATURE`, `POSITION_AUTRE_MONTANT`, `TRACE_LARGEUR_MAX/HAUTEUR_MAX` — géométrie d'estampage
- `parserReponses`, `parserSignataires`, `decoderTraceSignature` — validation stricte côté serveur
  (le catalogue fait office de whitelist ; le PNG de signature est vérifié avant d'approcher pdf-lib)
- Tests : `src/utils/profilEmprunteurs.test.ts`
- **Si Hypotheca révise le formulaire**, il faut régénérer le modèle *et* réextraire les
  coordonnées — voir l'entête du fichier.

### `src/utils/contratCourtage.ts`
Source de vérité du « Contrat de courtage hypothécaire », partagée entre `/contrat`,
`/signer-contrat` et les trois endpoints `contrat-*`.
- Catalogue complet des champs du modèle PDF avec **leurs coordonnées sur les 4 pages**
  (pages 612 × 1008 pt — format légal, pas lettre)
- `TYPES_FINANCEMENT`, `TYPES_TAUX`, `DOUBLE_REMUNERATION`, `PPV_CASES`… — cases à cocher,
  qui servent aussi de whitelist de validation côté serveur
- `LIGNES_IDENTITE` + `COLONNES_IDENTITE` — le tableau de vérification d'identité (10 × 3)
- `parserDonneesContrat`, `parserEmprunteurs` — validation stricte : toute option hors
  catalogue fait échouer la requête, les champs libres sont normalisés et plafonnés
- `repartirSurLignes` — répartit un texte libre sur les 2 à 4 lignes que le modèle réserve
- Tests : `src/utils/contratCourtage.test.ts`
- **Si Hypotheca révise le contrat**, il faut régénérer le modèle *et* réextraire les
  coordonnées — voir l'entête du fichier.

### `src/utils/traceSignature.ts`
Validation des tracés de signature (PNG), partagée par le profil et le contrat :
nombre magique, poids, et dimensions lues dans le chunk IHDR **avant** que pdf-lib ne
touche aux octets. `src/utils/profilEmprunteurs.ts` la réexporte pour les appelants
historiques.

### `src/utils/refinancementV2.ts`
Source de vérité du funnel `/refinancement-v2`, partagée entre la page et `/api/refinancement-v2-submit`.
- `INTENTIONS`, `VALEURS`, `SOLDES` — libellés + milieux de tranche ; servent aussi de whitelist de validation côté API
- `evaluerEquite(valeurCle, soldeCle)` — déduit équité, ratio et montant refinançable (80 % LTV) à partir des tranches ; `null` si une clé est invalide
- `classerRatio(ratio)` — `faible` sous 20 %, `bonne` à partir de 20 % inclusivement
- Tests : `src/utils/refinancementV2.test.ts`
- **L'équité est toujours recalculée côté serveur** — rien n'est accepté du client sur ce point.

## Formulaire « Profil des emprunteurs »

Le PDF officiel n'est **jamais reconstruit** : on charge le modèle d'Hypotheca et on estampe
par-dessus (coches vectorielles, montant libre, tracés de signature, dates). Le document produit
est identique au modèle au pixel près.

| Fichier | Rôle |
|---------|------|
| `src/data/profilEmprunteursModele.ts` | Le modèle PDF en base64 — **fichier généré**, ne pas éditer |
| `scripts/encode-modele.mjs` | Régénère le module ci-dessus : `node scripts/encode-modele.mjs <pdf>` |
| `src/services/profilPdfService.ts` | Estampage pdf-lib + empreintes SHA-256 |
| `src/utils/profilPreparation.ts` | Le préremplissage : encodage du lien, décodage défensif, normalisation |
| `src/pages/preparer-profil.astro` | L'écran de la courtière : saisir les emprunteurs, obtenir le lien |
| `src/services/profilDossierService.ts` | Dossiers en attente de co-signature (Netlify Blobs, jetons hachés) |
| `src/services/profilCourriels.ts` | Courriels + **trace de preuve** des signatures |
| `src/components/SignaturePad.astro` + `src/scripts/signaturePad.ts` | Bloc de signature (canevas, recadrage sur l'encre, repli « nom tapé ») |

**Règles :**
- **Le modèle ne doit porter aucune annotation.** Un contrat rempli cache ses valeurs dans
  le flux de contenu *et* parfois dans des annotations (`/Stamp`, `/FreeText`) qui survivent
  au nettoyage du contenu et s'impriment quand même — c'est ainsi que la signature de la
  courtière s'était retrouvée dans le modèle embarqué. Un test de `contratPdfService.test.ts`
  verrouille l'absence d'annotations.
- **Rien n'est ajouté au PDF hors des champs du modèle.** La trace de preuve (horodatage serveur,
  IP, navigateur, empreintes) vit dans le courriel interne, jamais dans le document.
- **Le PDF ne sort que vers la courtière.** Seul le courriel interne le porte en pièce jointe : les
  signataires reçoivent un accusé de signature sans document, et les endpoints ne renvoient plus
  ni `pdf` ni `filename` au navigateur — l'écran de confirmation ne propose aucun téléchargement.
- **Le nombre d'emprunteurs est demandé, jamais déduit.** Un écran dédié — en tuiles, sans valeur
  par défaut — précède la liste des signataires. Tant que la liste s'ouvrait sur une seule carte
  suivie d'un « + Ajouter » discret, le co-emprunteur se retrouvait absent d'un formulaire pourtant
  signé « notre vision commune ». Le bouton « + Ajouter » reste, mais comme correction, pas comme
  seul chemin.
- **« Les autres emprunteurs sont-ils avec vous ? » n'a pas de réponse par défaut.** C'est
  cette question, et elle seule, qui décide si un lien de signature part vers les
  co-emprunteurs. Tant que « Oui, ils sont avec moi » était pré-coché, on traversait sans la
  voir la branche où personne ne reçoit rien — et un co-emprunteur pouvait attendre
  indéfiniment un courriel qui n'était jamais dû. Même raison que l'écran du nombre
  d'emprunteurs. Corollaires tenus par `voieSoumise()` : un emprunteur **seul** n'est pas
  questionné (« en présence » est alors un constat, pas un défaut), et déclarer être seul
  n'écrit **rien** dans l'état — sinon ajouter ensuite un co-emprunteur ramènerait une
  réponse que personne n'a donnée. Chaque option énonce sa conséquence : « aucun lien ne
  sera envoyé » d'un côté, « chacun recevra son propre lien » de l'autre.
- Les tracés de signature ne sont **jamais persistés côté navigateur** et le dossier Blob est
  supprimé dès le PDF produit. TTL de 14 jours, purge opportuniste à la création.
- Le parcours reprend où il en était après un rechargement : réponses **et écran courant**
  vivent en `sessionStorage`, l'écran repris étant ramené au dernier que les données
  sauvegardées permettent de reconstruire. Effacé dès la soumission.
- L'écran de confirmation affiche les adresses **renvoyées par le serveur** (`copies` = les
  destinataires de l'accusé, `enAttente`), jamais celles restées en mémoire : c'est ce qui
  permet au client de repérer sa propre faute de frappe.
- **L'invitation part avant l'avis interne, et jamais en même temps.** Les deux envois
  étaient lancés par un même `Promise.allSettled` : deux requêtes Resend sur le fil à la
  milliseconde près, pour une limite de débit qui se compte à la seconde. Quand le 429 tombait
  sur l'invitation plutôt que sur l'avis, le résultat était l'inverse exact de la priorité
  annoncée — la courtière prévenue qu'un dossier attendait, et le co-emprunteur sans rien.
  `envoyerEnSerie` espaçait déjà les invitations entre elles ; c'est le couple invitation/avis
  qui court-circuitait la précaution. Même correction dans `/api/contrat-creer`, où le jeton du
  signataire courant est le seul vivant.
- **Un 429 n'est pas un refus, c'est « pas maintenant ».** `sendEmail` réessaie deux fois
  (`Retry-After` respecté, plafonné à 3 s) au lieu de perdre le courriel. Les autres statuts ne
  sont pas réessayés : un 422 sur une adresse mal formée ne changera pas d'avis.
- **Une invitation qui échoue ne fait plus échouer la soumission.** Le dossier existe : refuser
  ferait tout recommencer et ouvrirait un **second** dossier, donc deux liens vivants pour la
  même signature. `envoyerInvitations` ne lève plus — l'échec du premier co-signataire ne prive
  pas les suivants de leur lien — et rend un `BilanInvitations` que trois écrans consomment :
  l'écran de confirmation nomme qui n'a pas pu être joint, l'avis interne porte une alerte et
  les liens à transmettre à la main, et la route ne remonte une erreur que si **rien** n'est
  parti, seul cas où personne d'autre ne peut l'apprendre.
- Les jetons de co-signature sont à usage unique, stockés hachés (SHA-256), et comparés à temps
  constant.
- **Le préremplissage est une proposition, jamais une autorité.** Stéphanie connaît déjà les
  noms et les adresses au moment d'envoyer le formulaire : `/preparer-profil` fabrique un lien
  qui les porte (`?p=`, base64url, **non signé** — il n'ouvre aucun accès et n'obtient rien
  qu'un visiteur ne puisse taper à la main). Trois conséquences tenues par le code : les champs
  restent **modifiables** — la faute de frappe qu'il faut pouvoir rattraper est justement celle
  qui vient d'ailleurs ; une **saisie déjà commencée l'emporte**, sinon un rechargement
  ramènerait l'adresse que le client venait de corriger ; et l'**URL est nettoyée**
  (`history.replaceState`) dès les champs remplis, des noms et des adresses n'ayant rien à
  faire dans l'historique d'un appareil parfois partagé.
- **Le décodage est tolérant par champ, jamais par confiance.** Ce qui ne tiendrait pas la
  route côté serveur (adresse mal formée, nom d'une lettre, adresse en double) est écarté champ
  par champ plutôt que posé dans le formulaire ; un lien tronqué par une messagerie ouvre donc
  un formulaire **vierge**, pas un formulaire faux. La validation qui compte reste celle de
  `/api/profil-submit` — `parserSignataires` n'a pas bougé, et rien n'a été ajouté à sa
  confiance. `/preparer-profil` est **plus strict** que ce décodeur : une adresse douteuse doit
  être corrigée tant qu'elle est sous les yeux de celle qui la connaît.
- **Le nombre d'emprunteurs reste demandé.** Un lien préparé pour deux personnes
  **pré-sélectionne** la tuile et le dit à l'écran ; il ne franchit pas l'écran à la place du
  client. Une valeur préparée par la courtière n'est pas un nombre deviné par le formulaire.
- **`/preparer-profil` n'envoie rien et n'enregistre rien** : pas d'endpoint, pas de dossier,
  pas de courriel. La page ne construit qu'une URL dans le navigateur — ce qui est préparé
  n'existe que dans le lien, et le lien n'existe que quand elle le transmet.
- Le modèle contient déjà le nom de la courtière et son numéro AMF — ne rien y écrire.
- En dev sans Resend, tout s'exécute quand même (dossier compris) et les liens de signature sont
  imprimés dans la console : c'est la seule façon de dérouler la chaîne en local.

## Contrat de courtage hypothécaire

Stéphanie prépare le contrat dans un formulaire, le signe, et chaque emprunteur reçoit un
lien nominatif pour le lire et le signer. Aucune plateforme externe : la chaîne de signature
est celle déjà éprouvée par le « Profil des emprunteurs ».

Le PDF officiel n'est **jamais reconstruit** : on charge le modèle d'Hypotheca et on estampe
par-dessus (valeurs saisies, coches vectorielles, initiales, tracés de signature, dates).

| Fichier | Rôle |
|---------|------|
| `src/data/contratCourtageModele.ts` | Le modèle PDF vierge en base64 — **fichier généré**, ne pas éditer |
| `scripts/encode-modele.mjs` | Régénère le module : `node scripts/encode-modele.mjs <pdf> contrat` |
| `src/utils/contratCourtage.ts` | Catalogue des champs, coordonnées, validation |
| `src/services/contratPdfService.ts` | Estampage pdf-lib + empreintes SHA-256 |
| `src/services/contratDossierService.ts` | Dossiers en attente de signature (Netlify Blobs, jetons hachés) |
| `src/services/contratCourriels.ts` | Courriels + **trace de preuve** des signatures |
| `src/services/accesCourtiere.ts` | Mot de passe partagé + cookie signé de `/contrat` |
| `src/services/reglagesCourtiere.ts` | Signature mémorisée + valeurs par défaut du formulaire |
| `src/utils/detourageSignature.ts` + `src/scripts/importSignature.ts` | Import d'une signature photographiée : fond retiré, recadrage sur l'encre |
| `src/services/dossierStockage.ts` | Socle commun au profil et au contrat : stockage Blobs, jetons, purge |

**Règles :**
- **Rien n'est ajouté au PDF hors des champs du modèle.** La trace de preuve (horodatage
  serveur, IP, navigateur, empreintes) vit dans le courriel interne, jamais dans le document.
- **On ne signe pas ce qu'on n'a pas lu.** `/signer-contrat` affiche les 4 pages du contrat
  intégral (`/api/contrat-apercu`), pas un résumé. Le texte de `TEXTE_ATTESTATION` doit rester
  vrai de ce que l'écran montre — une attestation qui affirme plus que ce qui a été présenté
  ruinerait la preuve qu'elle constitue.
- **Le PDF *signé* ne sort que vers la courtière.** Les emprunteurs reçoivent un accusé sans
  pièce jointe, et c'est Stéphanie qui leur remet copie. L'aperçu avant signature, lui, est
  un droit : il est servi au signataire par son propre jeton, qui n'est pas consommé.
- **Un seul contrat, signé en séquence.** Le document ne se dédouble jamais : il passe d'un
  signataire au suivant, chacun le voyant porter les signatures déjà apposées. **Un seul jeton
  est vivant à la fois** — celui de la personne dont c'est le tour ; le suivant n'est émis
  qu'une fois le précédent consommé, ce qui rend l'ordre structurel plutôt que conventionnel.
- **Deux modes d'acheminement, un seul ordre.** À distance, chacun reçoit son lien par
  courriel quand son tour vient. En présentiel, le lien du signataire courant est rendu à
  l'écran de la courtière, qui tend l'appareil — le jeton ne transite alors par aucune boîte
  tierce. À distance, il ne redescend **jamais** au navigateur de celui qui vient de signer.
- **`ResumeDossier` ne porte ni jeton ni tracé.** C'est ce qui le rend transmissible au
  navigateur pour l'écran de suivi : un résumé qui embarquerait les tracés ferait redescendre
  au client la donnée la plus sensible du système, pour afficher une liste. Un test le vérifie.
- `reemettreLienCourant(id)` relit le dossier plutôt que de croire l'objet reçu : réémettre un
  lien sur un dossier gelé entre-temps par un refus serait exactement le cas où plus aucun
  lien ne doit vivre.
- **L'écran de suivi se charge seul, et s'ouvre seul quand elle est attendue.** Il est en
  tête de `/contrat`, avant le formulaire : un contrat prêt à finaliser passe avant un
  nouveau contrat. Tant qu'il fallait penser à déplier la section pour savoir s'il s'y
  passait quelque chose, un dossier pouvait y dormir des jours. Le compte replié suffit à
  le dire ; la section ne se déplie d'elle-même que si un dossier est à finaliser, refusé,
  ou sur le point d'expirer. Les cartes sont triées par urgence, pas par date.
- **Les écrans de fin de `/signer-contrat` ne sont pas des culs-de-sac.** La page n'a ni Nav
  ni pied de page : la confirmation et le lien périmé portent donc eux-mêmes les
  coordonnées de la courtière et la sortie vers l'accueil. Ce qu'annonce « la suite » doit
  rester vrai du système : le seul courriel qu'un emprunteur reçoit après avoir signé est
  celui du contrat complet, une fois la courtière passée — il n'y a pas d'accusé immédiat,
  et en promettre un ferait attendre pour rien. Pendant le relais en présentiel, ni
  coordonnées ni lien vers le site : l'appareil n'appartient pas au signataire.
- **Les cartes du suivi sont bâties en JavaScript, donc habillées par un bloc `is:global`**
  (circonscrit par `#ct-form` / `#ct-suivi`). Astro scope son `<style>` en estampant un
  attribut de portée sur les éléments qu'il rend lui-même : une règle scopée n'atteint
  jamais un élément créé par `document.createElement`, et la section s'affichait sans style.
- **La courtière signe en dernier.** Deux questions du contrat appartiennent à l'emprunteur
  — la PPV (« s'applique-t-elle à l'un des emprunteurs ? ») et le consentement au transfert
  de cabinet — et il confirme aussi ses coordonnées. Ces réponses arrivant après l'envoi,
  signer d'abord reviendrait à couvrir de sa signature des déclarations qu'elle n'a pas vues.
  Le dossier passe donc en `a_finaliser`, elle est prévenue, relit et signe d'un clic. **Le
  PDF n'existe qu'à ce moment-là.**
- **Agrégation des réponses** (`agregerPpv`, `agregerTransfert`) : le modèle n'a qu'une case
  pour tout le monde. Un seul « oui » suffit à cocher PPV ; un seul refus suffit à cocher
  « Non » au transfert — un consentement ne se déduit pas d'une majorité. Rien n'est coché
  tant que personne n'a répondu.
- Sa signature mémorisée est exigée **dès la création**, bien qu'elle ne serve qu'à la fin :
  la découvrir absente une fois tout le monde signé laisserait un dossier impossible à clore.
- Elle dessine son tracé **une seule fois** : il est
  mémorisé (`reglagesCourtiere`) et apposé automatiquement ensuite. La page n'envoie donc
  plus de signature à `/api/contrat-creer` — le serveur prend celle qui est enregistrée.
  Elle peut la **dessiner** ou **importer une photo** de sa signature manuscrite : le
  détourage mesure le niveau du papier sur l'image plutôt que de supposer du blanc, sans
  quoi une photo prise en pénombre ne donnerait rien.
- **Le tracé mémorisé est la donnée la plus sensible du site.** Il vit derrière la même porte
  que `/contrat` : qui a le mot de passe peut émettre un contrat signé de sa main.
- **`CLES_DEFAUTS` ne doit contenir que des champs du cabinet**, jamais un champ propre au
  client : une valeur mémorisée est reportée d'un dossier au suivant sans que personne ne le
  remarque. Un test verrouille cette règle.
- Les initiales ne sont estampées que pour les emprunteurs **ayant effectivement signé** :
  des initiales sans signature laisseraient croire qu'une clause a été acceptée.
- Les jetons de signature sont à usage unique, stockés hachés (SHA-256), comparés à temps
  constant, et expirent après 10 jours (plus court que le profil : les conditions bougent).
- Si un emprunteur refuse, le dossier est **gelé** : aucun PDF, tous les liens restants
  meurent, Stéphanie est prévenue. Mieux vaut un dossier gelé qu'une signature arrachée.
- Le dossier Blob est supprimé dès le PDF produit — les tracés ne restent pas au repos.
- `/contrat` et `/api/contrat-creer` appliquent **le même** verdict d'accès : une page
  protégée devant une API ouverte ne protège rien.
- Sans `CONTRAT_MOT_DE_PASSE` en production, la page se **ferme** (fail closed). En dev,
  elle reste ouverte pour pouvoir travailler en local.
- En dev sans Resend, tout s'exécute quand même (dossier compris) et les liens de signature
  sont imprimés dans la console.

## Réseau de partenaires

`/partenaires` est la porte **entrante** : un professionnel arrive de lui-même et réfère un
client. `/reseau` sert le mouvement inverse — Stéphanie qui approche un professionnel, un par
un, et qui se souvient de qui elle a relancé. Courtiers immobiliers, notaires, comptables,
planificateurs : les mêmes clés de profession que `/api/partenaires-submit`.

| Fichier | Rôle |
|---------|------|
| `src/utils/reseauCourtiers.ts` | Catalogues (professions, états, consentement), gabarits de courriel, rendu, validation |
| `src/services/reseauContactService.ts` | Le carnet : Netlify Blobs, historique, retrait |
| `src/services/reseauCourriels.ts` | Le courriel d'approche : gabarit visuel, pied de conformité LCAP, envoi Resend |
| `src/services/reseauGabaritsService.ts` | Les gabarits réécrits par la courtière, par couple (gabarit, profession) |
| `src/pages/reseau.astro` | L'écran : urgences du jour, carnet, fiche, composition |
| `src/middleware.ts` + `src/utils/origineRequete.ts` | La vérification d'origine (CSRF), et la seule route qui en est dispensée |

**Règles :**
- **Un contact retiré ne reçoit plus rien.** Vérifié au moment de l'envoi (`/api/reseau-envoi`),
  pas seulement à l'affichage — et un retrait ne se défait pas depuis l'écran : `changerEtat`
  refuse de rouvrir une fiche `refuse`. Un retrait est une volonté exprimée, pas une case
  qu'on décoche. Des tests verrouillent les deux.
- **Le lien de retrait est la seule route publique du réseau**, et il doit l'être : un
  désabonnement qui demande un mot de passe n'en est pas un. `GET` rend une page de
  confirmation, `POST` exécute — les aperçus automatiques des messageries visitent les liens
  des courriels, et un `GET` qui retirerait directement produirait des désabonnements que
  personne n'a demandés. Le traitement est idempotent, et la réponse ne dit jamais si
  l'adresse existe.
- **Trois émetteurs postent ce lien, et les trois doivent aboutir** : le bouton de la page
  (couple dans le corps *et* dans l'URL), le retrait en un clic d'un fournisseur de
  messagerie (RFC 8058 — corps `List-Unsubscribe=One-Click`, couple resté dans l'URL), et un
  client qui poste à vide. `lireDemande` cherche donc `c` et `j` **dans le corps puis dans la
  chaîne de requête** ; ne lire que le corps, comme avant, faisait échouer deux des trois en
  répondant « c'est fait ». Un retrait en un clic reçoit `OK` en texte, pas une page :
  personne n'est devant l'écran.
- **`security.checkOrigin` est désactivé, et réécrit à la main dans `src/middleware.ts`.**
  Astro refusait par 403 tout POST de formulaire sans en-tête `Origin` — c'est-à-dire
  exactement le retrait en un clic, que les serveurs du fournisseur exécutent sans
  navigateur. La règle d'Astro est reprise mot pour mot dans `src/utils/origineRequete.ts`
  (module pur, testé cas par cas) et **une seule route** en est dispensée. Y ajouter une
  route, c'est décider de la laisser sans protection CSRF ; un test verrouille la liste.
- **« C'est fait » doit être vrai.** La réponse reste la même dans tous les cas — dire « lien
  invalide » à qui vient de demander qu'on cesse de lui écrire est la pire réponse possible,
  et distinguer les cas ferait du lien un moyen de tester des identifiants. Mais cette
  promesse crée une dette : quand `retirerParJeton` ne retire personne (couple abîmé, fiche
  disparue, panne de stockage), `alerterRetraitNonEnregistre` prévient la courtière pour
  qu'elle retire la fiche à la main. Le jeton ne voyage pas dans l'alerte — seulement le fait
  qu'il était présent, ce qui suffit à trancher la cause. Sans ce rattrapage, un retrait perdu
  ne laissait de trace nulle part.
- **Le jeton de retrait est stocké en clair**, contrairement aux jetons de signature. Ce n'est
  pas un oubli : il doit rester **reproductible** (chaque courriel le porte à nouveau) et
  valide des mois durant. Un jeton haché ne pourrait pas être réécrit dans le message suivant,
  et en régénérer un à chaque envoi tuerait les liens des messages déjà partis — exactement ce
  que la loi interdit. Il n'autorise qu'à cesser de recevoir des courriels.
- **La source du consentement est obligatoire** à la création comme à l'import. C'est ce qui
  répond, un an plus tard, à « d'où vient mon adresse ». Facultative, elle ne serait jamais
  remplie.
- **Le pied de conformité part avec chaque message** : identité, organisation, adresse postale
  (`siteConfig.adresse`), téléphone, lien de retrait, plus les en-têtes `List-Unsubscribe` et
  `List-Unsubscribe-Post`. Un test le verrouille : ces mentions ne sont pas de la décoration
  qu'un remaniement du gabarit visuel peut emporter.
- **L'URL passe avant le `mailto:` dans `List-Unsubscribe`, et le retrait en un clic est
  déclaré.** Listé en premier, le `mailto:` amenait Gmail et Outlook à n'offrir qu'un courriel
  à écrire à la main : leur bouton « Se désabonner » ne déclenchait rien, et le retrait
  attendait que Stéphanie lise sa boîte. La crainte qui avait fait écarter
  `List-Unsubscribe-Post` — des aperçus automatiques produisant des désabonnements fantômes —
  est précisément ce contre quoi la RFC 8058 a été écrite : un antivirus **visite** le lien
  (`GET`, qui rend la page de confirmation et ne retire personne), il ne poste pas
  `List-Unsubscribe=One-Click`.
- **`RESEND_FROM_RESEAU` sépare l'envoi d'approche du reste** — mais elle n'est pas
  configurée aujourd'hui : un second domaine vérifié dans Resend suppose un forfait payant
  (décision d'août 2026). Les approches partent donc de `RESEND_FROM_EMAIL`, l'adresse des
  liens de signature et des accusés de rappel. Trois conséquences, liées entre elles :
  `PLAFOND_QUOTIDIEN` est **fixé bas (12)** parce que le volume est le seul garde-fou qui
  reste ; la page affiche l'adresse réellement employée en **constat, pas en alarme** — un
  avertissement qu'on ne peut pas suivre d'effet n'apprend qu'à ignorer les avertissements ;
  et le jour où un sous-domaine sera vérifié, renseigner la variable suffit (le plafond peut
  alors remonter).
- **Le courriel d'approche n'emprunte pas l'habillage du site.** `wrapEmailHtml` et
  `renderSignatureBlock` (fond sable, carte à bordure, liens couleur argile) conviennent à un
  accusé de réception — qui *est* un envoi automatique et gagne à en avoir l'air. Une approche
  est l'inverse : habillée en infolettre, elle est lue comme une infolettre, donc supprimée et
  parfois marquée comme pourriel. `reseauCourriels.ts` a donc son enveloppe nue et sa signature
  en texte simple, et un test interdit le retour du fond sable. Le contenu obligatoire (AMF,
  coordonnées, pied LCAP) est identique — seule la décoration tombe.
- **Les gabarits sont un point de départ, pas le texte final.** Le rendu vient du serveur
  (`GET /api/reseau-envoi`) pour que le catalogue n'existe qu'à un seul endroit, mais c'est le
  texte relu et retouché qui part — et c'est **lui** qui est journalisé, pas le modèle.
- **Les modèles eux-mêmes se réécrivent depuis l'écran**, sans déploiement : un texte
  d'approche vieillit, et le faire corriger par un `git push` condamne l'outil à ne jamais
  s'ajuster. Le catalogue de `reseauCourtiers.ts` reste la source des **modèles d'origine** ;
  `reseauGabaritsService` ne pose que des surcharges par-dessus, ce qui garde « revenir au
  modèle » possible. La portée d'une réécriture est le couple **(gabarit, profession)** — ce
  qu'elle a sous les yeux en écrivant ; un texte retouché pour un notaire n'a pas à partir
  ensuite à un comptable.
- **Un modèle est validé avant d'être enregistré** (`validerModele`), et pas seulement contre
  les variables inconnues. Une section mal fermée (`{{#agence}}` sans `{{/agence}}`) **ne lève
  pas** au rendu : elle survit telle quelle et part dans le courriel. D'où la double sonde —
  variables pleines puis vides — et le refus s'il reste la moindre accolade. `parserMessage`
  applique le même filet au message final, pour la saisie à la main.
- **Tout ce qui rend un courriel passe par `gabaritEffectif`**, jamais par `gabaritPour` :
  rendre depuis le catalogue enverrait un texte que l'écran d'édition ne montre pas.
- **L'historique ne se réécrit pas** : envois (avec le corps réellement expédié), notes,
  changements d'état, retrait. Le carnet n'expire pas et n'est jamais purgé — c'est un actif,
  pas un dossier de passage, d'où l'absence d'appel à `purgerExpires`.
- `versFiche()` retire le jeton de retrait avant que la fiche ne redescende au navigateur.
- Même porte que `/contrat` (`accesCourtiere`, `CONTRAT_MOT_DE_PASSE`) : c'est la même
  personne, et chaque endpoint applique le même verdict que la page.
- Les cartes du carnet sont bâties en JavaScript, donc habillées par un bloc `is:global`
  circonscrit par `#rs-app` — même raison que l'écran de suivi des contrats.
- En dev sans Resend, l'envoi est **simulé** : le message est imprimé dans la console et le
  journal dit « simulé », plutôt que d'affirmer un envoi qui n'a pas eu lieu.

## Dossiers clients et portail « Mon dossier »

Une demande de financement ouvre un dossier de suivi. Stéphanie le pilote depuis `/dossiers` ;
le client consulte le sien sur `/mon-dossier`, sans mot de passe. Le socle est celui déjà
éprouvé par le contrat et le réseau — `dossierStockage`, `accesCourtiere`, `emailService`.

| Fichier | Rôle |
|---------|------|
| `src/utils/dossiersClients.ts` | Catalogue : étapes, documents, semis de la checklist, whitelist de validation |
| `src/services/dossierClientService.ts` | Le carnet : Netlify Blobs, historique, lien magique, purge |
| `src/services/portailAcces.ts` | Session signée du client (`PORTAIL_SECRET`) |
| `src/services/dossierCourriels.ts` | Les deux courriels : lien d'accès, suivi |
| `src/pages/dossiers.astro` | L'écran de la courtière : urgences, liste, fiche |
| `src/pages/mon-dossier.astro` | Le portail du client : étape, frise, documents attendus |
| `src/utils/entreesProspect.ts` | Un adaptateur par formulaire — absorbe la divergence des vocabulaires |
| `src/services/ficheUnifiee.ts` | Le recoupement entre les carnets, par courriel |
| `src/utils/statistiquesDossiers.ts` | Les chiffres : rendement par origine, entonnoir, durées |

**Règles :**
- **Le CRM porte le suivi, pas le dossier de crédit.** `CHAMPS_CONSERVES` énumère limitativement
  ce qu'un dossier retient d'une demande. Ni date de naissance, ni revenus, ni évaluation de
  crédit, ni faillite, ni mise de fonds : ces champs continuent de ne vivre que dans le courriel
  interne que `/api/demande-submit` envoie déjà. Le registre officiel du dossier est celui
  d'Hypotheca ; ceci est un outil de suivi. **Un test verrouille la liste** — y ajouter un champ
  sensible « juste pour l'afficher » est la façon dont un outil de suivi devient une base de
  données nominative.
- **Le site ne reçoit aucun document.** Le portail *liste* ce qui manque et dit comment
  l'envoyer ; le client transmet ses pièces par ses moyens et c'est Stéphanie qui coche. Aucune
  route d'écriture n'est ouverte au client : il lit sa liste, il ne la coche pas — un client qui
  se déclare à jour ne l'est pas.
- **Un dossier perdu ne l'annonce pas au client.** `versVueClient` rend `null` pour une étape
  non destinée au client, et le portail affiche alors un écran neutre. La règle est structurelle :
  la page ne peut pas montrer ce qu'elle n'a pas reçu. `/api/crm-prevenir` refuse de même.
- **`versVueClient` est la frontière** — comme `ResumeDossier` (contrat) et `versFiche` (réseau).
  Ni notes internes, ni jeton, ni relance, ni historique. Les pièces `non_requis` en sont écartées :
  une pièce jugée inutile n'ajouterait que du doute à la liste de celui qui doit la réunir. Un
  test le vérifie.
- **`PORTAIL_SECRET`, jamais `CONTRAT_MOT_DE_PASSE`.** Dériver la session d'un client du mot de
  passe administratif ferait tomber tous les portails à chaque rotation, et ferait d'un secret
  client la fonction d'un secret à elle. L'identifiant du dossier entre dans la signature au même
  titre que l'expiration — sans quoi un cookie valide laisserait ouvrir le dossier d'un autre.
  Absente en production, le portail se **ferme** (fail closed) et `/dossiers` le signale là où
  elle peut encore renoncer à envoyer.
- **Le lien magique est à usage unique, valable 30 minutes**, stocké haché, comparé à temps
  constant. Consommé côté serveur, la page **redirige vers l'URL nue** : le jeton ne doit rester
  ni dans la barre d'adresse, ni dans l'historique, ni dans le `Referer`. La session qui suit
  dure 7 jours (`SameSite=Lax`, et non `Strict` : le client arrive par un lien cliqué dans son
  courriel, qu'un cookie `Strict` ne suivrait pas).
- **`/api/dossier-acces` répond la même chose dans tous les cas** — adresse inconnue, plafond
  atteint, panne d'envoi. Une réponse qui varie ferait de la route un oracle confirmant, adresse
  par adresse, qui est client de Stéphanie. `POST` seulement (un `GET` serait déclenché par les
  aperçus des messageries), et débit plafonné par IP **et** par adresse.
- **Le courriel du lien ne dit rien du dossier** — ni étape, ni documents, ni même s'il en existe
  un : un courriel de connexion qui résume le dossier le divulgue à qui contrôle la boîte, avant
  même que le lien ne soit cliqué. Seul le courriel de suivi le décrit, et il ne part que sur
  geste de la courtière.
- **« Prévenir le client » est un bouton, jamais un automatisme.** Un courriel par case cochée
  serait du bruit, et le bruit finit par être filtré — avec, dans le même dossier d'indésirables,
  le seul message qui comptait.
- **Chaque document porte sa raison d'être** (`pourquoi`). Une liste de pièces sans raison est
  une corvée ; la même liste avec sa raison est une démarche.
- **L'ouverture du dossier ne peut jamais faire échouer `/api/demande-submit`.** Elle a lieu
  **avant** l'envoi — si Resend échoue, le prospect survit à la panne au lieu de partir en fumée —
  et dans un `try/catch` qui journalise et poursuit. Le courriel reste la garantie, le dossier est
  un confort. Une nouvelle tentative ne produit pas de doublon : `creerDossier` dédoublonne sur
  l'adresse. Un test verrouille les deux.
- **Le carnet se purge**, contrairement à celui du réseau : douze mois après la clôture, un
  dossier est supprimé. Un contact professionnel est un actif ; un dossier client est nominatif
  et financier.
- **L'historique ne se réécrit pas** : étapes, documents, notes, courriels, ouvertures du portail.
- Les cartes de `/dossiers` sont bâties en JavaScript, donc habillées par un bloc `is:global`
  circonscrit par `#dc-app` — même raison que `#rs-app` et `#ct-suivi`.
- L'état du dossier sur `/mon-dossier` est rendu par le serveur et se lit **sans JavaScript** ;
  le seul script de la page sert au formulaire de demande de lien.
- En dev sans Resend, tout s'exécute quand même et les liens d'accès sont imprimés dans la
  console — même convention que les liens de signature.

**Les dix portes d'entrée :**
- **Les dix formulaires du site alimentent le carnet**, chacun par son adaptateur dans
  `entreesProspect.ts` — c'est là, et nulle part ailleurs, qu'est absorbée la divergence des
  vocabulaires (`courriel` ou `email`, `telephone` ou `cellulaire`, un champ de nom ou deux).
- **`ETAPE_INITIALE` dit quelle porte ouvre quoi.** `/demande` et la saisie manuelle ouvrent un
  **dossier** ; les huit autres ouvrent un **prospect**. Quarante-cinq champs remplis et un
  consentement à l'enquête de crédit ne sont pas un nom laissé au bas d'un calculateur.
- **L'étape `prospect` n'est pas visible du client et ne sème aucune checklist.** La liste ne
  s'établit qu'à la qualification, et ne s'écrase jamais si elle a déjà été travaillée à la main.
- **`CONSENTEMENT_PAR_ORIGINE` inscrit sur quoi repose le droit de rappeler**, et la fiche
  l'affiche. `calculateur` vaut `service_demande` : **ce formulaire n'a aucune case à cocher**,
  la personne a demandé un rapport. Une liste où tout le monde a « accepté d'être contacté » ne
  vaut rien le jour où il faut le prouver.
- **Aucun chiffre déclaré ne franchit la porte.** Ni dans le profil, que `CHAMPS_CONSERVES`
  filtre, ni dans les notes, écrites par les adaptateurs. La ligne est volontairement franche —
  pas de montants du tout : une frontière qui demande de juger au cas par cas ce qui est « assez
  financier » s'érode au troisième formulaire ajouté. Un test le verrouille porte par porte.
- **Le courriel est facultatif**, à condition qu'un téléphone permette de joindre la personne —
  une référence de partenaire n'arrive qu'avec un numéro. Le dédoublonnage bascule alors sur le
  numéro normalisé. Une adresse fournie qui ne correspond à rien tranche, plutôt que d'aller
  chercher par téléphone et de rattacher deux conjoints partageant une ligne. Sans adresse, le
  portail reste fermé, et la fiche le dit.
- **`/partenaires` alimente les deux carnets** : le professionnel au réseau, le client référé au
  CRM, le second pointant sur le premier par `refereParId`. Un professionnel qui n'a laissé qu'un
  numéro n'est pas inscrit au réseau — ce carnet sert à écrire des courriels.

**Le recoupement entre carnets (`ficheUnifiee`) :**
- **On unifie à la lecture, pas au stockage.** Les dossiers de signature sont éphémères (10 et
  14 jours, supprimés dès le PDF produit) ; en faire les enfants d'une fiche permanente
  obligerait à les garder plus longtemps ou à vivre avec des références mortes.
- **Les lectures sont séquentielles, jamais un `Promise.all`.** Chaque service charge Netlify
  Blobs à la demande et **retient** le résultat ; trois chargements concurrents suffisent à ce
  que l'un échoue et bascule silencieusement ce carnet sur son repli mémoire — vide,
  définitivement, pour la durée de vie de la fonction.
- **Résolution paresseuse** : à l'ouverture d'une fiche, jamais au chargement d'une liste.
- Les profils d'emprunteurs sont exclus : les lister ferait relire tous les blobs pour un objet
  qui vit deux semaines.

**Les chiffres (`statistiquesDossiers`) :**
- Module **pur**, calculé dans le navigateur sur la liste déjà chargée — aucune requête de plus.
- **Les clés, jamais les phrases** : les durées se lisent dans `de`/`vers`. Les événements
  antérieurs à ces champs sont **ignorés**, pas devinés.
- **Une fiche encore à l'étape ne compte pas dans sa durée** : l'inclure raccourcirait la médiane
  à mesure que la file s'allonge — l'écran dirait « ça va de plus en plus vite » quand ça bloque.
- **`donneesSuffisantes` autorise l'écran à se taire.** Un taux tiré de moins de quinze fiches
  raconte le hasard, et affiché sans réserve il servira quand même à décider.

## Tableau de bord

`/tableau-de-bord` est le cockpit de la courtière : une porte d'entrée aux écrans privés, qui
n'existaient dans aucun menu et n'étaient reliés par aucun lien. Il répond d'abord à « qu'est-ce
qui presse aujourd'hui, tous carnets confondus », puis donne accès aux outils. Même porte que
`/contrat`, `/reseau`, `/dossiers` (`accesCourtiere`, `CONTRAT_MOT_DE_PASSE`) : une session ouvre
les cinq.

| Fichier | Rôle |
|---------|------|
| `src/pages/tableau-de-bord.astro` | L'écran : en-tête daté, « À faire aujourd'hui », tuiles d'outils |
| `src/utils/tableauDeBord.ts` | Module **pur** : fusionne les urgences des trois carnets en une liste triée |
| `src/utils/tableauDeBord.test.ts` | Verrous : contact retiré exclu, tri indifférent au carnet, dossier clos absent, carnet muet toléré |
| `src/components/BarreCourtiere.astro` | La navigation entre les écrans privés |
| `src/components/ConnexionCourtiere.astro` | L'écran de connexion partagé |

**Règles :**
- **La règle d'urgence n'a qu'un exemplaire par carnet.** Celle des dossiers vit dans
  `dossiersEcran.ts` (le cockpit l'**appelle**, ne la réécrit pas) ; celles du réseau et des
  contrats ont migré depuis les scripts de `reseau.astro` et `contrat.astro` vers
  `tableauDeBord.ts`, que les deux pages consomment désormais. `phraseUrgence` (dossiers) est
  passée dans `dossiersEcran.ts` pour la même raison : deux écrans la rédigent, la laisser dans
  une page les ferait diverger.
- **Les trois `GET` partent en séquence, jamais en `Promise.all`.** Le SSR d'Astro sur Netlify
  est une seule fonction ; trois lectures Blobs concurrentes peuvent courir la mémoïsation
  paresseuse et basculer un carnet sur son repli mémoire vide — la panne déjà documentée pour
  `ficheUnifiee`.
- **Un carnet muet n'efface pas les autres.** Chaque appel dans son `try/catch` ; les carnets
  qui ont répondu s'affichent, une ligne nomme celui qui manque. Un 401 recharge la page — c'est
  le SSR qui rend l'écran de connexion.
- **Le cockpit n'écrit rien.** Il indique et il ouvre ; l'écran spécialisé garde la main sur son
  carnet. Les chiffres restent sur `/dossiers`, qui en a le contexte.
- **Liens profonds :** `/dossiers#f=<id>` et `/reseau#f=<id>` ouvrent la fiche nommée après le
  chargement (via l'`ouvrirFiche` déjà présent) ; `/contrat#ct-suivi` déplie la section de suivi.
- Les cartes de tâches sont bâties en JavaScript, donc habillées par un bloc `is:global`
  circonscrit par `#tb-app` — même raison que `#rs-app`, `#dc-app` et `#ct-suivi`.

## Configuration

### `src/config/siteConfig.json`
Toutes les coordonnées de la courtière — modifié directement par la cliente. Garder le JSON simple, pas de logique.
```json
{
  "nom": "Stéphanie Weyman",
  "titre": "Courtière hypothécaire",
  "organisation": "Hypotheca",
  "amf": "255885",
  "telephone": "514-949-7627",
  "courriel": "sweyman@hypotheca.ca",
  "site_url": "https://stephanieweyman.ca",
  "calendly_url": "https://outlook.office.com/book/rdv-StephanieWeyman@hypotheca.ca/",
  "google_place_id": "ChIJnde-9JoJSgYR6DgI66_nUl4"
}
```

`src/config/index.ts` exporte l'interface `SiteConfig` (strict TypeScript) et `loadSiteConfig()`.

## Tests

```bash
npx vitest run          # tests unitaires one-shot
npx vitest              # mode watch
```

- `src/lib/penalite.test.ts` — 35+ cas sur la logique de pénalité (3 mois, IRD, cas limites)
- `src/services/emailService.test.ts` — un 429 est réessayé (`Retry-After` respecté et
  plafonné), un 422 ne l'est pas, et l'abandon nomme le statut
- `src/utils/profilPreparation.test.ts` — aller-retour du lien préparé (accents compris), champs
  écartés un à un plutôt que crus, adresse en double non préremplie, paramètre abîmé → lien vierge
- `src/utils/contratCourtage.test.ts` — géométrie du modèle PDF + whitelist de validation
- `src/services/contratPdfService.test.ts` — estampage : 4 pages au bon format, caractères
  hors WinAnsi, champs trop longs tronqués plutôt que débordants
- `src/services/contratDossierService.test.ts` — jetons à usage unique, expiration, gel sur refus
- `src/services/accesCourtiere.test.ts` — porte de `/contrat` (fail closed, rotation du secret)
- `src/utils/reseauCourtiers.test.ts` — gabarits rendus sans variable orpheline, whitelists
- `src/services/reseauContactService.test.ts` — retrait définitif et idempotent, historique,
  jeton absent des fiches transmises
- `src/services/reseauCourriels.test.ts` — mentions obligatoires (LCAP), expéditeur dédié,
  en-têtes de désabonnement (URL avant le `mailto:`, retrait en un clic déclaré)
- `src/services/reseauRetraitRoute.test.ts` — les trois façons dont un retrait arrive
  aboutissent ; un `GET` ne retire personne ; la page ne dit jamais qu'un jeton est faux ; un
  retrait qui échoue prévient la courtière
- `src/utils/origineRequete.test.ts` — la vérification d'origine réécrite est identique à
  celle d'Astro, et la dispense ne couvre que `/api/reseau-retrait`
- `src/services/reseauGabaritsService.test.ts` — réécriture des gabarits : portée par
  profession, original récupérable, refus des modèles qui ne se rendent pas
- `src/utils/dossiersClients.test.ts` — semis de la checklist selon le statut d'emploi, verrou
  de `CHAMPS_CONSERVES`, étape `perdu` hors de la progression
- `src/services/dossierClientService.test.ts` — frontière de `versVueClient`, lien magique à
  usage unique, purge des dossiers clos
- `src/services/portailAcces.test.ts` — session signée, identifiant lié à la signature, fail
  closed en production
- `src/services/profilSubmitRoute.test.ts` — l'invitation part avant l'avis interne et jamais
  de front ; un envoi manqué est nommé au client et à la courtière sans coûter la soumission ;
  l'erreur ne remonte que si plus rien n'est parti
- `src/services/demandeSubmitRoute.test.ts` — une demande ouvre un dossier ; une panne de
  stockage ne coûte pas la soumission
- `src/utils/entreesProspect.test.ts` — verrou anti-fuite porte par porte, mappage des champs
  divergents, fiche sans courriel
- `src/services/entreesRoutes.test.ts` — les dix portes ouvrent la bonne fiche ; aucune panne de
  stockage ne coûte une soumission ; `/partenaires` alimente les deux carnets
- `src/services/ficheUnifiee.test.ts` — recoupement par courriel, référent nommé même sans
  adresse, ni jeton ni note interne transmis
- `src/utils/statistiquesDossiers.test.ts` — durées ignorées faute de clés, fiche encore à
  l'étape exclue de la médiane, rendement par origine
- Date de référence fixe dans les tests : 2026-05-14

## Conventions

- Déclarer explicitement `export const prerender` sur **chaque** page : `false` pour le SSR
  (données à l'exécution), `true` pour le statique. Ne jamais se fier au défaut.
- Noms de fichiers en anglais, textes en français (fr-CA).
- **Ne pas affaiblir la CSP** sans raison — `unsafe-inline` présent uniquement pour JSON-LD.
- **Jamais de taux fictifs en fallback** — afficher `null` + lien hypotheca.ca si aucun cache valide.
- Ne pas commiter `.cache/` (cache local dev, dans `.gitignore`).
- Validation TypeScript stricte : résoudre les erreurs `npm run check` avant de pusher.

## Sécurité (netlify.toml)

Headers sur toutes les routes (`/*`) :
- `Content-Security-Policy` — stricte, `unsafe-inline` limité à ce qui est nécessaire
- `Strict-Transport-Security` — HSTS 1 an, includeSubDomains
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

Redirects configurés :
- `/outils/penalite` → `/outils/calculateur-penalite-hypothecaire` (301)
- Redirects de hash legacy (`#simulateur`, `#calculateur`, `#comparateur`)

## Déploiement

Push sur `main` → Netlify build automatique.

**Variables d'environnement Netlify :**
| Variable | Requis | Description |
|----------|--------|-------------|
| `GOOGLE_PLACES_API_KEY` | Oui (avis) | Clé API Google Places (New) |
| `RESEND_API_KEY` | Oui (formulaires) | Clé API Resend — partagée par tous les formulaires (`/api/*-submit`) |
| `RESEND_FROM_EMAIL` | Oui (formulaires) | Adresse d'expéditeur vérifiée dans Resend, partagée par tous les formulaires |
| `RESEND_NOTIFY_EMAIL` | Oui (formulaires) | Adresse interne qui reçoit les notifications (boîte de la courtière) |
| `CONTRAT_MOT_DE_PASSE` | Oui (`/contrat`) | Mot de passe partagé du générateur de contrats — 12 caractères minimum. **Absent en production = page fermée.** |
| `PORTAIL_SECRET` | Oui (`/mon-dossier`) | Clé de signature des sessions du portail client — 32 caractères minimum, distincte du mot de passe de la courtière. **Absente en production = portail fermé.** |
| `RESEND_FROM_RESEAU` | Non — **non configurée** | Adresse d'expéditeur dédiée aux approches du réseau, sur un sous-domaine vérifié séparément dans Resend (`stephanie@partenaires.stephanieweyman.ca` si on y vient un jour). Laissée vide : un second domaine dans Resend suppose un forfait payant. Absente **ou mal formée** = repli sur `RESEND_FROM_EMAIL`, signalé en console et affiché sur `/reseau` |
| `ENABLE_RATES_PROXY=1` | Non | Active le proxy r.jina.ai comme fallback de scraping |
| `DEBUG_RATES=1` | Non | Logs détaillés du scraping des taux |

`netlify.toml` configure `included_files` pour embarquer `src/services/`, `src/utils/`, `src/config/` dans les fonctions SSR.
