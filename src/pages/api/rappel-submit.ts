// Endpoint de soumission du formulaire de rappel renouvellement / refinancement.
// Envoie 2 courriels via l'API Resend (fetch natif — aucune dépendance externe) :
//   1. Notification interne à Stéphanie (RAPPEL_NOTIFY_EMAIL)
//   2. Confirmation chaleureuse au client
// Aucune persistance, aucun cron : la requête est traitée puis oubliée.
//
// Variables d'environnement requises (à configurer dans Netlify) :
//   - RESEND_API_KEY     : clé API Resend (re_...).
//   - RAPPEL_FROM_EMAIL  : adresse d'expéditeur vérifiée dans Resend
//                          (ex. "Stéphanie Weyman <rappel@stephanieweyman.ca>").
//   - RAPPEL_NOTIFY_EMAIL: adresse interne qui reçoit la notification (boîte de Stéphanie).
//
// Convention identique à src/pages/api/bdc-rate.ts : API route Astro (prerender=false),
// type APIRoute, gestion d'erreur par Response JSON.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';

export const prerender = false;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/* ------------------------------------------------------------------ */
/*  Rate limiting (IP-based, Netlify Blobs)                            */
/*  Max 5 submissions per IP per hour.                                 */
/*  Skipped gracefully in dev (no Blobs available).                    */
/* ------------------------------------------------------------------ */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_BLOB_STORE = 'rate-limit';

interface RateEntry { count: number; windowStart: number; }

async function checkRateLimit(ip: string): Promise<boolean> {
  if (!process.env.NETLIFY) return true; // skip in local dev
  let getStore: typeof import('@netlify/blobs').getStore | undefined;
  try {
    getStore = (await import('@netlify/blobs')).getStore;
  } catch { return true; }
  if (!getStore) return true;
  try {
    const store = getStore(RATE_BLOB_STORE);
    const key = `rappel:${ip.slice(0, 64)}`; // cap key length
    const raw = await store.get(key, { type: 'text' });
    const now = Date.now();
    let entry: RateEntry = raw ? (JSON.parse(raw) as RateEntry) : { count: 0, windowStart: now };
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
    }
    entry.count += 1;
    await store.set(key, JSON.stringify(entry));
    return entry.count <= RATE_LIMIT_MAX;
  } catch {
    return true; // fail open — never block legitimate traffic over a Blob error
  }
}

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Téléphone : au moins 10 chiffres (séparateurs et indicatif tolérés).
const TEL_RE = /(?:\D*\d){10,}/;
const ECHEANCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TYPES_VALIDES = new Set(['Renouvellement', 'Refinancement']);

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** Neutralise toute entrée utilisateur injectée dans le HTML des courriels. */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Envoi Resend                                                       */
/* ------------------------------------------------------------------ */

interface ResendEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
}

async function sendEmail(apiKey: string, email: ResendEmail): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
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
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const allowed = await checkRateLimit(clientIp);
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
    !EMAIL_RE.test(courriel) ||
    !TEL_RE.test(telephone) ||
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
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RAPPEL_FROM_EMAIL;
  const notifyEmail = process.env.RAPPEL_NOTIFY_EMAIL;

  // En développement sans clé Resend : on logue les courriels dans la console
  // au lieu de les envoyer. Le formulaire retourne un succès pour faciliter
  // les tests locaux. En production, les 3 variables sont obligatoires.
  const isDev = import.meta.env.DEV;
  if (!apiKey || !fromEmail || !notifyEmail) {
    if (isDev) {
      console.log('[rappel-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[rappel-submit] 📨 Expéditeur simulé :', fromEmail || '(non défini)');
      console.log('[rappel-submit] 📩 Notification interne simulée vers :', notifyEmail || '(non défini)');
      console.log('[rappel-submit] ✉️  Confirmation client simulée vers :', courriel);
      // On retourne un succès simulé pour permettre le test du flux complet
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[rappel-submit] Variables Resend manquantes (RESEND_API_KEY / RAPPEL_FROM_EMAIL / RAPPEL_NOTIFY_EMAIL).');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }

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
  const eSiteUrl = escapeHtml(config.site_url);
  const siteHost = escapeHtml(config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, ''));

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

  const internalHtml = `<!doctype html><html lang="fr-CA"><body style="margin:0;background:#f7f2eb;font-family:Arial,Helvetica,sans-serif;color:#1f1e1c;">
    <div style="max-width:600px;margin:0 auto;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande de rappel</h1>
      <p style="margin:0 0 20px;color:#6a5f50;font-size:14px;">Type&nbsp;: <strong>${eType}</strong></p>
      ${rappelBanner}
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Nom</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;">${eNom}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Courriel</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><a href="mailto:${eCourriel}" style="color:#a85f38;">${eCourriel}</a></td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Téléphone</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;">${eTel || '—'}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Type de demande</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;">${eType}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Échéance actuelle</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;">${echeanceFmt ? eEcheance : '—'}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;"><strong>Institution actuelle</strong></td><td style="padding:12px 16px;border-bottom:1px solid #e3d9cc;font-size:14px;">${eInstitution || '—'}</td></tr>
        <tr><td style="padding:12px 16px;font-size:14px;vertical-align:top;"><strong>Détails</strong></td><td style="padding:12px 16px;font-size:14px;">${eDetails || '—'}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${escapeHtml(eNom)}.</p>
    </div></body></html>`;

  /* ---------- Courriel 2 — confirmation client (styles inline) ---------- */

  const suiteEcheance = echeanceFmt
    ? `Comme votre terme arrive à échéance en <strong>${eEcheance}</strong>, sachez que le meilleur moment pour magasiner se situe de 4 à 6 mois avant cette date. ${escapeHtml(prenomCourtiere)} vous contactera donc au moment idéal&nbsp;: vous n'avez rien à faire d'ici là.`
    : `${escapeHtml(prenomCourtiere)} examinera votre demande et vous contactera personnellement pour discuter du meilleur moment d'agir. Vous n'avez rien à faire d'ici là.`;

  const clientHtml = `<!doctype html><html lang="fr-CA"><body style="margin:0;background:#f7f2eb;font-family:Arial,Helvetica,sans-serif;color:#1f1e1c;">
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
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

        <div style="border-top:1px solid #e3d9cc;padding-top:20px;margin-top:8px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#1f1e1c;">
            <strong>${escapeHtml(config.nom)}</strong><br>
            ${escapeHtml(config.titre)}<br>
            ${escapeHtml(config.organisation)}<br>
            N&deg; de certificat AMF&nbsp;: ${escapeHtml(config.amf)}<br>
            <a href="${eSiteUrl}" style="color:#a85f38;">${siteHost}</a>
          </p>
        </div>
      </div>

      <p style="margin:20px 4px 0;font-size:11px;line-height:1.6;color:#6a5f50;">
        Vous recevez ce courriel parce que vous avez soumis une demande de suivi sur ${siteHost}.
        Vos renseignements sont utilisés uniquement à cette fin.
      </p>
    </div></body></html>`;

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
