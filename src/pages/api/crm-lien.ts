// Ce que les carnets savent d'une même personne — /api/crm-lien. Réservé à la courtière.
//
// Ne fait que lire, et relit trois magasins : appelée à l'ouverture d'une fiche, jamais au
// chargement d'une liste. C'est tout l'intérêt d'une route séparée plutôt que d'un champ de
// plus sur /api/crm-dossiers — sinon chaque affichage de /dossiers coûterait le triple.
//
// Accepte `?courriel=` (depuis /reseau) ou `?id=` (depuis /dossiers, qui connaît l'identifiant
// et gère aussi le cas des fiches sans adresse).

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import { resoudreParCourriel, resoudreParDossier } from '../../services/ficheUnifiee';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const courriel = params.get('courriel');

  try {
    const liens = id ? await resoudreParDossier(id) : await resoudreParCourriel(courriel);
    if (!liens) return jsonResponse({ error: 'Fiche introuvable.' }, 404);
    return jsonResponse({ ok: true, liens }, 200);
  } catch (err) {
    console.error('[crm-lien] Résolution impossible :', err);
    return jsonResponse({ error: 'Les liens n’ont pas pu être chargés.' }, 502);
  }
};
