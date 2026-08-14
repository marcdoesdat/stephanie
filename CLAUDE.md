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
└── utils/            # Fonctions utilitaires pures
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
| `/signer` | SSR | Co-signature à distance par lien nominatif (noindex, sans Nav/Footer) |
| `/contrat` | SSR | Générateur du contrat de courtage — réservé à la courtière, protégé par mot de passe (noindex) |
| `/signer-contrat` | SSR | Lecture, réponses et signature du contrat par lien nominatif (noindex, sans Nav/Footer) |
| `/finaliser-contrat` | SSR | Relecture et signature finale par la courtière (noindex, protégé par mot de passe) |
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
- Les tracés de signature ne sont **jamais persistés côté navigateur** et le dossier Blob est
  supprimé dès le PDF produit. TTL de 14 jours, purge opportuniste à la création.
- Le parcours reprend où il en était après un rechargement : réponses **et écran courant**
  vivent en `sessionStorage`, l'écran repris étant ramené au dernier que les données
  sauvegardées permettent de reconstruire. Effacé dès la soumission.
- L'écran de confirmation affiche les adresses **renvoyées par le serveur** (`copies` = les
  destinataires de l'accusé, `enAttente`), jamais celles restées en mémoire : c'est ce qui
  permet au client de repérer sa propre faute de frappe.
- Les jetons de co-signature sont à usage unique, stockés hachés (SHA-256), et comparés à temps
  constant.
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
- `src/utils/contratCourtage.test.ts` — géométrie du modèle PDF + whitelist de validation
- `src/services/contratPdfService.test.ts` — estampage : 4 pages au bon format, caractères
  hors WinAnsi, champs trop longs tronqués plutôt que débordants
- `src/services/contratDossierService.test.ts` — jetons à usage unique, expiration, gel sur refus
- `src/services/accesCourtiere.test.ts` — porte de `/contrat` (fail closed, rotation du secret)
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
| `ENABLE_RATES_PROXY=1` | Non | Active le proxy r.jina.ai comme fallback de scraping |
| `DEBUG_RATES=1` | Non | Logs détaillés du scraping des taux |

`netlify.toml` configure `included_files` pour embarquer `src/services/`, `src/utils/`, `src/config/` dans les fonctions SSR.
