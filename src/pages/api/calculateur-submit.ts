// Endpoint de soumission de la capture courriel/texto du calculateur de versement
// (section #calculateur, page d'accueil et /outils#calculateur).
// Envoie une notification interne à Stéphanie (avec la capture d'écran du résultat en
// pièce jointe, si fournie) et une confirmation au client (seulement si un courriel a
// été fourni — le champ est optionnel, le téléphone seul est accepté).
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

interface CalculateurPayload {
  nom?: unknown;
  telephone?: unknown;
  email?: unknown;
  labelFrequence?: unknown;
  versement?: unknown;
  montantPret?: unknown;
  primeSchl?: unknown;
  coutMensuelTotal?: unknown;
  amortissementUrl?: unknown;
  screenshotBase64?: unknown; // base64 sans préfixe data:, optionnel
}

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;
// Limite raisonnable pour une capture PNG compressée (≈ 6 Mo en base64).
const MAX_SCREENSHOT_BASE64_LENGTH = 8_000_000;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: CalculateurPayload;
  try {
    payload = (await request.json()) as CalculateurPayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'calculateur');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const nom = asTrimmedString(payload.nom);
  const telephone = asTrimmedString(payload.telephone);
  const email = asTrimmedString(payload.email);

  if (nom.length < 2 || (!telephone && !EMAIL_RE.test(email))) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const labelFrequence = asTrimmedString(payload.labelFrequence);
  const versement = asTrimmedString(payload.versement);
  const montantPret = asTrimmedString(payload.montantPret);
  const primeSchl = asTrimmedString(payload.primeSchl);
  const coutMensuelTotal = asTrimmedString(payload.coutMensuelTotal);
  const amortissementUrl = asTrimmedString(payload.amortissementUrl);
  const screenshotBase64Raw = typeof payload.screenshotBase64 === 'string' ? payload.screenshotBase64 : '';
  const screenshotBase64 = screenshotBase64Raw.length <= MAX_SCREENSHOT_BASE64_LENGTH ? screenshotBase64Raw : '';

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[calculateur-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[calculateur-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[calculateur-submit] ✉️  Confirmation client simulée vers :', email || '(pas de courriel — ignorée)');
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[calculateur-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const eNom = escapeHtml(nom);
  const eTel = escapeHtml(telephone);
  const eEmail = escapeHtml(email);

  /* ---------- Notification interne ---------- */

  const internalTable = renderDataRows([
    ['Nom', eNom],
    ['Courriel', email ? `<a href="mailto:${eEmail}" style="color:#a85f38;">${eEmail}</a>` : ''],
    ['Téléphone', eTel],
    [escapeHtml(labelFrequence || 'Versement'), escapeHtml(versement)],
    ['Montant du prêt', escapeHtml(montantPret)],
    ['Prime SCHL', escapeHtml(primeSchl)],
    ['Coût mensuel total', escapeHtml(coutMensuelTotal)],
    ['Tableau d\'amortissement', amortissementUrl ? `<a href="${escapeHtml(amortissementUrl)}" style="color:#a85f38;">Voir le détail</a>` : ''],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande — Calculateur de versement</h1>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${eNom}.</p>
  `);

  const emailsToSend = [
    sendEmail(apiKey, {
      from: fromEmail,
      to: notifyEmail,
      subject: `Nouvelle demande — Calculateur — ${nom}`,
      html: internalHtml,
      ...(email ? { reply_to: email } : {}),
      ...(screenshotBase64 ? { attachments: [toResendAttachment('calculateur-resultat.png', screenshotBase64)] } : {}),
    }),
  ];

  /* ---------- Confirmation client (seulement si courriel fourni) ---------- */

  if (email) {
    const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${eNom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande de résumé pour le calculateur de versement. Merci de votre confiance.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Je vous envoie votre résumé personnellement sous peu.
        </p>
        ${renderSignatureBlock()}
      </div>
    `, '32px 24px');

    emailsToSend.push(
      sendEmail(apiKey, {
        from: fromEmail,
        to: email,
        subject: `Votre résumé est en préparation — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      })
    );
  }

  try {
    await Promise.all(emailsToSend);
  } catch (err) {
    console.error('[calculateur-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
