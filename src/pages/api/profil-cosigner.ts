// Signature à distance d'un co-emprunteur (/signer?d=…&j=…).
//
// Deux actions possibles :
//   • « signer »   — enregistre le tracé et consomme le jeton. Si c'était la dernière
//                    signature attendue, le PDF est produit, envoyé à la courtière (les
//                    signataires n'ont qu'un accusé), et le dossier est supprimé.
//   • « desaccord » — le co-signataire ne se reconnaît pas dans les réponses : le dossier
//                    est gelé, aucun PDF ne sera produit, la courtière est prévenue.
//
// Le jeton est vérifié par profilDossierService (haché, usage unique, expiration) ; cet
// endpoint ne connaît jamais de secret en clair au-delà de la requête courante.

import type { APIRoute } from 'astro';
import {
  checkRateLimit,
  clientIpFromRequest,
  jsonResponse,
  loadResendEnv,
} from '../../services/emailService';
import {
  envoyerAvisDesaccord,
  envoyerDossierComplet,
  nomFichierProfil,
  type PreuveSignature,
} from '../../services/profilCourriels';
import {
  enregistrerSignature,
  marquerDesaccord,
  ouvrirParJeton,
  supprimerDossier,
  type Dossier,
} from '../../services/profilDossierService';
import { empreinteSha256, genererProfilPdf, versBase64 } from '../../services/profilPdfService';
import { decoderTraceSignature } from '../../utils/profilEmprunteurs';

export const prerender = false;

/** Reconstitue les octets d'un tracé stocké en base64 dans le dossier. */
function depuisBase64(base64: string): Uint8Array {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function preuvesDu(dossier: Dossier): PreuveSignature[] {
  return dossier.signataires
    .filter((s) => s.signature !== null)
    .map((s) => ({
      nom: s.nom,
      courriel: s.courriel,
      signeLe: s.signature!.signeLe,
      voie: s.signature!.voie,
      ip: s.signature!.ip,
      agent: s.signature!.agent,
      empreinteTrace: s.signature!.empreinteTrace,
    }));
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const agent = request.headers.get('user-agent') ?? 'inconnu';

  if (!(await checkRateLimit(clientIp, 'profil-cosigner'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const ouvert = await ouvrirParJeton(payload.dossier, payload.jeton);
  if (!ouvert) {
    return jsonResponse({ error: 'Ce lien de signature n’est plus valide.' }, 404);
  }
  const { dossier, index } = ouvert;

  const resendEnv = loadResendEnv();
  const enDev = import.meta.env.DEV && !resendEnv;
  if (!resendEnv && !enDev) {
    console.error('[profil-cosigner] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }

  /* ---------- Désaccord : on gèle plutôt que d'arracher une signature ---------- */

  if (payload.action === 'desaccord') {
    const motif = typeof payload.motif === 'string' ? payload.motif.trim() : '';
    const gele = await marquerDesaccord(dossier, index, motif);
    try {
      if (resendEnv) {
        await envoyerAvisDesaccord(
          resendEnv,
          gele.reponses,
          { nom: gele.signataires[index]!.nom, courriel: gele.signataires[index]!.courriel },
          motif,
        );
      } else {
        console.log('[profil-cosigner] ⚠️  Resend non configuré — désaccord simulé :', motif);
      }
    } catch (err) {
      console.error('[profil-cosigner] Échec d\'envoi de l\'avis de désaccord :', err);
    }
    return jsonResponse({ ok: true, statut: 'gele' }, 200);
  }

  /* ---------- Signature ---------- */

  if (payload.attestation !== true) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const trace = decoderTraceSignature(payload.signature);
  if (!trace) {
    return jsonResponse({ error: 'Signature manquante ou illisible' }, 400);
  }

  const { dossier: aJour, complet } = await enregistrerSignature(dossier, index, {
    tracePngBase64: versBase64(trace),
    signeLe: new Date().toISOString(),
    voie: 'distance',
    ip: clientIp,
    agent,
    empreinteTrace: await empreinteSha256(trace),
  });

  if (!complet) {
    const restants = aJour.signataires.filter((s) => s.signature === null).map((s) => s.nom);
    return jsonResponse({ ok: true, complet: false, enAttente: restants }, 200);
  }

  /* ---------- Dernière signature : on clôt le dossier ---------- */

  try {
    const pdf = await genererProfilPdf(
      aJour.reponses,
      aJour.signataires.map((s) => ({
        nom: s.nom,
        trace: depuisBase64(s.signature!.tracePngBase64),
        signeLe: new Date(s.signature!.signeLe),
      })),
    );
    const nomFichier = nomFichierProfil(aJour.signataires[0]!.nom, new Date());

    if (resendEnv) {
      await envoyerDossierComplet(resendEnv, {
        reponses: aJour.reponses,
        preuves: preuvesDu(aJour),
        pdfBase64: versBase64(pdf),
        empreintePdf: await empreinteSha256(pdf),
        nomFichier,
      });
    } else {
      console.log('[profil-cosigner] ⚠️  Resend non configuré — envoi du dossier complet simulé.');
    }

    // Le dossier n'a plus de raison d'exister : il ne contenait que des tracés au repos.
    await supprimerDossier(aJour.id);

    // Comme dans /api/profil-submit : le document reste entre le serveur et la courtière.
    return jsonResponse({ ok: true, complet: true }, 200);
  } catch (err) {
    console.error('[profil-cosigner] Échec de clôture du dossier :', err);
    // Le dossier reste en place : la signature est enregistrée, une relance pourra reprendre.
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }
};
