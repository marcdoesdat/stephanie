// Relance du signataire courant — /api/contrat-relancer. Réservé à la courtière.
//
// Sert quand un lien s'est perdu, qu'une adresse était mal saisie, ou qu'il faut simplement
// remettre l'appareil à quelqu'un en présentiel.
//
// **Réémettre invalide l'ancien lien.** Deux liens vivants pour la même place ouvriraient la
// porte à une signature en double ; c'est `reemettreLienCourant` qui le garantit, et il relit
// le dossier plutôt que de croire l'appelant — un dossier gelé entre-temps par un refus ne
// doit plus laisser vivre aucun lien.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import { envoyerInvitation } from '../../services/contratCourriels';
import { listerDossiers, reemettreLienCourant } from '../../services/contratDossierService';

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
  if (!(await checkRateLimit(clientIp, 'contrat-relancer'))) {
    return jsonResponse({ error: 'Trop de demandes. Réessayez dans une heure.' }, 429);
  }

  const invitation = await reemettreLienCourant(payload.d);
  if (!invitation) {
    return jsonResponse(
      { error: 'Ce dossier n’attend plus de signature — il est peut-être gelé, complet ou expiré.' },
      410,
    );
  }

  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  const lien = `${base}/signer-contrat?d=${encodeURIComponent(invitation.dossierId)}&j=${encodeURIComponent(invitation.jeton)}`;

  // Le rang sert au texte du courriel (« vous signez en premier », « les précédents ont
  // signé ») : on le retrouve dans le résumé plutôt que de le faire porter par la requête,
  // où le navigateur pourrait le fausser.
  const resume = (await listerDossiers()).find((d) => d.id === invitation.dossierId);
  const total = resume?.emprunteurs.length ?? 1;
  const rang = (resume?.emprunteurs.findIndex((e) => e.signeLe === null) ?? 0) + 1;

  // En présentiel, le lien revient à l'écran : c'est l'appareil de la courtière, et le jeton
  // n'a aucune raison de transiter par une boîte courriel.
  if (resume?.mode === 'presence') {
    return jsonResponse({ ok: true, mode: 'presence', nom: invitation.nom, lien }, 200);
  }

  const resendEnv = loadResendEnv();
  if (!resendEnv) {
    console.log(`[contrat-relancer] ⚠️  Resend non configuré — lien pour ${invitation.nom} : ${lien}`);
    return jsonResponse({ ok: true, dev: true, nom: invitation.nom, courriel: invitation.courriel }, 200);
  }

  try {
    await envoyerInvitation(
      resendEnv,
      { nom: invitation.nom, courriel: invitation.courriel, lien },
      rang,
      total,
    );
  } catch (err) {
    console.error('[contrat-relancer] Envoi impossible :', err);
    // Le nouveau jeton est déjà en place et l'ancien mort : le dire, plutôt que de laisser
    // croire que rien n'a bougé.
    return jsonResponse(
      { error: 'Le lien a été renouvelé mais le courriel n’est pas parti. Réessayez la relance.' },
      502,
    );
  }

  return jsonResponse({ ok: true, nom: invitation.nom, courriel: invitation.courriel }, 200);
};
