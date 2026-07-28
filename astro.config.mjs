import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

export default defineConfig({
  // L'URL est indispensable pour générer les liens du sitemap
  site: 'https://stephanieweyman.ca',
  adapter: netlify(),
  integrations: [
    sitemap({
      // Exclut les pages noindex du sitemap (sinon signaux contradictoires).
      // Comparaison sur le pathname exact : un endsWith('/refinancement/') exclurait
      // aussi la page SEO /services/refinancement/, qui doit rester indexée.
      filter: (page) => !['/demande/', '/merci/', '/refinancement/'].includes(new URL(page).pathname),
    })
  ],
});
