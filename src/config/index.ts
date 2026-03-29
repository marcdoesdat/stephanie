import config from './siteConfig.json';

export interface SiteConfig {
  nom: string;
  titre: string;
  organisation: string;
  region: string;
  amf: string;
  telephone: string;
  courriel: string;
  site_url: string;
  messenger_url: string;
  calendly_url?: string;
  meta_title: string;
  meta_description: string;
}

export function loadSiteConfig(): SiteConfig {
  // Astro comprend le JSON parfaitement sans outils supplémentaires
  return config as SiteConfig;
}