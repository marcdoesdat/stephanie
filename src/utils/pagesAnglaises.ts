/**
 * Les chemins de la version anglaise (/en/…), en fonctions pures.
 *
 * Chaque page française de `src/data/pagesTraduites.json` a un équivalent anglais, produit à la
 * demande par le serveur (src/services/traductionPage.ts, branché dans src/middleware.ts).
 * Convention : l'anglais porte toujours une barre finale — `/en/`, `/en/outils/` — pour qu'une
 * page n'ait qu'une adresse.
 */
import pages from '../data/pagesTraduites.json';

const PAGES = new Set<string>(pages);

/** `/outils/` et `/outils` sont la même page ; la racine reste `/`. */
export function normaliser(chemin: string): string {
  const n = chemin.replace(/\/+$/, '');
  return n === '' ? '/' : n;
}

/** La page française a-t-elle une version anglaise ? */
export function estTraduite(chemin: string): boolean {
  return PAGES.has(normaliser(chemin));
}

/** `/outils` → `/en/outils/` ; `/` → `/en/`. */
export function cheminAnglais(cheminFr: string): string {
  const n = normaliser(cheminFr);
  return n === '/' ? '/en/' : `/en${n}/`;
}

/** Le chemin d'une page anglaise est-il sous /en ? */
export function estAnglais(chemin: string): boolean {
  return chemin === '/en' || chemin.startsWith('/en/');
}

/** `/en/outils/` → `/outils` ; `/en/` → `/`. */
export function cheminFrancais(cheminEn: string): string {
  return normaliser(cheminEn.replace(/^\/en(?=\/|$)/, '') || '/');
}

/** Liste des pages (pour le sitemap). */
export function pagesTraduites(): string[] {
  return [...PAGES];
}
