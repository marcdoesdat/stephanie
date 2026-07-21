# Audit complet du site — stephanieweyman.ca

**Date :** juillet 2026 · **Objectif :** maximiser la conversion (prise de contact / rendez-vous) pour une courtière hypothécaire.

---

## 1. Vue d'ensemble — ce qui est déjà très bon

Le site est nettement au-dessus de la moyenne des sites de courtiers. Points forts à préserver :

- **Quiz de qualification multi-étapes** (Contact.astro) avec persistance sessionStorage, phrases de valeur dynamiques selon les réponses, échappatoire « message libre », pré-sélection du parcours via `?parcours=` depuis les pages services. C'est du niveau d'un funnel professionnel.
- **Outils interactifs comme aimants à leads** (6 calculateurs, capture courriel sur calculateur/pénalité) + état « converti » du sticky CTA mobile.
- **Taux en temps réel** avec règle stricte « jamais de faux taux » — crédibilité forte.
- **Avis Google dynamiques** avec fallback, AggregateRating conditionnel (émis seulement si avis live) — conforme aux guidelines.
- **Pages services segmentées** (premier achat, renouvellement, refinancement, travailleur autonome, dossier refusé, nouveaux arrivants) avec structure PAS (problème-agitation-solution) et FAQPage schema.
- **Pages villes** (Repentigny, Terrebonne, Mascouche) avec LocalBusiness + Person + FAQ schema et le composant Contact embarqué.
- **Infrastructure sérieuse** : CSP stricte, HSTS, honeypots anti-spam, Resend transactionnel, llms.txt, sitemap filtré, critical CSS inline, tests unitaires sur la logique de pénalité.

L'audit ci-dessous est donc surtout une affaire d'optimisation, pas de refonte.

---

## 2. Conversion — constats et recommandations (par priorité)

### 2.1 🔴 Hero : un seul CTA, et il pointe vers les outils

`Hero.astro` n'offre qu'un bouton : « Calcule ta capacité d'emprunt — gratuit » → `/outils#simulateur`. Le visiteur **chaud** (offre d'achat acceptée, renouvellement dans 3 semaines, refus bancaire) n'a aucun chemin direct vers un appel depuis le hero — il doit trouver le petit CTA du nav (masqué dans le hamburger sous 1180 px) ou scroller jusqu'en bas.

**Recommandation :** deux CTA hiérarchisés dans le hero :
- Primaire : « Réserver un appel de 15 min » (lien booking) — pour les chauds.
- Secondaire (style outline) : « Calculer ma capacité d'emprunt » — pour les tièdes.

C'est le changement au meilleur ratio impact/effort du site. À A/B tester si possible, mais la littérature CRO est claire : le segment le plus proche de la transaction doit avoir le chemin le plus court.

### 2.2 🔴 Incohérence tu/vous à travers le site

- Hero : « Je magasine … à **ta** place », « quand **t'es** prêt » (tu)
- Quiz de contact (même page) : « Quel est **votre** projet ? » (vous)
- Titre de la section contact : « Parlons de **ton** projet » (tu) … suivi de champs en vous
- Services, FAQ (mélangée : « dessers-tu » vs réponses en vous), pages services : vous
- Page ville Mascouche : « On jase de **ton** projet → » (tu)

Pour un service financier où la confiance est le facteur n°1, cette oscillation se remarque et affaiblit le professionnalisme perçu. **Choisir un registre et l'appliquer partout.** Recommandation : le « vous » chaleureux (cohérent avec la clientèle renouvellement/refinancement 35-60 ans qui a le plus de valeur), en gardant le ton simple et anti-jargon actuel. Si la cible prioritaire est le premier acheteur < 35 ans, le « tu » systématique se défend aussi — l'important est la cohérence, au minimum à l'intérieur d'une même page.

### 2.3 🔴 La page /rappel est votre meilleure offre basse-friction… et elle est invisible

`/rappel` (« Soyez rappelé·e au bon moment » — 4 à 6 mois avant l'échéance) est une offre de conversion exceptionnelle pour les renouvellements : friction quasi nulle, valeur immédiate, capture le lead **avant** que la banque n'envoie son offre. Or elle n'est liée que :
- dans le footer, colonne « Outils », sous le label vague « Rappel » ;
- via `RappelCTA.astro`, utilisé uniquement sur `/services/renouvellement`.

**Recommandations :**
- Ajouter un bloc « Votre terme approche ? » sur la page d'accueil (idéalement juste sous `TauxSection`, où le visiteur pense déjà aux taux) avec CTA vers `/rappel`.
- Renommer le lien footer : « Rappel de renouvellement » .
- L'ajouter aux pages villes et à la FAQ renouvellement.
- Envisager un champ « échéance » rendu obligatoire seulement au format mois/année (déjà le cas — bien).

### 2.4 🟠 Preuve sociale figée dans le hero alors que les vraies données sont déjà chargées

Le ruban sous la photo affiche « Satisfaction ⭐ 5/5 » **codé en dur**, alors qu'`index.astro` fetch déjà `googleReviews` (note + nombre d'avis). Un « 5/5 » générique sans volume est moins crédible qu'un chiffre réel.

**Recommandation :** passer `rating` et `totalReviews` en props au Hero : « ⭐ 4,9/5 · 47 avis Google », cliquable vers `#temoignages`. Idem pour les stats hero : « 20+ prêteurs · 0 $ frais · 24 h » pourrait inclure le nombre d'avis ou les années d'expérience (« 4 ans » est mentionné dans About).

### 2.5 🟠 Réservation en ligne : rupture d'expérience et zéro tracking

Tous les CTA « Consultation gratuite » / « Prendre rendez-vous » ouvrent `outlook.office.com` dans un nouvel onglet — page Microsoft générique, hors de votre marque, et **aucun événement de conversion n'est mesuré** (le clic sort du site sans trace ; seuls les PhoneLink ont des `trackId`).

**Recommandations :**
- Créer une page `/rendez-vous` qui embarque le widget MS Bookings en iframe — la CSP autorise déjà `frame-src outlook.office.com bookings.cloud.microsoft`, signe que c'était prévu. On garde le nav, le footer, la confiance… et la mesure.
- Ajouter des événements Umami (`data-umami-event="cta_booking_nav"`, `cta_booking_hero`, `cta_taux`, etc.) sur **tous** les CTA clés. Aujourd'hui, impossible de savoir quel CTA produit les rendez-vous — c'est le prérequis de toute optimisation future.

### 2.6 🟠 Aucun mécanisme de nurturing pour les leads « pas prêts »

Le quiz capture le consentement LCAP (« conseils hypothécaires, guides et ressources ») mais rien n'est offert en échange du courriel pour le visiteur « J'explore, sans pression » — qui est la majorité du trafic premier acheteur.

**Recommandation :** un lead magnet téléchargeable, p. ex. « Guide du premier acheteur au Québec 2026 (RAP, CELIAPP, mise de fonds, test de résistance) » ou « Checklist renouvellement : 7 questions avant de signer l'offre de votre banque ». Offert : dans le hero des pages services, en sortie de simulateur, et dans la FAQ. C'est ce qui transforme le trafic SEO informationnel en pipeline à 6-12 mois.

### 2.7 🟡 /demande est orpheline

`/demande` (formulaire complet de financement, 1160 lignes, noindex) n'a **aucun lien interne**. Si c'est voulu (envoyée par courriel après premier contact), parfait — sinon :
- La proposer sur l'écran de succès du quiz et sur `/merci` : « Gagnez du temps avant l'appel : remplissez votre demande complète ».

### 2.8 🟡 Frictions mineures dans les formulaires

- Quiz : la validation « au moins un moyen de contact » utilise `alert()` — remplacer par un message inline (l'alert est brutale sur mobile et casse le flot).
- Le libellé « 0 $ / Sans frais de courtage » (hero + pages villes « 0 $ sans frais de courtage ») est une double formulation maladroite — « Frais de courtage : 0 $ » est plus net.
- `sim_unlocked` est lu dans MainLayout (état sticky « converti ») mais n'est plus écrit nulle part — code mort à nettoyer ou fonctionnalité à rebrancher.

---

## 3. Cohérence du message (confiance = conversion)

### 3.1 🔴 Trois versions des heures d'ouverture

| Source | Horaires |
|---|---|
| `SEO.astro` (JSON-LD, ce que Google lit) | Lun-ven 9 h-18 h, sam 10 h-16 h |
| `Contact.astro` (ce que le visiteur lit) | Lun-ven 9 h-20 h, week-ends sur RDV |
| `public/llms.txt` (ce que les IA lisent) | Lun-ven 9 h-18 h, sam 10 h-16 h |

À harmoniser (une seule source de vérité — idéalement dans `siteConfig.json`, consommée partout). Les incohérences NAP/horaires pénalisent le SEO local et la confiance.

### 3.2 Promesse de délai incohérente

Le hero promet « **24 h** premier contact » ; partout ailleurs : « réponse dans les meilleurs délais ». Si le 24 h est tenable, c'est la formulation la plus forte — l'utiliser partout (quiz, pages services, courriels Resend). Sinon, la retirer du hero.

### 3.3 Coquille dans un schema

`services/premier-achat.astro` (JSON-LD FAQ) : « Une **cortière** compare… » → « courtière ».

---

## 4. SEO local et organique

### 4.1 Title de l'accueil vs meta_title de la config

`siteConfig.json` définit `meta_title: "Courtière Hypothécaire Repentigny | Stéphanie Weyman"` mais `index.astro` l'écrase avec `fullTitle="Stéphanie Weyman – Courtière hypothécaire | Lanaudière & Rive-Nord"` — **« Repentigny » disparaît du title de la page la plus forte du site**, alors que c'est la requête locale principale. Recommandation : « Courtière hypothécaire Repentigny & Rive-Nord | Stéphanie Weyman ».

### 4.2 Maillage interne des pages villes

Les 3 pages villes ne sont liées que depuis le footer. Les lier aussi depuis : la réponse FAQ « Quelles régions dessers-tu ? » (les villes y sont nommées en texte brut — parfait endroit pour 3 liens), et les pages services. À moyen terme : pages L'Assomption / Lavaltrie / Charlemagne (déjà citées en notes du footer).

### 4.3 Adresse Montréal vs positionnement Repentigny

Le JSON-LD utilise l'adresse du cabinet (3344 Fleury Est, Montréal) avec `areaServed` Lanaudière. C'est correct, mais pour les requêtes « courtier hypothécaire Repentigny », Google privilégie la proximité physique de la fiche Google Business. Rien à changer dans le code — mais à garder en tête côté fiche GBP (catégorie « Service de courtage hypothécaire » + zone de service bien définie, collecte d'avis mentionnant les villes).

### 4.4 Contenu informationnel

Aucun blog/guides. La FAQ est riche (bon balisage FAQPage), mais les requêtes « rap celiapp 2026 », « pénalité hypothécaire calcul », « renouvellement hypothécaire quand magasiner » méritent des pages dédiées de 1 200+ mots liées aux outils correspondants — le calculateur de pénalité est un aimant à backlinks naturel. 3-5 articles piliers suffisent.

### 4.5 Divers

- `BreadcrumbList` schema absent des sous-pages (mineur).
- OG image unique pour tout le site — des variantes par page service augmenteraient le CTR des partages (mineur).

---

## 5. Technique / performance / conformité

### 5.1 🟠 GTM chargé avant consentement

`MainLayout.astro` charge le container GTM (`GTM-P9NJL58S`) inconditionnellement dans le `<head>`, tandis que `consent.js` ne conditionne que gtag Ads. Selon ce que contient le container, c'est un risque Loi 25. Recommandation : Google Consent Mode v2 (default denied) dans le dataLayer avant GTM, ou charger GTM seulement après consentement, comme gtag.

### 5.2 Doubles analytics

GTM/GA4/Ads + Umami coexistent. C'est viable (Umami est sans cookie), mais définissez la source de vérité du funnel et instrumentez-y les événements CTA (voir 2.5). Umami est le candidat naturel : pas de consentement requis, donc données complètes.

### 5.3 Performance

Globalement très bon (critical CSS inline, images WebP + `astro:assets`, lazy loading correct, fonts en `media="print"` swap). Optimisations restantes de second ordre :
- Auto-héberger Lora + DM Sans (`@fontsource`) : supprime 2 connexions tierces, ~100-200 ms de LCP mobile.
- `Calculator.astro` embarque `html2canvas` — vérifier qu'il est bien importé dynamiquement au clic seulement.

### 5.4 Accessibilité

Bon niveau général (skip-link, focus-visible, aria sur quiz/carousel/FAQ, prefers-reduced-motion). Restes :
- Carrousel témoignages : autoplay sans bouton pause visible (pause au survol/focus seulement) — un vrai bouton ⏸ serait conforme WCAG 2.2.2.
- Quiz : erreurs via `alert()` (voir 2.8).

---

## 6. Plan d'action priorisé

### Quick wins (une demi-journée, fort impact)
1. **Hero : double CTA** — « Réserver un appel » (primaire) + « Calculer ma capacité » (secondaire). §2.1
2. **Harmoniser les horaires** (une seule source dans siteConfig.json). §3.1
3. **Preuve sociale réelle dans le hero** (note + nb d'avis Google dynamiques). §2.4
4. **Title accueil avec « Repentigny »**. §4.1
5. **Événements Umami sur tous les CTA** (booking, taux, outils, tel). §2.5
6. Coquille « cortière », libellé « Frais de courtage : 0 $ », nettoyage `sim_unlocked`. §2.8, §3.3

### Sprint suivant (1-2 jours)
7. **Uniformiser tu/vous** sur tout le site. §2.2
8. **Promouvoir /rappel** : bloc accueil sous TauxSection + renommage footer + pages villes. §2.3
9. **Page /rendez-vous** avec MS Bookings embarqué. §2.5
10. **GTM + Consent Mode v2**. §5.1
11. Maillage interne pages villes (FAQ régions + pages services). §4.2
12. Écran succès quiz + /merci → lien vers /demande. §2.7

### Moyen terme (backlog)
13. **Lead magnet PDF** (guide premier acheteur / checklist renouvellement) + séquence courriel LCAP. §2.6
14. Pages villes additionnelles (L'Assomption, Lavaltrie, Charlemagne). §4.2
15. 3-5 articles piliers liés aux outils. §4.4
16. Bouton pause carrousel, BreadcrumbList, OG images par page. §5.4, §4.5
17. Self-host des fonts. §5.3

---

*Audit réalisé par revue complète du code source (pages, composants, services, configuration Netlify, schémas SEO). Aucune modification fonctionnelle n'a été apportée au site.*
