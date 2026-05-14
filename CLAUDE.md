# Stephanie Weyman — Site courtière hypothécaire

Site Astro 6 hybride (SSR + statique) déployé sur Netlify. Page d'accueil rendue côté serveur pour afficher les taux hypothécaires en temps réel scrapés depuis hypotheca.ca.

## Stack
- **Astro 6** avec adapter `@astrojs/netlify` (SSR)
- **TypeScript** strict
- **Netlify Blobs** pour cache des taux en production
- Pas de framework UI (composants `.astro` natifs), pas de Tailwind — CSS dans `src/styles/global.css`
- Langue : français (fr-CA)

## Commandes
- `npm run dev` — serveur dev sur http://localhost:4321 (cache taux dans `.cache/`)
- `npm run build` — build production dans `dist/`
- `npm run preview` — preview du build
- `npm run check` — type-check Astro/TS
- `netlify dev` — émule l'environnement Netlify (Blobs) sur http://localhost:8888

## Architecture des taux (critique)
Flux : `hypotheca.ca` → `src/services/ratesService.ts` → Netlify Blob (store `rates`, TTL 6h) → `src/pages/index.astro` (SSR) → CDN (`s-maxage=21600, stale-while-revalidate=3600`).

Règles importantes :
- **Jamais de faux taux en fallback.** Si fetch échoue et qu'aucun cache stale < 30 jours n'existe, retourner `null` et afficher un lien vers hypotheca.ca.
- Le scraping parse trois formats en cascade : `<tr>` HTML visible → `occ(...)` obfusqué (voir `src/utils/hypothecaDecoder.ts`) → markdown (proxy r.jina.ai).
- Le proxy r.jina.ai est désactivé par défaut (`ENABLE_RATES_PROXY=1` pour l'activer).
- Validation des taux : entre 0.5 % et 20 %.

## Fichiers clés
- `src/config/siteConfig.json` — toutes les coordonnées (téléphone, courriel, AMF, URLs). Modifié par la cliente, garder le JSON simple.
- `src/config/index.ts` — type `SiteConfig` strict, `loadSiteConfig()`.
- `src/services/ratesService.ts` — fetch + cache (Blobs/fichier) + parsing.

- `src/layouts/MainLayout.astro` — wrapper SEO + head global.
- `netlify.toml` — headers de sécurité (CSP stricte, HSTS, X-Frame-Options) et `included_files` pour les fonctions SSR.

## Pages
- `/` — SSR (taux live)
- `/outils` — SSR (taux live) ; regroupe Simulator, Calculator et Comparateur dans un système d'onglets (hash : `#simulateur`, `#calculateur`, `#comparateur`).
- `/services/*` — pages statiques par type de clientèle

- `/amortissement`, `/conditions`, `/confidentialite`, `/404` — statiques
- `/api/bdc-rate` — endpoint

## Conventions
- `export const prerender = true` pour forcer le statique sur une page (par défaut : SSR via adapter Netlify).
- Composants en français (noms de fichiers anglais, textes français).
- Cookies/headers de sécurité ne pas affaiblir sans raison (CSP stricte en place).
- Ne pas commiter `.cache/` (cache local dev).

## Déploiement
Push sur `main` → Netlify build automatique. Variables d'env à configurer dans Netlify :
- `ENABLE_RATES_PROXY=1` (optionnel, fallback proxy)
- `DEBUG_RATES=1` (optionnel, logs détaillés)
