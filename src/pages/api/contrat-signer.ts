// Signature d'un contrat de courtage par un emprunteur, via son lien nominatif (/signer-contrat).
//
// Deux issues :
//
//   • signature — les réponses de l'emprunteur (PPV, transfert de cabinet, coordonnées) et
//     son tracé sont enregistrés, et son jeton consommé. **Le tour passe alors au suivant**,
//     dont le lien n'est émis qu'à cet instant : c'est ce qui rend l'ordre structurel plutôt
//     que conventionnel. Quand c'est le dernier attendu, le dossier passe en « à finaliser »
//     et la courtière est prévenue — c'est elle qui signera et clora le dossier.
//
//   • refus — l'emprunteur n'est pas d'accord. Le dossier est gelé, aucun PDF n'est produit,
//     les liens restants cessent de fonctionner et Stéphanie est prévenue. Mieux vaut un
//     dossier gelé qu'une signature arrachée.
//
// Le jeton est à usage unique : rouvrir le lien après coup ne donne plus rien.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { checkRateLimit, clientIpFromRequest, jsonResponse, loadResendEnv } from '../../services/emailService';
import { envoyerAvisAFinaliser, envoyerAvisRefus, envoyerInvitation } from '../../services/contratCourriels';
import {
  enregistrerSignature,
  marquerRefus,
  ouvrirParJeton,
  type DossierContrat,
  type Invitation,
} from '../../services/contratDossierService';
import type { SignatureEnregistree } from '../../services/dossierStockage';
import { empreinteSha256 } from '../../services/contratPdfService';
import { nomComplet, parserReponsesEmprunteur } from '../../utils/contratCourtage';
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

/** Le lien nominatif du signataire suivant. */
function lienSignature(dossierId: string, jeton: string): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/signer-contrat?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

/** Le lien que suit la courtière pour relire puis signer — protégé par son mot de passe. */
function lienFinalisation(dossier: DossierContrat): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/finaliser-contrat?d=${encodeURIComponent(dossier.id)}`;
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

  // Les deux questions du contrat qui appartiennent à l'emprunteur, plus ses coordonnées.
  const reponses = parserReponsesEmprunteur(payload.reponses);
  if (!reponses) {
    return jsonResponse({ error: 'Répondez aux deux questions avant de signer.' }, 400);
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
  let suivante: Invitation | null;
  try {
    ({ complet, suivante } = await enregistrerSignature(dossier, index, signature, reponses));
  } catch (err) {
    console.error('[contrat-signer] Impossible d’enregistrer la signature :', err);
    return jsonResponse({ error: 'Votre signature n’a pas pu être enregistrée. Réessayez.' }, 502);
  }

  /* ---------- Il reste des emprunteurs : on passe le contrat au suivant ---------- */

  if (!complet) {
    const restants = dossier.emprunteurs.filter((e) => !e.signature).length;
    const rang = dossier.emprunteurs.length - restants + 1;
    const lien = suivante ? lienSignature(suivante.dossierId, suivante.jeton) : null;

    // En présentiel, le lien du suivant revient à l'écran : c'est l'appareil de la courtière
    // et elle supervise le passage. À distance, il ne doit **jamais** redescendre au
    // navigateur de celui qui vient de signer — il part par courriel, et par là seulement.
    if (dossier.mode === 'presence') {
      return jsonResponse(
        { ok: true, complet: false, restants, suivant: suivante?.nom ?? null, lien },
        200,
      );
    }

    if (suivante && lien) {
      if (resendEnv) {
        try {
          await envoyerInvitation(
            resendEnv,
            { nom: suivante.nom, courriel: suivante.courriel, lien },
            rang,
            dossier.emprunteurs.length,
          );
        } catch (err) {
          // La signature est enregistrée et le jeton du suivant existe : un envoi manqué se
          // rattrape depuis /contrat, où la courtière peut réémettre le lien.
          console.error('[contrat-signer] Invitation au suivant non envoyée :', err);
        }
      } else {
        console.log(`[contrat-signer] ⚠️  Resend non configuré — lien pour ${suivante.nom} : ${lien}`);
      }
    }

    return jsonResponse({ ok: true, complet: false, restants, suivant: suivante?.nom ?? null }, 200);
  }

  /* ---------- Dernier signataire : la balle passe à la courtière ---------- */

  if (resendEnv) {
    try {
      await envoyerAvisAFinaliser(resendEnv, dossier, lienFinalisation(dossier));
    } catch (err) {
      // Les signatures sont enregistrées et le dossier attend : un avis manqué se rattrape,
      // et /contrat liste de toute façon les dossiers à finaliser.
      console.error('[contrat-signer] Avis « à finaliser » non envoyé :', err);
    }
  } else {
    console.log(`[contrat-signer] ⚠️  Resend non configuré — à finaliser : ${lienFinalisation(dossier)}`);
  }

  return jsonResponse({ ok: true, complet: true }, 200);
};
