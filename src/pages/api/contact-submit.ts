// Endpoint de soumission du formulaire de contact / quiz (section #contact, page d'accueil).
// Envoie une notification interne à Stéphanie et une confirmation au client.
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
} from '../../services/emailService';

export const prerender = false;

interface ContactPayload {
  parcours?: unknown;
  q1?: unknown;
  q2?: unknown;
  delai?: unknown;
  situation?: unknown;
  prefcontact?: unknown;
  pa_timing?: unknown;
  pa_revenus?: unknown;
  pa_mise?: unknown;
  prenom?: unknown;
  nom?: unknown;
  email?: unknown;
  telephone?: unknown;
  message?: unknown;
  lcap_consent?: unknown;
  'bot-field'?: unknown; // honeypot
}

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  if (asTrimmedString(payload['bot-field']) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'contact');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const prenom = asTrimmedString(payload.prenom);
  const nom = asTrimmedString(payload.nom);
  const email = asTrimmedString(payload.email);
  const telephone = asTrimmedString(payload.telephone);

  if (prenom.length < 1 || nom.length < 1 || (!EMAIL_RE.test(email) && telephone.length < 7)) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const parcours = asTrimmedString(payload.parcours) || asTrimmedString(payload.situation);
  const q1 = asTrimmedString(payload.q1);
  const q2 = asTrimmedString(payload.q2);
  const delai = asTrimmedString(payload.delai);
  const prefcontact = asTrimmedString(payload.prefcontact);
  const paTiming = asTrimmedString(payload.pa_timing);
  const paRevenus = asTrimmedString(payload.pa_revenus);
  const paMise = asTrimmedString(payload.pa_mise);
  const message = asTrimmedString(payload.message);
  const lcapConsent = asTrimmedString(payload.lcap_consent) === 'oui';

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[contact-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[contact-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[contact-submit] ✉️  Confirmation client simulée vers :', email || '(pas de courriel — ignorée)');
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[contact-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];
  const nomComplet = `${prenom} ${nom}`.trim();

  const eNomComplet = escapeHtml(nomComplet);
  const ePrenom = escapeHtml(prenom);
  const eEmail = escapeHtml(email);
  const eTel = escapeHtml(telephone);
  const eParcours = escapeHtml(parcours);
  const ePref = escapeHtml(prefcontact);
  const eMessage = escapeHtml(message).replace(/\n/g, '<br>');

  /* ---------- Notification interne ---------- */

  const parcoursRows: Array<[string, string]> =
    parcours === 'Premier achat'
      ? [
          ['Timing', escapeHtml(paTiming)],
          ['Revenus annuels bruts', escapeHtml(paRevenus)],
          ['Mise de fonds accumulée', escapeHtml(paMise)],
        ]
      : [
          ['Réponse 1', escapeHtml(q1)],
          ['Réponse 2', escapeHtml(q2)],
          ['Délai souhaité', escapeHtml(delai)],
        ];

  const internalTable = renderDataRows([
    ['Nom', eNomComplet],
    ['Courriel', email ? `<a href="mailto:${eEmail}" style="color:#a85f38;">${eEmail}</a>` : ''],
    ['Téléphone', eTel],
    ['Préférence de contact', ePref],
    ['Parcours', eParcours],
    ...parcoursRows,
    ['Message', eMessage],
    ['Consentement LCAP (communications marketing)', lcapConsent ? 'Oui' : 'Non'],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande de contact</h1>
      <p style="margin:0 0 20px;color:#6a5f50;font-size:14px;">Parcours&nbsp;: <strong>${eParcours || '—'}</strong></p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${eNomComplet}.</p>
  `);

  const emailsToSend = [
    sendEmail(apiKey, {
      from: fromEmail,
      to: notifyEmail,
      subject: `Nouvelle demande — ${parcours || 'Contact'} — ${nomComplet}`,
      html: internalHtml,
      ...(email ? { reply_to: email } : {}),
    }),
  ];

  /* ---------- Confirmation client (seulement si courriel fourni) ---------- */

  if (email) {
    const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${ePrenom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande. Merci de votre confiance.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'examine votre situation et je vous recontacte personnellement, selon la préférence que vous avez indiquée${prefcontact ? ` (<strong>${ePref}</strong>)` : ''}.
        </p>
        ${renderSignatureBlock()}
      </div>
    `, '32px 24px');

    emailsToSend.push(
      sendEmail(apiKey, {
        from: fromEmail,
        to: email,
        subject: `Votre demande est bien reçue — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      })
    );
  }

  try {
    await Promise.all(emailsToSend);
  } catch (err) {
    console.error('[contact-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
