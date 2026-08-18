// Le carnet du réseau — /api/reseau-contacts. Réservé à la courtière.
//
// Ne fait que lire. Le même verdict d'accès que la page /reseau : une page protégée devant
// une API ouverte ne protège rien.
//
// Renvoie aussi le compte d'envois du jour : l'écran doit pouvoir dire « il vous reste
// 18 envois aujourd'hui » avant qu'elle ne rédige, pas après.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import { envoisDuJour, listerContacts, versFiche } from '../../services/reseauContactService';
import { PLAFOND_QUOTIDIEN } from '../../utils/reseauCourtiers';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  try {
    const contacts = await listerContacts();
    return jsonResponse(
      {
        ok: true,
        contacts: contacts.map(versFiche),
        envoisDuJour: envoisDuJour(contacts),
        plafond: PLAFOND_QUOTIDIEN,
      },
      200,
    );
  } catch (err) {
    console.error('[reseau-contacts] Listage impossible :', err);
    return jsonResponse({ error: 'Le carnet n’a pas pu être chargé.' }, 502);
  }
};
