import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

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

let _cached: SiteConfig | null = null;

export function loadSiteConfig(): SiteConfig {
  if (_cached) return _cached;
  const configPath = path.resolve(
    process.cwd(),
    'src/config/siteConfig.yaml'
  );
  const raw = fs.readFileSync(configPath, 'utf-8');
  _cached = yaml.load(raw) as SiteConfig;
  return _cached;
}
