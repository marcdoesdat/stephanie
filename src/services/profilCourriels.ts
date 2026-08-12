/**
 * Courriels du formulaire « Profil des emprunteurs ».
 *
 * Partagés par /api/profil-submit et /api/profil-cosigner : les deux endpoints peuvent
 * clore un dossier (le premier quand tout le monde signe sur place, le second quand le
 * dernier co-signataire signe à distance), et doivent alors envoyer exactement les mêmes
 * courriels.
 *
 * La **trace de preuve** vit ici et nulle part ailleurs : horodatage serveur, IP,
 * navigateur, voie de signature et empreintes SHA-256. Elle n'est jamais écrite dans le
 * PDF — le document doit rester identique au modèle d'Hypotheca.
 *
 * @module profilCourriels
 */

import {
  escapeHtml,
  renderDataRows,
  renderSignatureBlock,
  sendEmail,
  toResendAttachment,
  wrapEmailHtml,
  type ResendEnv,
} from './emailService';
import { loadSiteConfig } from '../config';
import { TEXTE_ATTESTATION, resumerReponses, type ReponsesProfil } from '../utils/profilEmprunteurs';

/** Ce qu'on peut démontrer a posteriori sur une signature donnée. */
export interface PreuveSignature {
  readonly nom: string;
  readonly courriel: string;
  readonly signeLe: string;
  readonly voie: 'presence' | 'distance';
  readonly ip: string;
  readonly agent: string;
  readonly empreinteTrace: string;
}

/**
 * Resend limite le débit à quelques requêtes par seconde. Ce formulaire est le seul du site
 * à envoyer plus de deux courriels d'un coup — jusqu'à quatre avec trois signataires. Les
 * lancer en parallèle déclenche un 429, qui fait échouer toute la soumission. On les espace
 * donc, quitte à prendre deux secondes de plus.
 */
async function envoyerEnSerie(envois: ReadonlyArray<() => Promise<void>>): Promise<void> {
  for (const [index, envoi] of envois.entries()) {
    if (index > 0) await new Promise((resoudre) => setTimeout(resoudre, 600));
    await envoi();
  }
}

function bloc(titre: string, lignes: string): string {
  if (!lignes) return '';
  return `<h2 style="font-size:15px;margin:22px 0 8px;color:#a85f38;">${titre}</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e3d9cc;border-radius:8px;overflow:hidden;">
        ${lignes}
      </table>`;
}

const LIBELLE_VOIE: Record<PreuveSignature['voie'], string> = {
  presence: 'En présence (même appareil)',
  distance: 'À distance (lien nominatif à usage unique)',
};

/** Nom de fichier lisible et sans surprise : profil-emprunteurs-marc-andre-lacroix-2026-08-11.pdf */
export function nomFichierProfil(nomPrincipal: string, date: Date): string {
  const glissant = nomPrincipal
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `profil-emprunteurs-${glissant || 'client'}-${date.toISOString().slice(0, 10)}.pdf`;
}

function sectionReponses(reponses: ReponsesProfil): string {
  return bloc(
    'Réponses au formulaire',
    renderDataRows(resumerReponses(reponses).map(([intitule, valeur]) => [escapeHtml(intitule), escapeHtml(valeur)])),
  );
}

function sectionPreuves(preuves: readonly PreuveSignature[]): string {
  return preuves
    .map((preuve, index) =>
      bloc(
        `Signature ${index + 1} — ${escapeHtml(preuve.nom)}`,
        renderDataRows([
          ['Courriel', escapeHtml(preuve.courriel)],
          ['Signé le', escapeHtml(new Date(preuve.signeLe).toLocaleString('fr-CA', { timeZone: 'America/Toronto' }))],
          ['Horodatage UTC', escapeHtml(preuve.signeLe)],
          ['Voie', escapeHtml(LIBELLE_VOIE[preuve.voie])],
          ['Adresse IP', escapeHtml(preuve.ip)],
          ['Navigateur', escapeHtml(preuve.agent.slice(0, 200))],
          ['Attestation cochée', escapeHtml(TEXTE_ATTESTATION)],
          ['Empreinte du tracé (SHA-256)', `<code style="font-size:11px;">${escapeHtml(preuve.empreinteTrace)}</code>`],
        ]),
      ),
    )
    .join('\n');
}

/* ------------------------------------------------------------------ */
/*  Dossier complet — PDF à la courtière, confirmation aux signataires  */
/* ------------------------------------------------------------------ */

export interface EnvoiComplet {
  readonly reponses: ReponsesProfil;
  readonly preuves: readonly PreuveSignature[];
  readonly pdfBase64: string;
  readonly empreintePdf: string;
  readonly nomFichier: string;
}

/**
 * Le PDF signé ne part **qu'à la courtière**. Les signataires reçoivent une confirmation
 * sans pièce jointe : le document est une pièce de dossier, il circule par le canal de la
 * courtière et non par une boîte courriel de client. Ne pas y rattacher `piece`.
 */
export async function envoyerDossierComplet(env: ResendEnv, envoi: EnvoiComplet): Promise<void> {
  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];
  const principal = envoi.preuves[0];
  const noms = envoi.preuves.map((p) => p.nom).join(', ');
  const piece = toResendAttachment(envoi.nomFichier, envoi.pdfBase64);

  const interne = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Profil des emprunteurs signé</h1>
      <p style="margin:0 0 12px;color:#6a5f50;font-size:14px;">
        <strong>${escapeHtml(noms)}</strong> · ${envoi.preuves.length} signataire${envoi.preuves.length > 1 ? 's' : ''}
      </p>
      <p style="margin:0 0 4px;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.55;background:#f0f7f1;border:1px solid #c5dac8;color:#2d5a3a;">
        Le formulaire rempli et signé est en pièce jointe (<strong>${escapeHtml(envoi.nomFichier)}</strong>).
        Vous êtes seule à le recevoir : les signataires n'ont eu qu'un accusé de signature, sans le document.
      </p>
      ${sectionReponses(envoi.reponses)}
      ${sectionPreuves(envoi.preuves)}
      ${bloc('Document', renderDataRows([['Empreinte du PDF (SHA-256)', `<code style="font-size:11px;">${escapeHtml(envoi.empreintePdf)}</code>`]]))}
      <p style="margin:20px 0 0;font-size:12px;color:#6a5f50;">
        Conservez ce courriel : c'est lui qui porte la trace de signature. Le PDF, lui, est
        strictement identique au modèle d'Hypotheca — aucune mention technique n'y a été ajoutée.
      </p>
  `);

  const envois: Array<() => Promise<void>> = [
    () =>
      sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: env.notifyEmail,
        subject: `Profil des emprunteurs signé — ${principal?.nom ?? 'client'}`,
        html: interne,
        attachments: [piece],
        ...(principal ? { reply_to: principal.courriel } : {}),
      }),
  ];

  for (const preuve of envoi.preuves) {
    const client = wrapEmailHtml(
      `
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Merci, ${escapeHtml(preuve.nom.split(' ')[0] ?? preuve.nom)} 🌿</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Votre profil d'emprunteur est signé et m'a été transmis. Je le conserve à votre
          dossier&nbsp;; demandez-le-moi quand vous voulez et je vous en envoie une copie.
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Ce profil me sert à vous recommander le produit hypothécaire qui correspond vraiment à
          vos objectifs, et pas seulement au taux le plus bas de la semaine.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Une question d'ici notre prochain échange&nbsp;? Répondez simplement à ce courriel.
        </p>
        ${renderSignatureBlock()}
      </div>
  `,
      '32px 24px',
    );

    envois.push(() =>
      sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: preuve.courriel,
        subject: `Votre profil d'emprunteur signé — ${prenomCourtiere} Weyman`,
        html: client,
        reply_to: env.notifyEmail,
      }),
    );
  }

  await envoyerEnSerie(envois);
}

/* ------------------------------------------------------------------ */
/*  Dossier incomplet — invitations et accusé                          */
/* ------------------------------------------------------------------ */

export interface InvitationCourriel {
  readonly nom: string;
  readonly courriel: string;
  readonly lien: string;
}

/** Invite chaque co-signataire manquant à ouvrir son lien nominatif. */
export async function envoyerInvitations(
  env: ResendEnv,
  invitations: readonly InvitationCourriel[],
  initiateur: string,
): Promise<void> {
  const config = loadSiteConfig();
  const prenomCourtiere = config.nom.split(' ')[0];

  await envoyerEnSerie(
    invitations.map((invitation) => () => {
      const html = wrapEmailHtml(
        `
      <div style="background:#ffffff;border:1px solid #e3d9cc;border-radius:16px;padding:32px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#1f1e1c;line-height:1.3;">Il ne manque que votre signature</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Bonjour ${escapeHtml(invitation.nom.split(' ')[0] ?? invitation.nom)},<br />
          ${escapeHtml(initiateur)} vient de remplir avec moi le <strong>profil des emprunteurs</strong>,
          le formulaire qui me sert à vous recommander le bon produit hypothécaire.
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1f1e1c;">
          Puisque le prêt est un engagement conjoint et solidaire, les réponses doivent refléter
          votre vision commune. <strong>Prenez le temps de les lire</strong> — si quelque chose ne
          vous convient pas, vous pourrez me le signaler plutôt que de signer.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${escapeHtml(invitation.lien)}" style="display:inline-block;background:#a85f38;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;font-size:15px;">
            Lire et signer
          </a>
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.7;color:#6a5f50;">
          Ce lien vous est personnel, il ne fonctionne qu'une fois et expire dans 14 jours.
          Ne le transférez à personne.
        </p>
        ${renderSignatureBlock()}
      </div>
  `,
        '32px 24px',
      );

      return sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: invitation.courriel,
        subject: `${prenomCourtiere} Weyman — votre signature est requise`,
        html,
        reply_to: env.notifyEmail,
      });
    }),
  );
}

/** Prévient la courtière qu'un dossier attend des signatures, avec les liens pour relancer. */
export async function envoyerAvisEnAttente(
  env: ResendEnv,
  reponses: ReponsesProfil,
  initiateur: PreuveSignature,
  invitations: readonly InvitationCourriel[],
): Promise<void> {
  const attendus = renderDataRows(
    invitations.map((i) => [
      escapeHtml(i.nom),
      `${escapeHtml(i.courriel)}<br /><a href="${escapeHtml(i.lien)}" style="color:#a85f38;font-size:12px;">lien de signature (à renvoyer au besoin)</a>`,
    ]),
  );

  const html = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Profil des emprunteurs — en attente de signature</h1>
      <p style="margin:0 0 12px;color:#6a5f50;font-size:14px;"><strong>${escapeHtml(initiateur.nom)}</strong> a rempli et signé.</p>
      <p style="margin:0 0 4px;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.55;background:#f7f2eb;border:1px solid #e3d9cc;color:#6a5f50;">
        Aucun PDF n'est produit tant que tout le monde n'a pas signé. Vous recevrez le document
        complet automatiquement à la dernière signature.
      </p>
      ${bloc('En attente', attendus)}
      ${sectionReponses(reponses)}
      ${sectionPreuves([initiateur])}
  `);

  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: `Profil en attente de signature — ${initiateur.nom}`,
    html,
    reply_to: initiateur.courriel,
  });
}

/** Prévient la courtière qu'un co-signataire refuse les réponses : le dossier est gelé. */
export async function envoyerAvisDesaccord(
  env: ResendEnv,
  reponses: ReponsesProfil,
  opposant: { nom: string; courriel: string },
  motif: string,
): Promise<void> {
  const html = wrapEmailHtml(`
      <h1 style="font-size:20px;margin:0 0 4px;color:#1f1e1c;">Profil des emprunteurs — désaccord signalé</h1>
      <p style="margin:0 0 4px;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.55;background:#fbeae3;border:1px solid #a85f38;color:#a85f38;">
        <strong>${escapeHtml(opposant.nom)}</strong> ne se reconnaît pas dans les réponses soumises.
        Le dossier est gelé : aucun PDF ne sera produit et les liens de signature ne fonctionnent plus.
        À reprendre avec les emprunteurs.
      </p>
      ${bloc('Ce qui a été signalé', renderDataRows([['Signataire', escapeHtml(opposant.nom)], ['Courriel', escapeHtml(opposant.courriel)], ['Motif', escapeHtml(motif) || '—']]))}
      ${sectionReponses(reponses)}
  `);

  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: `Désaccord sur un profil d'emprunteurs — ${opposant.nom}`,
    html,
    reply_to: opposant.courriel,
  });
}
