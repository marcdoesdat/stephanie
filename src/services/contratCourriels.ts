/**
 * Courriels du « Contrat de courtage hypothécaire ».
 *
 * Partagés par /api/contrat-creer et /api/contrat-signer : les deux endpoints peuvent clore
 * un dossier (le premier quand tout le monde signe sur place, le second quand le dernier
 * emprunteur signe à distance), et doivent alors envoyer exactement les mêmes courriels.
 *
 * La **trace de preuve** vit ici et nulle part ailleurs : horodatage serveur, IP, navigateur,
 * voie de signature et empreintes SHA-256. Elle n'est jamais écrite dans le PDF — le
 * document doit rester identique au modèle d'Hypotheca.
 *
 * Le contrat signé ne part **qu'à la courtière**. Les emprunteurs reçoivent un accusé de
 * signature sans pièce jointe : c'est Stéphanie qui leur remet le document, comme sur papier.
 *
 * @module contratCourriels
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
import { formatDateHeureLong } from '../utils/formatters';
import {
  TEXTE_ATTESTATION,
  nomComplet,
  resumerContrat,
  resumerReponsesEmprunteur,
  type DonneesContrat,
  type ReponsesEmprunteur,
} from '../utils/contratCourtage';
import type { DossierContrat } from './contratDossierService';

/** Ce qu'on peut démontrer a posteriori sur une signature donnée. */
export interface PreuveSignature {
  readonly nom: string;
  readonly courriel: string;
  readonly signeLe: string;
  readonly voie: 'presence' | 'distance';
  readonly ip: string;
  readonly agent: string;
  readonly empreinteTrace: string;
  /** Ce que l'emprunteur a répondu en signant — PPV, transfert, coordonnées confirmées. */
  readonly reponses: ReponsesEmprunteur | null;
}

/**
 * Resend limite le débit à quelques requêtes par seconde. Ce formulaire peut envoyer
 * jusqu'à quatre courriels d'un coup. Les lancer en parallèle déclenche un 429, qui fait
 * échouer toute la soumission. On les espace donc, quitte à prendre deux secondes de plus.
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

function sectionContrat(donnees: DonneesContrat): string {
  return bloc(
    'Contenu du contrat',
    renderDataRows(resumerContrat(donnees).map(([libelle, valeur]) => [escapeHtml(libelle), escapeHtml(valeur)])),
  );
}

/** La trace de preuve, signataire par signataire. Ne sort jamais vers les emprunteurs. */
function sectionPreuves(preuves: readonly PreuveSignature[]): string {
  return preuves
    .map((preuve) =>
      bloc(
        `Signature — ${escapeHtml(preuve.nom)}`,
        renderDataRows([
          ['Courriel', escapeHtml(preuve.courriel)],
          ['Signé le', escapeHtml(formatDateHeureLong(preuve.signeLe))],
          ['Horodatage serveur (UTC)', escapeHtml(preuve.signeLe)],
          ['Voie', escapeHtml(LIBELLE_VOIE[preuve.voie])],
          ['Adresse IP', escapeHtml(preuve.ip)],
          ['Navigateur', escapeHtml(preuve.agent)],
          ['Empreinte SHA-256 du tracé', escapeHtml(preuve.empreinteTrace)],
          ['Attestation cochée', escapeHtml(TEXTE_ATTESTATION)],
          // Ces réponses sont les siennes, pas celles de la courtière : la preuve doit dire
          // qui a déclaré quoi.
          ...(preuve.reponses
            ? resumerReponsesEmprunteur(preuve.reponses).map(
                ([libelle, valeur]): [string, string] => [escapeHtml(libelle), escapeHtml(valeur)],
              )
            : []),
        ]),
      ),
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/*  Dossier complet — le contrat signé part à la courtière             */
/* ------------------------------------------------------------------ */

export interface EnvoiComplet {
  readonly donnees: DonneesContrat;
  readonly preuves: readonly PreuveSignature[];
  readonly pdfBase64: string;
  readonly empreintePdf: string;
  readonly nomFichier: string;
}

/**
 * Envoie le contrat signé à la courtière, puis un accusé à chaque emprunteur.
 *
 * Seul le courriel interne porte le PDF. L'accusé confirme la signature et rappelle que le
 * document sera transmis par Stéphanie — aucune pièce jointe, aucun lien de téléchargement.
 */
export async function envoyerDossierComplet(env: ResendEnv, envoi: EnvoiComplet): Promise<void> {
  const config = loadSiteConfig();
  const principal = envoi.preuves[0];
  const nomPrincipal = principal ? principal.nom : 'un client';

  const interne = () =>
    sendEmail(env.apiKey, {
      from: env.fromEmail,
      to: env.notifyEmail,
      subject: `Contrat de courtage signé — ${nomPrincipal}`,
      reply_to: principal?.courriel,
      html: wrapEmailHtml(
        `<h1 style="font-size:19px;margin:0 0 6px;">Contrat de courtage signé</h1>
         <p style="margin:0 0 18px;color:#6b6257;font-size:14px;">
           Toutes les signatures ont été recueillies. Le contrat estampé est en pièce jointe.
         </p>
         ${sectionContrat(envoi.donnees)}
         ${sectionPreuves(envoi.preuves)}
         ${bloc(
           'Document',
           renderDataRows([
             ['Nom du fichier', escapeHtml(envoi.nomFichier)],
             ['Empreinte SHA-256 du PDF', escapeHtml(envoi.empreintePdf)],
           ]),
         )}
         <p style="margin:20px 0 0;color:#6b6257;font-size:12px;">
           Conservez ce courriel : il constitue la trace de preuve des signatures. Les
           empreintes permettent de démontrer, plus tard, qu'un document présenté est bien
           celui qui a été signé.
         </p>`,
      ),
      attachments: [toResendAttachment(envoi.nomFichier, envoi.pdfBase64)],
    });

  const accuses = envoi.preuves.map((preuve) => () =>
    sendEmail(env.apiKey, {
      from: env.fromEmail,
      to: preuve.courriel,
      subject: 'Votre contrat de courtage est signé',
      reply_to: config.courriel,
      html: wrapEmailHtml(
        `<h1 style="font-size:19px;margin:0 0 6px;">Merci, votre signature est enregistrée</h1>
         <p style="margin:0 0 14px;font-size:14px;">
           Bonjour ${escapeHtml(preuve.nom)},
         </p>
         <p style="margin:0 0 14px;font-size:14px;">
           Votre contrat de courtage hypothécaire a été signé par toutes les parties le
           ${escapeHtml(formatDateHeureLong(preuve.signeLe))}. ${escapeHtml(config.nom)} vous fera parvenir une
           copie du document signé.
         </p>
         <p style="margin:0 0 14px;font-size:14px;">
           Une question sur ce contrat ? Répondez simplement à ce courriel.
         </p>
         ${renderSignatureBlock()}`,
      ),
    }),
  );

  await envoyerEnSerie([interne, ...accuses]);
}

/* ------------------------------------------------------------------ */
/*  Invitations à signer                                               */
/* ------------------------------------------------------------------ */

export interface InvitationCourriel {
  readonly nom: string;
  readonly courriel: string;
  readonly lien: string;
}

/**
 * Envoie à chaque emprunteur son lien de signature nominatif.
 *
 * Le lien porte le jeton en clair : il ne doit jamais apparaître ailleurs (ni dans les
 * logs, ni dans la notification interne, ni dans une réponse HTTP).
 */
export async function envoyerInvitations(
  env: ResendEnv,
  invitations: readonly InvitationCourriel[],
): Promise<void> {
  const config = loadSiteConfig();

  await envoyerEnSerie(
    invitations.map((invitation) => () =>
      sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: invitation.courriel,
        subject: 'Votre contrat de courtage hypothécaire à signer',
        reply_to: config.courriel,
        html: wrapEmailHtml(
          `<h1 style="font-size:19px;margin:0 0 6px;">Votre contrat est prêt à signer</h1>
           <p style="margin:0 0 14px;font-size:14px;">Bonjour ${escapeHtml(invitation.nom)},</p>
           <p style="margin:0 0 14px;font-size:14px;">
             ${escapeHtml(config.nom)} a préparé votre contrat de courtage hypothécaire.
             Le lien ci-dessous vous permet de le relire en entier, puis de le signer.
           </p>
           <p style="margin:22px 0;">
             <a href="${escapeHtml(invitation.lien)}"
                style="display:inline-block;background:#a85f38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
               Lire et signer mon contrat
             </a>
           </p>
           <p style="margin:0 0 14px;color:#6b6257;font-size:13px;">
             Ce lien vous est personnel, il ne fonctionne qu'une fois et expire dans 10 jours.
             Ne le transférez à personne : chaque emprunteur reçoit le sien.
           </p>
           <p style="margin:0 0 14px;font-size:14px;">
             Si quelque chose ne correspond pas à ce qui a été convenu, ne signez pas —
             l'écran vous permet de le signaler, et je vous rappellerai.
           </p>
           ${renderSignatureBlock()}`,
        ),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Avis internes                                                      */
/* ------------------------------------------------------------------ */

/** Prévient la courtière qu'un contrat est parti en signature et qui reste à signer. */
export async function envoyerAvisEnAttente(
  env: ResendEnv,
  donnees: DonneesContrat,
  enAttente: readonly InvitationCourriel[],
): Promise<void> {
  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: `Contrat de courtage envoyé en signature — ${enAttente.length} en attente`,
    html: wrapEmailHtml(
      `<h1 style="font-size:19px;margin:0 0 6px;">Contrat envoyé en signature</h1>
       <p style="margin:0 0 18px;color:#6b6257;font-size:14px;">
         Le contrat est parti. Chaque emprunteur va le lire, répondre aux questions qui lui
         reviennent et signer. Vous signerez en dernier, quand ils auront tous répondu.
       </p>
       ${sectionContrat(donnees)}
       ${bloc(
         'En attente de signature',
         renderDataRows(enAttente.map((i) => [escapeHtml(i.nom), escapeHtml(i.courriel)])),
       )}`,
    ),
  });
}

/**
 * Prévient la courtière que tous les emprunteurs ont signé et qu'il ne manque que sa
 * signature. C'est le seul courriel qui lui demande une action : le lien mène à l'écran de
 * relecture, derrière son mot de passe.
 */
export async function envoyerAvisAFinaliser(
  env: ResendEnv,
  dossier: DossierContrat,
  lien: string,
): Promise<void> {
  const noms = dossier.emprunteurs.map((e) => nomComplet(e.emprunteur));
  const preuves = dossier.emprunteurs
    .filter((e) => e.signature !== null)
    .map((e) => ({
      nom: nomComplet(e.emprunteur),
      courriel: e.emprunteur.courriel,
      signeLe: e.signature!.signeLe,
      voie: e.signature!.voie,
      ip: e.signature!.ip,
      agent: e.signature!.agent,
      empreinteTrace: e.signature!.empreinteTrace,
      reponses: e.reponses,
    })) satisfies PreuveSignature[];

  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: `À finaliser — ${noms.join(', ')} ont signé`,
    html: wrapEmailHtml(
      `<h1 style="font-size:19px;margin:0 0 6px;">Tout le monde a signé</h1>
       <p style="margin:0 0 14px;font-size:14px;">
         Il ne manque que votre signature. Relisez le contrat — il porte maintenant les
         réponses des emprunteurs — puis signez-le d'un clic.
       </p>
       <p style="margin:22px 0;">
         <a href="${escapeHtml(lien)}"
            style="display:inline-block;background:#a85f38;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
           Relire et signer le contrat
         </a>
       </p>
       <p style="margin:0 0 18px;color:#6b6257;font-size:13px;">
         Le contrat n'est produit qu'à ce moment-là, et vous le recevrez aussitôt. Sans votre
         signature, le dossier expire dans 10 jours et les signatures recueillies sont perdues.
       </p>
       ${sectionContrat(dossier.donnees)}
       ${sectionPreuves(preuves)}`,
    ),
  });
}

/** Prévient la courtière qu'un emprunteur refuse de signer — le dossier est gelé. */
export async function envoyerAvisRefus(
  env: ResendEnv,
  donnees: DonneesContrat,
  refus: { nom: string; courriel: string; motif: string },
): Promise<void> {
  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: `Contrat de courtage refusé — ${refus.nom}`,
    reply_to: refus.courriel,
    html: wrapEmailHtml(
      `<h1 style="font-size:19px;margin:0 0 6px;">Un emprunteur n'a pas signé</h1>
       <p style="margin:0 0 18px;color:#6b6257;font-size:14px;">
         Le dossier est gelé : aucun contrat ne sera produit et les liens restants ne
         fonctionnent plus. Rappelez la personne, puis renvoyez un contrat corrigé.
       </p>
       ${bloc(
         'Refus',
         renderDataRows([
           ['Nom', escapeHtml(refus.nom)],
           ['Courriel', escapeHtml(refus.courriel)],
           ['Motif indiqué', escapeHtml(refus.motif || '—')],
         ]),
       )}
       ${sectionContrat(donnees)}`,
    ),
  });
}
