// Le carnet des dossiers clients — /api/crm-dossiers. Réservé à la courtière.
//
// Ne fait que lire. Le même verdict d'accès que la page /dossiers : une page protégée devant
// une API ouverte ne protège rien.
//
// Renvoie les fiches complètes — Stéphanie est seule à les voir, et l'écran a besoin de
// l'historique pour afficher une fiche sans second aller-retour. Seul le jeton d'accès du
// client en est retiré (`versFiche`).

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import { listerDossiers, versFiche } from '../../services/dossierClientService';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  try {
    const dossiers = await listerDossiers();
    return jsonResponse({ ok: true, dossiers: dossiers.map(versFiche) }, 200);
  } catch (err) {
    console.error('[crm-dossiers] Listage impossible :', err);
    return jsonResponse({ error: 'Les dossiers n’ont pas pu être chargés.' }, 502);
  }
};
