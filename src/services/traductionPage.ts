/**
 * Produit une page anglaise (/en/…) à partir du HTML de la page française.
 *
 * Même dictionnaire et même moteur que le navigateur (public/js/i18n-core.js) : le HTML qui
 * sort d'ici est déjà en anglais, donc lisible — et indexable — sans JavaScript. Le texte que
 * les scripts des calculateurs écrivent après coup est traduit côté navigateur par
 * public/js/i18n.js, avec ce même moteur.
 *
 * Ce module ne lit rien d'autre que son entrée : pas de réseau, pas d'état. Le middleware
 * (src/middleware.ts) va chercher la page française et lui passe le HTML.
 */
import { parseHTML } from 'linkedom';
import dictionnaire from '../../public/js/i18n-en.json';
import '../../public/js/i18n-core.js';
import '../../public/js/i18n-regles.js';
import { cheminAnglais, estTraduite, normaliser } from '../utils/pagesAnglaises';

const core = (globalThis as any).swI18nCore;

// Ne jamais réécrire ce qui n'est pas une page : appels d'API, scripts, images, fichiers.
const NON_PAGES = /^\/(api|js|images|_astro|en)(\/|$)|\.[a-z0-9]{2,5}$/i;

/** Lien interne vers une page qui a une version anglaise → son adresse /en/. */
function lienAnglais(href: string, base: URL): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  const u = new URL(href, base);
  if (NON_PAGES.test(u.pathname) || !estTraduite(u.pathname)) return null;
  return cheminAnglais(u.pathname) + u.search + u.hash;
}

export function traduirePage(html: string, cheminFr: string, siteUrl: string): string {
  const { document } = parseHTML(html);
  const base = new URL(cheminFr, siteUrl);

  const t = core.traducteur(dictionnaire);
  t.entete(document);
  if (document.body) t.traiter(document.body);

  // <noscript> : pour le moteur, son contenu est du texte brut ; on le traduit comme un
  // fragment à part (c'est ce que lit un visiteur sans JavaScript).
  for (const ns of document.querySelectorAll('body noscript')) {
    const dedans = ns.innerHTML;
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(dedans.replace(/<[^>]*>/g, ''))) continue;
    const frag = parseHTML(`<!doctype html><html><body><div id="r">${dedans}</div></body></html>`).document;
    t.traiter(frag.body);
    ns.innerHTML = frag.getElementById('r')?.innerHTML ?? dedans;
  }

  document.documentElement.setAttribute('lang', 'en-CA');

  for (const a of document.querySelectorAll('a[href]')) {
    const cible = lienAnglais(a.getAttribute('href') ?? '', base);
    if (cible) a.setAttribute('href', cible);
  }

  // Cette page-ci est la version de référence de l'anglais : son adresse canonique est la sienne.
  const urlEn = new URL(cheminAnglais(normaliser(cheminFr)), siteUrl).toString();
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', urlEn);
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', urlEn);
  document.querySelector('meta[property="og:locale"]')?.setAttribute('content', 'en_CA');

  return document.toString();
}
