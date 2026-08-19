// Endpoint de soumission du funnel publicitaire /refinancement-v2.
//
// Variante « basse friction » de /api/refinancement-submit : aucun chiffre exact n'est
// demandé au prospect, seulement des tranches. L'équité est donc recalculée ici à partir
// des milieux de tranche (jamais reçue du client) et sert à flaguer le lead à l'interne.
//
// Envoie :
//   1. Notification interne à Stéphanie — tranches, ville, équité déduite + bandeau de
//      qualification (⚠️ si l'équité estimée est sous 20 %).
//   2. Confirmation client — générique, ne répète AUCUNE donnée financière.
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
import { formatCAD } from '../../utils/formatters';
import {
  estIntentionCle,
  evaluerEquite,
  libelleIntention,
  libelleSolde,
  libelleValeur,
  type Equite,
} from '../../utils/refinancementV2';
import { creerDossier } from '../../services/dossierClientService';
import { depuisRefinancementV2 } from '../../utils/entreesProspect';

export const prerender = false;

type FieldValue = unknown;
type Payload = Record<string, FieldValue>;

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

const VILLE_MIN = 2;
const VILLE_MAX = 60;

function asTrimmedString(value: FieldValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tableBlock(title: string, rows: string): string {
  if (!rows) return '';
  return `<h2 style="font-size:15px;margin:22px 0 8px;color:#a85f38;">${title}</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>`;
}

/** Bandeau de qualification affiché en tête de la notification interne. */
function bandeauEquite(equite: Equite): string {
  const styleBase =
    'margin:0 0 4px;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.55;';

  if (equite.niveau === 'faible') {
    return `<p style="${styleBase}background:#fbeae3;border:1px solid #a85f38;color:#a85f38;">
        <strong>⚠️ Équité estimée faible (moins de 20 %)</strong><br />
        À valider avant l'appel — un refinancement conventionnel est peu probable en l'état.
      </p>`;
  }
  if (equite.niveau === 'inconnue') {
    return `<p style="${styleBase}background:#f7f2eb;border:1px solid #e3d9cc;color:#6a5f50;">
        <strong>Solde hypothécaire inconnu</strong><br />
        Le prospect ignore son solde — équité à confirmer pendant l'appel.
      </p>`;
  }
  return `<p style="${styleBase}background:#f0f7f1;border:1px solid #c5dac8;color:#2d5a3a;">
      <strong>Équité estimée correcte</strong><br />
      Environ ${escapeHtml(formatCAD(equite.disponible80 ?? 0))} refinançables selon les tranches choisies.
    </p>`;
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
  if (asTrimmedString(payload.company) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'refinancement-v2');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const intention = asTrimmedString(payload.intention);
  const valeurTranche = asTrimmedString(payload.valeur_tranche);
  const soldeTranche = asTrimmedString(payload.solde_tranche);
  const ville = asTrimmedString(payload.ville);

  const prenom = asTrimmedString(payload.prenom);
  const courriel = asTrimmedString(payload.courriel);
  const cellulaire = asTrimmedString(payload.cellulaire);
  const consentement = payload.consentement === true;

  // L'équité est recalculée côté serveur : rien n'est accepté du client sur ce point.
  // evaluerEquite() retourne null si l'une des deux tranches est invalide, ce qui vaut
  // whitelist pour valeur_tranche et solde_tranche.
  const equite = evaluerEquite(valeurTranche, soldeTranche);

  if (
    prenom.length < 2 ||
    !EMAIL_RE.test(courriel) ||
    cellulaire.length < 7 ||
    !consentement ||
    ville.length < VILLE_MIN ||
    ville.length > VILLE_MAX ||
    !estIntentionCle(intention) ||
    equite === null
  ) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  // Ouvrir la fiche au carnet.
  //
  // **Avant** l'envoi, et jamais à son prix : le courriel reste la garantie, la fiche est un
  // confort. Une panne de Netlify Blobs ne doit pas coûter un prospect, d'où ce try/catch qui
  // journalise et poursuit — même patron que /api/demande-submit.
  try {
    const entree = depuisRefinancementV2({ ...payload, intention: libelleIntention(intention) });
    if (entree.ok) await creerDossier(entree.valeur, { origine: 'refinancement_v2' });
    else console.warn('[refinancement-v2-submit] Fiche non ouverte :', entree.erreur);
  } catch (err) {
    console.error('[refinancement-v2-submit] Ouverture de la fiche impossible :', err);
  }

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[refinancement-v2-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[refinancement-v2-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[refinancement-v2-submit] ✉️  Confirmation client simulée vers :', courriel);
      console.log('[refinancement-v2-submit] 🏠 Équité déduite :', equite);
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[refinancement-v2-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const ePrenom = escapeHtml(prenom);
  const eCourriel = escapeHtml(courriel);
  const eVille = escapeHtml(ville);

  /* ---------- Notification interne ---------- */

  const equiteAffichee =
    equite.equite === null || equite.ratio === null
      ? 'Inconnue (solde non déclaré)'
      : `${escapeHtml(formatCAD(equite.equite))} (${Math.round(equite.ratio * 100)} % de la valeur estimée)`;

  const disponibleAffiche =
    equite.disponible80 === null
      ? 'À confirmer'
      : escapeHtml(formatCAD(equite.disponible80));

  const sectionProjet = renderDataRows([
    ['Intention principale', escapeHtml(libelleIntention(intention))],
    ['Valeur de la propriété (tranche)', escapeHtml(libelleValeur(valeurTranche))],
    ['Solde hypothécaire (tranche)', escapeHtml(libelleSolde(soldeTranche))],
    ['Ville', eVille],
    ['Équité estimée', equiteAffichee],
    ['Montant refinançable estimé (80 % LTV)', disponibleAffiche],
  ]);

  const sectionContact = renderDataRows([
    ['Prénom', ePrenom],
    ['Courriel', `<a href="mailto:${eCourriel}" style="color:#a85f38;">${eCourriel}</a>`],
    ['Cellulaire', escapeHtml(cellulaire)],
    ['Consentement aux communications', 'Oui'],
    ['Source', 'Landing publicitaire /refinancement-v2'],
  ]);

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouveau lead — Refinancement V2 (publicité)</h1>
      <p style="margin:0 0 12px;color:#6a5f50;font-size:14px;"><strong>${ePrenom}</strong> · ${eVille}</p>
      ${bandeauEquite(equite)}
      ${tableBlock('1. Projet', sectionProjet)}
      ${tableBlock('2. Contact', sectionContact)}
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">
        Les montants ci-dessus sont des milieux de tranche déduits du questionnaire, pas des chiffres
        déclarés par le prospect. Répondez directement à ce courriel pour écrire à ${ePrenom}.
      </p>
  `);

  /* ---------- Confirmation client — aucune donnée financière répétée ---------- */

  const eCalendly = escapeHtml(config.calendly_url);

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${ePrenom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu ta demande d'analyse de refinancement. Merci de la confiance que tu m'accordes.
        </p>
        <h2 style="font-size:16px;margin:24px 0 8px;color:#a85f38;">Ce qui suit</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Je calcule ton économie potentielle et je te reviens en moins de 24 h ouvrables, avec les
          scénarios possibles parmi plus de 20 institutions prêteuses. C'est gratuit et sans engagement.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Tu veux aller plus vite&nbsp;? Réserve directement un 15 minutes dans mon agenda&nbsp;:<br />
          <a href="${eCalendly}" style="color:#a85f38;font-weight:600;">Prendre rendez-vous</a>
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Tes renseignements sont strictement confidentiels. Aucune enquête de crédit ne sera lancée
          sans ton consentement écrit.
        </p>
        ${renderSignatureBlock()}
      </div>
  `, '32px 24px');

  try {
    await Promise.all([
      sendEmail(apiKey, {
        from: fromEmail,
        to: notifyEmail,
        subject: `Nouveau lead refinancement V2 — ${prenom} (${ville})`,
        html: internalHtml,
        reply_to: courriel,
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: courriel,
        subject: `J'ai bien reçu ta demande — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[refinancement-v2-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
