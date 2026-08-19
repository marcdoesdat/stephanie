/**
 * Les courriels du portail client — le lien d'accès, et le suivi.
 *
 * Deux messages seulement, et c'est voulu : un portail dont on reçoit des nouvelles à chaque
 * case cochée finit dans le dossier « promotions », et c'est le seul courriel qui comptait
 * vraiment qui s'y perd avec les autres.
 *
 * 1. **Le lien d'accès** — le client l'a demandé lui-même depuis `/mon-dossier`. Il ne dit
 *    rien du dossier : ni étape, ni documents, ni même s'il en existe un. Un courriel de
 *    connexion qui résume le dossier est un courriel qui divulgue le dossier à qui contrôle
 *    la boîte, avant même que le lien ne soit cliqué.
 * 2. **Le suivi** — Stéphanie l'envoie quand il y a matière. Celui-là dit l'étape et ce qui
 *    manque, parce que c'est précisément ce qu'il vient annoncer.
 *
 * Aucun des deux ne porte de pièce jointe : le portail n'héberge pas de documents, et le
 * courriel n'en transporte pas davantage.
 *
 * @module dossierCourriels
 */

import { loadSiteConfig } from '../config';
import {
  escapeHtml,
  renderSignatureBlock,
  sendEmail,
  wrapEmailHtml,
  type ResendEnv,
} from './emailService';
import type { DossierClient } from './dossierClientService';
import { DESTINATAIRES, DOCUMENTS, ETAPES } from '../utils/dossiersClients';

/** L'adresse du portail, jeton compris. Le jeton n'existe en clair que dans le message. */
export function lienPortail(dossierId: string, jeton: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '');
  return `${base}/mon-dossier?d=${encodeURIComponent(dossierId)}&j=${encodeURIComponent(jeton)}`;
}

/** Les pièces encore attendues, nommées comme le client les reconnaîtra. */
export function piecesManquantes(dossier: DossierClient): string[] {
  return dossier.documents
    .filter((ligne) => ligne.etat === 'a_fournir')
    .map((ligne) => {
      const libelle = DOCUMENTS[ligne.cle].libelle;
      return ligne.pourQui === 'dossier'
        ? libelle
        : `${libelle} — ${DESTINATAIRES[ligne.pourQui].toLowerCase()}`;
    });
}

function bouton(lien: string, libelle: string): string {
  return `<p style="margin:24px 0;">
      <a href="${escapeHtml(lien)}" style="display:inline-block;background:#a85f38;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:15px;font-weight:600;">${escapeHtml(libelle)}</a>
    </p>`;
}

/**
 * Le pied qui rappelle la durée de validité. Un lien mort sans explication passe pour une
 * panne du site ; le même lien mort annoncé comme expirable se redemande sans y penser.
 */
function piedLien(minutes: number): string {
  return `<p style="margin:0;font-size:13px;line-height:1.6;color:#6a5f50;">
      Ce lien est valable ${minutes} minutes et ne sert qu’une fois. Passé ce délai, redemandez-en un depuis la page.
      Si vous n’avez rien demandé, ignorez ce message : personne n’a eu accès à quoi que ce soit.
    </p>`;
}

/* ------------------------------------------------------------------ */
/*  1. Le lien d'accès                                                 */
/* ------------------------------------------------------------------ */

export async function envoyerLienAcces(
  env: ResendEnv,
  courriel: string,
  lien: string,
  minutes: number,
): Promise<void> {
  const config = loadSiteConfig();
  const prenom = config.nom.split(' ')[0] ?? config.nom;

  const html = wrapEmailHtml(
    `<div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:20px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Votre lien d’accès</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Voici le lien pour consulter le suivi de votre dossier hypothécaire.
        </p>
        ${bouton(lien, 'Ouvrir mon dossier')}
        ${piedLien(minutes)}
        <div style="margin-top:24px;">${renderSignatureBlock()}</div>
      </div>`,
    '32px 24px',
  );

  const texte = [
    'Votre lien d’accès',
    '',
    'Voici le lien pour consulter le suivi de votre dossier hypothécaire :',
    lien,
    '',
    `Ce lien est valable ${minutes} minutes et ne sert qu’une fois.`,
    'Si vous n’avez rien demandé, ignorez ce message.',
    '',
    `${config.nom} — ${config.titre}, ${config.organisation}`,
    `${config.telephone} · ${config.courriel}`,
  ].join('\n');

  await sendEmail(env.apiKey, {
    from: `${config.nom} <${env.fromEmail}>`,
    to: courriel,
    reply_to: config.courriel,
    subject: `Votre lien d’accès — ${prenom} Weyman`,
    html,
    text: texte,
  });
}

/* ------------------------------------------------------------------ */
/*  2. Le suivi                                                        */
/* ------------------------------------------------------------------ */

export async function envoyerSuivi(env: ResendEnv, dossier: DossierClient, lien: string): Promise<void> {
  const config = loadSiteConfig();
  const prenom = config.nom.split(' ')[0] ?? config.nom;
  const etape = ETAPES[dossier.etape];
  const manquantes = piecesManquantes(dossier);

  const listeHtml = manquantes.length
    ? `<h2 style="font-size:16px;margin:24px 0 8px;color:#a85f38;">Ce qu’il reste à réunir</h2>
       <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.8;color:#1f1e1c;">
         ${manquantes.map((piece) => `<li>${escapeHtml(piece)}</li>`).join('\n')}
       </ul>`
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
         <strong>Tous les documents sont reçus.</strong> Rien à faire de votre côté pour l’instant.
       </p>`;

  const html = wrapEmailHtml(
    `<div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;line-height:1.3;">${escapeHtml(dossier.nom)}, voici où en est votre dossier</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#6a5f50;">${escapeHtml(etape.libelleClient)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">${escapeHtml(etape.explicationClient)}</p>
        ${listeHtml}
        ${bouton(lien, 'Voir mon dossier')}
        ${piedLien(30)}
        <div style="margin-top:24px;">${renderSignatureBlock()}</div>
      </div>`,
    '32px 24px',
  );

  const texte = [
    `${dossier.nom}, voici où en est votre dossier`,
    '',
    etape.libelleClient,
    etape.explicationClient,
    '',
    ...(manquantes.length
      ? ['Ce qu’il reste à réunir :', ...manquantes.map((piece) => `- ${piece}`)]
      : ['Tous les documents sont reçus. Rien à faire de votre côté pour l’instant.']),
    '',
    `Voir mon dossier : ${lien}`,
    'Ce lien est valable 30 minutes et ne sert qu’une fois.',
    '',
    `${config.nom} — ${config.titre}, ${config.organisation}`,
    `${config.telephone} · ${config.courriel}`,
  ].join('\n');

  await sendEmail(env.apiKey, {
    from: `${config.nom} <${env.fromEmail}>`,
    to: dossier.courriel,
    reply_to: config.courriel,
    subject: `Votre dossier hypothécaire — ${prenom} Weyman`,
    html,
    text: texte,
  });
}
