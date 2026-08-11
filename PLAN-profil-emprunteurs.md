# Plan — Page « Profil des emprunteurs » (formulaire AMF)

**Objectif :** permettre au client de remplir le formulaire *Profil des emprunteurs* d'Hypotheca
depuis une page du site, en cliquant des tuiles, sans jamais voir le PDF — et produire à la fin
**le PDF officiel identique au modèle**, rempli et signé électroniquement.

**Contrainte non négociable :** le document généré doit être *tel quel*. On ne recrée pas le
formulaire : on **estampe le PDF original**. Aucun pixel du modèle n'est reconstruit.

---

## 1. Faisabilité — déjà validée

Un POC a été exécuté sur le modèle fourni (`pdf-lib` + le PDF original) : les 30 cases à cocher,
le champ « Autre : ____ $ » et les 3 lignes de signature ont été estampés aux coordonnées
extraites du document. **Le rendu est correct dès la première passe.**

Constats sur le modèle (1 page, 612 × 792 pt, US Letter) :

| Élément | Constat |
|---|---|
| Champs de formulaire AcroForm | **Aucun** (0 champ) — l'estampage par coordonnées est donc la seule voie |
| Cases à cocher | 30 glyphes `□` en 16 pt, coordonnées toutes extraites (voir §5) |
| Nom de la courtière + n° AMF | **Déjà pré-remplis** dans le modèle (calque Acrobat Fill & Sign, `BBox` 218–533 × 667–684). Rien à ajouter. |
| Logo Hypotheca | Image `/Im0` en haut à gauche, intacte |
| Poids | 315 Ko (dominé par le logo) |

---

## 2. Décisions arrêtées

| Sujet | Décision |
|---|---|
| Signature | **Nom tapé + case d'attestation.** Le nom est rendu en italique sur la ligne de signature, la date du jour à côté. L'horodatage + IP + user-agent vont dans le **courriel interne**, pas dans le PDF (pour préserver le « tel quel »). |
| Emprunteurs | **Jusqu'à 3, réponses communes** — conforme à l'esprit du document (« vision commune »). Une soumission, un PDF. |
| Livraison | **Les trois :** courriel à Stéphanie avec PDF en pièce jointe, copie au client, et bouton de téléchargement sur l'écran de confirmation. |
| Accès | **Lien privé, `noindex`, sans Nav ni Footer** (même posture que `/refinancement-v2`). Stéphanie envoie le lien à ses clients. |

---

## 3. Architecture

Aucun nouveau service externe. On réutilise `emailService.ts` (Resend + pièces jointes base64 +
rate-limit + honeypot), les classes `quiz-*` de `global.css`, et le pattern de funnel de
`/refinancement-v2`.

**Une seule nouvelle dépendance : `pdf-lib`** (~450 Ko, pur JS, aucune dépendance native —
fonctionne dans les fonctions Netlify).

### Fichiers à créer

| Fichier | Rôle |
|---|---|
| `src/utils/profilEmprunteurs.ts` | **Source de vérité partagée** page ↔ API : les 8 questions, leurs options (clé + libellé + coordonnées de la case), et les helpers de validation. Sert de whitelist côté serveur. |
| `src/utils/profilEmprunteurs.test.ts` | Tests Vitest : intégrité du catalogue (30 coordonnées uniques), validation des payloads, cas limites du champ « Autre ». |
| `src/data/profilEmprunteursModele.ts` | Le PDF modèle encodé en base64 (voir §4 pour le pourquoi). |
| `src/services/profilPdfService.ts` | `genererProfilPdf(reponses) → Uint8Array` : charge le modèle, estampe les coches, le montant « Autre », les noms et dates de signature. |
| `src/pages/profil-emprunteur.astro` | La page-funnel (`prerender = true`, `noindex`, sans Nav/Footer). |
| `src/pages/api/profil-submit.ts` | Validation stricte → génération du PDF → 2 courriels → renvoie le PDF en base64 pour le téléchargement. |

### Fichiers à modifier

| Fichier | Modification |
|---|---|
| `package.json` | ajouter `pdf-lib` |
| `CLAUDE.md` | ajouter la route + l'API au tableau des pages |
| `netlify.toml` | **rien** — `src/data/**`, `src/utils/**` et `src/services/**` sont déjà dans `included_files` |

---

## 4. Comment le modèle PDF vit à l'exécution

Trois options ont été considérées :

1. **Module base64 (`src/data/profilEmprunteursModele.ts`) — retenu.** Le PDF (315 Ko → ~420 Ko
   en base64) devient une constante TypeScript importée normalement. Aucun accès disque, aucune
   config de build, aucun risque de chemin relatif cassé dans la fonction Netlify. Un petit
   script de génération (`scripts/encode-modele.mjs`) permet de régénérer le module si Hypotheca
   met le formulaire à jour.
2. `readFileSync` depuis `src/data/forms/*.pdf` — dépend du `cwd` de la fonction Netlify, fragile.
3. `fetch` du PDF depuis `public/forms/` — ajoute un aller-retour réseau par soumission et expose
   le modèle vierge publiquement.

> ⚠️ Le dépôt grossit de ~420 Ko. Acceptable, et c'est le prix de la fiabilité.

---

## 5. Coordonnées d'estampage (extraites et vérifiées)

Repère PDF (origine bas-gauche), position du glyphe `□`. La coche est un chevron vectoriel tracé
dans la case — pas un caractère, donc aucune dépendance de police.

| Question | Options → `[x, y]` |
|---|---|
| 1. Niveau d'expérience | Réduit `[28.1, 508.8]` · Moyen `[28.1, 490.2]` · Excellent `[28.1, 471.5]` |
| 2. Connaissances des produits | Réduites `[28.1, 422.9]` · Moyennes `[28.1, 404.3]` · Élevées `[28.1, 385.6]` |
| 3. Capacité d'absorption | 0 $ `[28.1, 340.9]` · 100 $ `[113.2, 340.9]` · 250 $ `[198.2, 340.9]` · 500 $ `[283.2, 340.9]` · Autre `[354.1, 340.9]` |
| 4. Remboursement avant terme | `[28.1 / 113.2 / 198.2 / 283.2, 304.3]` |
| 5. Apports en capital (> 15 %) | `[28.1 / 113.2 / 198.2 / 283.2, 267.7]` |
| 6. Besoin de liquidités (5 ans) | `[28.1 / 113.2 / 198.2 / 283.2, 231.1]` |
| 7. Confort avec un prêteur virtuel | `[28.1 / 113.2 / 198.2 / 283.2, 194.5]` |
| 8. Priorité de remboursement | Vite `[28.1, 157.8]` · Petit paiement `[28.1, 143.2]` · Moins d'intérêt `[28.1, 128.5]` |

**Champs texte :**

| Champ | Zone |
|---|---|
| Montant « Autre » | ligne pointillée `x 395–479`, `y 340.9` — écrire à `x ≈ 398`, sans le « $ » (le modèle en a déjà un en fin de ligne) |
| Signature emprunteur 1 / 2 / 3 | `x 141–330`, `y 96.2 / 71.8 / 47.4` — nom en Helvetica oblique 13 pt |
| Date 1 / 2 / 3 | `x 381–478`, mêmes `y` — date du jour en fr-CA (`formatDateLong`) |

Ces valeurs vivent dans `profilEmprunteurs.ts`, jamais en dur dans le service PDF.

---

## 6. Parcours client (la page)

Structure identique à `/refinancement-v2` : une tuile par question, **le clic sélectionne et fait
avancer automatiquement** (~250 ms de délai pour voir la sélection), barre de progression, bouton
« ← Retour ». Le client ne voit jamais le PDF pendant le parcours.

**11 étapes :**

| # | Contenu |
|---|---|
| 0 | **Intro** — « Ce court questionnaire aide Stéphanie à vous recommander le bon produit. 2 minutes. » + la mention du document sur la réponse commune si plusieurs emprunteurs. |
| 1–8 | Les 8 questions, une par écran, en tuiles cliquables. L'étape 3 (capacité d'absorption) ouvre un champ montant si « Autre » est choisi — c'est la seule étape qui ne s'auto-avance pas dans ce cas. |
| 9 | **Récapitulatif** — les 8 réponses en liste, chacune modifiable d'un clic (retour à l'étape). C'est ici qu'on remplace la lecture du PDF. |
| 10 | **Identité et attestation** — emprunteur 1 (nom complet + courriel, requis), emprunteurs 2 et 3 ajoutables (« + Ajouter un co-emprunteur », nom requis, courriel optionnel), case d'attestation : *« Nous confirmons que ces réponses reflètent notre vision commune et valent signature électronique. »* + honeypot. |
| 11 | **Confirmation** — « C'est envoyé » + bouton **Télécharger mon profil (PDF)**. |

Détails :
- Le JS vit dans un bloc `<script>` de la page `.astro` (Astro le compile en fichier externe →
  compatible avec la CSP actuelle, pas de `unsafe-inline` exécutable). Même approche que
  `refinancement-v2.astro`.
- Reprise après rechargement : état sérialisé dans `sessionStorage` (le formulaire est plus long
  que les funnels existants, perdre 8 réponses sur un rafraîchissement serait coûteux).
- Accessibilité : `role="group"` + `aria-labelledby` par question, focus déplacé sur le titre de
  l'étape à chaque avancée, tuiles atteignables au clavier (déjà géré par `.quiz-card`).
- Aucune donnée financière n'est demandée — c'est un questionnaire de préférences.

---

## 7. API `/api/profil-submit`

`export const prerender = false`. Même squelette que `refinancement-v2-submit.ts` :

1. Honeypot (`company` non vide → 200 silencieux, aucun courriel).
2. `checkRateLimit(ip, 'profil')`.
3. **Validation stricte contre le catalogue** : chaque réponse doit être une clé connue de
   `profilEmprunteurs.ts` (whitelist). Le montant « Autre » : entier, 1 – 100 000, requis si et
   seulement si l'option « Autre » est choisie. 1 à 3 emprunteurs, nom 2–60 caractères, courriel
   de l'emprunteur 1 valide, attestation `=== true`. Tout écart → 400.
4. `genererProfilPdf()` → `Uint8Array` → base64.
5. Deux envois Resend en parallèle :
   - **Interne** → `RESEND_NOTIFY_EMAIL` : PDF en pièce jointe (`profil-emprunteurs-<nom>-<date>.pdf`),
     corps HTML avec les 8 réponses en tableau, les emprunteurs, et le **bloc de preuve de
     signature** (horodatage ISO, IP, user-agent, texte exact de l'attestation). `reply_to` =
     courriel du client.
   - **Client** → même PDF en pièce jointe, message court de confirmation, signature de Stéphanie
     (`renderSignatureBlock()`).
6. Réponse `{ ok: true, pdf: "<base64>", filename: "..." }` → la page reconstruit un `Blob` et
   arme le bouton de téléchargement. **Aucun stockage du PDF côté serveur** : rien à purger, rien
   à sécuriser au repos.

> À valider en `netlify dev` : le téléchargement via URL `blob:`. Si la CSP le bloque (peu
> probable — une navigation de téléchargement n'est pas couverte par les directives de *fetch*),
> le repli est un `object-src blob:` ciblé dans `netlify.toml`.

---

## 8. Ordre de travail

| # | Lot | Détail | Effort |
|---|---|---|---|
| 1 | Socle données | `profilEmprunteurs.ts` (catalogue + coordonnées + validation) et ses tests | ~1 h |
| 2 | Modèle + PDF | `npm i pdf-lib`, script d'encodage, `profilEmprunteursModele.ts`, `profilPdfService.ts` | ~1 h — **le POC est déjà écrit, il s'agit de le porter** |
| 3 | API | `profil-submit.ts` + gabarits de courriels | ~1 h 30 |
| 4 | Page | `profil-emprunteur.astro` + JS du funnel (11 étapes, récap, sessionStorage) | ~2 h 30 |
| 5 | Finition | `npm run check`, `npx vitest run`, essai bout-en-bout en `netlify dev`, ouverture du PDF résultant dans Acrobat + Aperçu, ajout au `CLAUDE.md` | ~1 h |

Chaque lot est indépendamment testable ; les lots 1–3 peuvent être validés sans interface, en
appelant l'API avec `curl`.

---

## 9. Points à trancher avec Stéphanie

1. **La signature tapée est-elle acceptable pour son dossier de conformité AMF ?** C'est la seule
   vraie question réglementaire. Si son cabinet exige un tracé manuscrit, on remplace l'étape 10
   par un canevas de signature — le reste du plan ne bouge pas (seul l'estampage change : image
   au lieu de texte, mêmes coordonnées).
2. **Conservation.** Ici le PDF n'existe que dans les deux courriels. Si elle veut un archivage
   automatique (Netlify Blobs, Drive), c'est un ajout à prévoir — non inclus.
3. **Loi 25.** Le formulaire ne recueille aucun renseignement financier, mais il recueille des
   noms et courriels : un lien vers `/confidentialite` sera placé à l'étape 10.
4. **Mise à jour du modèle.** Si Hypotheca révise le formulaire, les coordonnées changent. Le
   script d'encodage réimprimera le modèle, mais les coordonnées devront être réextraites — c'est
   documenté en tête de `profilEmprunteurs.ts`.

---

## 10. Hors périmètre

- Signature manuscrite tracée (voir §9.1)
- Envoi de liens personnalisés / jetons par client
- Archivage ou tableau de bord des profils reçus
- Remplissage partagé entre plusieurs appareils (chaque emprunteur son lien)
- Traduction anglaise de la page
