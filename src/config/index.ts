import configData from './siteConfig.json';

export interface SiteConfig {
  nom: string;
  titre: string;
  organisation: string;
  region: string;
  amf: string;
  telephone: string;
  courriel: string;
  site_url: string;
  messenger_url?: string; // Optionnel (au cas où il serait vidé)
  calendly_url?: string;  // Optionnel
  meta_title: string;
  meta_description: string;
}

// Typage strict : TypeScript va lever une erreur ici si ton fichier JSON 
// oublie une propriété obligatoire (contrairement à "as SiteConfig" qui forçait la validation).
const config: SiteConfig = configData;

/**
 * Charge la configuration globale du site.
 * Les données proviennent de `src/config/siteConfig.json`.
 * * @returns {SiteConfig} Les informations centralisées de la courtière (Stéphanie).
 */
export function loadSiteConfig(): SiteConfig {
  return config;
}