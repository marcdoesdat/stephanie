// Ouverture de session sur le générateur de contrats (/contrat).
//
// Reçoit le mot de passe partagé, le vérifie à temps constant, et dépose le cookie d'accès.
// Aucun compte, aucune base : voir src/services/accesCourtiere.ts pour le raisonnement.
//
// Variable d'environnement : CONTRAT_MOT_DE_PASSE.

import type { APIRoute } from 'astro';
import {
  accesConfigure,
  creerJetonAcces,
  enteteCookieAcces,
  verifierMotDePasse,
} from '../../services/accesCourtiere';
import { checkRateLimit, clientIpFromRequest, jsonResponse } from '../../services/emailService';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!accesConfigure()) {
    console.error('[contrat-acces] CONTRAT_MOT_DE_PASSE absent ou trop court.');
    return jsonResponse({ error: 'L’accès n’est pas configuré sur ce site.' }, 503);
  }

  // Le seul secret du système est un mot de passe partagé : sans limitation de débit, il
  // serait devinable à la force brute depuis n'importe où.
  const ip = clientIpFromRequest(request);
  if (!(await checkRateLimit(ip, 'contrat-acces'))) {
    return jsonResponse({ error: 'Trop de tentatives. Réessayez dans une heure.' }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  if (!verifierMotDePasse(payload.motDePasse)) {
    return jsonResponse({ error: 'Mot de passe incorrect.' }, 401);
  }

  const jeton = await creerJetonAcces();
  if (!jeton) return jsonResponse({ error: 'L’accès n’est pas configuré sur ce site.' }, 503);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': enteteCookieAcces(jeton, new URL(request.url).protocol === 'https:'),
    },
  });
};
