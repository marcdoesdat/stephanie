// Endpoint de soumission de la capture de rapport du calculateur de pénalité
// (/outils/calculateur-penalite-hypothecaire). Envoie une notification interne à
// Stéphanie (avec la capture d'écran du rapport en pièce jointe, si fournie) et une
// confirmation au client.
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

interface PenalitePayload {
  prenom?: unknown;
  email?: unknown;
  telephone?: unknown;
  scenario?: unknown; // JSON string
  penalite?: unknown; // montant formaté, ex. "3 450 $"
  consentement?: unknown;
  screenshotBase64?: unknown;
}

interface ScenarioData {
  solde?: number;
  taux?: number;
  type?: string;
  dateDebut?: string;
  dureeMois?: number;
  preteur?: string;
}

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;
const MAX_SCREENSHOT_BASE64_LENGTH = 8_000_000;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseScenario(raw: string): ScenarioData {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ScenarioData;
  } catch {
    // ignore
  }
  return {};
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: PenalitePayload;
  try {
    payload = (await request.json()) as PenalitePayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'penalite');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const prenom = asTrimmedString(payload.prenom);
  const email = asTrimmedString(payload.email);
  const telephone = asTrimmedString(payload.telephone);
  const consentement = payload.consentement === true;

  if (prenom.length < 1 || !EMAIL_RE.test(email) || !consentement) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const scenarioRaw = asTrimmedString(payload.scenario);
  const penalite = asTrimmedString(payload.penalite);
  const scenario = parseScenario(scenarioRaw);
  const screenshotBase64Raw = typeof payload.screenshotBase64 === 'string' ? payload.screenshotBase64 : '';
  const screenshotBase64 = screenshotBase64Raw.length <= MAX_SCREENSHOT_BASE64_LENGTH ? screenshotBase64Raw : '';

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[penalite-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[penalite-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[penalite-submit] ✉️  Confirmation client simulée vers :', email);
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[penalite-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const ePrenom = escapeHtml(prenom);
  const eEmail = escapeHtml(email);
  const eTel = escapeHtml(telephone);
  const ePenalite = escapeHtml(penalite);

  /* ---------- Notification interne ---------- */

  const internalTable = renderDataRows([
    ['Nom', ePrenom],
    ['Courriel', `<a href="mailto:${eEmail}" style="color:#a85f38;">${eEmail}</a>`],
    ['Téléphone', eTel],
    ['Pénalité estimée', `<strong>${ePenalite}</strong>`],
    ['Prêteur', escapeHtml(scenario.preteur ?? '')],
    ['Solde hypothécaire', scenario.solde != null ? escapeHtml(String(scenario.solde)) : ''],
    ['Taux contractuel', scenario.taux != null ? escapeHtml(`${scenario.taux}%`) : ''],
    ['Type de taux', escapeHtml(scenario.type ?? '')],
    ['Date de début du terme', escapeHtml(scenario.dateDebut ?? '')],
    ['Durée du terme (mois)', scenario.dureeMois != null ? escapeHtml(String(scenario.dureeMois)) : ''],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande — Calculateur de pénalité</h1>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${ePrenom}.</p>
  `);

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${ePrenom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande de rapport de pénalité (estimation&nbsp;: <strong>${ePenalite}</strong>). Merci de votre confiance.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Je vous envoie votre rapport détaillé personnellement sous peu, avec une analyse adaptée à votre situation.
        </p>
        ${renderSignatureBlock()}
      </div>
  `, '32px 24px');

  try {
    await Promise.all([
      sendEmail(apiKey, {
        from: fromEmail,
        to: notifyEmail,
        subject: `Nouvelle demande — Pénalité (${penalite || 'estimation'}) — ${prenom}`,
        html: internalHtml,
        reply_to: email,
        ...(screenshotBase64 ? { attachments: [toResendAttachment('penalite-rapport.png', screenshotBase64)] } : {}),
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: email,
        subject: `Votre rapport de pénalité est en préparation — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[penalite-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
