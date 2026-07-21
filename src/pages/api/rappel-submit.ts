// Endpoint de soumission du formulaire de rappel renouvellement / refinancement.
// Envoie 2 courriels via l'API Resend (voir src/services/emailService.ts) :
//   1. Notification interne à Stéphanie (RESEND_NOTIFY_EMAIL)
//   2. Confirmation chaleureuse au client
// Aucune persistance, aucun cron : la requête est traitée puis oubliée.
//
// Variables d'environnement requises (à configurer dans Netlify) :
//   - RESEND_API_KEY     : clé API Resend (re_...).
//   - RESEND_FROM_EMAIL  : adresse d'expéditeur vérifiée dans Resend, partagée par
//                          tous les formulaires du site (ex. "Stéphanie Weyman
//                          <bonjour@stephanieweyman.ca>").
//   - RESEND_NOTIFY_EMAIL: adresse interne qui reçoit les notifications (boîte de Stéphanie).
//
// Convention identique à src/pages/api/bdc-rate.ts : API route Astro (prerender=false),
// type APIRoute, gestion d'erreur par Response JSON.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import {
  sendEmail,
  escapeHtml,
  wrapEmailHtml,
  renderDataRows,
  renderSignatureBlock,
  checkRateLimit,
  clientIpFromRequest,
  jsonResponse,
  loadResendEnv,
} from '../../services/emailService';

export const prerender = false;

/* ------------------------------------------------------------------ */
/*  Types & helpers                                                    */
/* ------------------------------------------------------------------ */

interface RappelPayload {
  nom?: unknown;
  courriel?: unknown;
  telephone?: unknown;
  type?: unknown;        // "Renouvellement" | "Refinancement"
  echeance?: unknown;    // "AAAA-MM"
  institution?: unknown;
  details?: unknown;
  consentement?: unknown;
  company?: unknown;     // honeypot anti-spam
}

// Regex courriel volontairement permissive mais sûre (pas de validation exhaustive).
const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;
// Téléphone : au moins 10 chiffres (séparateurs et indicatif tolérés).
const TEL_RE = /(?:\D*\d){10,}/;
const ECHEANCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TYPES_VALIDES = new Set(['Renouvellement', 'Refinancement']);

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Formate une échéance "AAAA-MM" en "mois AAAA" (fr-CA). Retourne '' si invalide. */
function formatEcheance(echeance: string): string {
  if (!ECHEANCE_RE.test(echeance)) return '';
  const annee = parseInt(echeance.slice(0, 4), 10);
  const mois = parseInt(echeance.slice(5, 7), 10);
  const nomMois = MOIS_FR[mois - 1];
  if (!nomMois) return '';
  return `${nomMois} ${annee}`;
}

/**
 * Calcule la date de rappel suggérée (échéance − 4 mois) au format "mois AAAA" (fr-CA).
 * Retourne '' si l'échéance est invalide.
 */
function computeRappelDate(echeance: string): string {
  if (!ECHEANCE_RE.test(echeance)) return '';
  const annee = parseInt(echeance.slice(0, 4), 10);
  const mois = parseInt(echeance.slice(5, 7), 10);
  // Index 0-based du mois, puis recul de 4 mois (Date normalise le passage d'année).
  const d = new Date(annee, mois - 1, 1);
  d.setMonth(d.getMonth() - 4);
  return `${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  // 1. Méthode (Astro route déjà POST, mais on reste défensif).
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  // 2. Parse JSON.
  let payload: RappelPayload;
  try {
    payload = (await request.json()) as RappelPayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  // 3. Honeypot : un bot a rempli le champ caché → succès silencieux, aucun envoi.
  if (asTrimmedString(payload.company) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  // 3b. Rate limiting : max 5 soumissions par IP par heure.
  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'rappel');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  // 4. Validation des champs requis.
  const nom = asTrimmedString(payload.nom);
  const courriel = asTrimmedString(payload.courriel);
  const telephone = asTrimmedString(payload.telephone);
  const type = asTrimmedString(payload.type);
  const consentement = payload.consentement === true;

  if (
    nom.length < 2 ||
    (!EMAIL_RE.test(courriel) && !TEL_RE.test(telephone)) ||
    !TYPES_VALIDES.has(type) ||
    !consentement
  ) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  // Champs optionnels.
  const echeanceRaw = asTrimmedString(payload.echeance);
  const institution = asTrimmedString(payload.institution);
  const details = asTrimmedString(payload.details);

  const echeanceFmt = formatEcheance(echeanceRaw);
  const rappelDate = computeRappelDate(echeanceRaw);

  // 5. Variables d'environnement.
  const resendEnv = loadResendEnv();

  // En développement sans clé Resend : on logue les courriels dans la console
  // au lieu de les envoyer. Le formulaire retourne un succès pour faciliter
  // les tests locaux. En production, les 3 variables sont obligatoires.
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[rappel-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[rappel-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[rappel-submit] ✉️  Confirmation client simulée vers :', courriel);
      // On retourne un succès simulé pour permettre le test du flux complet
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[rappel-submit] Variables Resend manquantes (RESEND_API_KEY / RESEND_FROM_EMAIL / RESEND_NOTIFY_EMAIL).');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  // Versions échappées pour insertion HTML.
  const eNom = escapeHtml(nom);
  const eCourriel = escapeHtml(courriel);
  const eTel = escapeHtml(telephone);
  const eType = escapeHtml(type);
  const eEcheance = escapeHtml(echeanceFmt || echeanceRaw);
  const eInstitution = escapeHtml(institution);
  const eDetails = escapeHtml(details).replace(/\n/g, '<br>');
  const eRappel = escapeHtml(rappelDate);

  /* ---------- Courriel 1 — notification interne ---------- */

  const rappelBanner = rappelDate
    ? `<div style="margin:0 0 24px;padding:16px 20px;background:#f0e8da;border-left:4px solid #c47a52;border-radius:8px;">
         <p style="margin:0;font-size:15px;color:#1f1e1c;line-height:1.6;">
           <strong>📅 Suggestion de rappel à placer au calendrier&nbsp;: ${eRappel}</strong><br>
           <span style="color:#6a5f50;">(≈ 4 mois avant l'échéance${echeanceFmt ? ` de ${eEcheance}` : ''})</span>
         </p>
       </div>`
    : `<div style="margin:0 0 24px;padding:16px 20px;background:#f0e8da;border-left:4px solid #c47a52;border-radius:8px;">
         <p style="margin:0;font-size:15px;color:#6a5f50;line-height:1.6;">
           Aucune date d'échéance fournie — à valider lors du contact.
         </p>
       </div>`;

  const internalTable = renderDataRows([
    ['Nom', eNom],
    ['Courriel', `<a href="mailto:${eCourriel}" style="color:#a85f38;">${eCourriel}</a>`],
    ['Téléphone', eTel],
    ['Type de demande', eType],
    ['Échéance actuelle', echeanceFmt ? eEcheance : ''],
    ['Institution actuelle', eInstitution],
    ['Détails', eDetails],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande de rappel</h1>
      <p style="margin:0 0 20px;color:#6a5f50;font-size:14px;">Type&nbsp;: <strong>${eType}</strong></p>
      ${rappelBanner}
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${eNom}.</p>
  `);

  /* ---------- Courriel 2 — confirmation client ---------- */

  const suiteEcheance = echeanceFmt
    ? `Comme votre terme arrive à échéance en <strong>${eEcheance}</strong>, sachez que le meilleur moment pour magasiner se situe de 4 à 6 mois avant cette date. ${escapeHtml(prenomCourtiere)} vous contactera donc au moment idéal&nbsp;: vous n'avez rien à faire d'ici là.`
    : `${escapeHtml(prenomCourtiere)} examinera votre demande et vous contactera personnellement pour discuter du meilleur moment d'agir. Vous n'avez rien à faire d'ici là.`;

  const siteHost = escapeHtml(config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, ''));

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${eNom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande de suivi pour votre <strong>${eType.toLowerCase()}</strong> hypothécaire. Merci de votre confiance.
        </p>

        <h2 style="font-size:16px;margin:24px 0 8px;color:#a85f38;">Ce qui suit</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          ${escapeHtml(prenomCourtiere)} examine votre demande et vous contactera personnellement. ${suiteEcheance}
        </p>

        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Une question d'ici là&nbsp;? Vous pouvez simplement répondre à ce courriel — il se rend directement à moi.
        </p>

        ${renderSignatureBlock()}
      </div>

      <p style="margin:20px 4px 0;font-size:11px;line-height:1.6;color:#6a5f50;">
        Vous recevez ce courriel parce que vous avez soumis une demande de suivi sur ${siteHost}.
        Vos renseignements sont utilisés uniquement à cette fin.
      </p>
  `, '32px 24px');

  // 6. Envoi des 2 courriels en parallèle.
  try {
    await Promise.all([
      sendEmail(apiKey, {
        from: fromEmail,
        to: notifyEmail,
        subject: `Demande de rappel — ${type} — ${nom}`,
        html: internalHtml,
        reply_to: courriel,
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: courriel,
        subject: `Votre demande de suivi est bien reçue — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[rappel-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
