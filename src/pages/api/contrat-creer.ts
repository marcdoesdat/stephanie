// Création d'un contrat de courtage (/contrat) — réservé à la courtière.
//
// Stéphanie prépare le contrat et l'envoie. **Un seul contrat existe, et il se signe en
// séquence** : le premier emprunteur reçoit un lien nominatif à usage unique, et ce n'est
// qu'une fois qu'il a signé que le suivant reçoit le sien. Chacun voit donc le document avec
// les signatures déjà apposées, comme une feuille qu'on se passe.
//
// En présentiel, l'acheminement change mais pas l'ordre : le lien du signataire courant est
// remis à l'écran de la courtière plutôt qu'envoyé par courriel.
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
import { envoyerAvisEnAttente, envoyerInvitation } from '../../services/contratCourriels';
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

  const mode = payload.mode === 'presence' ? 'presence' : 'distance';

  let premier: { nom: string; courriel: string; lien: string };
  try {
    const { invitation } = await creerDossier(donnees, mode);
    premier = {
      nom: invitation.nom,
      courriel: invitation.courriel,
      lien: lienSignature(invitation.dossierId, invitation.jeton),
    };
  } catch (err) {
    return echec('dossier', err);
  }

  // L'ordre de passage, pour que l'écran de confirmation le rappelle.
  const ordre = donnees.emprunteurs.map((e) => ({
    nom: `${e.prenom} ${e.nom}`.trim(),
    courriel: e.courriel,
  }));

  // En présentiel, le lien ne part pas par courriel : il est remis à la courtière, qui tend
  // l'appareil au premier signataire. Le jeton ne transite donc jamais par une boîte tierce.
  if (mode === 'presence') {
    if (resendEnv) {
      try {
        await envoyerAvisEnAttente(resendEnv, donnees, ordre, mode);
      } catch (err) {
        console.error('[contrat-creer] Notification interne non envoyée :', err);
      }
    }
    return jsonResponse({ ok: true, mode, ordre, lien: premier.lien }, 200);
  }

  // En développement sans Resend, le dossier est créé quand même et le lien est imprimé dans
  // la console : c'est la seule façon de dérouler la chaîne en local.
  if (!resendEnv) {
    console.log(`[contrat-creer] ⚠️  Resend non configuré — lien pour ${premier.nom} : ${premier.lien}`);
    return jsonResponse({ ok: true, dev: true, mode, ordre }, 200);
  }

  /*
   * En séquence, l'invitation d'abord — jamais les deux de front.
   *
   * Un `Promise.allSettled` posait les deux requêtes sur le fil à la même milliseconde, pour
   * une limite de débit Resend qui se compte à la seconde. Quand le 429 tombait sur
   * l'invitation, la courtière était prévenue qu'un contrat attendait pendant que le
   * signataire, lui, n'avait rien reçu — l'inverse exact de la priorité annoncée. Ici le
   * jeton du signataire courant est le **seul** vivant : son courriel passe en premier.
   */
  try {
    await envoyerInvitation(resendEnv, premier, 1, donnees.emprunteurs.length);
  } catch (err) {
    return echec('invitation', err);
  }

  try {
    await envoyerAvisEnAttente(resendEnv, donnees, ordre, mode);
  } catch (err) {
    console.error('[contrat-creer] Invitation partie, mais la notification interne a échoué :', err);
  }

  return jsonResponse({ ok: true, mode, ordre }, 200);
};
