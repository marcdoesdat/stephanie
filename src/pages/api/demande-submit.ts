// Endpoint de soumission du formulaire de demande de financement (/demande).
// Formulaire le plus étoffé du site (~45 champs), incluant des renseignements personnels
// sensibles (adresse, date de naissance, revenus, évaluation de crédit). Envoie :
//   1. Notification interne à Stéphanie — détail complet, section par section.
//   2. Confirmation client — générique et chaleureuse, ne répète AUCUNE donnée sensible.
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

type FieldValue = unknown;
type Payload = Record<string, FieldValue>;

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

function asTrimmedString(value: FieldValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: FieldValue): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

/* ------------------------------------------------------------------ */
/*  Libellés lisibles pour les valeurs de select/radio/checkbox         */
/* ------------------------------------------------------------------ */

const LABELS: Record<string, Record<string, string>> = {
  type_demande: { achat: 'Nouvel achat', refinancement: 'Refinancement' },
  statut_residence: {
    citoyen: 'Citoyen·ne canadien·ne', resident_permanent: 'Résident·e permanent·e',
    permis_travail: 'Permis de travail', autre_statut: 'Autre',
  },
  etat_civil: {
    celibataire: 'Célibataire', marie: 'Marié·e', conjoint_fait: 'Conjoint·e de fait',
    divorce: 'Divorcé·e', veuf: 'Veuf·ve',
  },
  statut_emploi: {
    salarie: 'Salarié·e (T4)', travailleur_autonome: 'Travailleur·e autonome',
    commission: 'À commission', contractuel: 'Contractuel·le', sans_emploi: 'Sans emploi actuellement',
  },
  co_statut_emploi: {
    salarie: 'Salarié·e (T4)', travailleur_autonome: 'Travailleur·e autonome',
    commission: 'À commission', contractuel: 'Contractuel·le', sans_emploi: 'Sans emploi actuellement',
  },
  anciennete: {
    moins_6mois: 'Moins de 6 mois', '6mois_1an': '6 mois à 1 an', '1a_2ans': '1 à 2 ans',
    '2a_5ans': '2 à 5 ans', '5ans_plus': 'Plus de 5 ans', travailleur_autonome: 'Travailleur autonome',
  },
  auto_evaluation_credit: {
    excellent: 'Excellent', bon: 'Bon', a_reconstruire: 'À reconstruire', ne_sais_pas: 'Je ne sais pas',
  },
  faillite_passee: { non: 'Non', oui_liberee: 'Oui — libérée', oui_active: 'Oui — en cours' },
  source_fonds: {
    epargne: 'Épargne personnelle', reer_rap: 'REER (RAP)', celiapp: 'CELIAPP', don: "Don d'un proche",
    vente: "Vente d'une propriété actuelle", refinancement: "Refinancement d'une autre propriété",
    heritage: 'Héritage', combinaison: 'Combinaison de plusieurs sources',
  },
  fonds_90jours: { oui: 'Oui', non: 'Non — dépôt récent', partiel: 'En partie seulement' },
  pref_taux: { fixe: 'Taux fixe', variable: 'Taux variable', indecis: 'Indécis' },
  duree_terme: { '1a_3ans': 'Court terme (1 à 3 ans)', '5ans': 'Standard (5 ans)', indecis: 'Indécis' },
  promesse_achat: { oui: 'Oui', non: 'Non — magasine encore' },
  type_propriete: {
    maison: 'Maison unifamiliale', condo: 'Condo / copropriété', plex: 'Plex',
    maison_mobile: 'Maison mobile', terrain: 'Terrain', autre: 'Autre',
  },
  usage_propriete: {
    principale: 'Résidence principale', secondaire: 'Résidence secondaire / chalet', revenus: 'Immeuble à revenus',
  },
  pref_contact: { telephone: 'Téléphone', texto: 'Texto', courriel: 'Courriel', indifferent: 'Peu importe' },
  moment_contact: { jour: 'En journée', soir: 'En soirée', weekend: 'Week-end', flexible: 'Flexible' },
  source: {
    google: 'Recherche Google', facebook: 'Facebook', bouche_oreille: 'Bouche-à-oreille',
    hypotheca: 'Hypotheca', centris: 'Centris', autre_source: 'Autre',
  },
  co_emprunteur: { seul: 'Seul·e', deux: 'À deux' },
  situation_logement: { locataire: 'Locataire', proprietaire: 'Propriétaire', famille: 'Chez la famille / ami' },
  vente_propriete: { oui: 'Oui — achat-vente simultané', non: 'Non — je la conserve' },
  oui_non: { oui: 'Oui', non: 'Non' },
  paiements_anticipes: { oui: 'Oui', peut_etre: 'Peut-être', non: 'Non' },
  personnes_charge: { '0': 'Aucune', '1': '1', '2': '2', '3': '3 ou plus' },
  refi_but: {
    consolidation: 'Consolidation de dettes', renos: 'Rénovations', equite: "Libération d'équité",
    meilleur_taux: 'Meilleur taux ou conditions', autre: 'Autre',
  },
  docs_disponibles: {
    talons_paie: 'Talons de paie', lettre_emploi: "Lettre d'emploi", t4: 'T4 / Relevé 1',
    avis_cotisation: 'Avis de cotisation', aucun: 'Aucun pour le moment',
  },
  types_dettes: {
    cartes_credit: 'Cartes de crédit / marges', pret_auto: 'Prêt ou location auto',
    pret_etudiant: 'Prêt étudiant', pret_personnel: 'Prêt personnel',
    pension_alimentaire: 'Pension alimentaire', hypotheque_autre: 'Hypothèque autre propriété',
    aucune_dette: 'Aucune dette',
  },
};

function label(field: string, value: string): string {
  return escapeHtml(LABELS[field]?.[value] ?? value);
}

function labelList(field: string, values: string[]): string {
  return values.map((v) => label(field, v)).join(', ');
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
  const allowed = await checkRateLimit(clientIp, 'demande');
  if (!allowed) {
    return jsonResponse({ error: 'Trop de demandes. Veuillez réessayer dans une heure.' }, 429);
  }

  const nom = asTrimmedString(payload.nom);
  const courriel = asTrimmedString(payload.courriel);
  const telephone = asTrimmedString(payload.telephone);
  const typeDemande = asTrimmedString(payload.type_demande);
  const consentement = payload.consentement === true;

  if (
    nom.length < 2 ||
    !EMAIL_RE.test(courriel) ||
    telephone.length < 7 ||
    !LABELS.type_demande?.[typeDemande] ||
    !consentement
  ) {
    return jsonResponse({ error: 'Champs invalides ou manquants' }, 400);
  }

  const resendEnv = loadResendEnv();
  const isDev = import.meta.env.DEV;
  if (!resendEnv) {
    if (isDev) {
      console.log('[demande-submit] ⚠️  Mode développement — Resend non configuré. Les courriels sont logués ci-dessous.');
      console.log('[demande-submit] 📩 Notification interne simulée vers :', process.env.RESEND_NOTIFY_EMAIL || '(non défini)');
      console.log('[demande-submit] ✉️  Confirmation client simulée vers :', courriel);
      return jsonResponse({ ok: true, dev: true }, 200);
    }
    console.error('[demande-submit] Variables Resend manquantes.');
    return jsonResponse({ error: 'Service temporairement indisponible' }, 502);
  }
  const { apiKey, fromEmail, notifyEmail } = resendEnv;

  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  const s = (field: string): string => escapeHtml(asTrimmedString(payload[field]));
  const l = (field: string): string => label(field, asTrimmedString(payload[field]));
  const list = (field: string): string => escapeHtml(labelList(field, asStringArray(payload[field])));

  const eNom = escapeHtml(nom);
  const eCourriel = escapeHtml(courriel);

  /* ---------- Notification interne — section par section ---------- */

  const sectionType = renderDataRows([
    ['Type de demande', l('type_demande')],
    ...(typeDemande === 'refinancement'
      ? ([
          ['Solde hypothécaire actuel', s('refi_solde')],
          ['Valeur estimée', s('refi_valeur')],
          ['Prêteur actuel', s('refi_preteur')],
          ["Échéance du terme", s('refi_echeance')],
          ['But du refinancement', list('refi_but')],
        ] as Array<[string, string]>)
      : []),
  ]);

  const sectionIdentite = renderDataRows([
    ['Nom complet', eNom],
    ['Date de naissance', s('naissance')],
    ['Adresse', s('adresse')],
    ['Ville', s('ville')],
    ['Code postal', s('code_postal')],
    ['Depuis plus de 3 ans à cette adresse', label('oui_non', asTrimmedString(payload.adresse_3ans))],
    ['Adresse précédente', s('adresse_precedente')],
    ['Statut de résidence', l('statut_residence')],
    ['État civil', l('etat_civil')],
    ['Téléphone', s('telephone')],
    ['Courriel', `<a href="mailto:${eCourriel}" style="color:#a85f38;">${eCourriel}</a>`],
  ]);

  const coEmprunteur = asTrimmedString(payload.co_emprunteur);
  const sectionCo = coEmprunteur === 'deux'
    ? renderDataRows([
        ['Co-emprunteur', 'Oui'],
        ['Nom du co-emprunteur', s('co_nom')],
        ['Date de naissance', s('co_naissance')],
        ["Statut d'emploi", l('co_statut_emploi')],
        ['Revenu annuel brut', s('co_revenu')],
      ])
    : renderDataRows([['Co-emprunteur', 'Seul·e']]);

  const sectionSituation = renderDataRows([
    ['Situation actuelle', l('situation_logement')],
    ['Loyer / paiement actuel ($/mois)', s('paiement_actuel')],
    ['Vente de la propriété actuelle prévue', l('vente_propriete')],
    ['Premier acheteur', label('oui_non', asTrimmedString(payload.premier_acheteur))],
  ]);

  const sectionEmploi = renderDataRows([
    ['Employeur', s('employeur')],
    ['Titre du poste', s('titre_poste')],
    ["Statut d'emploi", l('statut_emploi')],
    ['Ancienneté', l('anciennete')],
    ['Revenu annuel brut de base', s('revenu_base')],
    ['Bonus / commissions annuels', s('revenu_extra')],
    ['Autres revenus', s('autres_revenus')],
    ['Documents disponibles', list('docs_disponibles')],
  ]);

  const sectionCredit = renderDataRows([
    ['Auto-évaluation du crédit', l('auto_evaluation_credit')],
    ['Faillite ou proposition passée', l('faillite_passee')],
  ]);

  const sectionMise = typeDemande !== 'refinancement'
    ? renderDataRows([
        ['Montant disponible', s('mise_montant')],
        ['Prix de la propriété visée', s('prix_vise')],
        ['Source des fonds', l('source_fonds')],
        ['Fonds depuis 90+ jours', l('fonds_90jours')],
        ['Précisions sur la mise de fonds', s('mise_precisions')],
      ])
    : '';

  const sectionDettes = renderDataRows([
    ['Paiements mensuels de dettes', s('paiement_dettes')],
    ['Types de dettes', list('types_dettes')],
    ['Personnes à charge', l('personnes_charge')],
    ['Consentement enquête de crédit', payload.consentement_credit === true || asTrimmedString(payload.consentement_credit) === 'oui' ? 'Oui' : 'Non'],
  ]);

  const sectionPreferences = renderDataRows([
    ['Taux fixe ou variable', l('pref_taux')],
    ['Durée du terme', l('duree_terme')],
    ['Paiements anticipés prévus', l('paiements_anticipes')],
    ['Vente à court terme envisagée', label('oui_non', asTrimmedString(payload.vente_court_terme))],
  ]);

  const sectionPropriete = renderDataRows([
    ['Promesse d\'achat acceptée', l('promesse_achat')],
    ['Adresse de la propriété visée', s('adresse_propriete')],
    ['Date de possession prévue', s('date_possession')],
    ['Type de propriété', l('type_propriete')],
    ['Usage', l('usage_propriete')],
    ['Frais de copropriété ($/mois)', s('frais_condo')],
    ['Revenus locatifs estimés ($/mois)', s('revenus_locatifs')],
  ]);

  const sectionFinal = renderDataRows([
    ['Préférence de contact', l('pref_contact')],
    ['Meilleur moment', l('moment_contact')],
    ['Comment nous a connu', l('source')],
    ['Message', escapeHtml(asTrimmedString(payload.message)).replace(/\n/g, '<br>')],
  ]);

  function tableBlock(title: string, rows: string): string {
    if (!rows) return '';
    return `<h2 style="font-size:15px;margin:22px 0 8px;color:#a85f38;">${title}</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>`;
  }

  const internalHtml = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Nouvelle demande de financement</h1>
      <p style="margin:0 0 4px;color:#6a5f50;font-size:14px;">${l('type_demande')} — <strong>${eNom}</strong></p>
      ${tableBlock('1. Type de demande', sectionType)}
      ${tableBlock('2. Identité et situation personnelle', sectionIdentite)}
      ${tableBlock('3. Co-emprunteur', sectionCo)}
      ${tableBlock('4. Situation actuelle', sectionSituation)}
      ${tableBlock('5. Emploi et revenus', sectionEmploi)}
      ${tableBlock('6. Crédit', sectionCredit)}
      ${tableBlock('7. Mise de fonds', sectionMise)}
      ${tableBlock('8. Dettes et obligations', sectionDettes)}
      ${tableBlock('9. Préférences de financement', sectionPreferences)}
      ${tableBlock('10. Propriété visée', sectionPropriete)}
      ${tableBlock('Contact et source', sectionFinal)}
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">Répondez directement à ce courriel pour écrire à ${eNom}.</p>
  `);

  /* ---------- Confirmation client — générique, aucune donnée sensible répétée ---------- */

  const clientHtml = wrapEmailHtml(`
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${eNom} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'ai bien reçu votre demande de financement. Merci de la confiance que vous m'accordez — je sais que remplir un formulaire aussi complet demande du temps.
        </p>
        <h2 style="font-size:16px;margin:24px 0 8px;color:#a85f38;">Ce qui suit</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          J'analyse votre dossier et je vous contacte personnellement dans les meilleurs délais pour discuter des prochaines étapes et des documents à réunir (talons de paie, avis de cotisation, relevés bancaires, etc.).
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
        subject: `Nouvelle demande — ${label('type_demande', typeDemande)} — ${nom}`,
        html: internalHtml,
        reply_to: courriel,
      }),
      sendEmail(apiKey, {
        from: fromEmail,
        to: courriel,
        subject: `Votre demande de financement est bien reçue — ${prenomCourtiere} Weyman`,
        html: clientHtml,
        reply_to: notifyEmail,
      }),
    ]);
  } catch (err) {
    console.error('[demande-submit] Échec d\'envoi Resend:', err);
    return jsonResponse({ error: "L'envoi a échoué. Veuillez réessayer." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
