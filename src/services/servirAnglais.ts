/**
 * Sert une page /en/… : va chercher la page française correspondante, la traduit, la renvoie.
 *
 * Passer par la page française plutôt que par un second jeu de pages garantit que les deux
 * versions ne divergent jamais : les taux du jour, le contenu des composants et les liens sont
 * ceux du français, traduits à la volée. Le résultat est mis en cache par le CDN.
 *
 * - Une page absente de `src/data/pagesTraduites.json` (écrans de la courtière, signatures) n'a
 *   pas de version anglaise : on sert la page 404, traduite, avec son statut 404.
 * - `/en` et `/en/outils` sont redirigés vers l'adresse à barre finale : une page, une adresse.
 * - L'URL de la page française est appelée telle quelle, sans en-tête de session : ce sont des
 *   pages publiques.
 */
import { cheminFrancais, estTraduite } from '../utils/pagesAnglaises';
import { traduirePage } from './traductionPage';

const CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=3600';

export async function servirAnglais(
  url: URL,
  siteUrl: string,
  chercher: (adresse: URL) => Promise<Response> = (a) => fetch(a, { headers: { accept: 'text/html' } }),
): Promise<Response> {
  if (!url.pathname.endsWith('/')) {
    return new Response(null, { status: 301, headers: { location: url.pathname + '/' + url.search } });
  }

  const cheminFr = cheminFrancais(url.pathname);
  const traduite = estTraduite(cheminFr);
  const cible = traduite ? cheminFr : '/404';

  const rep = await chercher(new URL(cible + (traduite ? url.search : ''), url.origin));
  const type = rep.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return rep;

  const html = traduirePage(await rep.text(), cheminFr, siteUrl);
  return new Response(html, {
    status: traduite ? rep.status : 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': traduite && rep.status === 200 ? CACHE : 'no-store',
      // La page anglaise d'une page inconnue ne doit pas s'indexer.
      ...(traduite ? {} : { 'x-robots-tag': 'noindex' }),
    },
  });
}
