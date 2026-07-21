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

`export const prerender = true` force le statique sur une page (par défaut SSR via adapter Netlify).

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
Scrape les taux depuis hypotheca.ca, cache 6h via Netlify Blobs (fichier en dev).

**Flux :** `hypotheca.ca` → parse HTML → Netlify Blob (store `rates`, TTL 6h) → pages SSR → CDN (`s-maxage=21600, stale-while-revalidate=3600`)

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
  - `taux_reel` — Prêteurs virtuels  (MCAP, First National…) : IRD basé sur taux réel
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
- Date de référence fixe dans les tests : 2026-05-14

## Conventions

- `export const prerender = true` pour forcer le statique sur une page.
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
| `ENABLE_RATES_PROXY=1` | Non | Active le proxy r.jina.ai comme fallback de scraping |
| `DEBUG_RATES=1` | Non | Logs détaillés du scraping des taux |

`netlify.toml` configure `included_files` pour embarquer `src/services/`, `src/utils/`, `src/config/` dans les fonctions SSR.
