// Soumission du formulaire « Profil des emprunteurs » (/profil-emprunteur).
//
// Deux issues selon la voie choisie par l'emprunteur qui remplit :
//
//   • « presence » — tout le monde a signé sur le même appareil. Le PDF est produit ici et
//     envoyé à la seule courtière ; les signataires reçoivent un accusé sans pièce jointe.
//     Le document ne redescend jamais au navigateur. Rien n'est stocké.
//
//   • « distance » — seul l'initiateur a signé. Un dossier en attente est créé et chaque
//     co-signataire reçoit un lien nominatif à usage unique (voir profilDossierService).
//     Aucun PDF n'existe tant que le dernier n'a pas signé — c'est /api/profil-cosigner
//     qui clôt le dossier.
//
// Rien de ce que le navigateur envoie n'est repris tel quel : les réponses sont validées
// contre le catalogue de src/utils/profilEmprunteurs.ts, et chaque PNG de signature est
// vérifié avant d'approcher pdf-lib.
//
// Variables d'environnement : voir src/services/emailService.ts (RESEND_*).

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
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
  nomFichierProfil,
  type InvitationCourriel,
  type PreuveSignature,
} from '../../services/profilCourriels';
import { creerDossier, type SignatureEnregistree } from '../../services/profilDossierService';
import { empreinteSha256, genererProfilPdf, versBase64 } from '../../services/profilPdfService';
import {
  decoderTraceSignature,
  parserReponses,
  parserSignataires,
  type Signataire,
} from '../../utils/profilEmprunteurs';

export const prerender = false;

type Payload = Record<string, unknown>;

/** Construit le lien de signature envoyé à un co-signataire. */
function lienSignature(dossierId: string, jeton: string): string {
  const base = loadSiteConfig().site_url.replace(/\/$/, '');
  return `${base}/signer?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

/**
 * Étapes qui peuvent échouer après validation. Un message générique unique rendait le
 * diagnostic impossible depuis l'écran du client : on nomme désormais l'étape fautive,
 * côté serveur (log complet) comme côté client (message + code).
 */
const ECHECS = {
  pdf: 'Le document n’a pas pu être produit. Réessayez ; si ça persiste, écrivez à Stéphanie.',
  courriel: 'Le document a été produit mais l’envoi par courriel a échoué. Réessayez dans quelques minutes.',
  dossier: 'Votre dossier n’a pas pu être enregistré. Réessayez dans quelques minutes.',
  invitation: 'Impossible d’envoyer l’invitation à signer. Vérifiez les adresses courriel saisies.',
} as const;

function echec(etape: keyof typeof ECHECS, err: unknown): Response {
  console.error(`[profil-submit] Échec à l'étape « ${etape} » :`, err);
  // Le détail technique est renvoyé au navigateur : la page n'est accessible que par lien
  // privé, et sans lui il faut un aller-retour de déploiement pour diagnostiquer quoi que
  // ce soit. Les messages amont (ex. « Resend HTTP 403: … ») ne contiennent aucune clé.
  const detail = err instanceof Error ? err.message : String(err);
  return jsonResponse({ error: ECHECS[etape], code: etape, detail: detail.slice(0, 300) }, 502);
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  // Honeypot : succès silencieux, aucun courriel envoyé.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const agent = request.headers.get('user-agent') ?? 'inconnu';

  if (!(await checkRateLimit(clientIp, 'profil'))) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  /* ---------- Validation ---------- */

  const reponses = parserReponses(payload.reponses);
  const signataires: Signataire[] | null = parserSignataires(payload.signataires);
  const voie = payload.voie === 'distance' ? 'distance' : payload.voie === 'presence' ? 'presence' : null;
  const attestation = payload.attestation === true;

  if (!reponses || !signataires || !voie || !attestation) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  // Les tracés arrivent indexés par la position du signataire : { "0": "data:image/png…" }.
  const tracesBrutes = (payload.signatures ?? {}) as Record<string, unknown>;
  const maintenant = new Date();
  const signatures = new Map<number, SignatureEnregistree>();

  for (const [index] of signataires.entries()) {
    const brut = tracesBrutes[String(index)];
    // En voie « distance », seul l'initiateur signe maintenant ; les autres signeront par lien.
    if (brut === undefined && voie === 'distance' && index > 0) continue;

    const trace = decoderTraceSignature(brut);
    if (!trace) return jsonResponse({ error: 'Signature manquante ou illisible' }, 400);

    signatures.set(index, {
      tracePngBase64: versBase64(trace),
      signeLe: maintenant.toISOString(),
      // Toute signature recueillie ici l'a été sur l'appareil du demandeur, quelle que soit
      // la voie annoncée. Le libellé « à distance » appartient à /api/profil-cosigner.
      voie: 'presence',
      ip: clientIp,
      agent,
      empreinteTrace: await empreinteSha256(trace),
    });
  }

  // En voie « en présence », la boucle ci-dessus exige déjà un tracé pour chaque signataire :
  // il ne reste qu'à garantir la signature du demandeur, seule obligatoire dans tous les cas.
  if (!signatures.has(0)) {
    return jsonResponse({ error: 'Signature manquante ou illisible' }, 400);
  }

  /**
   * La complétude se déduit des signatures réellement reçues, jamais de la voie annoncée
   * par le navigateur. Sans ça, un emprunteur seul dont l'état local était resté sur
   * « ils signeront de leur côté » ouvrait un dossier sans aucun co-signataire à inviter :
   * aucun PDF produit, aucun courriel au client, et un écran qui affirmait le contraire.
   */
  const toutSigne = signatures.size === signataires.length;

  /* ---------- Environnement Resend ---------- */

  const resendEnv = loadResendEnv();
  if (!resendEnv && !import.meta.env.DEV) {
    console.error('[profil-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  // En développement sans Resend, tout le reste s'exécute quand même — dossier compris —
  // et seuls les envois sont remplacés par des logs. C'est la seule façon de dérouler la
  // chaîne de co-signature en local : le lien à ouvrir est imprimé dans la console.
  const simule = resendEnv === null;

  const preuves: PreuveSignature[] = signataires
    .map((signataire, index) => {
      const signature = signatures.get(index);
      if (!signature) return null;
      return {
        nom: signataire.nom,
        courriel: signataire.courriel,
        signeLe: signature.signeLe,
        voie: signature.voie,
        ip: signature.ip,
        agent: signature.agent,
        empreinteTrace: signature.empreinteTrace,
      } satisfies PreuveSignature;
    })
    .filter((p): p is PreuveSignature => p !== null);

  /* ---------- Tout le monde a signé : le dossier est clos tout de suite ---------- */

  if (toutSigne) {
    let pdf: Uint8Array;
    const nomFichier = nomFichierProfil(signataires[0]!.nom, maintenant);
    try {
      pdf = await genererProfilPdf(
        reponses,
        signataires.map((signataire, index) => ({
          nom: signataire.nom,
          trace: decoderTraceSignature(tracesBrutes[String(index)])!,
          signeLe: maintenant,
        })),
      );
    } catch (err) {
      return echec('pdf', err);
    }

    try {
      if (resendEnv) {
        await envoyerDossierComplet(resendEnv, {
          reponses,
          preuves,
          pdfBase64: versBase64(pdf),
          empreintePdf: await empreinteSha256(pdf),
          nomFichier,
        });
      } else {
        console.log('[profil-submit] ⚠️  Resend non configuré — envoi du dossier complet simulé :', nomFichier);
      }
    } catch (err) {
      return echec('courriel', err);
    }

    // Le PDF n'est jamais renvoyé au navigateur : il ne part qu'à la courtière, par courriel.
    //
    // `copies` : les adresses qui reçoivent réellement l'accusé de signature, telles que
    // normalisées ici. L'écran de confirmation les affiche — c'est la seule façon pour le
    // client de vérifier tout de suite qu'il n'a pas fait une faute de frappe dans sa propre
    // adresse.
    return jsonResponse(
      {
        ok: true,
        ...(simule ? { dev: true } : {}),
        copies: signataires.map((signataire) => signataire.courriel),
      },
      200,
    );
  }

  /* ---------- Il manque des signatures : dossier en attente + invitations ---------- */

  let aEnvoyer: InvitationCourriel[];
  try {
    const { invitations } = await creerDossier(reponses, signataires, signatures);
    aEnvoyer = invitations.map((invitation) => ({
      nom: invitation.nom,
      courriel: invitation.courriel,
      lien: lienSignature(invitation.dossierId, invitation.jeton),
    }));
  } catch (err) {
    return echec('dossier', err);
  }

  // Nom **et** adresse : l'écran de confirmation nomme la personne relancée et montre où le
  // lien est parti, sans jamais divulguer le lien lui-même.
  const enAttente = aEnvoyer.map((i) => ({ nom: i.nom, courriel: i.courriel }));
  const copies = signataires.map((signataire) => signataire.courriel);

  if (!resendEnv) {
    console.log('[profil-submit] ⚠️  Resend non configuré — invitations simulées. Liens à ouvrir :');
    for (const invitation of aEnvoyer) console.log(`  ${invitation.nom} → ${invitation.lien}`);
    return jsonResponse({ ok: true, dev: true, enAttente, copies }, 200);
  }

  // L'invitation est ce qui débloque la suite : si elle part, le dossier vit, même si la
  // notification interne échoue. On ne fait donc échouer la soumission que sur l'invitation.
  const [invitationsEnvoyees, avisInterne] = await Promise.allSettled([
    envoyerInvitations(resendEnv, aEnvoyer, signataires[0]!.nom),
    envoyerAvisEnAttente(resendEnv, reponses, preuves[0]!, aEnvoyer),
  ]);

  if (invitationsEnvoyees.status === 'rejected') {
    return echec('invitation', invitationsEnvoyees.reason);
  }
  if (avisInterne.status === 'rejected') {
    console.error('[profil-submit] Invitations parties, mais la notification interne a échoué :', avisInterne.reason);
  }

  return jsonResponse({ ok: true, enAttente, copies }, 200);
};
