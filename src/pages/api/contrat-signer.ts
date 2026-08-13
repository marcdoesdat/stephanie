// Signature d'un contrat de courtage par un emprunteur, via son lien nominatif (/signer-contrat).
//
// Deux issues :
//
//   • signature — le tracé est enregistré et le jeton consommé. Si c'était le dernier
//     emprunteur attendu, le contrat est produit ici et envoyé à la courtière, puis le
//     dossier est supprimé : les tracés ne restent jamais au repos plus longtemps que
//     nécessaire.
//
//   • refus — l'emprunteur n'est pas d'accord avec le contrat. Le dossier est gelé, aucun
//     PDF n'est produit, les liens restants cessent de fonctionner et Stéphanie est
//     prévenue. Mieux vaut un dossier gelé qu'une signature arrachée.
//
// Le jeton est à usage unique : rouvrir le lien après coup ne donne plus rien.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import {
  envoyerAvisRefus,
  envoyerDossierComplet,
  type PreuveSignature,
} from '../../services/contratCourriels';
import {
  enregistrerSignature,
  marquerRefus,
  ouvrirParJeton,
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
import { nomComplet } from '../../utils/contratCourtage';
import { decoderTraceSignature } from '../../utils/traceSignature';

export const prerender = false;

const LIEN_INVALIDE = 'Ce lien n’est plus valide. Il a peut-être déjà servi, ou le contrat a expiré.';

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

/** Reconstitue la trace de preuve de chaque emprunteur ayant signé. */
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
      } satisfies PreuveSignature;
    })
    .filter((p): p is PreuveSignature => p !== null);
}

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const clientIp = clientIpFromRequest(request);
  const agent = request.headers.get('user-agent') ?? 'inconnu';

  if (!(await checkRateLimit(clientIp, 'contrat-signer'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const ouvert = await ouvrirParJeton(payload.d, payload.j);
  if (!ouvert) return jsonResponse({ error: LIEN_INVALIDE, code: 'lien' }, 410);

  const { dossier, index } = ouvert;
  const entree = dossier.emprunteurs[index]!;
  const resendEnv = loadResendEnv();

  /* ---------- Refus de signer ---------- */

  if (payload.action === 'refus') {
    const motif = typeof payload.motif === 'string' ? payload.motif.trim() : '';
    try {
      await marquerRefus(dossier, index, motif);
    } catch (err) {
      console.error('[contrat-signer] Impossible de geler le dossier :', err);
      return jsonResponse({ error: 'Votre réponse n’a pas pu être enregistrée. Réessayez.' }, 502);
    }

    if (resendEnv) {
      try {
        await envoyerAvisRefus(resendEnv, dossier.donnees, {
          nom: nomComplet(entree.emprunteur),
          courriel: entree.emprunteur.courriel,
          motif,
        });
      } catch (err) {
        // Le dossier est gelé quoi qu'il arrive : c'est l'essentiel. L'avis peut être rejoué.
        console.error('[contrat-signer] Avis de refus non envoyé :', err);
      }
    } else {
      console.log('[contrat-signer] ⚠️  Resend non configuré — avis de refus simulé.');
    }

    return jsonResponse({ ok: true, refus: true }, 200);
  }

  /* ---------- Signature ---------- */

  if (payload.attestation !== true) {
    return jsonResponse({ error: 'Vous devez confirmer l’attestation avant de signer.' }, 400);
  }

  const trace = decoderTraceSignature(payload.signature);
  if (!trace) return jsonResponse({ error: 'Signature manquante ou illisible' }, 400);

  const maintenant = new Date();
  const signature: SignatureEnregistree = {
    tracePngBase64: versBase64(trace),
    signeLe: maintenant.toISOString(),
    voie: 'distance',
    ip: clientIp,
    agent,
    empreinteTrace: await empreinteSha256(trace),
  };

  let complet: boolean;
  try {
    ({ complet } = await enregistrerSignature(dossier, index, signature));
  } catch (err) {
    console.error('[contrat-signer] Impossible d’enregistrer la signature :', err);
    return jsonResponse({ error: 'Votre signature n’a pas pu être enregistrée. Réessayez.' }, 502);
  }

  // Il reste des emprunteurs à signer : on s'arrête là, leur lien vit toujours.
  if (!complet) {
    return jsonResponse({ ok: true, complet: false, restants: dossier.emprunteurs.filter((e) => !e.signature).length }, 200);
  }

  /* ---------- Dernier signataire : on produit le contrat ---------- */

  const nomFichier = nomFichierContrat(nomComplet(dossier.donnees.emprunteurs[0]!), maintenant);
  let pdf: Uint8Array;
  try {
    const aEstamper = new Map<number, SignatureEstampee>();
    for (const [position, e] of dossier.emprunteurs.entries()) {
      if (!e.signature) continue;
      aEstamper.set(position, {
        nom: nomComplet(e.emprunteur),
        trace: depuisBase64(e.signature.tracePngBase64),
        signeLe: new Date(e.signature.signeLe),
      });
    }
    pdf = await genererContratPdf(
      dossier.donnees,
      aEstamper,
      dossier.signatureCourtiere
        ? {
            nom: loadSiteConfig().nom,
            trace: depuisBase64(dossier.signatureCourtiere.tracePngBase64),
            signeLe: new Date(dossier.signatureCourtiere.signeLe),
          }
        : null,
    );
  } catch (err) {
    console.error('[contrat-signer] Le contrat n’a pas pu être produit :', err);
    // Le dossier reste en place : la signature est enregistrée, l'envoi pourra être rejoué.
    return jsonResponse({ error: 'Le contrat n’a pas pu être produit. Stéphanie a été prévenue.' }, 502);
  }

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
      console.log('[contrat-signer] ⚠️  Resend non configuré — envoi du contrat simulé :', nomFichier);
    }
  } catch (err) {
    console.error('[contrat-signer] Contrat produit mais envoi échoué :', err);
    return jsonResponse({ error: 'Votre signature est enregistrée, mais l’envoi a échoué. Stéphanie a été prévenue.' }, 502);
  }

  // Le dossier a fini son office : les tracés ne doivent pas rester au repos une minute de
  // plus que nécessaire.
  await supprimerDossier(dossier.id);

  return jsonResponse({ ok: true, complet: true }, 200);
};
