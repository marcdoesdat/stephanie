// Service Resend partagé par toutes les routes /api/*-submit du site.
// Centralise ce qui était dupliqué dans src/pages/api/rappel-submit.ts : envoi HTTP vers
// Resend, échappement HTML, gabarit visuel commun des courriels, et limitation de débit
// par IP (Netlify Blobs). Chaque route garde sa propre validation de champs et son propre
// contenu de courriel — seule l'infrastructure commune vit ici.

import { loadSiteConfig } from '../config';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/* ------------------------------------------------------------------ */
/*  Envoi Resend                                                       */
/* ------------------------------------------------------------------ */

export interface ResendAttachment {
  filename: string;
  content: string; // base64, sans préfixe "data:...;base64,"
}

export interface ResendEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
  attachments?: ResendAttachment[];
}

export async function sendEmail(apiKey: string, email: ResendEmail): Promise<void> {
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

/** Construit une pièce jointe Resend à partir d'un contenu déjà encodé en base64. */
export function toResendAttachment(filename: string, base64Content: string): ResendAttachment {
  return { filename, content: base64Content };
}

/* ------------------------------------------------------------------ */
/*  Échappement HTML                                                   */
/* ------------------------------------------------------------------ */

/** Neutralise toute entrée utilisateur injectée dans le HTML des courriels. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '&#92;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/*  Gabarit visuel commun                                              */
/* ------------------------------------------------------------------ */

/** Enveloppe un corps de courriel dans le gabarit visuel commun (fond sable, Arial, 600px). */
export function wrapEmailHtml(bodyHtml: string, padding = '24px'): string {
  return `<!doctype html><html lang="fr-CA"><body style="margin:0;background:#f7f2eb;font-family:Arial,Helvetica,sans-serif;color:#1f1e1c;">
    <div style="max-width:600px;margin:0 auto;padding:${padding};">
      ${bodyHtml}
    </div></body></html>`;
}

/**
 * Génère les lignes <tr> d'un tableau de données pour les courriels de notification
 * interne. `rows` est une liste de paires [étiquette, valeur déjà échappée].
 */
export function renderDataRows(rows: Array<[label: string, value: string]>): string {
  return rows
    .map(([label, value], i) => {
      const border = i === rows.length - 1 ? '' : 'border-bottom:1px solid #e3d9cc;';
      return `<tr><td style="padding:12px 16px;${border}font-size:14px;vertical-align:top;"><strong>${label}</strong></td><td style="padding:12px 16px;${border}font-size:14px;">${value || '—'}</td></tr>`;
    })
    .join('\n');
}

/** Bloc de signature standard (nom, titre, organisation, AMF, lien site) pour les courriels client. */
export function renderSignatureBlock(): string {
  const config = loadSiteConfig();
  const eSiteUrl = escapeHtml(config.site_url);
  const siteHost = escapeHtml(config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  return `<div style="border-top:1px solid #e3d9cc;padding-top:20px;margin-top:8px;">
      <p style="margin:0;font-size:14px;line-height:1.6;color:#1f1e1c;">
        <strong>${escapeHtml(config.nom)}</strong><br>
        ${escapeHtml(config.titre)}<br>
        ${escapeHtml(config.organisation)}<br>
        N&deg; de certificat AMF&nbsp;: ${escapeHtml(config.amf)}<br>
        <a href="${eSiteUrl}" style="color:#a85f38;">${siteHost}</a>
      </p>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Limitation de débit (IP-based, Netlify Blobs)                      */
/* ------------------------------------------------------------------ */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const RATE_BLOB_STORE = 'rate-limit';

interface RateEntry { count: number; windowStart: number; }

/**
 * Limite à 5 soumissions par IP par heure. `formKey` namespace le compteur pour que
 * chaque formulaire ait son propre quota (ex. "rappel", "demande", "contact"...).
 * Ignoré en local (pas de Netlify Blobs) ; fail-open sur erreur Blob pour ne jamais
 * bloquer un utilisateur légitime sur un incident d'infrastructure.
 */
export async function checkRateLimit(ip: string, formKey: string): Promise<boolean> {
  if (!process.env.NETLIFY) return true; // skip en dev local
  let getStore: typeof import('@netlify/blobs').getStore | undefined;
  try {
    getStore = (await import('@netlify/blobs')).getStore;
  } catch { return true; }
  if (!getStore) return true;
  try {
    const store = getStore(RATE_BLOB_STORE);
    const key = `${formKey}:${ip.slice(0, 64)}`; // cap key length
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
    return true; // fail open — jamais bloquer le trafic légitime sur une erreur Blob
  }
}

/* ------------------------------------------------------------------ */
/*  Utilitaires HTTP communs aux routes /api/*-submit                  */
/* ------------------------------------------------------------------ */

/** Extrait l'adresse IP du client depuis les en-têtes de proxy Netlify. */
export function clientIpFromRequest(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Variables d'environnement Resend                                   */
/* ------------------------------------------------------------------ */

export interface ResendEnv {
  apiKey: string;
  fromEmail: string;
  notifyEmail: string;
}

/** Lit les 3 variables d'env Resend partagées. Retourne null si l'une d'elles manque. */
export function loadResendEnv(): ResendEnv | null {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const notifyEmail = process.env.RESEND_NOTIFY_EMAIL;
  if (!apiKey || !fromEmail || !notifyEmail) return null;
  return { apiKey, fromEmail, notifyEmail };
}
