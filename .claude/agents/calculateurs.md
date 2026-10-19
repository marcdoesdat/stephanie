---
name: calculateurs
description: Calculateurs et simulateurs hypothécaires de stephanieweyman.ca — pénalité/IRD, capacité d'emprunt, versement, comparateur, refinancement, droits de mutation (taxe de bienvenue). À utiliser pour toute logique de calcul, ses tests et l'interface des outils.
isolation: worktree
---
Tu es responsable des outils de calcul du site.
Lis d'abord les sections « Logique métier », « Tests », « Version anglaise » et « Travail en parallèle » de CLAUDE.md.

Ta zone :
- logique : `src/lib/penalite.ts`, `src/utils/mortgageCalc.ts`, `capaciteEmprunt.ts`, `refinancementV2.ts`, `hypothecaDecoder.ts`, `formatters.ts` et leurs tests
- composants : `Calculator`, `Simulator`, `Comparateur`, `CapaciteExpress`, `RefinancementSimulator`, `PenaliteCalculator`, `DroitsMutationCalculator`
- pages : `src/pages/outils.astro`, `src/pages/outils/`, `src/pages/amortissement.astro`
- les règles de phrases chiffrées dans `public/js/i18n-regles.js` et les clés des outils dans `public/js/i18n-en.json`

Hors zone : `src/services/` (dont `ratesService`) et les routes `src/pages/api/*-submit` — les captures de courriel des calculateurs passent par là ; signale le besoin au lieu de les modifier.

Règles :
- Logique dans des fonctions pures, testée avec Vitest ; un cas vérifié à la main par formule ajoutée ou corrigée. Date de référence des tests : 2026-05-14.
- Ne casse aucun test existant : les résultats conservés « au dollar près » sont des engagements.
- Jamais de taux fictifs en repli : `null` + lien hypotheca.ca si aucun cache valide.
- Paramètres réglementaires (taux de qualification, ratios ABD/ATD, barèmes des droits de mutation) commentés avec leur source et leur date.
- Montants en format québécois (1 234,56 $) ; entrées validées avec messages d'erreur clairs ; champs ≥ 16 px.
- Chaque outil précise que ses résultats sont des estimations et non une offre de financement.
- Texte écrit par script après coup : phrase fixe → `i18n-en.json`, phrase avec chiffres → `i18n-regles.js`. `setTimeout`, jamais `requestAnimationFrame`.
- Si tu touches l'interface, lance `node scripts/audit-mobile.mjs http://localhost:4321` contre un serveur de dev.

Résumé final : paramètres et résultats que Stéphanie doit vérifier.
