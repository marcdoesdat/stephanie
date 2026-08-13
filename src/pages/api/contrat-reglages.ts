// Réglages persistants de la courtière — /api/contrat-reglages.
//
// GET    : ce qui est mémorisé (valeurs par défaut + signature, pour l'aperçu à l'écran).
// PUT    : enregistre une signature et/ou des valeurs par défaut.
// DELETE : oublie la signature enregistrée.
//
// Derrière la même porte que /contrat : le tracé de signature de Stéphanie est la donnée la
// plus sensible du site, il ne doit jamais être servi ni remplacé sans le mot de passe.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import {
  enregistrerDefauts,
  enregistrerSignature,
  lireReglages,
  oublierSignature,
} from '../../services/reglagesCourtiere';

export const prerender = false;

function refusAcces(): Response {
  return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) return refusAcces();

  const reglages = await lireReglages();
  return jsonResponse(
    {
      ok: true,
      defauts: reglages.defauts,
      // La signature n'est renvoyée que pour être affichée à sa propriétaire, sur une page
      // qu'elle vient de déverrouiller.
      signature: reglages.signature
        ? {
            dataUrl: `data:image/png;base64,${reglages.signature.tracePngBase64}`,
            enregistreeLe: reglages.signature.enregistreeLe,
          }
        : null,
    },
    200,
  );
};

export const PUT: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) return refusAcces();

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  try {
    if (payload.signature !== undefined && payload.signature !== null) {
      if (!(await enregistrerSignature(payload.signature))) {
        return jsonResponse({ error: 'Signature illisible. Réessayez.' }, 400);
      }
    }
    if (payload.defauts !== undefined) {
      if (typeof payload.defauts !== 'object' || payload.defauts === null) {
        return jsonResponse({ error: 'Réglages invalides' }, 400);
      }
      await enregistrerDefauts(payload.defauts as Record<string, unknown>);
    }
  } catch (err) {
    console.error('[contrat-reglages] Enregistrement impossible :', err);
    return jsonResponse({ error: 'Vos réglages n’ont pas pu être enregistrés.' }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) return refusAcces();
  try {
    await oublierSignature();
  } catch (err) {
    console.error('[contrat-reglages] Suppression impossible :', err);
    return jsonResponse({ error: 'La signature n’a pas pu être retirée.' }, 502);
  }
  return jsonResponse({ ok: true }, 200);
};
