// Création d'un contrat de courtage (/contrat) — réservé à la courtière.
//
// Deux issues selon la voie choisie :
//
//   • « distance » (le cas normal) — Stéphanie signe, un dossier en attente est créé et
//     chaque emprunteur reçoit un lien nominatif à usage unique. Aucun PDF n'existe tant
//     que le dernier n'a pas signé : c'est /api/contrat-signer qui clôt le dossier.
//
//   • « presence » — tout le monde signe sur le même appareil. Le contrat est produit ici
//     et envoyé à la seule courtière ; les emprunteurs reçoivent un accusé sans pièce
//     jointe. Le document ne redescend jamais au navigateur. Rien n'est stocké.
//
// Rien de ce que le navigateur envoie n'est repris tel quel : les données sont validées
// contre le catalogue de src/utils/contratCourtage.ts, et chaque PNG de signature est
// vérifié avant d'approcher pdf-lib.
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
  envoyerDossierComplet,
  envoyerInvitations,
  type InvitationCourriel,
  type PreuveSignature,
} from '../../services/contratCourriels';
import { creerDossier } from '../../services/contratDossierService';
import type { SignatureEnregistree } from '../../services/dossierStockage';
import {
  empreinteSha256,
  genererContratPdf,
  nomFichierContrat,
  type SignatureEstampee,
} from '../../services/contratPdfService';
import { nomComplet, parserDonneesContrat } from '../../utils/contratCourtage';
import { decoderTraceSignature } from '../../utils/traceSignature';

export const prerender = false;

/** Encode des octets en base64 — format attendu par les pièces jointes Resend. */
function versBase64(octets: Uint8Array): string {
  let binaire = '';
  const TRANCHE = 0x8000; // évite de dépasser la limite d'arguments de String.fromCharCode
  for (let i = 0; i < octets.length; i += TRANCHE) {
    binaire += String.fromCharCode(...octets.subarray(i, i + TRANCHE));
  }
  return btoa(binaire);
}

/** Construit le lien de signature envoyé à un emprunteur. */
function lienSignature(dossierId: string, jeton: string): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/signer-contrat?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

/**
 * Étapes qui peuvent échouer après validation. Un message générique unique rendrait le
 * diagnostic impossible depuis l'écran : on nomme l'étape fautive, côté serveur (log
 * complet) comme côté client (message + code).
 */
const ECHECS = {
  pdf: 'Le contrat n’a pas pu être produit. Réessayez ; si ça persiste, vérifiez les champs saisis.',
  courriel: 'Le contrat a été produit mais l’envoi par courriel a échoué. Réessayez dans quelques minutes.',
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
  const agent = request.headers.get('user-agent') ?? 'inconnu';

  if (!(await checkRateLimit(clientIp, 'contrat-creer'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  /* ---------- Validation ---------- */

  const donnees = parserDonneesContrat(payload.donnees);
  const voie = payload.voie === 'presence' ? 'presence' : 'distance';

  if (!donnees) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const maintenant = new Date();

  // La courtière signe à la création : un contrat qui part en signature sans la signature
  // du courtier n'est pas un contrat, c'est un brouillon.
  const traceCourtiere = decoderTraceSignature(payload.signatureCourtiere);
  if (!traceCourtiere) {
    return jsonResponse({ error: 'Votre signature est manquante ou illisible.' }, 400);
  }
  const signatureCourtiere: SignatureEnregistree = {
    tracePngBase64: versBase64(traceCourtiere),
    signeLe: maintenant.toISOString(),
    voie: 'presence',
    ip: clientIp,
    agent,
    empreinteTrace: await empreinteSha256(traceCourtiere),
  };

  // Les tracés des emprunteurs arrivent indexés par position : { "0": "data:image/png…" }.
  const tracesBrutes = (payload.signatures ?? {}) as Record<string, unknown>;
  const signatures = new Map<number, SignatureEnregistree>();
  const tracesDecodees = new Map<number, Uint8Array>();

  if (voie === 'presence') {
    for (const [index] of donnees.emprunteurs.entries()) {
      const trace = decoderTraceSignature(tracesBrutes[String(index)]);
      if (!trace) return jsonResponse({ error: 'Signature manquante ou illisible' }, 400);
      tracesDecodees.set(index, trace);
      signatures.set(index, {
        tracePngBase64: versBase64(trace),
        signeLe: maintenant.toISOString(),
        voie: 'presence',
        ip: clientIp,
        agent,
        empreinteTrace: await empreinteSha256(trace),
      });
    }
  }

  /**
   * La complétude se déduit des signatures réellement reçues, jamais de la voie annoncée
   * par le navigateur.
   */
  const toutSigne = signatures.size === donnees.emprunteurs.length;

  /* ---------- Environnement Resend ---------- */

  const resendEnv = loadResendEnv();
  if (!resendEnv && !import.meta.env.DEV) {
    console.error('[contrat-creer] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  // En développement sans Resend, tout le reste s'exécute quand même — dossier compris —
  // et seuls les envois sont remplacés par des logs. C'est la seule façon de dérouler la
  // chaîne de signature en local : le lien à ouvrir est imprimé dans la console.
  const simule = resendEnv === null;

  const preuves: PreuveSignature[] = donnees.emprunteurs
    .map((emprunteur, index) => {
      const signature = signatures.get(index);
      if (!signature) return null;
      return {
        nom: nomComplet(emprunteur),
        courriel: emprunteur.courriel,
        signeLe: signature.signeLe,
        voie: signature.voie,
        ip: signature.ip,
        agent: signature.agent,
        empreinteTrace: signature.empreinteTrace,
      } satisfies PreuveSignature;
    })
    .filter((p): p is PreuveSignature => p !== null);

  /* ---------- Tout le monde a signé sur place : dossier clos tout de suite ---------- */

  if (toutSigne) {
    const nomFichier = nomFichierContrat(nomComplet(donnees.emprunteurs[0]!), maintenant);
    let pdf: Uint8Array;
    try {
      const aEstamper = new Map<number, SignatureEstampee>();
      for (const [index, emprunteur] of donnees.emprunteurs.entries()) {
        aEstamper.set(index, {
          nom: nomComplet(emprunteur),
          trace: tracesDecodees.get(index)!,
          signeLe: maintenant,
        });
      }
      pdf = await genererContratPdf(donnees, aEstamper, {
        nom: loadSiteConfig().nom,
        trace: traceCourtiere,
        signeLe: maintenant,
      });
    } catch (err) {
      return echec('pdf', err);
    }

    try {
      if (resendEnv) {
        await envoyerDossierComplet(resendEnv, {
          donnees,
          preuves,
          pdfBase64: versBase64(pdf),
          empreintePdf: await empreinteSha256(pdf),
          nomFichier,
        });
      } else {
        console.log('[contrat-creer] ⚠️  Resend non configuré — envoi du contrat simulé :', nomFichier);
      }
    } catch (err) {
      return echec('courriel', err);
    }

    // Le PDF n'est jamais renvoyé au navigateur : il ne part qu'à la courtière, par courriel.
    return jsonResponse(
      {
        ok: true,
        ...(simule ? { dev: true } : {}),
        copies: donnees.emprunteurs.map((e) => e.courriel),
      },
      200,
    );
  }

  /* ---------- Signature à distance : dossier en attente + invitations ---------- */

  let aEnvoyer: InvitationCourriel[];
  try {
    const { invitations } = await creerDossier(donnees, signatureCourtiere, signatures);
    aEnvoyer = invitations.map((invitation) => ({
      nom: invitation.nom,
      courriel: invitation.courriel,
      lien: lienSignature(invitation.dossierId, invitation.jeton),
    }));
  } catch (err) {
    return echec('dossier', err);
  }

  const enAttente = aEnvoyer.map((i) => ({ nom: i.nom, courriel: i.courriel }));

  if (!resendEnv) {
    console.log('[contrat-creer] ⚠️  Resend non configuré — invitations simulées. Liens à ouvrir :');
    for (const invitation of aEnvoyer) console.log(`  ${invitation.nom} → ${invitation.lien}`);
    return jsonResponse({ ok: true, dev: true, enAttente }, 200);
  }

  // L'invitation est ce qui débloque la suite : si elle part, le dossier vit, même si la
  // notification interne échoue. On ne fait donc échouer la soumission que sur l'invitation.
  const [invitationsEnvoyees, avisInterne] = await Promise.allSettled([
    envoyerInvitations(resendEnv, aEnvoyer),
    envoyerAvisEnAttente(resendEnv, donnees, preuves, aEnvoyer),
  ]);

  if (invitationsEnvoyees.status === 'rejected') {
    return echec('invitation', invitationsEnvoyees.reason);
  }
  if (avisInterne.status === 'rejected') {
    console.error('[contrat-creer] Invitations parties, mais la notification interne a échoué :', avisInterne.reason);
  }

  return jsonResponse({ ok: true, enAttente }, 200);
};
