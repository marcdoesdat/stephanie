// Endpoint de soumission du formulaire de contact du hub d'outils (/outils, section
// « On en parle ? »). Envoie une notification interne à Stéphanie (avec la capture
// d'écran du panneau actif en pièce jointe, si fournie, et le résumé de simulation) et
// une confirmation au client.
//
// Variables d'environnement requises : voir src/services/emailService.ts (RESEND_API_KEY,
// RESEND_FROM_EMAIL, RESEND_NOTIFY_EMAIL) — partagées par toutes les routes /api/*-submit.

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
  toResendAttachment,
} from '../../services/emailService';

export const prerender = false;

interface OutilsPayload {
  prenom?: unknown;
  email?: unknown;
  telephone?: unknown;
  'pref-communication'?: unknown;
  message?: unknown;
  'consentement-lcap'?: unknown;
  'simulateur-donnees'?: unknown;
  screenshotBase64?: unknown;
  'bot-field'?: unknown; // honeypot
}

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;
const MAX_SCREENSHOT_BASE64_LENGTH = 8_000_000;

const PREFS: Record<string, string> = {
  courriel: 'Courriel',
  appel: 'Appel',
  texto: 'Texto',
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: OutilsPayload;
  try {
    payload = (await request.json()) as OutilsPayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  if (asTrimmedString(payload['bot-field']) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'outils');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const prenom = asTrimmedString(payload.prenom);
  const email = asTrimmedString(payload.email);
  const telephone = asTrimmedString(payload.telephone);
  const prefRaw = asTrimmedString(payload['pref-communication']) || 'courriel';
  const telRequis = prefRaw === 'appel' || prefRaw === 'texto';

  if (prenom.length < 1 || !EMAIL_RE.test(email) || (telRequis && telephone.length < 7)) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const message = asTrimmedString(payload.message);
  const simulateurDonnees = asTrimmedString(payload['simulateur-donnees']);
  const consentementLcap = payload['consentement-lcap'] === true;
  const screenshotBase64Raw = typeof payload.screenshotBase64 === 'string' ? payload.screenshotBase64 : '';
  const screenshotBase64 = screenshotBase64Raw.length <= MAX_SCREENSHOT_BASE64_LENGTH ? screenshotBase64Raw : '';

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[outils-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[outils-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[outils-submit] ✉️  Confirmation client simulée vers :', email);
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[outils-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const ePrenom = escapeHtml(prenom);
  const eEmail = escapeHtml(email);
  const eTel = escapeHtml(telephone);
  const ePref = escapeHtml(PREFS[prefRaw] ?? prefRaw);
  const eMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const eSimulation = escapeHtml(simulateurDonnees).replace(/\n/g, '<br>');

  /* ---------- Notification interne ---------- */

  const internalTable = renderDataRows([
    ['Nom', ePrenom],
    ['Courriel', `<a href="mailto:${eEmail}" style="color:#a85f38;">${eEmail}</a>`],
    ['Téléphone', eTel],
    ['Préférence de communication', ePref],
    ['Message', eMessage],
    ['Consentement LCAP (communications marketing)', consentementLcap ? 'Oui' : 'Non'],
  ]);

  const simulationBlock = simulateurDonnees
    ? `<div style="margin-top:20px;padding:16px 20px;background:#f0e8da;border-left:4px solid #c47a52;border-radius:8px;">
         <p style="margin:0;font-size:13px;color:#1f1e1c;line-height:1.7;"><strong>Résumé de la simulation jointe&nbsp;:</strong><br>${eSimulation}</p>
       </div>`
    : '';

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande — Hub d'outils</h1>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      ${simulationBlock}
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${ePrenom}.</p>
  `);

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${ePrenom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande depuis les outils de calcul. Merci de votre confiance.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Je valide vos chiffres et je vous recontacte personnellement, selon la préférence que vous avez indiquée (<strong>${ePref}</strong>).
        </p>
        ${renderSignatureBlock()}
      </div>
  `, '32px 24px');

  try {
    await Promise.all([
      sendEmail(apiKey, {
        from: fromEmail,
        to: notifyEmail,
        subject: `Nouvelle demande — Outils — ${prenom}`,
        html: internalHtml,
        reply_to: email,
        ...(screenshotBase64 ? { attachments: [toResendAttachment('outils-resultat.png', screenshotBase64)] } : {}),
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: email,
        subject: `Votre demande est bien reçue — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[outils-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
