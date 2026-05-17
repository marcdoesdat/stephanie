# Site web — Stéphanie Weyman, Courtière Hypothécaire

Site hybride construit avec [Astro](https://astro.build) et hébergé sur [Netlify](https://netlify.com). La page d'accueil est rendue côté serveur (SSR) pour afficher les taux hypothécaires en temps réel. Les autres pages sont générées statiquement.

---

## 🏗️ Architecture des taux hypothécaires

Les taux sont récupérés depuis hypotheca.ca et mis en cache via **Netlify Blobs** (production) ou un fichier local (développement).

### Flux de données

```
hypotheca.ca  →  ratesService.ts  →  Netlify Blob (store: "rates")
                                           ↓
                       CDN cache (6h)  ←  index.astro (SSR)  →  HTML
```

### Stratégie de cache (TTL 6 heures)

1. **Requête utilisateur** → le CDN Netlify sert la page HTML en cache (`s-maxage=21600`)
2. **Après 6h**, le CDN revalide en arrière-plan (`stale-while-revalidate=3600`)
3. **Côté serveur**, `ratesService.ts` vérifie le Blob cache :
   - **Cache valide (< 6h)** → retourne les taux en cache
   - **Cache expiré** → fetch hypotheca.ca, met à jour le Blob, retourne les taux frais
   - **Fetch échoué + cache périmé (< 30 jours)** → retourne le stale cache
   - **Aucune donnée disponible** → affiche un lien vers hypotheca.ca (pas de faux taux)

### Taux indisponibles

Si les taux ne peuvent pas être récupérés et qu'aucun cache n'est disponible, le tableau affiche :
> « Les taux ne sont pas disponibles. Voir les taux sur hypotheca.ca → »

---

## 🌟 Architecture des avis Google

Les avis sont récupérés depuis Google Places API (New) et mis en cache via **Netlify Blobs** (production) ou un fichier local (développement).

### Flux de données

```
Google Places API (New) v1  →  reviewsService.ts  →  Netlify Blob (store: "reviews")
                                                           ↓
                            CDN cache (6h)  ←  index.astro (SSR)  →  HTML + JSON-LD
```

### Stratégie de cache (TTL 24 heures)

1. **Requête utilisateur** → le CDN Netlify sert la page HTML en cache
2. **Côté serveur**, `reviewsService.ts` vérifie le Blob cache :
   - **Cache valide (< 24 h)** → retourne les avis en cache
   - **Cache expiré** → fetch Google Places API, met à jour le Blob, retourne les avis frais
   - **Fetch échoué + cache périmé (< 7 jours)** → retourne le cache stale
   - **Aucune donnée disponible** → fallback statique (`src/data/fallbackReviews.json`)
3. **JSON-LD** émis uniquement si la source n'est pas `"fallback"` (évite de publier un rating non vérifié)

### Avis indisponibles

Si l'API Google est down et qu'aucun cache n'est disponible, les témoignages de secours (3 avis manuels) sont affichés. Le site ne plante jamais — le build continue même sans clé API.

### Configuration requise

1. **Clé API** : `GOOGLE_PLACES_API_KEY` dans Netlify (Site settings → Environment variables)
2. **Place ID** : `google_place_id` dans `src/config/siteConfig.json`
3. La clé API doit être restreinte à `stephanieweyman.ca` et `localhost` (Google Cloud Console → API Keys → Restrictions)

### Mise en place (étape par étape)

1. Créer un projet Google Cloud et activer **Places API (New)** (pas l'ancienne Places API)
2. Générer une clé API avec restrictions de domaine
3. Trouver le Place ID via [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)
4. Ajouter `GOOGLE_PLACES_API_KEY` dans Netlify (Site settings → Environment variables)
5. Remplir `google_place_id` dans `src/config/siteConfig.json` et commit

---

## 🗂️ Modifier les informations du site (téléphone, courriel, AMF…)

Tout ce qui est personnel se trouve dans **un seul fichier** :

```
src/config/siteConfig.json
```

Ouvre ce fichier avec n'importe quel éditeur de texte (Bloc-notes, VS Code, etc.) et modifie les valeurs entre les guillemets `" "`.

### Exemple du fichier :

```json
{
  "nom": "Stéphanie Weyman",
  "titre": "Courtière hypothécaire",
  "organisation": "Hypotheca",
  "region": "Partout au Québec",

  "amf": "3002365315",
  "telephone": "514-949-7627",
  "courriel": "sweyman@hypotheca.ca",

  "site_url": "https://stephanieweyman.ca",
  "messenger_url": "https://m.me/stephanie.weyman.courtiere.hypothecaire"
}
```

### Règles importantes :
- Ne **jamais** effacer les guillemets `" "` autour des valeurs.
- Ne **jamais** effacer les virgules `,` à la fin de chaque ligne (sauf la dernière ligne avant `}`).

---

## 🚀 Lancer le site en mode développement (aperçu local)

> Tu as besoin de [Node.js](https://nodejs.org/fr) installé sur ton ordinateur (version 18 ou plus).

Ouvre un terminal dans le dossier du projet, puis :

```bash
npm install      # À faire une seule fois au début
npm run dev      # Lance le site sur http://localhost:4321
```

En mode dev, les taux sont cachés dans un fichier local (`.cache/hypotheca-rates.json`). Pas besoin de Netlify CLI.

#### Option : tester avec Netlify Blobs en local

Pour simuler l'environnement de production (Blobs, SSR) :

```bash
npm install -g netlify-cli   # Une seule fois
netlify login                # Authentification
netlify link                 # Lier au site Netlify
netlify dev                  # Lance le site avec l'émulation Netlify
```

Ouvre ton navigateur et va sur **http://localhost:8888** pour voir le site avec les Blobs.

---

## 🏗️ Générer le site pour la mise en ligne (build)

```bash
npm run build
```

Le site généré se trouve dans le dossier `dist/`. En production sur Netlify, le déploiement est automatique via git push.

---

## 📁 Structure du projet

```
src/
  config/
    siteConfig.json    ← Modifie tes infos ici (téléphone, courriel, AMF...)
  services/
    ratesService.ts    Récupération et cache des taux (Netlify Blobs / fichier local)
    reviewsService.ts  Récupération et cache des avis Google (Places API New → Blobs)
  data/
    fallbackReviews.json  Témoignages de secours si l'API Google est down
  components/
    Nav.astro          Navigation en haut
    Hero.astro         Section principale (grande intro)
    About.astro        Section À propos
    Services.astro     Section Services
    Simulator.astro    Simulateur « Combien puis-je emprunter ? »
    TauxSection.astro  Tableau des taux hypothécaires (scrappe hypotheca.ca)
    Calculator.astro   Calculateur de paiement mensuel
    Faq.astro          Questions fréquentes
    Rdv.astro          Section Rendez-vous / Calendly
    Testimonials.astro Témoignages clients
    Contact.astro      Formulaire de contact
    Footer.astro       Pied de page
    MessengerBtn.astro Bouton Messenger flottant
  styles/
    global.css         Tous les styles visuels du site
  pages/
    index.astro        Point d'entrée — SSR (taux en temps réel)
    amortissement.astro  Tableau d'amortissement (statique)
    404.astro          Page 404 (statique)
```

---

## 🔧 Autres modifications courantes

### Changer les témoignages
Ouvre `src/components/Testimonials.astro` et modifie les textes directement.

### Changer les questions FAQ
Ouvre `src/components/Faq.astro` et modifie les questions/réponses entre les balises `<div class="faq-q">` et `<div class="faq-a-inner">`.

### Changer la photo
Remplace le fichier `src/assets/stephanie.jpg` par une nouvelle photo en gardant exactement le même nom de fichier.

### Activer Calendly
1. Crée un compte gratuit sur [calendly.com](https://calendly.com)
2. Configure tes disponibilités
3. Copie ton lien Calendly (ex : `https://calendly.com/stephanie-weyman`)
4. Dans `src/config/siteConfig.json`, ajoute `"calendly_url": "https://calendly.com/ton-lien"` dans le fichier JSON
5. Dans `src/components/Rdv.astro`, remplace le bloc `<div class="calendly-placeholder">` par le widget Calendly (Marc peut faire ça en 5 min)

 
