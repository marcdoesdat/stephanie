import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';
import { readFileSync } from 'node:fs';

const SITE = 'https://stephanieweyman.ca';

// Pages publiques mais noindex : ni en français ni en anglais dans le sitemap (signaux
// contradictoires sinon). /amortissement est vide sans les paramètres du calculateur.
const NOINDEX = ['/amortissement/', '/demande/', '/merci/', '/refinancement/', '/refinancement-v2/', '/refinancement/merci/'];

// Le sitemap est une liste blanche : les pages publiques (src/data/pagesTraduites.json), moins
// les noindex. Une liste d'exclusion laissait passer chaque nouvel écran privé — /contrat,
// /reseau, /tableau-de-bord… s'y étaient retrouvés, publiant leurs adresses. Comparaison sur le
// pathname exact : /refinancement/ (noindex) n'est pas /services/refinancement/ (indexée).
const INDEXABLES = JSON.parse(readFileSync(new URL('./src/data/pagesTraduites.json', import.meta.url), 'utf8'))
  .map((p) => (p === '/' ? '/' : `${p}/`))
  .filter((p) => !NOINDEX.includes(p));

// Les équivalents anglais (/en/…) n'existent pas au build : le serveur les fabrique (voir
// src/services/servirAnglais.ts). On les déclare ici à partir de la même liste de pages.
const pagesEn = INDEXABLES.map((p) => `/en${p}`);

// Le filtre s'applique aussi aux pages déclarées à la main : il doit laisser passer les deux langues.
const AU_SITEMAP = new Set([...INDEXABLES, ...pagesEn]);

export default defineConfig({
  // L'URL est indispensable pour générer les liens du sitemap
  site: SITE,
  adapter: netlify(),
  // La vérification d'origine (CSRF) est reprise à la main dans src/middleware.ts, à
  // l'identique — mais avec une dispense pour /api/reseau-retrait, que les clients de
  // messagerie appellent sans en-tête « Origin ». Voir l'entête de ce module.
  security: { checkOrigin: false },
  integrations: [
    sitemap({
      customPages: pagesEn.map((p) => SITE + p),
      filter: (page) => AU_SITEMAP.has(new URL(page).pathname),
    })
  ],
});
