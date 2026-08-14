// Création d'un contrat de courtage (/contrat) — réservé à la courtière.
//
// Stéphanie prépare le contrat et l'envoie ; chaque emprunteur reçoit un lien nominatif à
// usage unique pour le lire, répondre aux questions qui lui reviennent (PPV, transfert de
// cabinet, coordonnées) et signer.
//
// **Aucune signature n'est apposée ici, pas même la sienne.** Les réponses des emprunteurs
// modifient le document : signer avant de les connaître reviendrait à couvrir de sa
// signature des déclarations qu'elle n'a pas vues. Elle signe en dernier, via
// /api/contrat-finaliser. Aucun PDF n'existe avant.
//
// Rien de ce que le navigateur envoie n'est repris tel quel : les données sont validées
// contre le catalogue de src/utils/contratCourtage.ts.
//
// Variables d'environnement : CONTRAT_MOT_DE_PASSE (accès) + RESEND_* (voir emailService).

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import {
  checkRateLimit,
  clientIpFromRequest,
  jsonResponse,
  loadResendEnv,
} from '../../services/emailService';
import {
  envoyerAvisEnAttente,
  envoyerInvitations,
  type InvitationCourriel,
} from '../../services/contratCourriels';
import { creerDossier } from '../../services/contratDossierService';
import { lireReglages, traceEnregistree } from '../../services/reglagesCourtiere';
import { parserDonneesContrat } from '../../utils/contratCourtage';

export const prerender = false;

/** Construit le lien de signature envoyé à un emprunteur. */
function lienSignature(dossierId: string, jeton: string): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/signer-contrat?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

const ECHECS = {
  dossier: 'Le dossier n’a pas pu être enregistré. Réessayez dans quelques minutes.',
  invitation: 'Impossible d’envoyer l’invitation à signer. Vérifiez les adresses courriel saisies.',
} as const;

function echec(etape: keyof typeof ECHECS, err: unknown): Response {
  console.error(`[contrat-creer] Échec à l'étape « ${etape} » :`, err);
  const detail = err instanceof Error ? err.message : String(err);
  return jsonResponse({ error: ECHECS[etape], code: etape, detail: detail.slice(0, 300) }, 502);
}

export const POST: APIRoute = async ({ request }) => {
  // La page /contrat est protégée par mot de passe ; l'endpoint doit l'être identiquement,
  // sinon la protection ne vaut rien.
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page et reconnectez-vous.', code: 'acces' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const clientIp = clientIpFromRequest(request);
  if (!(await checkRateLimit(clientIp, 'contrat-creer'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const donnees = parserDonneesContrat(payload.donnees);
  if (!donnees) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  // On exige la signature mémorisée **dès maintenant**, alors qu'elle ne servira qu'à la
  // finalisation : découvrir son absence une fois que tous les emprunteurs ont signé
  // laisserait un dossier impossible à clore.
  if (!traceEnregistree(await lireReglages())) {
    return jsonResponse(
      { error: 'Aucune signature enregistrée. Dessinez la vôtre dans « Ma signature ».', code: 'signature' },
      400,
    );
  }

  const resendEnv = loadResendEnv();
  if (!resendEnv && !import.meta.env.DEV) {
    console.error('[contrat-creer] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }

  let aEnvoyer: InvitationCourriel[];
  try {
    const { invitations } = await creerDossier(donnees);
    aEnvoyer = invitations.map((invitation) => ({
      nom: invitation.nom,
      courriel: invitation.courriel,
      lien: lienSignature(invitation.dossierId, invitation.jeton),
    }));
  } catch (err) {
    return echec('dossier', err);
  }

  const enAttente = aEnvoyer.map((i) => ({ nom: i.nom, courriel: i.courriel }));

  // En développement sans Resend, le dossier est créé quand même et les liens sont imprimés
  // dans la console : c'est la seule façon de dérouler la chaîne en local.
  if (!resendEnv) {
    console.log('[contrat-creer] ⚠️  Resend non configuré — invitations simulées. Liens à ouvrir :');
    for (const invitation of aEnvoyer) console.log(`  ${invitation.nom} → ${invitation.lien}`);
    return jsonResponse({ ok: true, dev: true, enAttente }, 200);
  }

  // L'invitation est ce qui débloque la suite : si elle part, le dossier vit, même si la
  // notification interne échoue. On ne fait donc échouer la soumission que sur l'invitation.
  const [invitationsEnvoyees, avisInterne] = await Promise.allSettled([
    envoyerInvitations(resendEnv, aEnvoyer),
    envoyerAvisEnAttente(resendEnv, donnees, aEnvoyer),
  ]);

  if (invitationsEnvoyees.status === 'rejected') {
    return echec('invitation', invitationsEnvoyees.reason);
  }
  if (avisInterne.status === 'rejected') {
    console.error('[contrat-creer] Invitations parties, mais la notification interne a échoué :', avisInterne.reason);
  }

  return jsonResponse({ ok: true, enAttente }, 200);
};
