/**
 * Vérification d'origine (CSRF) — reprise à la main de celle d'Astro.
 *
 * Astro refuse par défaut tout POST porteur d'un `content-type` de formulaire dont
 * l'en-tête `Origin` ne correspond pas à l'URL demandée (`security.checkOrigin`). C'est la
 * bonne règle pour les routes qui n'existent que pour le site lui-même — et c'est
 * exactement la mauvaise pour **une** d'entre elles.
 *
 * `/api/reseau-retrait` n'est pas appelée par une page du site : elle est appelée par le
 * client de messagerie de la personne qui veut cesser de recevoir des courriels. Un
 * fournisseur qui exécute le retrait en un clic (RFC 8058) poste depuis ses propres
 * serveurs, sans navigateur, donc **sans en-tête `Origin`** — Astro répondait 403, la
 * personne restait inscrite, et personne ne l'apprenait. Or la LCAP n'admet pas qu'un
 * mécanisme de retrait échoue en silence.
 *
 * D'où ce middleware : `security.checkOrigin` est désactivé dans `astro.config.mjs`, la
 * règle est réécrite **à l'identique** dans `src/utils/origineRequete.ts` (module pur, donc
 * vérifiable par des tests), et une seule route en est dispensée.
 *
 * Ce que la dispense coûte : un site tiers pourrait faire poster `/api/reseau-retrait` par
 * le navigateur d'un visiteur. Il lui faudrait pour cela connaître un couple (identifiant,
 * jeton) valide — c'est-à-dire avoir déjà lu le courriel de la personne — et le seul effet
 * atteignable serait de la désabonner. Faire cesser des courriels n'est pas un dommage ;
 * ne pas les faire cesser en est un.
 *
 * @module middleware
 */

import { defineMiddleware } from 'astro:middleware';
import { origineNonVerifiee, origineRefusee } from './utils/origineRequete';

export const onRequest = defineMiddleware((context, next) => {
  const { request, url, isPrerendered } = context;
  if (isPrerendered) return next();
  if (origineNonVerifiee(url.pathname)) return next();

  if (
    origineRefusee(
      request.method,
      request.headers.get('origin'),
      url.origin,
      request.headers.get('content-type'),
    )
  ) {
    return new Response(`Cross-site ${request.method} form submissions are forbidden`, {
      status: 403,
    });
  }

  return next();
});
