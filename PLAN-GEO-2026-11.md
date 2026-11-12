# Plan GEO — stephanieweyman.ca

**Objectif :** que les moteurs génératifs — ChatGPT (recherche), Google (AI Overviews et Mode IA),
Gemini, Perplexity, Copilot, Claude — **lisent** le site, **comprennent** qui est Stéphanie Weyman
et le **citent** quand on leur pose une question hypothécaire au Québec ou qu'on leur demande une
courtière sur la Rive-Nord.

**Date :** 8 novembre 2026 · **Horizon :** 12 semaines (9 novembre 2026 → 29 janvier 2027), puis
un rituel mensuel.
**État :** plan. Rien n'est implémenté. Les constats du § 2 ont été mesurés le 8 novembre 2026 sur
le site en production ; l'annexe G donne les commandes pour les refaire.

Les tâches marquées 🔒 touchent une zone protégée (CLAUDE.md, « Travail en parallèle ») : elles
attendent un feu vert explicite (décision D4).

---

## 0. L'essentiel

### Le « score GEO » a deux étages, et le premier est déjà au maximum

- **La préparation technique** — ce que notent Lighthouse et les outils d'audit GEO. Lighthouse
  13.6 (Chrome 156, mobile) donne **SEO 100** et **Agentic Browsing 3/3** (arbre d'accessibilité,
  CLS 0, `llms.txt` valide) sur l'accueil, `/outils/`, le guide du premier achat et la page
  Repentigny. Tous les robots d'IA testés reçoivent un 200. Il n'y a plus rien à gagner là ; il
  faut seulement le garder.
- **La visibilité réelle** — la part des réponses d'IA qui nomment Stéphanie et lient le site.
  Personne ne la mesure aujourd'hui. **C'est le score que vise ce plan** (indice défini au § 10).

### Trois constats expliquent l'écart entre les deux

1. **Une grande partie du texte est invisible aux lecteurs des assistants.** Les réponses des FAQ
   en accordéon portent `aria-hidden="true"`. Readability, l'extracteur du mode lecture de Firefox
   et du serveur MCP `fetch` de référence, les supprime : **0 réponse sur 14** lue sur l'accueil,
   **1 sur 8** sur la page Repentigny, **0 sur 14** sur `/en/`. Les six pages services déclarent
   **18 questions-réponses en JSON-LD qui n'apparaissent nulle part sur la page**. Sur `/outils/`,
   75 % des mots dorment dans des onglets `hidden`. Les guides, eux, sont lus à 90 % : c'est un
   défaut de gabarit, pas de contenu.
2. **L'entité « Stéphanie Weyman » est floue.** Trois adresses portent son identité
   (stephanieweyman.ca, hypotheca.ca/sweyman, sweyman.hypotheca.ca), et aucune page Hypotheca ne
   renvoie au site. Le site dit « depuis quatre ans », la fiche Hypotheca « trois ans ». Il n'y a
   pas de page « À propos ». Un moteur de recherche tiers ne trouve rien à son nom, et elle est
   absente des annuaires et palmarès qui répondent à « meilleur courtier hypothécaire Repentigny ».
3. **Le contenu le plus citable n'est pas publié.** Le code contient déjà les barèmes de taxe de
   bienvenue par ville, les méthodes de pénalité par prêteur, les seuils de mise de fonds et les
   primes SCHL, mais comme entrées de calculateurs, pas comme tableaux lisibles, datés et sourcés.
   Pour un robot, les taux du jour s'affichent sans date (« Mise à jour en cours… »). Aucun guide
   ne cite de source officielle, et le sitemap n'a aucune `lastmod`.

### Les dix actions, dans l'ordre

| # | Action | Pourquoi d'abord | Quand |
|---|--------|------------------|-------|
| 1 | Mesure de référence : panel de 40 requêtes, Bing Webmaster Tools, Umami | Sans point de départ, aucun « meilleur score » n'est démontrable | S1 |
| 2 | FAQ en `<details>` partout, aucun texte sous `hidden` ou `aria-hidden` | Rend lisibles d'un coup 14 + 13 × 8 réponses déjà écrites | S1–S2 |
| 3 | FAQ des pages services rendues visibles, depuis la même source que leur JSON-LD | 18 réponses existent déjà ; aujourd'hui le balisage décrit un contenu absent | S2 |
| 4 | `scripts/audit-geo.mjs` : verrouille 2 et 3 | Une régression de gabarit ne se voit pas à l'œil | S1 |
| 5 | JSON-LD : retirer `aggregateRating` (contraire aux règles de Google) et `priceRange: "Free"`, zone desservie tirée de `villes.ts` | Corrige deux affirmations fausses que les IA répéteront | S1–S2 |
| 6 | Date des taux et taux directeur rendus par le serveur | Un chiffre sans date n'est pas citable | S2 |
| 7 | Page `/a-propos/` ; fiches Hypotheca et Google alignées sur les mêmes faits | Donne aux moteurs une seule version de qui elle est | S3–S4 |
| 8 | Signature et sources officielles au bas de chaque guide et page service | Le levier le mieux démontré (étude GEO, § 1.1) | S4–S5 |
| 9 | Pages de données : coût d'un courtier, mise de fonds et SCHL, pénalité par prêteur, taxe de bienvenue par ville (barèmes 2027) | Les réponses qu'on veut voir citées, calculées par les fonctions du site | S3–S10 |
| 10 | Avis, annuaires, partenaires, médias locaux (Stéphanie, 1 à 2 h par semaine) | Pour « qui recommandes-tu ? », les moteurs cherchent un consensus hors du site | continu |

**À trancher avant de commencer :** les dix décisions du § 13, chacune avec une recommandation.

---

## 1. Ce qu'on optimise

### 1.1 Comment un moteur génératif choisit ses sources

- **Il cherche avant de répondre.** Pour une question d'actualité ou locale, l'assistant interroge
  un index : celui de Google pour AI Overviews, le Mode IA (offert en français au Canada depuis
  octobre 2025) et Gemini ; celui de Bing pour Copilot. ChatGPT combine son propre robot
  (OAI-SearchBot) et des fournisseurs tiers, dont Bing. Perplexity (PerplexityBot) et Anthropic
  (Claude-SearchBot) explorent le Web pour leurs propres résultats. **Être absent de l'index de Bing, c'est
  disparaître de Copilot**, et d'une partie de ChatGPT.
- **Il découpe la page, puis cite des passages.** Ce qui est cité, c'est un paragraphe qui
  répond seul : une question, une réponse courte, un chiffre avec son unité et sa date, une
  source. Le Mode IA décompose la question en sous-questions (*query fan-out*). Une page qui
  répond aussi aux sous-questions (qui paie, quand, combien, exceptions) a donc plus de chances
  d'être retenue.
- **Pour « le meilleur X près de moi », il cherche un consensus** : fiche Google, avis, annuaires,
  palmarès, articles locaux. Le site seul ne suffit pas, d'où le § 8.
- **La finance est un sujet sensible (YMYL).** Les moteurs y privilégient les sources dont
  l'auteur, le titre professionnel et les références se vérifient. Le numéro AMF est l'atout le
  plus solide du site : il doit être partout, toujours identique, et vérifiable.
- **La recherche va dans le même sens.** L'étude « GEO: Generative Engine Optimization »
  (Aggarwal et al., KDD 2024) mesure jusqu'à 40 % de visibilité en plus dans les réponses
  génératives quand on ajoute des sources citées, des citations et des statistiques ; le bourrage
  de mots-clés n'y change rien. C'est une étude de laboratoire, mais elle pointe dans la direction
  des pratiques ci-dessous.

### 1.2 Le score visé

L'**indice GEO** du § 10.1 : la part des réponses qui citent le site, qui nomment Stéphanie, qui
le font sans erreur, plus l'hygiène technique. On le mesure sur un panel fixe de requêtes, le
même chaque mois.

### 1.3 Ce qu'on ne fera pas

- Servir aux robots un autre contenu qu'aux visiteurs (camouflage), du texte caché, ou des
  « instructions pour IA » glissées dans la page.
- Se déclarer « meilleure courtière », ou acheter une place dans un palmarès présenté comme
  éditorial.
- Baliser les avis Google en `AggregateRating` (§ 2.3).
- Générer en masse des pages villes ou lexique sans valeur propre. Google sanctionne l'abus de
  contenu à grande échelle, et une page fausse sur une ville se voit d'abord par ceux qui y
  habitent.
- Compter sur `llms.txt`. Google dit qu'il n'a aucun effet sur la recherche, et rien ne montre que
  les assistants le lisent en production (97 % des fichiers ne reçoivent aucune requête d'IA,
  selon une étude de 2026). On le garde juste (T1.8) parce qu'il coûte peu et que Lighthouse le
  vérifie.

---

## 2. État des lieux — mesuré le 8 novembre 2026

### 2.1 Acquis à préserver

| Acquis | Preuve |
|--------|--------|
| HTML rendu par le serveur ou au build | Astro SSR/statique — rien d'essentiel n'attend JavaScript, sauf les exceptions du § 2.5 |
| Tous les robots d'IA admis | `robots.txt` : `User-agent: *` / `Allow: /`. GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, bingbot et Googlebot reçoivent 200 sur `/`, `/en/` et un guide |
| Réponses rapides | Temps de première réponse 0,2 à 0,5 s en cache ; à froid 1,0 s (accueil) et 2,8 s (`/en/`) |
| Une adresse par page | Canonique à barre finale, 301, hreflang fr-CA / en-CA / x-default |
| Sitemap en liste blanche | 60 adresses (30 FR + 30 EN), aucune page privée |
| Version anglaise indexable, au bon vocabulaire | `/en/…` ; FHSA, HBP, CMHC, *welcome tax* dans le dictionnaire |
| Guides très lisibles | Readability garde 90 % du texte ; « L'essentiel en 30 secondes », date de révision affichée, `Article` avec autrice `#stephanie` |
| Une seule entreprise `#business`, numéro AMF balisé | [SEO.astro](src/components/SEO.astro), [schemaVille.ts](src/utils/schemaVille.ts) |
| Données à exemplaire unique | `guides.ts`, `villes.ts`, `droitsMutation.ts`, `preteurs.ts`, `mortgageCalc.ts`, `prixMedians.ts` : on peut en tirer des tableaux sans recopier un seul chiffre |
| Scores techniques au maximum | Lighthouse 13.6 : SEO 100, Agentic Browsing 3/3 (WebMCP et manifeste ARD non applicables) sur 4 pages |

### 2.2 Ce que lit vraiment un lecteur d'assistant

**Méthode :** HTML de production passé à `@mozilla/readability` 0.6. Les « mots cachés » sont ceux
des éléments qui portent `hidden` ou `aria-hidden="true"`. Une réponse de FAQ est « lue » si ses
60 premiers caractères se retrouvent dans le texte extrait. Script :
`C:\Users\marc_\AppData\Local\Temp\claude\5daf3404c8c7819b\6b547287-15d6-4006-9921-8b82c9384003\scratchpad\tools\lisibilite.mjs`
(point de départ de T1.7).

| Page | Mots dans `<main>` | dont cachés | Gardés par Readability | Réponses de FAQ lues |
|------|-------------------:|------------:|-----------------------:|----------------------|
| `/` | 3 415 | 2 189 | 678 | **0 / 14** |
| `/en/` | 3 158 | 2 039 | 602 | **0 / 14** (texte caché, et pas de FAQ balisée en anglais) |
| `/outils/` | 3 352 | 2 522 | 653 | 7 / 7 (déjà en `<details>`) |
| `/villes/courtier-hypothecaire-repentigny/` | 2 384 | 893 | 1 018 | **1 / 8** |
| `/services/premier-achat/` | 776 | 7 | 732 | les 3 réponses balisées ne sont pas sur la page |
| `/services/renouvellement/` | 880 | 7 | 758 | idem |
| `/outils/calculateur-penalite-hypothecaire/` | 1 080 | 0 | 689 | 8 / 9 visibles (`<details>`) ; 1 / 3 balisées, d'un autre texte |
| `/guides/premier-achat/` | 2 144 | 8 | 1 921 | — |
| `/guides/renouvellement/` | 2 276 | 8 | 2 048 | — |

**Lecture :**
- Google indexe le contenu replié : AI Overviews et le Mode IA ne sont pas aveugles à la FAQ. Les
  assistants qui vont chercher la page au moment de répondre (ChatGPT, Perplexity, Claude, les
  agents) ne publient pas leur extracteur. Readability est le plus répandu et le plus strict sur ce
  point : c'est le pire cas raisonnable, et le corriger ne coûte rien côté Google.
- **Une seule cause :** `aria-hidden="true"` sur chaque `.faq-a`
  ([Faq.astro:192](src/components/Faq.astro#L192),
  [courtier-hypothecaire-repentigny.astro:391](src/pages/villes/courtier-hypothecaire-repentigny.astro#L391)),
  et `hidden` sur les catégories autres que « Général » ([Faq.astro:170](src/components/Faq.astro#L170)).
  Les FAQ de `/outils/` et de la page pénalité sont en `<details>` : 7 réponses sur 7 lues sur
  `/outils/`, 8 sur 9 sur la page pénalité. Le correctif existe déjà dans le site.
- **En anglais, c'est pire.** `traductionPage.ts` retire le JSON-LD de la FAQ, avec raison (il
  serait en français), et le texte visible est caché : la FAQ anglaise n'existe pour aucun
  extracteur.

### 2.3 Données structurées

| # | Constat | Où | Pourquoi c'est un problème | Correctif |
|---|---------|----|-----------------------------|-----------|
| 1 | `aggregateRating` tiré des avis Google | [index.astro:53](src/pages/index.astro#L53) | Google : « *Don't aggregate reviews or ratings from other websites* ». Une entreprise qui balise des avis sur elle-même, même par un widget Google, est inéligible aux étoiles. Gain nul, risque d'action manuelle (le balisage de la page serait alors ignoré). Le même bloc redéclare `areaServed` en texte libre sur `#business`, en contradiction avec la liste de `SEO.astro`. | Retirer le bloc ; garder la note **en texte visible**, datée, avec un lien vers la fiche Google (T2.3) |
| 2 | `priceRange: "Free"` | [SEO.astro:80](src/components/SEO.astro#L80) | Affirmation absolue que la règle du site interdit (« gratuit pour la vaste majorité des dossiers* »), et que les assistants répéteront mot pour mot | Retirer (le champ est facultatif) |
| 3 | FAQ balisée invisible | les 6 pages `services/` | 18 questions-réponses n'existent qu'en JSON-LD : le balisage doit décrire ce qui est visible, et ces réponses sont perdues pour tout extracteur qui ignore les `<script>` | T1.3 |
| 4 | Balisage de la page pénalité ≠ page | [calculateur-penalite-hypothecaire.astro:146](src/pages/outils/calculateur-penalite-hypothecaire.astro#L146) | 3 questions balisées, 8 visibles, textes différents ; « Puis-je négocier la pénalité ? » n'est que dans le balisage | T1.4 |
| 5 | `areaServed` : 4 villes + Lanaudière | [SEO.astro:50](src/components/SEO.astro#L50) | Le site a 13 pages villes et dessert le reste du Québec à distance | Tirer la liste de `villes.ts`, plus `AdministrativeArea` Québec |
| 6 | `Person` absente de l'accueil ; son `url` est l'accueil ; ni `sameAs`, ni langues, ni domaines | [schemaVille.ts:50](src/utils/schemaVille.ts#L50) | La page la plus liée ne dit pas qui est la courtière | T2.2, T2.3 |
| 7 | `sameAs` mêle personne et entreprise | [SEO.astro:74](src/components/SEO.astro#L74) | Le profil LinkedIn (une personne) est rattaché à `#business` | Répartir (annexe D) |
| 8 | `datePublished` = `dateModified` | guides | La date de publication avance à chaque révision | Champ `publie` dans `guides.ts` |
| 9 | Titre AMF sur `#business` | [SEO.astro:82](src/components/SEO.astro#L82) | C'est le titre de la personne | Le garder sur `#stephanie` seulement |

### 2.4 Faits contradictoires

Un assistant qui croise ses sources retient la version la plus répétée, ou les mélange.

| Fait | Site | `llms.txt` | hypotheca.ca/sweyman | sweyman.hypotheca.ca | À faire |
|------|------|------------|----------------------|----------------------|---------|
| Ancienneté | « depuis quatre ans » ([About.astro:30](src/components/About.astro#L30)) | — | « trois ans » | — | Une année de début, la même partout (« depuis 20XX ») : une durée relative vieillit toute seule |
| Lien vers stephanieweyman.ca | — | — | non (renvoie au mini-site Hypotheca) | non | Demande à Hypotheca (T2.6) |
| Numéro AMF | partout | oui | absent | absent | Demande à Hypotheca |
| Coût | « gratuit pour la vaste majorité des dossiers* » | « gratuit pour le client » (+ réserve) | « première étape gratuite » | — | Une seule phrase (T2.1) |
| Outils | 7 | « six calculateurs » | — | — | `llms.txt` généré (T1.8) |
| Délai de réponse | « habituellement le jour ouvrable même » | « dans les meilleurs délais » | — | — | Idem |
| Zone | 13 villes + reste du Québec à distance | autre liste | « partout au Québec » | aucune | `villes.ts` comme source |
| Exemple « 0,30 % sur 400 000 $ et 5 ans » | « près de 4 000 $ » (FAQ de l'accueil) ; « plus de 4 000 $ » (premier achat) | — | — | — | Le calculer avec les fonctions du site, l'écrire une fois |

Autres écarts du `llms.txt` actuel : il liste `/amortissement` (noindex), écrit les adresses sans
barre finale et ne mentionne ni les guides ni la version anglaise. La description de
`/services/renouvellement/` (« Gratuit et sans engagement ») parle du service, pas de l'appel :
elle est à aligner sur la même règle.

### 2.5 Fraîcheur et données vivantes

- **Taux :** sans JavaScript, la section affiche les taux suivis de « Mise à jour en cours… » ; la
  date est écrite par script ([TauxSection.astro:44](src/components/TauxSection.astro#L44)). Le
  taux directeur se lit « Taux directeur BdC — … Mis à jour le — » : il est chargé dans le
  navigateur depuis `/api/bdc-rate`.
- **Sitemap :** aucune `lastmod` sur les 60 adresses.
- **Prix médians :** `prixMedians.ts` est à `null` pour les 13 villes.
- **Taxe de bienvenue :** `droitsMutation.ts` cite « calculconversion.com, sites municipaux », une
  source secondaire. Avant d'en faire un tableau citable, chaque barème doit renvoyer à sa source
  municipale.
- **Avis :** au moment de l'audit, l'accueil servait les avis de repli (3 avis statiques ; aucun
  `aggregateRating` émis, ce que le code ne fait qu'avec des avis en direct). À vérifier :
  `GOOGLE_PLACES_API_KEY` et les journaux de `reviewsService`. Le héros affiche « 5,0 sur 5 » sans
  nombre d'avis.

### 2.6 Présence hors site

- Une recherche sur « Stéphanie Weyman » courtière hypothécaire ne rend aucun résultat à son sujet
  (un moteur tiers, pas Google : c'est un indice, pas une preuve).
- Pour « meilleur courtier hypothécaire Repentigny », les sources qu'un assistant trouvera sont
  threebestrated.ca (trois courtiers nommés), yellowpages.ca, GuildQuality, une page de conseiller
  de la Banque Nationale et une page Mortgage Architects. Stéphanie n'apparaît dans aucune.
- Hypotheca : une fiche (hypotheca.ca/sweyman) et un mini-site (sweyman.hypotheca.ca) avec des
  articles (rénovations, séparation, duplex, mise de fonds de 5 %). Aucun des deux ne renvoie au
  site ni n'affiche le numéro AMF.
- Une fiche Google existe (`google_place_id`). Je ne peux en vérifier d'ici ni la complétude ni le
  nombre d'avis.

### 2.7 Mesure

- Aucune mesure de visibilité dans les IA aujourd'hui.
- **Umami, sans témoin, voit tous les référents** (chatgpt.com, perplexity.ai,
  gemini.google.com, copilot.microsoft.com, claude.ai) : c'est la mesure la plus complète dont on
  dispose. GA4 ne voit que les visiteurs qui consentent.
- **Bing Webmaster Tools** a un rapport « AI Performance » (aperçu public depuis février 2026) :
  citations dans Copilot et les réponses IA de Bing, par requête et par page. Il ne couvre pas
  ChatGPT et ne donne pas les clics. Configuration actuelle à vérifier.
- Search Console ne distinguait pas, à la dernière vérification, AI Overviews ni le Mode IA du
  reste des résultats : à revérifier en T0.3.

---

## 3. Garde-fous — valables pour chaque tâche

1. **AMF.** Aucune promesse de taux ni d'approbation ; tout exemple chiffré est illustratif ;
   « meilleur » ne se dit jamais de soi. Chaque page nouvelle est validée par Stéphanie (les
   agents listent les affirmations à valider).
2. **Un fait dont on n'est pas sûr est retiré, pas nuancé** : barèmes, méthodes des prêteurs,
   délais, faits locaux.
3. **Un chiffre publié est calculé par la fonction qui sert l'outil** (`miseMinimale`,
   `calculateSCHL`, `droitsMutation`, `calculerPenalite`, `calculerCapacite`…), jamais recopié.
   Une règle qui change se met à jour dans le guide, la FAQ et l'outil en même temps (règle
   existante des guides).
4. **Le même HTML pour tous.** Aucune détection d'agent utilisateur, aucun texte réservé aux
   robots.
5. **Traduction.** Tout texte français reçoit sa clé anglaise (`i18n-extraire.mjs`). Toute page
   nouvelle entre dans `pagesTraduites.json`, et dans `NOINDEX` si elle est noindex.
6. **Confidentialité.** Nouveau champ, témoin ou sous-traitant : `/confidentialite` est mise à jour
   dans le même commit. IndexNow ne transmet que des adresses de pages, Bing Webmaster Tools rien de
   personnel.
7. **CSP inchangée.** Pas de cadre YouTube (un lien suffit). Tout nouveau domaine s'ajoute aux deux
   endroits, avec le test.
8. **Zones.** 🔒 = feu vert explicite (D4).
9. **La lisibilité est verrouillée** : `audit-geo.mjs` passe avant chaque fusion (T1.7).
10. **Un seul `#business`, un seul `#stephanie`**, rattachés par `@id`.

---

## 4. Phase 0 — Mesure de référence (S1)

Il faut un chiffre à battre.

**T0.1 — Panel de requêtes.** Les 40 requêtes de l'annexe A, dont 20 « noyau » (★).
- Chaque mois, le noyau sur 4 moteurs : ChatGPT avec recherche, Perplexity, Google Mode IA
  (fr-CA), Copilot. Chaque trimestre, le panel complet sur 6 moteurs (ajouter Gemini et Claude,
  noter les AI Overviews quand ils s'affichent).
- Fenêtre privée, sans connexion quand c'est possible ; même formulation chaque fois.
- Colonnes du tableur (tenu hors du dépôt : il contient des noms de concurrents et des captures) :
  date · moteur · requête · nommée (0/1) · site lié (0/1, quelle page) · faits exacts (nom,
  cabinet, numéro AMF, zone, coût) · concurrents nommés · domaines cités · capture.
- Durée : environ 2 h la première fois, 90 min ensuite.

**T0.2 — Bing Webmaster Tools.** Import depuis Search Console (aucun code), envoi du sitemap,
inspection de `/`, `/guides/premier-achat/` et `/villes/courtier-hypothecaire-repentigny/`,
activation du rapport AI Performance. **Si des pages manquent à l'index de Bing, cela devient la
priorité n° 1** : c'est l'index de Copilot et une partie de celui de ChatGPT.

**T0.3 — Search Console.** Requêtes de marque (« weyman »), pages les plus vues, inspection d'URL
des pages clés (indexée ? quelle canonique Google a-t-il retenue ?).

**T0.4 — Référents IA.** Un filtre Umami « IA » et un groupe de canaux GA4 (annexe H).

**T0.5 — Attribution déclarée.** Voir D5.

**T0.6 — Hygiène technique.** Lighthouse (annexe G), puis `audit-geo.mjs` dès que T1.7 existe.

**Livrable :** l'indice GEO de référence (§ 10.1) et la liste des sources que les moteurs citent à
la place du site.

---

## 5. Phase 1 — Être lue (S1–S3)

### T1.1 — FAQ de l'accueil en `<details>`
- **Quoi :** chaque question devient un `<details name="faq">` avec la question dans un `<summary>`
  (un titre y est permis) et la réponse en enfant direct, sans `aria-hidden` ni `hidden`.
  Catégories : plus de `hidden` sur les éléments. Recommandé : des sections titrées par catégorie,
  les puces devenant des ancres (sans JavaScript, sans saut de mise en page). Autre voie : un
  filtre en CSS seul (boutons radio et `:has()`). Le script peut enrichir l'affichage, jamais
  cacher du texte dans le HTML servi. Les `id` `faq-<slug>` restent (liens profonds, traduction).
  Le JSON-LD est inchangé : il vient du même tableau.
- **Fichiers :** `src/components/Faq.astro`, et les scripts qui ciblent `.faq-q` ou `aria-expanded`
  (`grep -rn` d'abord).
- **Qui :** design (structure seulement, aucun texte).
- **Critère :** `audit-geo` lit 14/14 réponses sur `/` et `/en/` ; clavier et lecteur d'écran
  corrects ; `audit-mobile.mjs` passe ; aucune clé de traduction perdue (`i18n-extraire.mjs`).
- **Effort :** ½ jour.

### T1.2 — FAQ des 13 pages villes
- **Quoi :** le même gabarit, tiré d'un composant unique `FaqDetails.astro` (props : les
  questions) que réutiliseront l'accueil et les pages services. Une seule copie de la structure,
  comme ailleurs dans le site.
- **Qui :** design. **Critère :** 8/8 réponses lues sur chaque page ville. **Effort :** ½ à 1 jour.

### T1.3 — FAQ visibles sur les six pages services
- **Quoi :** les trois questions de chaque page passent du JSON-LD écrit à la main à un tableau.
  Ce tableau rend une section « Questions fréquentes » visible (via `FaqDetails`, avant l'appel
  final) **et** produit le JSON-LD, comme le fait déjà `Faq.astro`. Les textes existent : il
  reste à les relire. À valider en particulier : « en 24 à 48 h » (dossier refusé), l'exemple
  « plus de 4 000 $ » (premier achat, voir § 2.4). Traduction anglaise de chaque réponse.
- **Fichiers :** `src/pages/services/*.astro`, `public/js/i18n-en.json`.
- **Qui :** contenu (texte, traduction), puis design (gabarit). En séquence, pas en parallèle :
  mêmes fichiers.
- **Critère :** 18/18 réponses visibles et lues ; le JSON-LD reprend exactement le texte visible
  (contrôle L2) ; zéro clé manquante.
- **Effort :** 1 jour.

### T1.4 — Page pénalité : un seul tableau de questions
- **Quoi :** les 8 questions visibles deviennent un tableau dont le JSON-LD est tiré. Les 3
  questions balisées à part disparaissent. « Puis-je négocier la pénalité ? » rejoint la page si
  on la garde. Fait à valider ou à retirer : « frais administratifs mineurs (300-500 $) ».
- **Qui :** calculateurs (page `outils/`). **Effort :** ¼ jour.

### T1.5 — `/outils/` : l'explication hors des onglets
- **Quoi :** les onglets restent (c'est l'interface), mais une section fixe « Comment fonctionnent
  ces calculs » (H2) donne pour chaque outil un H3 : ce qu'il calcule ; les règles et paramètres
  avec leur date (test de résistance, ratios ABD/ATD 39/44 assuré et 35/42 conventionnel, mise
  minimale par tranche, plafond de 1,5 M$, surprime de 0,20 % au-delà de 25 ans…) ; **un exemple
  calculé par les fonctions** ; un lien vers l'onglet. C'est ce texte qu'un assistant citera pour
  « comment est calculée la capacité d'emprunt ».
- **Fichiers :** `src/pages/outils.astro`, `i18n-en.json`.
- **Qui :** calculateurs, contenu pour la formulation.
- **Critère :** au moins 120 mots lisibles par outil hors des onglets ; aucun chiffre écrit en dur
  dans le gabarit.
- **Effort :** 1½ jour.

### T1.6 — 🔒 Date des taux et taux directeur rendus par le serveur
- **Quoi :**
  - `TauxSection` rend `<time datetime="{fetchedAt}">` avec `formatDateHeureLong(fetchedAt)`
    (« Taux relevés le 8 novembre 2026 à 6 h 12 »). Le script peut ajouter « il y a 3 heures » à
    côté, jamais remplacer la date. Sans taux, rien (la règle « jamais de faux taux » ne change
    pas).
  - Taux directeur : la logique de récupération et de cache sort de `src/pages/api/bdc-rate.ts`
    vers `src/services/bdcRateService.ts`, appelé par la route et par la page (lectures en
    séquence, jamais en `Promise.all`). Taux et date sont rendus par le serveur.
  - Même chose sur les pages villes qui affichent un taux.
- **Qui :** session principale (zone protégée), calculateurs pour l'affichage.
- **Critère :** `curl` de `/` montre la date et le taux directeur ; en-têtes de cache inchangés ;
  tests du service (cache, panne → `null`, aucune valeur inventée).
- **Effort :** 1 jour.

### T1.7 — Verrou : `scripts/audit-geo.mjs`
- **Quoi :** l'audit de l'annexe F, sur le modèle de `audit-mobile.mjs` (serveur lancé, code de
  sortie 1 en cas d'échec). `@mozilla/readability` en dépendance de développement ; essayer
  d'abord `linkedom` (déjà présent), sinon `jsdom`. Ajouter la commande à CLAUDE.md.
- **Qui :** session principale ou agent seo. **Effort :** ½ jour.

### T1.8 — `llms.txt` produit au build
- **Quoi :** `src/pages/llms.txt.ts` (`prerender = true`), construit par une fonction pure
  (`src/utils/llmsTxt.ts`) à partir de `siteConfig`, de la fiche (T2.1), de `guides.ts`, de
  `villes.ts` et de `pagesTraduites.json` moins `NOINDEX`. Structure à l'annexe C. Adresses
  absolues à barre finale, section anglaise. Supprimer `public/llms.txt` dans le même commit,
  sinon les deux se disputent l'adresse.
- **Test :** `llmsTxt.test.ts` — chaque page indexable présente une fois avec son résumé (un
  résumé manquant fait échouer le test), aucune page noindex ni privée, un H1 et des liens au
  format Markdown (ce que vérifie Lighthouse), moins de 50 Ko.
- **Qui :** seo (fichier hors de sa zone actuelle : l'élargir explicitement). **Effort :** ½ jour.

### T1.9 — `robots.txt`
Aucun changement de fond : tout est déjà admis. Ajouter les commentaires de l'annexe B pour que
la politique soit écrite. Ne jamais y énumérer les écrans privés (ce serait publier leurs
adresses, la faute corrigée dans le sitemap). Dépend de D1. **Effort :** 5 minutes.

### T1.10 — 🔒 IndexNow et `lastmod`
- **IndexNow :** une clé dans `public/<clé>.txt` ; une extension Netlify locale (événement
  `onSuccess` — vérifier dans la documentation de Netlify qu'il s'exécute une fois le site publié,
  sinon passer par une fonction `deploy-succeeded`) qui envoie à `api.indexnow.org` les adresses
  modifiées, en français et en anglais.
  « Modifiées » = les pages dont la source a changé entre `CACHED_COMMIT_REF` et `COMMIT_REF` ;
  toutes les pages si un composant partagé ou le layout a changé. Jamais toutes les adresses à
  chaque déploiement. Touche `netlify.toml`.
- **`lastmod` :** `serialize()` de `@astrojs/sitemap` pose `lastmod` là où une date de révision
  existe dans les données (les guides aujourd'hui ; services et villes quand ils auront un champ
  `revise`). Jamais la date du build : une `lastmod` fausse est ignorée par Google et décrédibilise
  les autres. Touche `astro.config.mjs` hors de `NOINDEX`.
- **Effort :** 1 jour.

### T1.11 — 🔒 (facultatif) Cache durable
`Netlify-CDN-Cache-Control: public, durable, s-maxage=…` sur les réponses du serveur
(`rateCacheControl`, `servirAnglais`) : un robot qui tombe sur une page froide (2,8 s sur `/en/`)
reçoit la copie partagée. Mesurer avant et après. **Effort :** ¼ jour.

---

## 6. Phase 2 — Être comprise et crue : l'entité (S2–S5)

### T2.1 — Une fiche d'identité, une seule fois
- **Quoi :** `src/data/fiche.ts` (ou des champs de `siteConfig.json` 🔒, selon D3) : année de
  début ; langues de service ; « plus de 20 prêteurs » ; la phrase de rémunération (« … dans la
  vaste majorité des dossiers… ») ; le délai de réponse ; le mode d'accompagnement (Teams,
  téléphone, texto, signature électronique) ; le numéro AMF du cabinet (`amf_cabinet` est vide) ;
  l'adresse de la fiche Google ; l'adresse de la fiche au registre de l'AMF si elle est stable. La
  zone vient de `villes.ts`. Lisent la fiche : `About.astro`, `/a-propos/`, `llms.txt`, le JSON-LD,
  le pied de page.
- « depuis quatre ans » devient « depuis {année} ».
- **À vérifier :** pour une représentante en courtage hypothécaire, le registre de l'AMF parle-t-il
  de « certificat » ou de « permis » ? Le site dit « permis ». Employer le terme du registre : c'est
  lui que les moteurs recouperont.
- **Qui :** seo ou session principale ; chaque fait validé par Stéphanie. **Effort :** ½ jour.

### T2.2 — Page `/a-propos/`
- **Contenu** (contenu, avec Stéphanie) : nom, titre, cabinet Hypotheca, numéro AMF et comment le
  vérifier au registre ; depuis quand ; basée à Repentigny, accompagnement à distance partout au
  Québec (Teams, téléphone, texto ; jamais « en personne ») ; les six clientèles, chacune vers sa
  page service ; comment elle est rémunérée (phrase de la fiche, lien vers la page coût) ; comment
  se passe l'accompagnement ; langues ; avis (lien vers la fiche Google) ; coordonnées.
- **Balisage :** `ProfilePage` + `Person #stephanie` (`url` = `/a-propos/`), `BreadcrumbList`.
- **Maillage :** « À propos » du menu pointe vers `/a-propos/` au lieu de `/#apropos` ; la
  signature des guides y mène ; la section de l'accueil y renvoie.
- **À ne pas oublier :** `pagesTraduites.json`, traductions, sitemap (automatique).
- **Qui :** contenu (texte), seo (balisage), design (mise en page), session principale pour le
  menu si besoin. **Effort :** 1½ jour, plus 1 h de Stéphanie.

### T2.3 — JSON-LD (cible à l'annexe D)
- **Partie 1 (S1–S2) :** retirer le bloc `aggregateRating` de l'accueil ; retirer `priceRange` ;
  `areaServed` tiré de `villes.ts` plus Québec ; `url` de `#business` à barre finale.
- **Partie 2 (S4, après T2.1) :** `#stephanie` émis par `SEO.astro` sur chaque page indexable (les
  copies des guides et des villes deviennent des renvois par `@id`) ; `sameAs` réparti entre
  personne et entreprise ; `knowsLanguage`, `knowsAbout`, `affiliation` Hypotheca ; titre AMF sur la
  personne seulement.
- **Test :** la construction du schéma sort de `SEO.astro` vers `src/utils/schemaSite.ts` (pur,
  comme `schemaVille.ts`). `schemaSite.test.ts` vérifie : ni `aggregateRating` ni `priceRange` ;
  `areaServed` couvre `villes.ts` ; `@id` uniques ; `identifier` AMF = `siteConfig.amf` ; `sameAs`
  en https.
- **Qui :** seo. **Effort :** ½ à 1 jour.

### T2.4 — 🔒 FAQ anglaise balisée
- **Quoi :** dans `traductionPage.ts`, après la traduction, reconstruire le `FAQPage` à partir du
  DOM **anglais affiché** (questions et réponses des `<details>`). La règle documentée reste vraie :
  le dictionnaire ne traduit pas le JSON-LD, on le bâtit à partir de ce que l'écran montre en
  anglais.
- **Test :** dans `servirAnglais.test.ts`, les questions du `FAQPage` anglais égalent les résumés
  visibles, et aucun texte français n'y figure.
- **Effort :** ½ jour.

### T2.5 — Signature, sources, méthode
- **Signature** sous le H1 des guides et des pages services : « Par Stéphanie Weyman, courtière
  hypothécaire (AMF 255885), Hypotheca · Mis à jour en novembre 2026 », avec lien vers `/a-propos/`.
- **Bloc « Sources »** au bas de chaque guide, page service et page d'outil : 3 à 6 sources
  primaires — gouvernement du Canada (CELIAPP, RAP, règles du 15 décembre 2024), SCHL, BSIF (test
  de résistance), Revenu Québec, Banque du Canada, AMF, municipalités (taxe de bienvenue), APCIQ.
  Chacune : institution, titre de la page, lien, « consulté en <mois> ». Les adresses exactes sont
  relevées par l'agent contenu, page par page, jamais devinées. Balisage `citation` dans
  l'`Article`.
- **Méthode :** l'encadré des outils (T1.5).
- **Qui :** contenu (sources, formulation), seo (balisage), design (style du bloc).
  **Effort :** 1½ jour.

### T2.6 — Hypotheca (Stéphanie)
Demander : que le champ « site web » de la fiche hypotheca.ca/sweyman pointe vers
stephanieweyman.ca ; un lien vers stephanieweyman.ca sur sweyman.hypotheca.ca (ou une redirection,
si Hypotheca le permet) ; la même année de début et la même présentation (T2.8) ; l'affichage du
numéro AMF ; la même photo. Demander aussi si les articles du mini-site sont communs au réseau
(des textes dupliqués sur des centaines de mini-sites ne la distinguent de personne).
**Effort :** 30 min, plus le délai d'Hypotheca.

### T2.7 — Fiches d'annuaire (Stéphanie)
Nom, téléphone, site et adresse **identiques partout** (D10).

| Fiche | À faire |
|-------|---------|
| Google Business Profile | Catégorie principale de courtier hypothécaire ; description = présentation T2.8 ; les six services ; zone de service = villes ; heures (lun–ven 9 h–20 h, fins de semaine sur rendez-vous) ; photos ; une publication par mois (aux annonces de la Banque du Canada) ; réponse à chaque avis |
| Bing Places | Import depuis la fiche Google |
| Apple Business Connect | Même fiche (Plans, Siri) |
| PagesJaunes / yellowpages.ca | Fiche gratuite ; c'est une des sources citées pour Repentigny |
| Facebook (page existante) | Section « À propos » = présentation, lien vers le site |
| LinkedIn | Titre « Courtière hypothécaire · Hypotheca · AMF 255885 » ; résumé = présentation ; guides en vedette |
| threebestrated.ca | Proposer sa candidature si leurs critères le permettent ; ne jamais payer une place |
| Hypotheca, « Trouver un courtier » | Vérifier la fiche (T2.6) |

**Effort :** 3 à 4 h.

### T2.8 — Présentation type, à reprendre partout (à valider)

> **FR —** Stéphanie Weyman est courtière hypothécaire au cabinet Hypotheca (AMF n° 255885).
> Établie à Repentigny, elle accompagne ses clients partout au Québec, à distance, par Teams,
> téléphone ou texto. Elle compare les offres de plus de 20 prêteurs pour l'achat, le
> renouvellement et le refinancement, y compris pour les travailleurs autonomes, les nouveaux
> arrivants et les dossiers refusés par une banque. Dans la vaste majorité des dossiers, elle est
> rémunérée par le prêteur, et non par le client.

> **EN —** Stéphanie Weyman is a mortgage broker with Hypotheca (AMF no. 255885). Based in
> Repentigny, she works with clients across Quebec remotely, by Teams, phone or text. She compares
> offers from more than 20 lenders for purchases, renewals and refinancing, including for
> self-employed borrowers, newcomers and applicants declined by a bank. In the vast majority of
> files, she is paid by the lender, not by the client.

Ajouter l'année de début une fois D3 tranchée. Ne pas affirmer un service en anglais tant que D3
ne l'a pas confirmé.

---

## 7. Phase 3 — Être choisie : du contenu citable (S2–S12)

### 7.1 Charte d'écriture GEO (pour l'agent contenu)

1. **Une section = une question**, formulée comme on la pose (« Combien coûte un courtier
   hypothécaire au Québec ? »).
2. **Juste sous le titre, une réponse courte qui tient seule** (40 à 70 mots) : le sujet est nommé
   (ni « il », ni « comme on l'a vu ») ; chiffre, unité et date ; la condition principale.
3. **Puis le détail** : étapes numérotées, tableau dès qu'on compare, exemple calculé.
4. **Chiffres datés et sourcés** (« depuis le 15 décembre 2024 », « barème 2027 »), calculés par
   les fonctions du site.
5. **Les institutions par leur nom complet** une fois par page : SCHL, BSIF, Banque du Canada,
   Revenu Québec, AMF, RAP, CELIAPP.
6. **Une source primaire par affirmation réglementaire** (bloc « Sources »).
7. **L'expérience compte** : un cas réel, anonymisé et consenti, présenté comme le résultat d'un
   dossier et non comme une promesse, vaut plus qu'un paragraphe générique.
8. **Pas d'absolus ni de « meilleur ».** Repérer aussi l'existant : « je magasine pour vous le
   meilleur taux » (FAQ de l'accueil) sera cité comme une promesse.
9. **Couvrir les sous-questions** : lister pour chaque page les 5 à 8 questions dérivées (qui
   paie, quand, combien, exceptions, délais) et vérifier qu'une phrase répond à chacune.
10. **En anglais, le vocabulaire anglais réel** : FHSA, HBP, CMHC, welcome tax, prepayment
    penalty, IRD, stress test.

Gabarit à l'annexe E.

### 7.2 Mise à niveau des pages existantes

| Type | À faire |
|------|---------|
| Services (6) | « En bref » en tête (pour qui, ce que fait la courtière, ce que ça coûte) ; FAQ visible (T1.3) ; signature et sources (T2.5) ; lien vers le guide du même sujet |
| Villes (13) | 1er paragraphe = phrase d'identité (nom, AMF, cabinet, basée à Repentigny, à distance ailleurs) ; données locales **quand elles sont vérifiées** : prix médian APCIQ, barème de taxe de bienvenue de la ville calculé pour trois prix ; FAQ en `<details>` ; aucun fait inventé |
| Guides (3) | Bloc « Sources », signature, champ `publie` ; « L'essentiel » existe déjà |
| Accueil | FAQ (T1.1), date des taux (T1.6), lien vers `/a-propos/`, l'exemple 0,30 % calculé |
| Outils | T1.5 |

**Effort :** 3 à 4 jours d'agents, environ 2 h de validation par Stéphanie.

### 7.3 Pages nouvelles, par ordre de priorité

| # | Page | Requêtes visées | Contenu et données (source dans le code) | Qui | Sem. |
|---|------|-----------------|-------------------------------------------|-----|------|
| P1 | `/guides/cout-courtier-hypothecaire/` | « combien coûte un courtier hypothécaire », « courtier ou banque » | Rémunération par le prêteur ; exceptions (prêteurs alternatifs ou privés : frais annoncés d'avance) ; ce que prévoit le contrat de courtage (dont la double rémunération, `DOUBLE_REMUNERATION` dans `contratCourtage.ts`) ; tableau courtier ou banque ; rôle de l'AMF | contenu | S3 |
| P2 | `/guides/taux-fixe-ou-variable/` (en cours) | « fixe ou variable en 2026 » | Appliquer la charte, sources ; sans prévision de taux | contenu | S2 |
| P3 | `/guides/mise-de-fonds-schl/` | « mise de fonds minimale 600 000 $ », « coût assurance SCHL 10 % » | Tableaux calculés : mise minimale par prix (300 k$ à 1,6 M$) avec `miseMinimale`, prime par tranche de ratio avec `tauxPrimeAssurance`, plafond de 1,5 M$, 30 ans et surprime | calculateurs + contenu | S4 |
| P4 | `/guides/penalite-hypothecaire/` | « pénalité hypothécaire Desjardins », « casser son hypothèque à taux fixe » | 3 mois ou IRD ; méthode par prêteur tirée de `preteurs.ts`, **chacune vérifiée sur la page officielle du prêteur, sinon retirée** ; exemple calculé par `calculerPenalite` ; comment la réduire (transfert à l'échéance, portabilité, remboursements anticipés permis) | calculateurs + contenu | S5–S6 |
| P5 | `/guides/lexique-hypothecaire/` | « qu'est-ce que l'IRD », « ABD ATD », « terme vs amortissement » | 40 à 60 termes, une ancre chacun, 1 à 3 phrases et un lien ; balisage `DefinedTermSet` | contenu + seo | S6 |
| P6 | `/outils/taxe-de-bienvenue/` + section par ville | « taxe de bienvenue Terrebonne 450 000 $ » | Page d'outil sur le modèle de la page pénalité ; tableau par ville desservie pour 300, 450, 600 et 800 k$ calculé par `droitsMutation` ; **barèmes 2027 vérifiés à la source municipale, chacun lié** ; « qui paie, quand » seulement si vérifié | calculateurs + contenu | S9 (janvier : les seuils sont indexés au 1er janvier) |
| P7 | `/outils/rap-celiapp/` | « RAP ou CELIAPP », « cumuler RAP et CELIAPP » | Page d'outil, méthode, paramètres 2027 | calculateurs | S10 |
| P8 | `/guides/refinancement/` | « refinancer pour consolider ses dettes » | Équité à 80 %, coûts (pénalité), quand c'est sensé ; exemple calculé | contenu + calculateurs | S10 |
| P9 | `/guides/travailleur-autonome/` | « hypothèque travailleur autonome documents » | Documents, revenu moyen sur deux ans, options | contenu | S11 |
| P10 | `/taux-hypothecaires/` | « taux 5 ans fixe aujourd'hui Québec » | Tableau daté rendu par le serveur, écart taux affiché / taux Hypotheca, taux directeur, méthode ; historique si D8 | calculateurs + 🔒 | S11–S12 |
| P11 | `/guides/nouveaux-arrivants/` | « hypothèque nouvel arrivant » | Très factuel : vérification stricte | contenu | après S12 |

Pas de nouvelles pages villes tant qu'une ville n'a pas ses propres données vérifiées.

### 7.4 Anglais
Chaque page nouvelle entre dans `pagesTraduites.json`. Les requêtes anglaises du panel servent de
contrôle. Les titres anglais emploient les termes cherchés en anglais (« Mortgage broker in
Repentigny », « Quebec welcome tax calculator »).

### 7.5 Calendrier de fraîcheur

| Quand | Quoi | Qui |
|-------|------|-----|
| À chaque annonce de la Banque du Canada (8 par an, dates sur banqueducanada.ca) | Note datée sur la page des taux ou l'accueil, publication sur la fiche Google, LinkedIn | Stéphanie (le texte), contenu |
| Chaque mois | Panel noyau (§ 10), une publication Google, réponses aux avis | Stéphanie |
| Chaque trimestre | Prix médians APCIQ (`prixMedians.ts`), panel complet, revue de ce plan | calculateurs, Stéphanie |
| Chaque janvier | Paramètres fiscaux (RAP, CELIAPP : règle existante), seuils des droits de mutation, dates `revise`, tests | calculateurs, contenu |
| À chaque règle fédérale qui change | Guide, FAQ et outil ensemble (règle existante) | tous |

---

## 8. Phase 4 — Autorité hors site (Stéphanie, en continu)

1. **Avis Google.** Les demander à chaque dossier conclu, au même rythme toute l'année (mieux que
   des vagues). Inviter le client à décrire sa situation dans ses mots : aucun texte suggéré,
   aucune contrepartie. Répondre à chaque avis sans rien révéler du dossier.
2. **Annuaires** : T2.7.
3. **Palmarès et listes** : candidature là où les critères sont publics ; jamais payer une liste
   présentée comme éditoriale.
4. **Partenaires** (le carnet de `/reseau`, gabarits modifiables à l'écran, sans déploiement) :
   proposer aux courtiers immobiliers, notaires et comptables (a) le calculateur de taxe de
   bienvenue et les guides comme ressources pour leurs clients ; (b) un article écrit à deux pour
   leur blogue ; (c) des pages « partenaires » réciproques, seulement là où la relation est réelle.
   Chaque mention est une corroboration par un tiers.
5. **Médias locaux** (hebdos et radios de Repentigny, Terrebonne, Mascouche) : commentaire aux
   annonces de la Banque du Canada, à la saison des renouvellements, aux barèmes de janvier, avec
   les pages de données du site comme référence. Aucune prévision présentée comme certaine.
6. **Vidéo courte** (D9) : 60 secondes par question du panel, chacune liée à sa page ; la
   transcription sur la page ; un lien plutôt qu'un cadre intégré (CSP).
7. **LinkedIn** : un article par mois qui reprend une section de guide et renvoie au site.
8. **À éviter** : créer soi-même une fiche Wikidata ou Wikipédia ; se promouvoir sur Reddit (toute
   prise de parole publique d'une courtière relève des règles de publicité de l'AMF) ; acheter des
   liens ; ne solliciter que les clients satisfaits.

---

## 9. Phase 5 — Agents IA (veille, facultatif)

- **WebMCP** (proposition de Chrome pour exposer les outils d'un site aux agents) : Lighthouse liste
  déjà, à titre informatif, les formulaires sans annotations. Candidats : les calculateurs, qui
  calculent sur place et n'envoient rien. Exclus tant qu'on n'a pas tranché la question du
  consentement : les formulaires de contact (qui consent quand un agent demande un rappel au nom de
  quelqu'un ?). Attendre la sortie de la phase d'essai.
- **Manifeste ARD** (`/.well-known/ard.json`) : spécification naissante que Lighthouse 13.6
  vérifie ; non applicable aujourd'hui. Attendre.
- **Markdown sur demande** (`Accept: text/markdown`) : aucune preuve d'effet, et Google dit que ce
  n'est pas nécessaire. Écarté.
- **Journal des visites de robots** (🔒 middleware) : compteurs quotidiens par robot d'IA connu et
  par page, sans IP, affichés dans `/tableau-de-bord`. Seulement si Bing AI Performance et Umami
  ne suffisent pas.

---

## 10. Mesure continue

### 10.1 L'indice GEO (0 à 100)

```
Indice = 40 × taux de citation + 30 × taux de mention + 20 × exactitude + 10 × hygiène technique
```

- **Taux de citation** : part des observations (requête × moteur) dont la réponse lie
  stephanieweyman.ca (ou `/en/`).
- **Taux de mention** : part des observations où Stéphanie est nommée.
- **Exactitude** : parmi les mentions, part où nom, cabinet, numéro AMF, zone et coût sont justes.
- **Hygiène technique** : part des contrôles `audit-geo` réussis (et fraction Agentic Browsing de
  Lighthouse).

Chaque mois sur le noyau (20 requêtes × 4 moteurs = 80 observations) ; chaque trimestre sur le
panel complet (40 × 6 = 240).

### 10.2 Indicateurs secondaires
Référents IA dans Umami (sessions, pages d'arrivée) ; demandes dont la source déclarée est une IA
(D5) ; citations Copilot dans Bing (nombre, requêtes d'ancrage) ; impressions de marque dans Search
Console ; nombre et note des avis Google ; appels et clics depuis la fiche Google.

### 10.3 Cibles indicatives à 12 semaines (à recaler après la mesure de référence)

| Indicateur | Cible |
|------------|-------|
| Hygiène technique | 100 % : `audit-geo` vert, Lighthouse Agentic 3/3 |
| Requêtes de marque (A) | Réponse exacte et citée dans au moins 4 moteurs sur 6 |
| Requêtes locales (B : Repentigny, Terrebonne, Mascouche) | Nommée dans au moins 25 % des observations |
| Requêtes d'information (C) | Site cité dans au moins 15 % des observations |
| Exactitude | Aucune erreur de fait dans les mentions |
| Référents IA (Umami) | En hausse trois mois de suite |

### 10.4 Rituel mensuel (90 minutes)
1. Panel noyau, au tableur.
2. Umami et Bing AI Performance : relever les chiffres.
3. Une ligne de constats, transformée en tâches.
4. Toute erreur de fait vue dans une réponse d'IA : retrouver la source qui la porte (page,
   annuaire, fiche) et la corriger **là**.

---

## 11. Répartition et lots

| Tâche | Qui | Fichiers | Zone | Contrôle |
|-------|-----|----------|------|----------|
| T1.1, T1.2 | design | `Faq.astro`, `FaqDetails.astro` (nouveau), 13 pages villes | libre | audit-geo L1, audit-mobile, i18n-extraire |
| T1.3 | contenu, puis design | `services/*.astro`, `i18n-en.json` | libre | L1, L2 |
| T1.4, T1.5 | calculateurs | `outils/…penalite…astro`, `outils.astro` | libre | L2, L5 |
| T1.6 | session principale | `TauxSection.astro`, `api/bdc-rate.ts`, `services/bdcRateService.ts` | 🔒 | L6, tests du service |
| T1.7 | session principale ou seo | `scripts/audit-geo.mjs`, `package.json` | libre | — |
| T1.8 | seo (zone élargie) | `src/pages/llms.txt.ts`, `src/utils/llmsTxt.ts`, `public/llms.txt` (supprimé) | libre | `llmsTxt.test.ts`, S1 |
| T1.10 | session principale | `netlify.toml`, extension locale, `astro.config.mjs` | 🔒 | S2 |
| T1.11 | session principale | `ratesService`, `servirAnglais` | 🔒 | mesure du temps de réponse |
| T2.1 | seo ou session principale | `src/data/fiche.ts` (ou `siteConfig.json` 🔒) | selon D3 | — |
| T2.2 | contenu, seo, design | `src/pages/a-propos.astro`, `Nav.astro`, `pagesTraduites.json` | libre | L1–L4 |
| T2.3 | seo | `SEO.astro`, `schemaSite.ts`, `index.astro` (head), `schemaVille.ts` | libre | `schemaSite.test.ts`, L4 |
| T2.4 | session principale | `traductionPage.ts` | 🔒 | `servirAnglais.test.ts` |
| T2.5 | contenu, seo, design | guides, services, outils | libre | — |
| P1 à P11 | voir § 7.3 | `src/pages/guides/…`, `src/pages/outils/…` | libre (P10 🔒) | audit-geo, `guides.test.ts` |

**Lots pour les agents en parallèle (sans fichier commun) :**
- **Lot A (S1)** : design (T1.1, T1.2) · seo (T2.3 partie 1, T1.8) · session principale (T1.7).
- **Lot B (S2)** : contenu puis design (T1.3, en séquence) · calculateurs (T1.4, T1.5) · session
  principale (T1.6 🔒).
- **Lot C (S3–S5)** : T2.1 → T2.2 → T2.3 partie 2 ; T2.4 🔒 ; T2.5 ; T1.10 🔒 ; P1 et P3.
- `public/js/i18n-en.json` est partagé : chacun n'ajoute que ses clés, sans réordonner (règle
  existante).

---

## 12. Calendrier sur 12 semaines

| Sem. | Lundi | Développement et agents | Stéphanie |
|------|-------|-------------------------|-----------|
| S1 | 9 nov. | T1.7 ; T1.1–T1.2 ; T2.3 partie 1 ; T1.9 ; T0.6 | T0.1 panel (2 h) ; T0.2–T0.4 (1 h) ; décisions § 13 |
| S2 | 16 nov. | T1.3 ; T1.4 ; T1.6 🔒 ; T1.8 ; fin du guide taux fixe ou variable | Valider les 18 réponses des services ; T2.6 |
| S3 | 23 nov. | T1.5 ; T1.10 🔒 ; T2.1 ; P1 | Valider la fiche (année, langues, terme AMF) ; fiche Google |
| S4 | 30 nov. | T2.2 ; T2.3 partie 2 ; P3 | Texte de `/a-propos/` (1 h) ; Bing Places, Apple, PagesJaunes |
| S5 | 7 déc. | T2.4 🔒 ; T2.5 ; T1.11 🔒 | Demandes d'avis aux dossiers conclus en 2026 |
| S6 | 14 déc. | P4 (vérification des prêteurs) ; P5 ; mesure M1 | Valider P4 ; profil et premier article LinkedIn |
| S7 | 21 déc. | Congés : correctifs issus de M1 | — |
| S8 | 28 déc. | Préparer janvier : relever les sources des paramètres 2027 (RAP, CELIAPP, seuils des droits de mutation) | — |
| S9 | 4 janv. | Rituel de janvier ; P6 ; dates `revise` | Valider les barèmes 2027 ; proposer un sujet « taxe de bienvenue 2027 » aux médias locaux |
| S10 | 11 janv. | P7 ; P8 ; mise à niveau des villes (§ 7.2) | Gabarit « ressources » pour les partenaires dans `/reseau` |
| S11 | 18 janv. | P9 ; P10 (si D8) ; mesure M2 | — |
| S12 | 25 janv. | Bilan : panel complet, indice GEO comparé à la référence, Bing AI Performance ; plan du trimestre suivant | Bilan (30 min) |

**Effort total estimé :** phase 0, ½ jour de développement et 3 h de Stéphanie ; phase 1, 6 à 7
jours ; phase 2, 4 à 5 jours et 5 h de Stéphanie ; phase 3, 12 à 15 jours d'agents et environ 1 h
de validation par page ; phase 4, 1 à 2 h par semaine pour Stéphanie ; phase 5, facultative (2 à 4
jours).

---

## 13. Décisions à prendre

| # | Décision | Recommandation |
|---|----------|----------------|
| D1 | Robots d'entraînement (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot) : admis ou bloqués ? | **Admis.** Être apprise par les prochains modèles aide la notoriété ; le site n'a rien à protéger. Bloquer Google-Extended couperait aussi l'ancrage dans l'application Gemini |
| D2 | Créer `/a-propos/` et y faire pointer « À propos » | **Oui** |
| D3 | Faits de la fiche : année de début (trois ou quatre ans ?), langues de service, terme exact du registre AMF, numéro AMF du cabinet, adresse de la fiche Google, adresse au registre ; `fiche.ts` ou `siteConfig.json` | Stéphanie fournit les faits ; **`fiche.ts`** pour les phrases, `siteConfig.json` pour les coordonnées qu'elle modifie elle-même |
| D4 | Feux verts 🔒 : `src/services/` (T1.6, T2.4, T1.11), `astro.config.mjs` (T1.10), `netlify.toml` (T1.10), `siteConfig.json` (selon D3) | **Oui pour T1.6, T2.4 et T1.10** ; T1.11 après mesure |
| D5 | Question facultative « Comment avez-vous entendu parler de moi ? » (option « ChatGPT ou une autre IA ») sur le formulaire de contact et `/demande` — 🔒 API, `CHAMPS_CONSERVES` (champ non sensible), politique de confidentialité | **Oui** : beaucoup de visites influencées par une IA arrivent ensuite en direct ou par une recherche du nom ; seule la réponse du client les rattache |
| D6 | Panel manuel ou outil payant de suivi (Otterly.AI, Peec AI…) | **Manuel au départ** ; un outil si le rituel dépasse 90 min |
| D7 | Pages d'outil dédiées (taxe de bienvenue, RAP ou CELIAPP) sur le modèle de la page pénalité | **Oui** : une adresse par sujet se cite mieux qu'un onglet |
| D8 | Historique des taux : garder chaque relevé (🔒 `ratesService`, Blobs) et publier l'écart taux affiché / taux Hypotheca | Oui, **avec l'accord d'Hypotheca**, source des taux |
| D9 | Vidéo courte (YouTube, LinkedIn) | Oui si Stéphanie est à l'aise ; un lien, pas un cadre intégré |
| D10 | Adresse publiée dans les annuaires : celle d'Hypotheca (comme le balisage) ou une zone de service sans adresse (comme la fiche Google le permet) | Celle que porte déjà la fiche Google ; la même partout |

---

## 14. Risques

| Risque | Parade |
|--------|--------|
| Un chiffre faux devient « la » réponse des IA | Chiffres calculés par les fonctions ; sources primaires ; validation de Stéphanie ; retirer plutôt que nuancer |
| Publicité non conforme (AMF) | Relecture par Stéphanie ; ni « meilleur » ni promesse ; avertissement daté |
| Contenu jugé « produit à grande échelle » | Aucun gabarit répété sans donnée propre ; aucune ville nouvelle sans données locales |
| Mesure bruitée (réponses variables, personnalisées) | 4 moteurs, fenêtre privée, captures, tendance sur trois mois |
| Les moteurs changent leurs règles | Revue trimestrielle du plan ; sources datées |
| Décalage entre le français et l'anglais | `i18n-extraire.mjs` et `audit-geo.mjs` sur `/en/` |
| Régression de lisibilité | `audit-geo.mjs` avant chaque fusion |
| Temps de Stéphanie sous-estimé | Tâches hors site regroupées, 1 à 2 h par semaine, demandes rédigées d'avance |

---

## Annexe A — Panel de requêtes (★ = noyau mensuel)

**A. Marque et entité**
1. ★ Qui est Stéphanie Weyman, courtière hypothécaire ?
2. ★ Stéphanie Weyman Hypotheca : avis ?
3. Stéphanie Weyman est-elle autorisée par l'AMF ?
4. Comment joindre Stéphanie Weyman, courtière hypothécaire ?
5. ★ Who is Stéphanie Weyman, mortgage broker in Quebec?

**B. Recommandation locale**
6. ★ Quel courtier hypothécaire me recommandes-tu à Repentigny ?
7. ★ Meilleur courtier hypothécaire à Terrebonne
8. Courtier hypothécaire à Mascouche disponible le soir
9. ★ Courtier hypothécaire dans Lanaudière pour un premier achat
10. Courtier hypothécaire sur la Rive-Nord de Montréal pour un renouvellement
11. Courtier hypothécaire pour travailleur autonome à Laval
12. ★ Ma banque m'a refusé un prêt hypothécaire à Repentigny, qui peut m'aider ?
13. Courtier hypothécaire pour nouvel arrivant à Montréal
14. Mortgage broker in Repentigny
15. ★ Best mortgage broker in Terrebonne

**C. Information (le site doit y être cité)**
16. ★ Combien coûte un courtier hypothécaire au Québec ?
17. ★ Courtier hypothécaire ou banque pour renouveler ?
18. ★ Quelle mise de fonds minimale pour une maison de 600 000 $ au Québec ?
19. Combien coûte l'assurance SCHL avec 10 % de mise de fonds ?
20. ★ Comment calculer la taxe de bienvenue à Terrebonne pour 450 000 $ ?
21. Taxe de bienvenue à Repentigny en 2027
22. ★ Comment Desjardins calcule-t-il la pénalité hypothécaire ?
23. Combien coûte casser une hypothèque à taux fixe avant la fin du terme ?
24. ★ RAP ou CELIAPP pour une première maison ?
25. Peut-on cumuler le RAP et le CELIAPP ?
26. ★ Taux fixe ou variable : comment choisir ?
27. Quand commencer à magasiner son renouvellement hypothécaire ?
28. Qu'est-ce que le test de résistance hypothécaire ?
29. Amortissement de 30 ans : qui y a droit ?
30. ★ Combien puis-je emprunter avec un salaire de 85 000 $ ?
31. Hypothèque pour travailleur autonome : quels documents ?
32. Différence entre pré-approbation et approbation hypothécaire
33. ★ How is the welcome tax calculated in Laval?
34. FHSA or HBP for a first home in Quebec?
35. What is the prepayment penalty on a TD fixed mortgage?

**D. Données du jour**
36. ★ Quel est le taux hypothécaire 5 ans fixe aujourd'hui au Québec ?
37. Écart entre le taux affiché et le taux réel des banques
38. Taux directeur actuel de la Banque du Canada et effet sur le taux variable
39. Current 5-year fixed mortgage rate in Quebec
40. Prix médian d'une maison à Repentigny (quand le chiffre APCIQ sera publié)

## Annexe B — `robots.txt` proposé

```
# stephanieweyman.ca — exploration
#
# Tous les robots sont admis, ceux des moteurs génératifs compris : robots d'index
# (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, bingbot…), de consultation à la
# demande (ChatGPT-User, Claude-User, Perplexity-User…) et d'entraînement (GPTBot, ClaudeBot,
# Google-Extended, Applebot-Extended, CCBot…). Être lue et apprise par ces moteurs fait partie de
# la stratégie : voir PLAN-GEO-2026-11.md, décision D1.
#
# Les écrans privés ne sont pas énumérés ici : protégés par mot de passe et en noindex, les lister
# publierait leurs adresses (même raison que le sitemap en liste blanche).

User-agent: *
Allow: /

Sitemap: https://stephanieweyman.ca/sitemap-index.xml
```

## Annexe C — Structure du `llms.txt` produit au build

```
# Stéphanie Weyman — courtière hypothécaire (Hypotheca, AMF 255885)

> {présentation T2.8, tirée de fiche.ts}

Site en français (fr-CA) ; version anglaise sous /en/. Les taux affichés changent chaque jour :
consultez la page plutôt qu'un taux mémorisé.

## Faits
- Rémunération : {fiche.remuneration}
- Prêteurs comparés : {fiche.preteurs}
- Accompagnement : {fiche.modes}
- Délai de réponse : {fiche.delaiReponse}
- Zone : {villes.ts} ; ailleurs au Québec, à distance
- AMF : 255885 — {lien du registre, si stable}

## Guides                      ← guides.ts (titre, résumé, mois de révision)
- [Premier achat au Québec, étape par étape](https://stephanieweyman.ca/guides/premier-achat/): {résumé} — mis à jour en novembre 2026

## Outils                      ← liste des outils, une ligne chacun
## Services                    ← résumés tenus dans llmsTxt.ts ; un résumé manquant fait échouer le test
## Courtière hypothécaire par ville   ← villes.ts
## À propos et rendez-vous     ← /a-propos/, /rendez-vous/, téléphone, courriel
## English                     ← /en/ et les guides en anglais
## Optional                    ← /conditions/, /confidentialite/
```

## Annexe D — JSON-LD cible

```jsonc
// #business — émis par SEO.astro sur chaque page indexable
{
  "@context": "https://schema.org",
  "@type": "FinancialService",
  "@id": "https://stephanieweyman.ca#business",
  "name": "Stéphanie Weyman — Courtière hypothécaire",
  "alternateName": "Stéphanie Weyman",
  "url": "https://stephanieweyman.ca/",
  "telephone": "+15149497627",
  "email": "sweyman@hypotheca.ca",
  "address": { /* ADRESSE_ENTREPRISE, inchangée */ },
  "geo": { /* inchangé */ },
  "openingHoursSpecification": [ /* inchangé */ ],
  "areaServed": [
    /* une City par entrée de villes.ts */
    { "@type": "AdministrativeArea", "name": "Québec" }
  ],
  "parentOrganization": { "@type": "Organization", "name": "Hypotheca", "url": "https://hypotheca.ca" },
  "sameAs": ["https://www.facebook.com/stephanieweymanhypotheque/", "<adresse de la fiche Google>"],
  "description": "…",
  "serviceType": ["Courtage hypothécaire", "Prêt hypothécaire", "Refinancement", "Renouvellement hypothécaire"]
  // retirés : priceRange, hasCredential (passe sur la personne), aggregateRating (bloc de l'accueil)
}

// #stephanie — émis par SEO.astro ; les guides et les villes y renvoient par @id
{
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://stephanieweyman.ca#stephanie",
  "name": "Stéphanie Weyman",
  "jobTitle": "Courtière hypothécaire",
  "url": "https://stephanieweyman.ca/a-propos/",
  "image": "<photo importée, .src>",
  "worksFor": { "@id": "https://stephanieweyman.ca#business" },
  "affiliation": { "@type": "Organization", "name": "Hypotheca", "url": "https://hypotheca.ca" },
  "hasCredential": { /* celui de schemaCourtiere, terme selon D3 */ },
  "knowsLanguage": ["fr" /* , "en" selon D3 */],
  "knowsAbout": ["Prêt hypothécaire", "Renouvellement hypothécaire", "Refinancement hypothécaire",
                 "Pénalité de remboursement anticipé", "Assurance prêt hypothécaire",
                 "Régime d'accession à la propriété", "CELIAPP", "Droits de mutation immobilière"],
  "areaServed": { "@type": "AdministrativeArea", "name": "Québec" },
  "sameAs": ["https://www.linkedin.com/in/st%C3%A9phanie-weyman-12208b3bb/",
             "https://hypotheca.ca/sweyman", "https://sweyman.hypotheca.ca/"]
}

// /a-propos/
{ "@context": "https://schema.org", "@type": "ProfilePage",
  "url": "https://stephanieweyman.ca/a-propos/",
  "mainEntity": { "@id": "https://stephanieweyman.ca#stephanie" },
  "dateModified": "<date de révision de la page>" }

// Article (guides) : ajouts
{ "datePublished": "<guides.ts : publie>", "dateModified": "<guides.ts : revise>",
  "citation": [{ "@type": "CreativeWork", "name": "<titre de la source>", "url": "<adresse relevée>" }] }
```

## Annexe E — Gabarit d'une section « réponse d'abord »

```html
<section id="cout-courtier" aria-labelledby="cout-courtier-titre">
  <h2 id="cout-courtier-titre">Combien coûte un courtier hypothécaire au Québec ?</h2>
  <p class="gd-reponse"><strong>En bref :</strong> {40 à 70 mots qui se comprennent seuls :
     sujet nommé, chiffre avec unité et date, condition principale}</p>
  <p>{détail}</p>
  <table>{comparaison, chiffres calculés au rendu}</table>
  <p class="gd-cas"><strong>Cas vécu :</strong> {dossier réel, anonymisé, consenti — un résultat, pas une promesse}</p>
</section>
…
<aside class="gd-sources" aria-labelledby="sources-titre">
  <h2 id="sources-titre">Sources</h2>
  <ul>
    <li>{Institution}, « {titre de la page} », <a href="{adresse relevée}">{domaine}</a>, consulté en novembre 2026.</li>
  </ul>
</aside>
```

Classes à créer par l'agent design dans `global.css` (aucun style en ligne : CSP).

## Annexe F — `scripts/audit-geo.mjs`

```
node scripts/audit-geo.mjs <adresse de base> [--json rapport.json] [--pages /,/outils/]
```

Pages contrôlées : `pagesTraduites.json` moins `NOINDEX`, en français et sous `/en/`.

| Contrôle | Règle |
|----------|-------|
| L1 | Chaque réponse du `FAQPage` (60 premiers caractères normalisés) se retrouve dans le texte extrait par Readability |
| L2 | Chaque question du `FAQPage` figure dans le texte visible (hors `<script>`) ; après T2.4, toute FAQ visible en anglais a son `FAQPage` |
| L3 | Les mots sous `[hidden]` ou `[aria-hidden="true"]` font moins de 10 % du texte de `<main>` ; seule exemption : les panneaux d'outils de `/outils/`, si L5 passe |
| L4 | Ni `aggregateRating` ni `priceRange` ; tout nœud `FinancialService` porte l'`@id` `#business` ; un `#stephanie` sur l'accueil et sur chaque guide |
| L5 | `/outils/` : chaque outil a au moins 120 mots lisibles hors des onglets |
| L6 | Une page qui affiche des taux porte un `<time datetime>` dans la section des taux |
| S1 | `/llms.txt` : un H1, un lien Markdown par page indexable, aucune page noindex ni privée, moins de 50 Ko |
| S2 | Sitemap : une `lastmod` par guide, égale à `guides.ts` |
| S3 | `robots.txt` n'interdit aucun des robots de l'annexe B et ne nomme aucune route privée |

Sortie : un tableau par page ; code 1 si un contrôle échoue. Le script de la § 2.2 en est le point
de départ.

## Annexe G — Commandes de vérification

```bash
# Robots d'IA : statut et temps de première réponse
for ua in "GPTBot/1.2" "OAI-SearchBot/1.0" "ClaudeBot/1.0" "Claude-User/1.0" "PerplexityBot/1.0" "bingbot/2.0"; do
  curl -s -o /dev/null -w "$ua %{http_code} %{time_starttransfer}s\n" \
    -A "Mozilla/5.0 (compatible; $ua)" https://stephanieweyman.ca/
done

# Ce que lit un robot sans JavaScript : la date des taux (après T1.6)
curl -s https://stephanieweyman.ca/ | grep -o '<time[^>]*>[^<]*</time>'

# Lighthouse : préparation aux agents et SEO (Chrome 150 ou plus récent)
npx lighthouse@13 https://stephanieweyman.ca/ --only-categories=agentic-browsing,seo \
  --form-factor=mobile --chrome-flags="--headless=new" --output=html --output-path=./lh-accueil.html

# Lisibilité (après T1.7), serveur de dev lancé
node scripts/audit-geo.mjs http://localhost:4321
```

## Annexe H — Référents IA

**Umami :** rapport des référents filtré sur `chatgpt.com`, `perplexity.ai`, `gemini.google.com`,
`copilot.microsoft.com`, `claude.ai`, `chat.mistral.ai`, plus le paramètre
`utm_source=chatgpt.com` que ChatGPT ajoute à ses liens. Umami ne pose pas de témoin : il voit tous
les visiteurs, contrairement à GA4.

**GA4 :** groupe de canaux personnalisé, canal « IA générative » placé **au-dessus** de
« Referral », condition « Source de la session » correspondant à l'expression régulière :

```
chatgpt|openai|perplexity|gemini\.google|copilot|claude\.ai|mistral|meta\.ai|you\.com|poe\.com|deepseek
```

Le Mode IA et les AI Overviews arrivent comme `google` : impossible à isoler, d'où le panel.

## Annexe I — Sources consultées (8 novembre 2026)

- Google Search Central, consignes des extraits d'avis : https://developers.google.com/search/docs/appearance/structured-data/review-snippet
- Google Canada, « Le Mode IA est maintenant disponible en français » (14 octobre 2025) : https://blog.google/intl/fr-ca/produits/explorez-obtenez-des-reponses/le-mode-ia-est-maintenant-disponible-en-francais/
- Chrome, Lighthouse Agentic Browsing : https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring ; code de Lighthouse 13.6.0 (audits `llms-txt`, `ard-schema`, `webmcp-*`)
- Search Engine Journal, l'audit `llms.txt` de Lighthouse et les liens Markdown : https://www.searchenginejournal.com/lighthouse-fails-your-llms-txt-without-markdown-links/577590/
- PPC Land, adoption de `llms.txt` et requêtes des IA : https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/
- Momentic, robots et agents d'IA (mise à jour d'octobre 2026) : https://momenticmarketing.com/blog/ai-search-crawlers-bots
- Rapport AI Performance de Bing Webmaster Tools : https://www.practicalecommerce.com/bings-improved-ai-performance-section ; https://searchengineland.com/bing-webmaster-tools-testing-new-ai-performance-report-468039
- Aggarwal et al., « GEO: Generative Engine Optimization », KDD 2024 : https://arxiv.org/abs/2311.09735
- Résultats locaux : https://threebestrated.ca/fr-courtiers-hypoth%C3%A9caires-in-repentigny-qc ; https://www.yellowpages.ca/bus/Quebec/Repentigny/Multi-Pret-Hypotheque/101464689.html
- Fiches Hypotheca : https://hypotheca.ca/sweyman ; https://sweyman.hypotheca.ca
