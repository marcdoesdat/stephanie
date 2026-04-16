import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

export default defineConfig({
  // L'URL est indispensable pour générer les liens du sitemap
  site: 'https://stephanieweyman.ca',
  adapter: netlify(),
  integrations: [
    sitemap()
  ],
});