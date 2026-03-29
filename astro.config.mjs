import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // L'URL est indispensable pour générer les liens du sitemap
  site: 'https://stephanieweyman.ca',
  
  integrations: [
    sitemap()
  ],
});