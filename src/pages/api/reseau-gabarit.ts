// Édition des gabarits de courriel — /api/reseau-gabarit. Réservé à la courtière.
//
// GET    ?gabarit=…&profession=…  → le texte en vigueur (réécrit ou d'origine), NON rendu :
//                                   c'est le modèle avec ses {{variables}} qu'on édite.
// PUT    { gabarit, profession, objet, corps } → enregistre la réécriture, après validation.
// DELETE { gabarit, profession }  → revient au modèle d'origine.
//
// La portée est le couple (gabarit, profession) : c'est ce qu'elle a sous les yeux quand
// elle écrit. Un texte retouché pour un notaire n'a pas à partir ensuite à un comptable.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import {
  enregistrerSurcharge,
  gabaritEffectif,
  gabaritOrigine,
  oublierSurcharge,
} from '../../services/reseauGabaritsService';
import {
  GABARITS,
  LONGUEURS,
  gabaritValide,
  normaliser,
  professionValide,
  type CleGabarit,
  type CleProfession,
} from '../../utils/reseauCourtiers';

export const prerender = false;

/** Les notes gardent leurs retours à la ligne : un gabarit est fait de paragraphes. */
function normaliserModele(valeur: unknown, max: number): string {
  if (typeof valeur !== 'string') return '';
  return valeur.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, max);
}

type Cible = { gabarit: CleGabarit; profession: CleProfession };

function cible(gabarit: unknown, profession: unknown): Cible | null {
  if (!gabaritValide(gabarit) || !professionValide(profession)) return null;
  return { gabarit, profession };
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  const params = new URL(request.url).searchParams;
  const ou = cible(params.get('gabarit'), params.get('profession'));
  if (!ou) return jsonResponse({ error: 'Gabarit ou profession inconnu.' }, 400);

  try {
    const effectif = await gabaritEffectif(ou.gabarit, ou.profession);
    return jsonResponse(
      {
        ok: true,
        ...effectif,
        // L'original voyage avec : « revenir au modèle » doit pouvoir montrer ce qu'il
        // rendrait avant qu'elle ne clique, sans second aller-retour.
        origine: gabaritOrigine(ou.gabarit, ou.profession),
        nom: GABARITS[ou.gabarit].nom,
      },
      200,
    );
  } catch (err) {
    console.error('[reseau-gabarit] Lecture impossible :', err);
    return jsonResponse({ error: 'Le gabarit n’a pas pu être chargé.' }, 502);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  let source: Record<string, unknown>;
  try {
    source = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const ou = cible(source.gabarit, source.profession);
  if (!ou) return jsonResponse({ error: 'Gabarit ou profession inconnu.' }, 400);

  const objet = normaliser(source.objet, LONGUEURS.objet);
  if (objet.length < 3) return jsonResponse({ error: 'L’objet est requis.' }, 400);

  const corps = normaliserModele(source.corps, LONGUEURS.corps);
  if (corps.length < 20) return jsonResponse({ error: 'Le message est trop court.' }, 400);

  try {
    const verdict = await enregistrerSurcharge(ou.gabarit, ou.profession, objet, corps);
    if (!verdict.ok) return jsonResponse({ error: verdict.erreur, code: 'modele' }, 400);
    return jsonResponse({ ok: true, objet, corps, personnalise: true }, 200);
  } catch (err) {
    console.error('[reseau-gabarit] Enregistrement impossible :', err);
    return jsonResponse({ error: 'Le gabarit n’a pas pu être enregistré.' }, 502);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  let source: Record<string, unknown>;
  try {
    source = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const ou = cible(source.gabarit, source.profession);
  if (!ou) return jsonResponse({ error: 'Gabarit ou profession inconnu.' }, 400);

  try {
    await oublierSurcharge(ou.gabarit, ou.profession);
    return jsonResponse({ ok: true, ...gabaritOrigine(ou.gabarit, ou.profession) }, 200);
  } catch (err) {
    console.error('[reseau-gabarit] Retour au modèle impossible :', err);
    return jsonResponse({ error: 'Le modèle d’origine n’a pas pu être rétabli.' }, 502);
  }
};
