// Suivi des contrats en cours — /api/contrat-dossiers. Réservé à la courtière.
//
// Sans cet écran, Stéphanie n'a aucune visibilité : elle sait qu'un contrat est parti, mais
// pas qui traîne, ni s'il reste quelque chose à finaliser. Elle ne peut pas non plus relancer
// un lien perdu, faute de savoir sur quel dossier agir.
//
// Ne renvoie que des **résumés** : ni jeton, ni tracé de signature. C'est ce qui rend la
// liste transmissible au navigateur — voir `ResumeDossier`.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import { listerDossiers } from '../../services/contratDossierService';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  try {
    return jsonResponse({ ok: true, dossiers: await listerDossiers() }, 200);
  } catch (err) {
    console.error('[contrat-dossiers] Listage impossible :', err);
    return jsonResponse({ error: 'La liste des contrats n’a pas pu être chargée.' }, 502);
  }
};
