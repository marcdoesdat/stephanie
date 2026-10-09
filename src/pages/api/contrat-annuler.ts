// Annulation d'un contrat en cours — /api/contrat-annuler. Réservé à la courtière.
//
// C'est le pendant, côté courtière, du refus de l'emprunteur : elle stoppe un dossier
// qu'elle ne veut plus voir signé (erreur dans le contrat, conditions qui ont bougé,
// emprunteur qui renonce). Tous les liens cessent de valoir, aucun PDF ne sera produit, et
// chaque emprunteur déjà atteint est prévenu — sinon il cliquerait sur un lien mort et
// croirait à une panne.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import { envoyerAnnulation } from '../../services/contratCourriels';
import { annulerDossier, destinatairesAnnulation } from '../../services/contratDossierService';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const clientIp = clientIpFromRequest(request);
  if (!(await checkRateLimit(clientIp, 'contrat-annuler'))) {
    return jsonResponse({ error: 'Trop de demandes. Réessayez dans une heure.' }, 429);
  }

  const dossier = await annulerDossier(payload.d);
  if (!dossier) {
    return jsonResponse(
      { error: 'Ce dossier ne peut plus être annulé — il est peut-être déjà expiré, gelé ou annulé.' },
      410,
    );
  }

  // Prévenir ceux qui ont déjà été atteints : signataires, et signataire courant à distance.
  // Ceux dont le tour n'était pas venu n'ont rien reçu — rien à démentir. En dev sans
  // Resend, l'annulation est simulée et journalisée — même convention que le reste.
  const resendEnv = loadResendEnv();
  const destinataires = destinatairesAnnulation(dossier);

  if (destinataires.length === 0) {
    // Présentiel, personne n'a encore signé : aucun courriel n'est parti, aucun à envoyer.
  } else if (resendEnv) {
    try {
      await envoyerAnnulation(resendEnv, destinataires);
    } catch (err) {
      // Le dossier est annulé quoi qu'il arrive : c'est l'essentiel.
      console.error('[contrat-annuler] Avis d’annulation non envoyé :', err);
    }
  } else {
    console.log(
      `[contrat-annuler] ⚠️  Resend non configuré — annulation simulée pour ${destinataires
        .map((d) => d.nom)
        .join(', ')}.`,
    );
  }

  return jsonResponse({ ok: true }, 200);
};
