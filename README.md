# Site web — Stéphanie Weyman, Courtière Hypothécaire

Site statique construit avec [Astro](https://astro.build). Il se génère en quelques secondes et peut être hébergé gratuitement sur Vercel, Netlify ou GitHub Pages.

---

## 🗂️ Modifier les informations du site (téléphone, courriel, AMF…)

Tout ce qui est personnel se trouve dans **un seul fichier** :

```
src/config/siteConfig.yaml
```

Ouvre ce fichier avec n'importe quel éditeur de texte (Bloc-notes, VS Code, etc.) et modifie les valeurs entre les guillemets `" "`.

### Exemple du fichier :

```yaml
nom: "Stéphanie Weyman"
titre: "Courtière hypothécaire agréée"
organisation: "Hypotheca"
region: "Partout au Québec"

amf: "3002365315"
telephone: "514-949-7627"
courriel: "stephanie@hypotheca.ca"

site_url: "https://stephanieweyman.ca"
messenger_url: "https://m.me/stephanie.weyman.courtiere.hypothecaire"

# Pour activer Calendly, enlève le # au début et colle ton lien :
# calendly_url: "https://calendly.com/ton-lien"

meta_title: "Stéphanie Weyman — Courtière Hypothécaire · Québec"
meta_description: "Courtière hypothécaire agréée au Québec..."
```

### Règles importantes :
- Ne **jamais** effacer les guillemets `" "` autour des valeurs.
- Les lignes qui commencent par `#` sont des **commentaires** — elles sont ignorées par le site. Tu peux les modifier librement.
- Pour activer Calendly, retire le `#` devant `calendly_url:` et remplace par ton lien.

---

## 🚀 Lancer le site en mode développement (aperçu local)

> Tu as besoin de [Node.js](https://nodejs.org/fr) installé sur ton ordinateur (version 18 ou plus).

Ouvre un terminal dans le dossier du projet, puis :

```bash
npm install      # À faire une seule fois au début
npm run dev      # Lance le site sur http://localhost:4321
```

Ouvre ton navigateur et va sur **http://localhost:4321** pour voir le site. Les modifications que tu fais au fichier YAML ou aux composants s'affichent immédiatement.

---

## 🏗️ Générer le site pour la mise en ligne (build)

```bash
npm run build
```

Le site généré se trouve dans le dossier `dist/`. C'est ce dossier que tu mets en ligne sur ton hébergeur.

---

## 📁 Structure du projet

```
src/
  config/
    siteConfig.yaml   ← Modifie tes infos ici (téléphone, courriel, AMF...)
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
    index.astro        Point d'entrée — assemble tous les composants
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
4. Dans `src/config/siteConfig.yaml`, retire le `#` devant `# calendly_url:` et colle ton lien
5. Dans `src/components/Rdv.astro`, remplace le bloc `<div class="calendly-placeholder">` par le widget Calendly (Marc peut faire ça en 5 min)

 
