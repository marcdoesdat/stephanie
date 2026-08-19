// Endpoint de soumission du funnel publicitaire /refinancement.
// Landing page de campagne (Facebook/Google Ads) — les leads arrivent qualifiés avec
// un portrait financier sommaire. Envoie :
//   1. Notification interne à Stéphanie — portrait complet + provenance publicitaire.
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
import { creerDossier } from '../../services/dossierClientService';
import { depuisRefinancement } from '../../utils/entreesProspect';

export const prerender = false;

type FieldValue = unknown;
type Payload = Record<string, FieldValue>;

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

function asTrimmedString(value: FieldValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

const LABELS: Record<string, Record<string, string>> = {
  proprietaire: { oui: 'Oui', non: 'Non' },
  type_propriete: { maison: 'Maison unifamiliale', condo: 'Condo', plex: 'Plex', autre: 'Autre' },
  but_refinancement: {
    consolider_dettes: 'Consolider mes dettes', renovations: 'Rénovations',
    cash_projet: 'Sortir du cash pour un projet', autre: 'Autre',
  },
  preteur_actuel: {
    rbc: 'RBC — Banque Royale', td: 'TD — Groupe Banque TD',
    bmo: 'BMO — Banque de Montréal', cibc: 'CIBC', scotia: 'Banque Scotia',
    bnc: 'Banque Nationale', desjardins: 'Desjardins',
    first_national: 'First National', mcap: 'MCAP', tangerine: 'Tangerine',
    autre: 'Autre',
    ne_sais_pas: 'Je ne sais pas',
  },
  type_revenu: {
    salarie: 'Salarié', travailleur_autonome: 'Travailleur autonome',
    retraite: 'Retraité', prestation: 'Prestation / Allocation', autre: 'Autre',
  },
  cote_credit: {
    '760_plus': 'Excellente (760 et plus)', '700_759': 'Très bonne (700 à 759)',
    '650_699': 'Un peu basse (650 à 699)', moins_650: 'Moins de 650', ne_sais_pas: 'Je ne sais pas',
  },
  faillite: { oui: 'Oui', non: 'Non', pas_certain: 'Pas certain' },
};

function label(field: string, value: string): string {
  return escapeHtml(LABELS[field]?.[value] ?? value);
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

  if (asTrimmedString(payload.company) !== '') {
    return jsonResponse({ ok: true }, 200);
  }

  const clientIp = clientIpFromRequest(request);
  const allowed = await checkRateLimit(clientIp, 'refinancement');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const prenom = asTrimmedString(payload.prenom);
  const nom = asTrimmedString(payload.nom);
  const courriel = asTrimmedString(payload.courriel);
  const cellulaire = asTrimmedString(payload.cellulaire);
  const consentement = payload.consentement === true;

  const proprietaire = asTrimmedString(payload.proprietaire);
  const typePropriete = asTrimmedString(payload.type_propriete);
  const butRefinancement = asTrimmedString(payload.but_refinancement);
  const preteurActuel = asTrimmedString(payload.preteur_actuel);
  const typeRevenu = asTrimmedString(payload.type_revenu);
  const coteCredit = asTrimmedString(payload.cote_credit);
  const faillite = asTrimmedString(payload.faillite);

  const valeurMarchande = asTrimmedString(payload.valeur_marchande);
  const soldePret = asTrimmedString(payload.solde_pret);
  const dettes = asTrimmedString(payload.dettes_a_refinancer);
  const finTerme = asTrimmedString(payload.fin_terme);
  const revenuBrut = asTrimmedString(payload.revenu_brut);

  if (
    prenom.length < 2 ||
    nom.length < 2 ||
    !EMAIL_RE.test(courriel) ||
    cellulaire.length < 7 ||
    !consentement ||
    !LABELS.proprietaire?.[proprietaire] ||
    !LABELS.type_propriete?.[typePropriete] ||
    !LABELS.but_refinancement?.[butRefinancement] ||
    !LABELS.preteur_actuel?.[preteurActuel] ||
    !LABELS.type_revenu?.[typeRevenu] ||
    !LABELS.cote_credit?.[coteCredit] ||
    !LABELS.faillite?.[faillite] ||
    valeurMarchande === '' ||
    soldePret === '' ||
    dettes === '' ||
    finTerme === '' ||
    revenuBrut === ''
  ) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  // Ouvrir la fiche au carnet.
  //
  // **Avant** l'envoi, et jamais à son prix : le courriel reste la garantie, la fiche est un
  // confort. Une panne de Netlify Blobs ne doit pas coûter un prospect, d'où ce try/catch qui
  // journalise et poursuit — même patron que /api/demande-submit.
  try {
    // Les libellés, pas les clés : « consolider_dettes » dans une fiche que Stéphanie relit
    // six mois plus tard ne veut rien dire. La table de traduction vit ici, à un seul endroit.
    const entree = depuisRefinancement({
      ...payload,
      but_refinancement: LABELS.but_refinancement?.[butRefinancement] ?? butRefinancement,
      preteur_actuel: LABELS.preteur_actuel?.[preteurActuel] ?? preteurActuel,
      type_propriete: LABELS.type_propriete?.[typePropriete] ?? typePropriete,
    });
    if (entree.ok) await creerDossier(entree.valeur, { origine: 'refinancement' });
    else console.warn('[refinancement-submit] Fiche non ouverte :', entree.erreur);
  } catch (err) {
    console.error('[refinancement-submit] Ouverture de la fiche impossible :', err);
  }

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[refinancement-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[refinancement-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[refinancement-submit] ✉️  Confirmation client simulée vers :', courriel);
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[refinancement-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const nomComplet = `${prenom} ${nom}`;
  const eNomComplet = escapeHtml(nomComplet);
  const ePrenom = escapeHtml(prenom);
  const eCourriel = escapeHtml(courriel);

  /* ---------- Notification interne ---------- */

  const sectionPropriete = renderDataRows([
    ['But du refinancement', label('but_refinancement', butRefinancement)],
    ["Propriétaire d'un bien immobilier", label('proprietaire', proprietaire)],
    ['Type de propriété à refinancer', label('type_propriete', typePropriete)],
    ['Valeur marchande estimée', escapeHtml(valeurMarchande)],
    ['Solde hypothécaire actuel', escapeHtml(soldePret)],
    ['Dettes totales à refinancer', escapeHtml(dettes)],
    ['Date approximative de fin de terme', escapeHtml(finTerme)],
    ['Prêteur actuel', label('preteur_actuel', preteurActuel)],
  ]);

  const sectionProfil = renderDataRows([
    ['Type de revenu principal', label('type_revenu', typeRevenu)],
    ['Revenu brut familial approximatif', escapeHtml(revenuBrut)],
    ['Cote de crédit approximative', label('cote_credit', coteCredit)],
    ['Faillite ou proposition au consommateur', label('faillite', faillite)],
  ]);

  const sectionContact = renderDataRows([
    ['Nom complet', eNomComplet],
    ['Courriel', `<a href="mailto:${eCourriel}" style="color:#a85f38;">${eCourriel}</a>`],
    ['Cellulaire', escapeHtml(cellulaire)],
    ['Consentement aux communications', 'Oui'],
    ['Source', 'Landing publicitaire /refinancement'],
  ]);

  function tableBlock(title: string, rows: string): string {
    if (!rows) return '';
    return `<h2 style="font-size:15px;margin:22px 0 8px;color:#a85f38;">${title}</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>`;
  }

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouveau lead — Refinancement (publicité)</h1>
      <p style="margin:0 0 4px;color:#6a5f50;font-size:14px;"><strong>${eNomComplet}</strong></p>
      ${tableBlock('1. Projet et propriété', sectionPropriete)}
      ${tableBlock('2. Profil financier', sectionProfil)}
      ${tableBlock('3. Contact', sectionContact)}
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${ePrenom}.</p>
  `);

  /* ---------- Confirmation client — aucune donnée financière répétée ---------- */

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${ePrenom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande d'analyse de refinancement. Merci de la confiance que vous m'accordez.
        </p>
        <h2 style="font-size:16px;margin:24px 0 8px;color:#a85f38;">Ce qui suit</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'analyse votre situation et je vous contacte personnellement dans les meilleurs délais pour vous présenter
          les scénarios possibles — parmi plus de 30 institutions prêteuses. C'est gratuit et sans engagement.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Vos renseignements sont strictement confidentiels. Aucune enquête de crédit ne sera lancée sans votre consentement écrit.
        </p>
        ${renderSignatureBlock()}
      </div>
  `, '32px 24px');

  try {
    await Promise.all([
      sendEmail(apiKey, {
        from: fromEmail,
        to: notifyEmail,
        subject: `Nouveau lead refinancement (pub) — ${nomComplet}`,
        html: internalHtml,
        reply_to: courriel,
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: courriel,
        subject: `Votre demande de refinancement est bien reçue — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[refinancement-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
