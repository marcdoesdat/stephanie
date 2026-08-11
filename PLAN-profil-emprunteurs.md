# Plan — Page « Profil des emprunteurs » (formulaire AMF)

**Objectif :** permettre au client de remplir le formulaire *Profil des emprunteurs* d'Hypotheca
depuis une page du site, en cliquant des tuiles, sans jamais voir le PDF — et produire à la fin
**le PDF officiel identique au modèle**, rempli et signé.

**Contrainte non négociable :** le document généré doit être *tel quel*. On ne recrée pas le
formulaire : on **estampe le PDF original**. Aucun pixel du modèle n'est reconstruit.

---

## 1. Faisabilité — déjà validée

Un POC a été exécuté sur le modèle fourni (`pdf-lib` + le PDF original). Les 30 cases à cocher, le
champ « Autre : ____ $ », les **signatures manuscrites** et les dates ont été estampés aux
coordonnées extraites du document. **Le rendu est correct.**

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
| Signature | **Dessinée** — canevas tactile, tracé exporté en PNG transparent et estampé sur la ligne. Voir §6 (technique) et §7 (assurance). |
| Emprunteurs | **Jusqu'à 3, réponses communes** — conforme à l'esprit du document (« vision commune »). Une soumission, un PDF. |
| Livraison | **Les trois :** courriel à Stéphanie avec PDF en pièce jointe, copie à chaque signataire, et bouton de téléchargement sur l'écran de confirmation. |
| Accès | **Lien privé, `noindex`, sans Nav ni Footer** (même posture que `/refinancement-v2`). |
| Traçabilité | Horodatage serveur, IP, user-agent et empreintes SHA-256 par signataire — **dans le courriel interne, jamais dans le PDF** (pour préserver le « tel quel »). |

---

## 3. Architecture

Aucun nouveau service externe. On réutilise `emailService.ts` (Resend + pièces jointes base64 +
rate-limit + honeypot), les classes `quiz-*` de `global.css`, le pattern de funnel de
`/refinancement-v2`, et Netlify Blobs (déjà en place pour les taux et le rate-limit).

**Une seule nouvelle dépendance : `pdf-lib`** (~450 Ko, pur JS, aucune dépendance native —
fonctionne dans les fonctions Netlify).

### Fichiers à créer

| Fichier | Rôle | Phase |
|---|---|---|
| `src/utils/profilEmprunteurs.ts` | **Source de vérité partagée** page ↔ API : les 8 questions, leurs options (clé + libellé + coordonnées de la case), le gabarit des signatures, et les helpers de validation. Sert de whitelist côté serveur. | 1 |
| `src/utils/profilEmprunteurs.test.ts` | Tests Vitest : intégrité du catalogue (30 coordonnées uniques), validation des payloads, cas limites du champ « Autre », validation du PNG de signature. | 1 |
| `src/data/profilEmprunteursModele.ts` | Le PDF modèle encodé en base64 (voir §4). | 1 |
| `src/services/profilPdfService.ts` | `genererProfilPdf(dossier) → Uint8Array` : charge le modèle, estampe coches, montant « Autre », tracés de signature et dates. | 1 |
| `src/pages/profil-emprunteur.astro` | La page-funnel (`prerender = true`, `noindex`, sans Nav/Footer). | 1 |
| `src/pages/api/profil-submit.ts` | Validation stricte → PDF → courriels → renvoie le PDF en base64. | 1 |
| `src/services/profilDossierService.ts` | Dossiers en attente de co-signature dans Netlify Blobs : création, lecture par jeton, ajout d'une signature, purge. | 2 |
| `src/pages/signer.astro` | Écran de co-signature à distance (récapitulatif en lecture seule + canevas). | 2 |
| `src/pages/api/profil-cosigner.ts` | Consomme un jeton, enregistre une signature, déclenche le PDF quand le dossier est complet. | 2 |

### Fichiers à modifier

| Fichier | Modification |
|---|---|
| `package.json` | ajouter `pdf-lib` |
| `CLAUDE.md` | ajouter les routes + API au tableau des pages |
| `netlify.toml` | **rien** — `src/data/**`, `src/utils/**` et `src/services/**` sont déjà dans `included_files` |

---

## 4. Comment le modèle PDF vit à l'exécution

Trois options ont été considérées :

1. **Module base64 (`src/data/profilEmprunteursModele.ts`) — retenu.** Le PDF (315 Ko → ~420 Ko
   en base64) devient une constante TypeScript importée normalement. Aucun accès disque, aucune
   config de build, aucun risque de chemin relatif cassé dans la fonction Netlify. Un petit
   script (`scripts/encode-modele.mjs`) permet de régénérer le module si Hypotheca met le
   formulaire à jour.
2. `readFileSync` depuis `src/data/forms/*.pdf` — dépend du `cwd` de la fonction Netlify, fragile.
3. `fetch` du PDF depuis `public/forms/` — aller-retour réseau par soumission et modèle vierge
   exposé publiquement.

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

**Champs texte et signatures :**

| Champ | Zone |
|---|---|
| Montant « Autre » | ligne pointillée `x 395–479`, `y 340.9` — écrire à `x ≈ 398`, sans le « $ » (le modèle en a déjà un en fin de ligne) |
| Signature 1 / 2 / 3 | coin bas-gauche `[145.3, 98.2 / 73.8 / 49.4]`, **largeur max 185 pt, hauteur max 24 pt, ratio conservé** |
| Date 1 / 2 / 3 | `x ≈ 385`, `y 96.2 / 71.8 / 47.4` — date de signature **de ce signataire** (fr-CA, `formatDateLong`) |

Ces valeurs vivent dans `profilEmprunteurs.ts`, jamais en dur dans le service PDF.

---

## 6. La signature dessinée — technique

**Capture.** `<canvas>` piloté par les *Pointer Events* (`pointerdown/move/up` + `setPointerCapture`),
`touch-action: none` sur l'élément pour que le doigt trace au lieu de faire défiler la page.
Canevas d'environ 3:1 (confortable au doigt), résolution interne × `min(devicePixelRatio, 2)`.
Trait lissé par courbes quadratiques entre les points médians, `lineCap`/`lineJoin` ronds.

**Fond transparent** — on ne remplit jamais le canevas, ce qui donne un PNG à fond transparent qui
se pose sur la ligne pointillée sans masquer le document (validé au POC).

**Recadrage sur l'encre.** Avant l'export, on scanne le canal alpha pour trouver la boîte
englobante du tracé et on ré-exporte uniquement cette zone. Deux bénéfices : le poids tombe à
15–50 Ko, et la signature occupe vraiment la ligne au lieu de flotter, réduite, dans un grand
canevas vide.

**Garde-fous.** Un tracé trivial est refusé (moins de 2 segments ou longueur cumulée sous ~150 px)
avec le message « Votre signature semble incomplète ». Boutons « Effacer » et aperçu du tracé
avant validation.

**Validation serveur** — le PNG n'est jamais pris au mot : entête PNG vérifiée, dimensions
plafonnées (2000 × 800), poids plafonné (500 Ko), décodage par `embedPng` (échec → 400). Le corps
de la requête est plafonné à 2 Mo.

**CSP** — aucun impact : le canevas est *same-origin* et `img-src 'self' data: https:` couvre déjà
l'aperçu en `data:`.

**Accessibilité** — dessiner est impossible pour certaines personnes (motricité, lecteur d'écran).
Prévoir le repli « signer en tapant mon nom » derrière un lien discret, avec la même valeur
juridique et la même trace d'audit. À confirmer avec Stéphanie (§10.2).

---

## 7. « Comment s'assurer que chacun signe réellement ? »

### 7.1 Le plafond, dit honnêtement

Aucun formulaire web ne prouve *qui tient le doigt*. Un tracé dessiné n'est pas plus contraignant
qu'un nom tapé — ce qui donne sa force à une signature électronique, c'est le **faisceau de
preuves** qui la relie à une personne. Par ordre croissant, on peut prouver :

| Niveau | Ce qui est réellement prouvé | Coût |
|---|---|---|
| 0 — Tous sur le même appareil | Rien. Une seule personne peut tracer les trois signatures. | nul |
| 1 — **Lien unique par signataire** | Le contrôle d'une **boîte courriel** distincte | modéré |
| 2 — + code SMS | Le contrôle d'un **téléphone** distinct | + service SMS (nouveau fournisseur, coût récurrent) |
| 3 — Vérification d'identité | L'**identité** (pièce d'identité, selfie) | disproportionné ici |

Le niveau 3 est hors sujet pour un questionnaire de préférences — ce n'est pas l'engagement
hypothécaire, et Stéphanie rencontre ces clients de toute façon. **Le niveau 1 est le bon point
d'équilibre**, et c'est aussi celui qui tient la route si le dossier est examiné : on peut montrer
que chaque signature est arrivée par un lien nominatif envoyé à une adresse distincte, à un moment
distinct, depuis une IP distincte.

### 7.2 Avant de construire quoi que ce soit

**Question à poser à Hypotheca : le cabinet fournit-il déjà un outil de signature électronique ?**
(ConsignO/Notarius, DocuSign, la signature intégrée à Velocity/Filogix…) Si oui, la bonne
architecture est nettement plus simple et plus solide : **le site produit le PDF rempli, et
Stéphanie le route dans l'outil du cabinet pour la signature.** On garde la phase 1, on jette la
phase 2. C'est la première chose à vérifier — ça peut supprimer une demi-journée de travail et
donner une valeur probante supérieure à tout ce qu'on écrirait nous-mêmes.

### 7.3 Le mécanisme retenu si on le construit — chaîne de signature

À l'étape identité, l'emprunteur 1 saisit le nom **et le courriel distinct** de chaque
co-emprunteur, puis choisit :

- **« Ils sont avec moi »** (voie rapide) — l'appareil est passé de main en main. Chaque signature
  a son propre écran, son propre horodatage et sa propre attestation. C'est exactement ce que fait
  le papier. Le PDF part immédiatement. *Assurance : niveau 0, assumée.*
- **« Ils signeront de leur côté »** — un dossier en attente est créé, chaque co-emprunteur reçoit
  un **lien nominatif à usage unique**. *Assurance : niveau 1.*

**Le co-signataire à distance** ouvre son lien et voit le **récapitulatif des 8 réponses en lecture
seule** — il doit pouvoir lire ce qu'il signe, c'est le cœur de la conformité — puis son
attestation et son canevas. Il ne peut pas modifier les réponses ; un bouton **« Je ne suis pas
d'accord »** gèle le dossier et prévient Stéphanie, au lieu de le pousser à signer à contrecœur.

**Le PDF n'est généré que lorsque tous ont signé**, puis envoyé à Stéphanie et à chaque signataire.
Tant que le dossier est incomplet, aucun document n'existe.

**Jetons.** 32 octets aléatoires en base64url, **stockés hachés** (SHA-256) dans le Blob, à usage
unique, expiration 14 jours. Le lien ne révèle rien avant ouverture, la page est `noindex`.

**Relance.** Le courriel interne contient un lien de relance que Stéphanie déclenche elle-même
quand elle veut. Pas de cron à construire ni à surveiller.

**Confidentialité.** Un dossier en attente contient des tracés de signature au repos dans les
Blobs — c'est la donnée la plus sensible du système. TTL strict de 14 jours, **suppression du
dossier dès le PDF généré**, et purge des dossiers gelés ou expirés au passage suivant.

### 7.4 La trace de preuve, par signataire

Consignée dans le courriel interne (et donc conservée dans la boîte de Stéphanie), jamais dans le
PDF :

- horodatage ISO 8601 **serveur** (jamais l'heure du client)
- IP et user-agent
- voie utilisée : *en présence* ou *lien à distance*, et l'adresse à laquelle le lien a été envoyé
- texte exact de l'attestation cochée
- empreintes SHA-256 du PNG de signature et du PDF final — permettent de démontrer plus tard
  qu'un document présenté est bien celui qui a été signé

### 7.5 Recommandation de séquence

**Phase 1 d'abord, phase 2 seulement si nécessaire.** La phase 1 (parcours + dessin + signature en
présence + PDF + trace d'audit) est immédiatement utilisable et couvre le cas courant : un couple
qui remplit le questionnaire ensemble. La phase 2 se décide après la réponse d'Hypotheca (§7.2) —
elle peut s'avérer inutile.

---

## 8. Parcours client (la page)

Structure identique à `/refinancement-v2` : une tuile par question, **le clic sélectionne et fait
avancer automatiquement** (~250 ms pour voir la sélection), barre de progression, bouton
« ← Retour ». Le client ne voit jamais le PDF pendant le parcours.

| # | Contenu |
|---|---|
| 0 | **Intro** — « Ce court questionnaire aide Stéphanie à vous recommander le bon produit. 2 minutes. » + la mention du document sur la réponse commune. |
| 1–8 | Les 8 questions, une par écran, en tuiles cliquables. L'étape 3 ouvre un champ montant si « Autre » est choisi — seule étape qui ne s'auto-avance pas dans ce cas. |
| 9 | **Récapitulatif** — les 8 réponses en liste, chacune modifiable d'un clic. C'est ici qu'on remplace la lecture du PDF. |
| 10 | **Les signataires** — nom complet + courriel de chaque emprunteur (1 à 3, « + Ajouter un co-emprunteur »), courriels **distincts** exigés, puis le choix « ils sont avec moi » / « ils signeront de leur côté » (§7.3). Honeypot ici. |
| 11 | **Signature** — un écran par signataire présent : rappel du nom, case d'attestation (*« Je confirme que ces réponses reflètent notre vision commune et que ce tracé vaut ma signature. »*), canevas, « Effacer », « Signer ». |
| 12 | **Confirmation** — soit « C'est envoyé » + **Télécharger mon profil (PDF)**, soit « Il manque la signature de X — un lien vient de lui être envoyé ». |

Détails :
- Le JS vit dans un bloc `<script>` de la page `.astro` (Astro le compile en fichier externe →
  compatible avec la CSP actuelle). Même approche que `refinancement-v2.astro`.
- Reprise après rechargement : réponses sérialisées dans `sessionStorage`. **Les tracés de
  signature, eux, ne sont jamais persistés côté navigateur** — ils vivent en mémoire jusqu'à
  l'envoi.
- Accessibilité : `role="group"` + `aria-labelledby` par question, focus déplacé sur le titre de
  l'étape à chaque avancée, tuiles atteignables au clavier (déjà géré par `.quiz-card`), repli de
  signature tapée (§6).
- Aucune donnée financière n'est demandée — c'est un questionnaire de préférences.

---

## 9. API

### `/api/profil-submit` (phase 1)

`export const prerender = false`. Même squelette que `refinancement-v2-submit.ts` :

1. Honeypot (`company` non vide → 200 silencieux, aucun courriel).
2. `checkRateLimit(ip, 'profil')`.
3. **Validation stricte contre le catalogue** : chaque réponse doit être une clé connue de
   `profilEmprunteurs.ts`. Montant « Autre » : entier 1–100 000, requis si et seulement si
   l'option « Autre » est choisie. 1 à 3 signataires, nom 2–60 caractères, courriels valides et
   **distincts entre eux**, attestation `=== true` pour chaque signataire présent, PNG valide
   (§6). Tout écart → 400.
4. Voie *en présence* → `genererProfilPdf()` → base64 → deux envois Resend en parallèle :
   - **Interne** → `RESEND_NOTIFY_EMAIL` : PDF en pièce jointe
     (`profil-emprunteurs-<nom>-<date>.pdf`), corps HTML avec les 8 réponses en tableau, les
     signataires, et la trace de preuve (§7.4). `reply_to` = courriel de l'emprunteur 1.
   - **Client** → même PDF à chaque signataire, message court + `renderSignatureBlock()`.
   Réponse `{ ok: true, pdf: "<base64>", filename }` → la page reconstruit un `Blob` et arme le
   bouton de téléchargement. **Aucun stockage du PDF côté serveur.**
5. Voie *à distance* → création du dossier (phase 2), envoi des liens, réponse `{ ok: true,
   enAttente: ["Julie"] }`, aucun PDF.

### `/api/profil-cosigner` (phase 2)

Consomme le jeton (comparaison du hachage, usage unique, expiration), valide la signature, met le
dossier à jour. Si tous ont signé : génère le PDF, envoie les courriels, **supprime le dossier**.
Rate-limit par IP et par jeton.

> À valider en `netlify dev` : le téléchargement via URL `blob:`. Si la CSP le bloque (peu
> probable — une navigation de téléchargement n'est pas couverte par les directives de *fetch*),
> le repli est un `object-src blob:` ciblé dans `netlify.toml`.

---

## 10. Ordre de travail

### Phase 1 — utilisable telle quelle

| # | Lot | Effort |
|---|---|---|
| 1 | `profilEmprunteurs.ts` (catalogue + coordonnées + validation) et ses tests | ~1 h |
| 2 | `npm i pdf-lib`, script d'encodage, `profilEmprunteursModele.ts`, `profilPdfService.ts` | ~1 h — **le POC est écrit, il s'agit de le porter** |
| 3 | `profil-submit.ts` + gabarits de courriels + trace de preuve | ~1 h 30 |
| 4 | Composant de signature (canevas, pointer events, recadrage, garde-fous, repli tapé) | ~2 h |
| 5 | `profil-emprunteur.astro` + JS du funnel (12 étapes, récap, sessionStorage) | ~2 h 30 |
| 6 | `npm run check`, `npx vitest run`, essai bout-en-bout en `netlify dev`, ouverture du PDF dans Acrobat **et** Aperçu, essai réel au doigt sur iOS et Android, mise à jour du `CLAUDE.md` | ~1 h 30 |

### Phase 2 — co-signature à distance (seulement si §7.2 le confirme)

| # | Lot | Effort |
|---|---|---|
| 7 | `profilDossierService.ts` (Blobs, jetons hachés, TTL, purge) + tests | ~1 h 30 |
| 8 | `signer.astro` (récapitulatif en lecture seule + canevas réutilisé) | ~1 h |
| 9 | `profil-cosigner.ts` + courriels d'invitation, de relance et de désaccord | ~1 h 30 |

Les lots 1 à 3 sont validables sans interface, en appelant l'API avec `curl`.

---

## 11. Points à trancher avec Stéphanie

1. **Hypotheca fournit-il déjà un outil de signature électronique ?** (§7.2) — à vérifier **avant**
   d'entamer la phase 2. Réponse positive = phase 2 annulée.
2. **Le repli « signature tapée » est-il acceptable** pour les personnes qui ne peuvent pas
   dessiner ? Sinon il faut prévoir une procédure hors ligne pour ces cas.
3. **Conservation.** Ici le PDF n'existe que dans les courriels. Si elle veut un archivage
   automatique (Blobs, Drive), c'est un ajout à prévoir — non inclus.
4. **Loi 25.** Le formulaire recueille des noms, des courriels et des signatures : lien vers
   `/confidentialite` à l'étape 10, et la politique devrait mentionner la conservation des tracés.
5. **Mise à jour du modèle.** Si Hypotheca révise le formulaire, les coordonnées changent. Le
   script d'encodage réimprimera le modèle, mais les coordonnées devront être réextraites — c'est
   documenté en tête de `profilEmprunteurs.ts`.

---

## 12. Hors périmètre

- Vérification d'identité (pièce d'identité, selfie) et code SMS — voir §7.1, disproportionné ici
- Archivage ou tableau de bord des profils reçus
- Relances automatiques planifiées (relance manuelle seulement)
- Traduction anglaise de la page
