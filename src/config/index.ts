// On importe le fichier YAML directement
import config from './siteConfig.yaml';

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
  // Pas besoin de fs ou de path, Vite a déjà fait le travail !
  return config as SiteConfig;
}