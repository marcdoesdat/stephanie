// Finalisation d'un contrat par la courtière — /api/contrat-finaliser.
//
// Dernier maillon de la chaîne : tous les emprunteurs ont signé et répondu, Stéphanie a relu
// le document, et sa signature mémorisée vient le clore. C'est **ici** et nulle part ailleurs
// que le PDF est produit, envoyé, puis le dossier supprimé.
//
// Pourquoi elle signe en dernier : les réponses des emprunteurs (PPV, transfert de cabinet,
// coordonnées) modifient le document. Signer avant de les connaître reviendrait à couvrir de
// sa signature des déclarations qu'elle n'a pas vues.
//
// Protégé par le mot de passe de /contrat — pas de jeton nominatif : ce serait un secret de
// plus à faire circuler par courriel, pour la même porte.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import { envoyerDossierComplet, type PreuveSignature } from '../../services/contratCourriels';
import {
  ouvrirPourFinalisation,
  signerParLaCourtiere,
  supprimerDossier,
  type DossierContrat,
} from '../../services/contratDossierService';
import type { SignatureEnregistree } from '../../services/dossierStockage';
import {
  empreinteSha256,
  genererContratPdf,
  nomFichierContrat,
  type SignatureEstampee,
} from '../../services/contratPdfService';
import { lireReglages, traceEnregistree } from '../../services/reglagesCourtiere';
import { nomComplet } from '../../utils/contratCourtage';

export const prerender = false;

function versBase64(octets: Uint8Array): string {
  let binaire = '';
  const TRANCHE = 0x8000;
  for (let i = 0; i < octets.length; i += TRANCHE) {
    binaire += String.fromCharCode(...octets.subarray(i, i + TRANCHE));
  }
  return btoa(binaire);
}

function depuisBase64(base64: string): Uint8Array {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** Reconstitue la trace de preuve de chaque emprunteur. */
function preuvesDe(dossier: DossierContrat): PreuveSignature[] {
  return dossier.emprunteurs
    .map((entree) => {
      if (!entree.signature) return null;
      return {
        nom: nomComplet(entree.emprunteur),
        courriel: entree.emprunteur.courriel,
        signeLe: entree.signature.signeLe,
        voie: entree.signature.voie,
        ip: entree.signature.ip,
        agent: entree.signature.agent,
        empreinteTrace: entree.signature.empreinteTrace,
        reponses: entree.reponses,
      } satisfies PreuveSignature;
    })
    .filter((p): p is PreuveSignature => p !== null);
}

export const POST: APIRoute = async ({ request }) => {
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
  if (!(await checkRateLimit(clientIp, 'contrat-finaliser'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const dossier = await ouvrirPourFinalisation(payload.d);
  if (!dossier) {
    return jsonResponse({ error: 'Ce dossier n’est plus à finaliser — il a peut-être expiré.', code: 'dossier' }, 410);
  }

  const trace = traceEnregistree(await lireReglages());
  if (!trace) {
    return jsonResponse(
      { error: 'Aucune signature enregistrée. Dessinez la vôtre dans « Ma signature ».', code: 'signature' },
      400,
    );
  }

  const maintenant = new Date();
  const config = loadSiteConfig();
  const signatureCourtiere: SignatureEnregistree = {
    tracePngBase64: versBase64(trace),
    signeLe: maintenant.toISOString(),
    voie: 'presence',
    ip: clientIp,
    agent: request.headers.get('user-agent') ?? 'inconnu',
    empreinteTrace: await empreinteSha256(trace),
  };

  try {
    await signerParLaCourtiere(dossier, signatureCourtiere);
  } catch (err) {
    console.error('[contrat-finaliser] Impossible d’enregistrer la signature :', err);
    return jsonResponse({ error: 'Votre signature n’a pas pu être enregistrée. Réessayez.' }, 502);
  }

  /* ---------- Production du contrat ---------- */

  const nomFichier = nomFichierContrat(nomComplet(dossier.donnees.emprunteurs[0]!), maintenant);
  let pdf: Uint8Array;
  try {
    const aEstamper = new Map<number, SignatureEstampee>();
    for (const [position, entree] of dossier.emprunteurs.entries()) {
      if (!entree.signature) continue;
      aEstamper.set(position, {
        nom: nomComplet(entree.emprunteur),
        trace: depuisBase64(entree.signature.tracePngBase64),
        signeLe: new Date(entree.signature.signeLe),
      });
    }
    pdf = await genererContratPdf(
      dossier.donnees,
      aEstamper,
      { nom: config.nom, trace, signeLe: maintenant },
      dossier.emprunteurs.map((e) => e.reponses),
    );
  } catch (err) {
    console.error('[contrat-finaliser] Le contrat n’a pas pu être produit :', err);
    // Le dossier reste en place : la signature est enregistrée, l'envoi pourra être rejoué.
    return jsonResponse({ error: 'Le contrat n’a pas pu être produit. Le dossier est conservé.' }, 502);
  }

  const resendEnv = loadResendEnv();
  try {
    if (resendEnv) {
      await envoyerDossierComplet(resendEnv, {
        donnees: dossier.donnees,
        preuves: preuvesDe(dossier),
        pdfBase64: versBase64(pdf),
        empreintePdf: await empreinteSha256(pdf),
        nomFichier,
      });
    } else {
      console.log('[contrat-finaliser] ⚠️  Resend non configuré — envoi du contrat simulé :', nomFichier);
    }
  } catch (err) {
    console.error('[contrat-finaliser] Contrat produit mais envoi échoué :', err);
    return jsonResponse({ error: 'Le contrat est produit, mais l’envoi a échoué. Réessayez.' }, 502);
  }

  // Le dossier a fini son office : les tracés ne doivent pas rester au repos une minute de
  // plus que nécessaire.
  await supprimerDossier(dossier.id);

  return jsonResponse({ ok: true, nomFichier }, 200);
};
