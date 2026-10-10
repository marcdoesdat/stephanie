/**
 * La version anglaise : /en/… est fabriquée à la demande depuis la page française
 * (voir src/services/servirAnglais.ts).
 *
 * Il faut une route, et pas seulement le middleware : sur Netlify, une adresse qui ne
 * correspond à aucune route reçoit la page 404 **sans que le middleware ne soit appelé**
 * (l'adaptateur la sert avant de rendre quoi que ce soit). Tant que /en/ ne vivait que dans
 * le middleware, la bascule « English » menait à une 404 en production, alors qu'elle
 * fonctionnait en `npm run dev`.
 */
import type { APIRoute } from 'astro';
import { servirAnglais } from '../../services/servirAnglais';
import { loadSiteConfig } from '../../config';

export const prerender = false;

export const GET: APIRoute = ({ url }) => servirAnglais(url, loadSiteConfig().site_url);
