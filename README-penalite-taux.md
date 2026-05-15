# Maintenance des taux courants du marché — Calculateur de pénalité IRD

Ce document explique comment les taux du marché sont chargés dans le calculateur
de pénalité hypothécaire et comment les maintenir à jour.

## Source des données

Les taux sont chargés depuis **Hypotheca** via le service `src/services/ratesService.ts`.
Ce service scrape la page [hypotheca.ca/taux](https://hypotheca.ca/taux/) et retourne
les taux suivants (entre autres) :

| Champ            | Description                    | Utilisé pour       |
|------------------|--------------------------------|--------------------|
| `fixe_5ans`      | Taux fixe 5 ans                | Terme 5 ans (60 mois) |
| `fixe_3ans`      | Taux fixe 3 ans                | Terme 3 ans (36 mois) |
| `fixe_1an`       | Taux fixe 1 an                 | Terme 1 an (12 mois)  |
| `variable`       | Taux variable                  | Non utilisé directement |

Les taux pour les autres termes (6 mois, 2 ans, 4 ans) sont interpolés à partir
de ces trois valeurs de référence.

## Mécanisme de cache

- **Développement local** (`npm run dev`) : cache dans `.cache/` (fichier local)
- **Production** (Netlify) : Netlify Blobs, TTL de 6 heures
- La page SSR (`s-maxage=21600`) est servie par le CDN avec un TTL de 6 heures

## Où les taux sont-ils utilisés ?

Dans `src/pages/outils/calculateur-penalite-hypothecaire.astro`, les taux Hypotheca
pré-remplissent les champs du formulaire. L'utilisateur peut les modifier manuellement.

Les valeurs par défaut (fallback si le scrape échoue) sont :

```typescript
const taux5ans = hypothecaRates?.fixe_5ans ?? 4.89;
const taux3ans = hypothecaRates?.fixe_3ans ?? 4.69;
const taux1an  = hypothecaRates?.fixe_1an  ?? 5.49;
```

## Fréquence de mise à jour recommandée

- **Automatique** : le scrape Hypotheca s'exécute à chaque requête SSR (toutes les
  6 heures via le cache Netlify). Aucune action nécessaire.
- **Valeurs de fallback** : à vérifier **une fois par trimestre** pour s'assurer
  qu'elles restent dans une fourchette réaliste (± 1 % du marché).

## Procédure de mise à jour manuelle des fallbacks

1. Ouvrir `src/pages/outils/calculateur-penalite-hypothecaire.astro`
2. Modifier les constantes `taux5ans`, `taux3ans`, `taux1an` dans le frontmatter
3. Commiter et pousser sur `main` → Netlify rebuild automatique

## Débogage

Si les taux ne se chargent pas correctement :
- Activer `DEBUG_RATES=1` dans les variables d'environnement Netlify
- Vérifier les logs dans le dashboard Netlify (Functions → rates)
- Le fallback proxy r.jina.ai peut être activé avec `ENABLE_RATES_PROXY=1`

## Fichiers concernés

| Fichier                                           | Rôle                                    |
|---------------------------------------------------|-----------------------------------------|
| `src/services/ratesService.ts`                    | Scraping + cache des taux Hypotheca     |
| `src/pages/outils/calculateur-penalite-hypothecaire.astro` | Page du calculateur (consomme les taux) |
| `src/utils/hypothecaDecoder.ts`                   | Décode les taux obfusqués               |
| `netlify.toml`                                    | Config Netlify Blobs + fonctions        |
