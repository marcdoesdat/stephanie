import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

export default defineConfig({
  // L'URL est indispensable pour générer les liens du sitemap
  site: 'https://stephanieweyman.ca',
  adapter: netlify(),
  // La vérification d'origine (CSRF) est reprise à la main dans src/middleware.ts, à
  // l'identique — mais avec une dispense pour /api/reseau-retrait, que les clients de
  // messagerie appellent sans en-tête « Origin ». Voir l'entête de ce module.
  security: { checkOrigin: false },
  integrations: [
    sitemap({
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
