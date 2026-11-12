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
  /** Version texte. Facultative, mais un courriel sans elle part avec un handicap de délivrabilité. */
  text?: string;
  /** Copie invisible — sert à déposer dans la boîte de la courtière ce qu'elle a envoyé. */
  bcc?: string;
  reply_to?: string;
  /** En-têtes bruts — sert au `List-Unsubscribe` des courriels d'approche. */
  headers?: Record<string, string>;
  attachments?: ResendAttachment[];
}

/**
 * Resend limite le débit à quelques requêtes par seconde et répond 429 au-delà. Un 429 n'est
 * pas un refus, c'est « pas maintenant » : le laisser remonter perdait le courriel — y
 * compris l'invitation à signer, qui est la seule chose capable de débloquer un dossier en
 * attente. Deux relances suffisent : la limite se mesure à la seconde, pas à la minute.
 */
const RELANCES_MAX = 2;

/** Attente par défaut entre deux tentatives, quand Resend n'indique pas `Retry-After`. */
const ATTENTE_RELANCE_MS = 1100;

/** Plafond de l'attente : au-delà, la fonction SSR expirerait avant d'avoir réessayé. */
const ATTENTE_RELANCE_MAX_MS = 3000;

function attenteRelance(enTete: string | null | undefined): number {
  const secondes = Number(enTete);
  if (!Number.isFinite(secondes) || secondes <= 0) return ATTENTE_RELANCE_MS;
  return Math.min(secondes * 1000, ATTENTE_RELANCE_MAX_MS);
}

export async function sendEmail(apiKey: string, email: ResendEmail): Promise<void> {
  for (let tentative = 0; ; tentative += 1) {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return;

    const detail = await res.text().catch(() => '');
    if (res.status === 429 && tentative < RELANCES_MAX) {
      // `headers` peut manquer sur une réponse simulée : on ne le lit qu'avec précaution.
      const attente = attenteRelance(res.headers?.get?.('retry-after'));
      console.warn(`[email] Resend a répondu 429 — nouvelle tentative dans ${attente} ms.`);
      await new Promise((resoudre) => setTimeout(resoudre, attente));
      continue;
    }
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

/**
 * La palette des courriels : celle du site (`:root` de `global.css`), en valeurs écrites — un
 * courriel ne lit pas de variables CSS. Changer une couleur du site, c'est la changer ici aussi.
 */
export const COULEURS_COURRIEL = {
  fond: '#f6f3ff', // --sand
  lilas: '#ece6ff', // --warm
  mauve: '#6d47ff', // --clay
  mauveFonce: '#5b34f0', // --clay-dk
  encre: '#12101f', // --ink
  attenue: '#575268', // --muted
  bordure: '#e2ddf0', // --border
  rose: '#ffc6e0', // --rose
  soleil: '#ffd23f', // --sun
} as const;

const C = COULEURS_COURRIEL;

/**
 * Police des titres, puis celle du texte, puis les polices système. Les clients de courriel
 * n'ont presque jamais Bricolage Grotesque ni DM Sans : le repli doit tenir seul. Aucune police
 * n'est chargée à distance — le site a quitté Google Fonts pour ne pas transmettre l'IP du
 * visiteur, ce n'est pas pour la transmettre à l'ouverture d'un courriel.
 */
const POLICE_TEXTE = `'DM Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const POLICE_TITRES = `'Bricolage Grotesque',${POLICE_TEXTE}`;

/**
 * Enveloppe un corps de courriel dans le gabarit visuel du site : fond lilas, en-tête au nom
 * de la courtière avec le filet dégradé de la navigation, 600 px de large.
 *
 * Les styles du `<head>` ne font qu'ajouter (police des titres, liens) : tout ce qui compte
 * est écrit en ligne, puisque certains clients retirent le `<style>`.
 */
export function wrapEmailHtml(bodyHtml: string, padding = '24px'): string {
  const config = loadSiteConfig();
  const [prenom, ...reste] = config.nom.split(' ');
  const nomFamille = reste.join(' ');
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>
  h1,h2,h3{font-family:${POLICE_TITRES};letter-spacing:-0.01em;}
  a{color:${C.mauve};}
  @media (max-width:480px){.sw-enveloppe{padding:16px 10px!important;}}
</style></head>
<body style="margin:0;padding:0;background:${C.fond};font-family:${POLICE_TEXTE};color:${C.encre};-webkit-font-smoothing:antialiased;">
    <div class="sw-enveloppe" style="max-width:600px;margin:0 auto;padding:${padding};">
      <div style="background:#ffffff;border:1px solid ${C.bordure};border-radius:20px;padding:18px 24px 0;margin:0 0 20px;overflow:hidden;">
        <p style="margin:0;font-family:${POLICE_TITRES};font-size:20px;font-weight:700;line-height:1.2;color:${C.encre};">${escapeHtml(prenom)}${nomFamille ? ` <span style="color:${C.mauve};font-weight:600;">${escapeHtml(nomFamille)}</span>` : ''}</p>
        <p style="margin:4px 0 16px;font-size:13px;line-height:1.4;color:${C.attenue};">${escapeHtml(config.titre)} &middot; ${escapeHtml(config.organisation)}</p>
        <div style="height:4px;margin:0 -24px;background-color:${C.mauve};background-image:linear-gradient(90deg,${C.mauve} 0%,${C.rose} 55%,${C.soleil} 100%);font-size:0;line-height:0;">&nbsp;</div>
      </div>
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
      const border = i === rows.length - 1 ? '' : `border-bottom:1px solid ${C.bordure};`;
      return `<tr><td style="padding:12px 16px;${border}font-size:14px;vertical-align:top;"><strong>${label}</strong></td><td style="padding:12px 16px;${border}font-size:14px;">${value || '—'}</td></tr>`;
    })
    .join('\n');
}

/** Bloc de signature standard (nom, titre, organisation, AMF, lien site) pour les courriels client. */
export function renderSignatureBlock(): string {
  const config = loadSiteConfig();
  const eSiteUrl = escapeHtml(config.site_url);
  const siteHost = escapeHtml(config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  return `<div style="border-top:1px solid ${C.bordure};padding-top:20px;margin-top:8px;">
      <p style="margin:0;font-size:14px;line-height:1.6;color:${C.encre};">
        <strong style="font-family:${POLICE_TITRES};font-size:16px;">${escapeHtml(config.nom)}</strong><br>
        <span style="color:${C.attenue};">${escapeHtml(config.titre)} &middot; ${escapeHtml(config.organisation)}<br>
        N&deg; de certificat AMF&nbsp;: ${escapeHtml(config.amf)}</span><br>
        <a href="${eSiteUrl}" style="color:${C.mauve};font-weight:600;text-decoration:none;">${siteHost}</a>
      </p>
    </div>`;
}

export interface OptionsRendezVous {
  /**
   * Le formulaire d'où part l'accusé (`demande`, `rappel`…) : il devient `utm_campaign`, ce
   * qui permet de compter les rendez-vous pris depuis chaque accusé.
   */
  readonly campagne: string;
  /** La phrase au-dessus du bouton, déjà échappée. Un texte par défaut convient à un client. */
  readonly texte?: string;
  /** Les pages publicitaires tutoient ; le reste du site vouvoie. */
  readonly tutoiement?: boolean;
}

/** L'adresse de `/rendez-vous/` marquée de sa provenance, pour les accusés de réception. */
export function lienRendezVous(campagne: string): string {
  const config = loadSiteConfig();
  const params = new URLSearchParams({ utm_source: 'courriel', utm_medium: 'accuse', utm_campaign: campagne });
  return `${config.site_url.replace(/\/$/, '')}/rendez-vous/?${params.toString()}`;
}

/**
 * L'invitation à réserver un appel de 15 minutes, au bas de chaque accusé de réception.
 *
 * C'est quand l'accusé arrive que l'intérêt du prospect est le plus fort : il vient de
 * remplir un formulaire. Lui offrir de choisir lui-même son moment évite d'attendre un
 * rappel qui, s'il tombe mal, devient un message vocal de plus.
 *
 * Le lien mène à la page `/rendez-vous/` du site, pas directement à l'agenda : c'est le
 * chemin de tous les autres boutons de réservation, il garde le numéro de téléphone en
 * repli, et l'`utm_campaign` dit lequel des accusés a produit le rendez-vous.
 */
export function renderInvitationRendezVous(options: OptionsRendezVous): string {
  const eLien = escapeHtml(lienRendezVous(options.campagne));
  const texte =
    options.texte ??
    (options.tutoiement
      ? 'Tu veux aller plus vite&nbsp;? Choisis toi-même le moment qui te convient dans mon agenda&nbsp;: un appel de 15&nbsp;minutes, gratuit et sans engagement.'
      : 'Vous préférez qu\'on en parle de vive voix&nbsp;? Choisissez vous-même le moment qui vous convient dans mon agenda&nbsp;: un appel de 15&nbsp;minutes, gratuit et sans engagement.');
  return `<div style="background:${C.fond};border:1px solid ${C.bordure};border-radius:18px;padding:22px;margin:0 0 24px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.mauve};">Appel de 15&nbsp;min &middot; gratuit</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.encre};">${texte}</p>
      <a href="${eLien}" style="display:inline-block;background:${C.mauve};color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;padding:14px 22px;border-radius:999px;border-bottom:3px solid ${C.mauveFonce};">Réserver un appel de 15&nbsp;min &rarr;</a>
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
 * Limite à `max` soumissions par IP par heure (5 par défaut). `formKey` namespace le compteur
 * pour que chaque formulaire ait son propre quota (ex. "rappel", "demande", "contact"...).
 * Un plafond plus haut ne se justifie que sur une route déjà gardée par un jeton aléatoire,
 * où l'IP ne protège plus un secret mais seulement contre l'abus de volume.
 * Ignoré en dev local ; fail-open sur erreur Blob pour ne jamais bloquer un utilisateur
 * légitime sur un incident d'infrastructure.
 *
 * Le dev se reconnaît à `import.meta.env.DEV`, **jamais** à `process.env.NETLIFY` : cette
 * variable n'est pas garantie au runtime des fonctions (même constat que `dossierStockage`
 * et `ratesService`), et son absence éteignait la limite en production — y compris celle
 * qui protège le mot de passe de la courtière contre la force brute.
 */
export async function checkRateLimit(
  ip: string,
  formKey: string,
  max: number = RATE_LIMIT_MAX,
): Promise<boolean> {
  if (import.meta.env.DEV === true) return true; // skip en dev local
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
    return entry.count <= max;
  } catch {
    return true; // fail open — jamais bloquer le trafic légitime sur une erreur Blob
  }
}

/* ------------------------------------------------------------------ */
/*  Utilitaires HTTP communs aux routes /api/*-submit                  */
/* ------------------------------------------------------------------ */

/**
 * Adresse IP du client, telle que Netlify l'a vue.
 *
 * `x-nf-client-connection-ip` est posé par le réseau de Netlify lui-même : c'est la source
 * que l'adaptateur Astro retient pour `clientAddress`. `X-Forwarded-For`, lui, peut porter
 * une valeur écrite par le visiteur — en prendre le premier élément laissait chacun choisir
 * son IP : contourner la limite de débit (donc deviner le mot de passe de la courtière sans
 * frein) et inscrire une adresse inventée dans la trace de preuve d'une signature.
 *
 * Les en-têtes de proxy ne sont donc lus qu'en dev local, où l'en-tête Netlify n'existe pas.
 * En production, son absence donne `unknown` plutôt qu'une valeur que le client contrôle.
 */
export function clientIpFromRequest(request: Request): string {
  const netlify = request.headers.get('x-nf-client-connection-ip')?.trim();
  if (netlify) return netlify;
  if (import.meta.env.DEV !== true) return 'unknown';
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
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
