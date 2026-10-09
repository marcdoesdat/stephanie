// Correction d'un contrat en cours — /api/contrat-corriger. Réservé à la courtière.
//
// Une coquille dans un contrat déjà parti ne devrait pas obliger à tout ressaisir. `GET`
// rend les données du dossier pour préremplir le formulaire de /contrat ; `POST` enregistre
// la version corrigée dans **le même dossier**.
//
// **Les signatures déjà recueillies sont écartées** (voir `corrigerContrat`) : un emprunteur
// a signé l'ancien texte, pas celui-ci. La séquence repart du premier signataire, avec un
// nouveau lien ; tous les anciens meurent. Ce qui est épargné, c'est la ressaisie — jamais
// la relecture de ceux qui signent.
//
// Même porte que /contrat : une page protégée devant une API ouverte ne protège rien.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import { envoyerAvisCorrection, envoyerAvisEnAttente, envoyerInvitation } from '../../services/contratCourriels';
import { corrigerContrat, lireDonneesACorriger } from '../../services/contratDossierService';
import { nomComplet, parserDonneesContrat } from '../../utils/contratCourtage';

export const prerender = false;

const INTROUVABLE =
  'Ce contrat ne peut plus être corrigé — il est peut-être expiré, refusé, annulé ou déjà finalisé.';

function lienSignature(dossierId: string, jeton: string): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/signer-contrat?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  const lu = await lireDonneesACorriger(url.searchParams.get('d'));
  if (!lu) return jsonResponse({ error: INTROUVABLE }, 410);

  return new Response(JSON.stringify({ ok: true, ...lu }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

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
  if (!(await checkRateLimit(clientIp, 'contrat-corriger'))) {
    return jsonResponse({ error: 'Trop de demandes. Réessayez dans une heure.' }, 429);
  }

  const donnees = parserDonneesContrat(payload.donnees);
  if (!donnees) return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);

  const resendEnv = loadResendEnv();
  if (!resendEnv && !import.meta.env.DEV) {
    console.error('[contrat-corriger] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }

  let resultat;
  try {
    resultat = await corrigerContrat(payload.d, donnees);
  } catch (err) {
    console.error('[contrat-corriger] Le dossier n’a pas pu être enregistré :', err);
    return jsonResponse({ error: 'La correction n’a pas pu être enregistrée. Réessayez dans quelques minutes.' }, 502);
  }

  if (!resultat.ok) {
    return resultat.raison === 'inchange'
      ? jsonResponse({ error: 'Aucun changement : le contrat est identique à celui déjà envoyé.', code: 'inchange' }, 400)
      : jsonResponse({ error: INTROUVABLE }, 410);
  }

  const { dossier, invitation, changements, atteints } = resultat;
  const signaturesEcartees = dossier.corrections?.at(-1)?.signaturesEcartees ?? [];
  const ordre = donnees.emprunteurs.map((e) => ({ nom: nomComplet(e), courriel: e.courriel }));
  const premier = { nom: invitation.nom, courriel: invitation.courriel, lien: lienSignature(dossier.id, invitation.jeton) };

  // En présentiel, aucun lien n'est parti par courriel et il n'en part pas davantage : le
  // nouveau lien revient à l'écran, et la courtière tend de nouveau l'appareil.
  if (dossier.mode === 'presence') {
    if (resendEnv) {
      try {
        await envoyerAvisEnAttente(resendEnv, donnees, ordre, 'presence', { changements, signaturesEcartees });
      } catch (err) {
        console.error('[contrat-corriger] Notification interne non envoyée :', err);
      }
    }
    return jsonResponse({ ok: true, mode: 'presence', ordre, changements, signaturesEcartees, lien: premier.lien }, 200);
  }

  if (!resendEnv) {
    console.log(`[contrat-corriger] ⚠️  Resend non configuré — lien pour ${premier.nom} : ${premier.lien}`);
    return jsonResponse({ ok: true, dev: true, mode: 'distance', ordre, changements, signaturesEcartees }, 200);
  }

  // Le premier signataire reçoit son nouveau lien ; s'il avait déjà été atteint, l'invitation
  // dit pourquoi on lui redemande de signer. Les autres déjà atteints apprennent que leur
  // signature ou leur lien ne vaut plus — sans lien : le leur viendra à leur tour, comme
  // toujours. En série, l'invitation d'abord : c'est le seul jeton vivant.
  const premierAtteint = atteints.find((a) => a.courriel === premier.courriel);
  try {
    await envoyerInvitation(
      resendEnv,
      premier,
      1,
      donnees.emprunteurs.length,
      premierAtteint ? { changements, aSigne: premierAtteint.aSigne } : undefined,
    );
  } catch (err) {
    // Le dossier est corrigé et les anciens liens sont morts : « Renvoyer le lien » rattrape.
    console.error('[contrat-corriger] Invitation non envoyée :', err);
    return jsonResponse(
      {
        error: `Le contrat est corrigé, mais le lien n’a pas pu partir à ${premier.nom}. Utilisez « Renvoyer le lien » dans le suivi.`,
        code: 'invitation',
      },
      502,
    );
  }

  const aPrevenir = atteints.filter((a) => a.courriel !== premier.courriel);
  if (aPrevenir.length > 0) {
    try {
      await envoyerAvisCorrection(resendEnv, aPrevenir, changements);
    } catch (err) {
      console.error('[contrat-corriger] Avis de correction non envoyé :', err);
    }
  }

  try {
    await envoyerAvisEnAttente(resendEnv, donnees, ordre, 'distance', { changements, signaturesEcartees });
  } catch (err) {
    console.error('[contrat-corriger] Notification interne non envoyée :', err);
  }

  return jsonResponse({ ok: true, mode: 'distance', ordre, changements, signaturesEcartees }, 200);
};
