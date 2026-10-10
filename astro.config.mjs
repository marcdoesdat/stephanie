import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';
import { readFileSync } from 'node:fs';

const SITE = 'https://stephanieweyman.ca';

// Pages noindex : ni en français ni en anglais dans le sitemap (signaux contradictoires sinon).
const NOINDEX = ['/demande/', '/merci/', '/profil-emprunteur/', '/refinancement/', '/refinancement-v2/', '/refinancement/merci/', '/signer/'];

// Les équivalents anglais (/en/…) n'existent pas au build : le serveur les fabrique (voir
// src/services/servirAnglais.ts). On les déclare ici à partir de la même liste de pages.
const pagesEn = JSON.parse(readFileSync(new URL('./src/data/pagesTraduites.json', import.meta.url), 'utf8'))
  .map((p) => (p === '/' ? '/en/' : `/en${p}/`))
  .filter((p) => !NOINDEX.includes(p.slice(3) || '/'))
  .map((p) => SITE + p);

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
      customPages: pagesEn,
      // Exclut les pages noindex du sitemap (sinon signaux contradictoires).
      // Comparaison sur le pathname exact : un endsWith('/refinancement/') exclurait
      // aussi la page SEO /services/refinancement/, qui doit rester indexée.
      filter: (page) => ![
        '/demande/',
        '/merci/',
        '/profil-emprunteur/',
        '/refinancement/',
        '/refinancement-v2/',
        '/refinancement/merci/',
        '/signer/',
      ].includes(new URL(page).pathname),
    })
  ],
});
