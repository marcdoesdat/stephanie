// Endpoint de soumission du formulaire de référence partenaire (/partenaires).
// Envoie une notification interne à Stéphanie, et une confirmation au partenaire
// référent uniquement si son champ "courriel ou téléphone" contient une adresse
// courriel valide (sinon impossible de lui écrire).
//
// Variables d'environnement requises : voir src/services/emailService.ts (RESEND_API_KEY,
// RESEND_FROM_EMAIL, RESEND_NOTIFY_EMAIL) — partagées par toutes les routes /api/*-submit.

import type { APIRoute } from 'astro';
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

interface PartenairesPayload {
  'nom-partenaire'?: unknown;
  profession?: unknown;
  'contact-partenaire'?: unknown;
  'client-nom'?: unknown;
  'client-telephone'?: unknown;
  'type-projet'?: unknown;
  notes?: unknown;
  'consentement-client'?: unknown;
  'bot-field'?: unknown; // honeypot
}

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

const PROFESSIONS: Record<string, string> = {
  'courtier-immobilier': 'Courtier immobilier',
  'planificateur-financier': 'Planificateur financier / Conseiller',
  notaire: 'Notaire',
  comptable: 'Comptable',
  autre: 'Autre profession',
};

const PROJETS: Record<string, string> = {
  achat: 'Achat',
  renouvellement: 'Renouvellement',
  refinancement: 'Refinancement',
  preapprobation: 'Pré-approbation',
  autre: 'Autre / à déterminer',
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: APIRoute = async ({ request }) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let payload: PartenairesPayload;
  try {
    payload = (await request.json()) as PartenairesPayload;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  if (asTrimmedString(payload['bot-field']) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'partenaires');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const nomPartenaire = asTrimmedString(payload['nom-partenaire']);
  const profession = asTrimmedString(payload.profession);
  const contactPartenaire = asTrimmedString(payload['contact-partenaire']);
  const clientNom = asTrimmedString(payload['client-nom']);
  const clientTelephone = asTrimmedString(payload['client-telephone']);
  const consentement = payload['consentement-client'] === true;

  if (
    nomPartenaire.length < 2 ||
    !PROFESSIONS[profession] ||
    contactPartenaire.length < 5 ||
    clientNom.length < 2 ||
    clientTelephone.length < 7 ||
    !consentement
  ) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const typeProjet = asTrimmedString(payload['type-projet']);
  const notes = asTrimmedString(payload.notes);
  const contactEstCourriel = EMAIL_RE.test(contactPartenaire);

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[partenaires-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[partenaires-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[partenaires-submit] ✉️  Confirmation partenaire simulée :', contactEstCourriel ? contactPartenaire : '(pas de courriel valide — ignorée)');
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[partenaires-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const eNomPartenaire = escapeHtml(nomPartenaire);
  const eProfession = escapeHtml(PROFESSIONS[profession]);
  const eContact = escapeHtml(contactPartenaire);
  const eClientNom = escapeHtml(clientNom);
  const eClientTel = escapeHtml(clientTelephone);
  const eProjet = escapeHtml(PROJETS[typeProjet] ?? '');
  const eNotes = escapeHtml(notes).replace(/\n/g, '<br>');

  /* ---------- Notification interne ---------- */

  const internalTable = renderDataRows([
    ['Partenaire', `${eNomPartenaire} (${eProfession})`],
    ['Contact partenaire', contactEstCourriel ? `<a href="mailto:${eContact}" style="color:#a85f38;">${eContact}</a>` : eContact],
    ['Client référé', eClientNom],
    ['Téléphone du client', eClientTel],
    ['Type de projet', eProjet],
    ['Notes', eNotes],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle référence partenaire</h1>
      <p style="margin:0 0 20px;color:#6a5f50;font-size:14px;">Référé par <strong>${eNomPartenaire}</strong> (${eProfession})</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${internalTable}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${eNomPartenaire}.</p>
  `);

  const emailsToSend = [
    sendEmail(apiKey, {
      from: fromEmail,
      to: notifyEmail,
      subject: `Nouvelle référence — ${clientNom} (via ${nomPartenaire})`,
      html: internalHtml,
      ...(contactEstCourriel ? { reply_to: contactPartenaire } : {}),
    }),
  ];

  /* ---------- Confirmation partenaire (seulement si courriel valide) ---------- */

  if (contactEstCourriel) {
    const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${eNomPartenaire} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre référence pour <strong>${eClientNom}</strong>. Merci de votre confiance.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Je communique avec ${eClientNom} rapidement et je vous tiens informé·e de l'avancement du dossier.
        </p>
        ${renderSignatureBlock()}
      </div>
    `, '32px 24px');

    emailsToSend.push(
      sendEmail(apiKey, {
        from: fromEmail,
        to: contactPartenaire,
        subject: `Référence bien reçue — ${clientNom}`,
        html: clientHtml,
        reply_to: notifyEmail,
      })
    );
  }

  try {
    await Promise.all(emailsToSend);
  } catch (err) {
    console.error('[partenaires-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
