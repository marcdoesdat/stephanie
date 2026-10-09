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
import type { CertificatJoint } from './certificatSignaturePdf';

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

/**
 * Un certificat manquant se dit : sans cette ligne, son absence passerait pour un oubli du
 * système de messagerie. La trace reste entière dans ce courriel.
 */
function alerteCertificat(certificat: CertificatJoint | null): string {
  if (certificat) return '';
  return `<p style="margin:0 0 4px;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.55;background:#fbeae3;border:1px solid #a85f38;color:#a85f38;">
    Le certificat de signature (PDF) n’a pas pu être produit. La trace de preuve ci-dessous
    reste complète : conservez ce courriel.
  </p>`;
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
  /** Le journal d'audit en PDF, joint au courriel interne ; `null` s'il n'a pu être produit. */
  readonly certificat: CertificatJoint | null;
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
           Toutes les signatures ont été recueillies. Le contrat estampé est en pièce jointe${
             envoi.certificat ? ', avec son certificat de signature (journal d’audit)' : ''
           }.
         </p>
         ${alerteCertificat(envoi.certificat)}
         ${sectionContrat(envoi.donnees)}
         ${sectionPreuves(envoi.preuves)}
         ${bloc(
           'Document',
           renderDataRows([
             ['Nom du fichier', escapeHtml(envoi.nomFichier)],
             ['Empreinte SHA-256 du PDF', escapeHtml(envoi.empreintePdf)],
             ...(envoi.certificat
               ? [['Certificat de signature', escapeHtml(envoi.certificat.nomFichier)] as [string, string]]
               : []),
           ]),
         )}
         <p style="margin:20px 0 0;color:#6b6257;font-size:12px;">
           Conservez ce courriel : il constitue la trace de preuve des signatures. Les
           empreintes permettent de démontrer, plus tard, qu'un document présenté est bien
           celui qui a été signé.
         </p>`,
      ),
      attachments: [
        toResendAttachment(envoi.nomFichier, envoi.pdfBase64),
        ...(envoi.certificat ? [toResendAttachment(envoi.certificat.nomFichier, envoi.certificat.pdfBase64)] : []),
      ],
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

/** Ce qui a changé, en liste — dans les courriels qui suivent une correction. */
function blocCorrection(changements: readonly string[]): string {
  if (changements.length === 0) return '';
  return `<p style="margin:0 0 6px;font-size:14px;">Ce qui a changé :</p>
           <ul style="margin:0 0 14px;padding-left:20px;font-size:14px;">
             ${changements.map((c) => `<li style="margin:0 0 4px;">${escapeHtml(c)}</li>`).join('')}
           </ul>`;
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
 * Envoie à **un** emprunteur son lien de signature nominatif — celui dont c'est le tour.
 *
 * Un seul contrat circule, signé en séquence : les autres recevront le leur quand celui-ci
 * aura signé. Le lien porte le jeton en clair et ne doit jamais apparaître ailleurs (ni dans
 * les logs, ni dans la notification interne, ni dans une réponse HTTP destinée à un tiers).
 *
 * @param rang  Position du signataire dans la file (1 = premier), pour le lui dire.
 * @param total Nombre d'emprunteurs au contrat.
 * @param correction Ce que la courtière vient de corriger, quand l'invitation suit une
 *   correction : le signataire qui a déjà lu (ou signé) l'ancien texte doit savoir pourquoi
 *   on lui redemande de signer, et quoi relire.
 */
export async function envoyerInvitation(
  env: ResendEnv,
  invitation: InvitationCourriel,
  rang: number,
  total: number,
  correction?: { readonly changements: readonly string[]; readonly aSigne: boolean },
): Promise<void> {
  const config = loadSiteConfig();
  const suite =
    total > 1
      ? rang === 1
        ? `Vous signez en premier ; ${total === 2 ? 'l’autre emprunteur recevra' : 'les autres emprunteurs recevront'} le lien ensuite.`
        : `Les signataires précédents ont signé — le contrat porte déjà leur signature.`
      : '';

  const entete = correction
    ? `<h1 style="font-size:19px;margin:0 0 6px;">Votre contrat a été corrigé</h1>
           <p style="margin:0 0 14px;font-size:14px;">Bonjour ${escapeHtml(invitation.nom)},</p>
           <p style="margin:0 0 14px;font-size:14px;">
             ${escapeHtml(config.nom)} a corrigé votre contrat de courtage hypothécaire.
             ${
               correction.aSigne
                 ? 'Votre signature précédente portait sur l’ancien texte : elle a été écartée, et il faut signer le contrat corrigé.'
                 : 'Le lien reçu précédemment ne fonctionne plus ; celui-ci le remplace.'
             }
           </p>
           ${blocCorrection(correction.changements)}`
    : `<h1 style="font-size:19px;margin:0 0 6px;">Votre contrat est prêt à signer</h1>
           <p style="margin:0 0 14px;font-size:14px;">Bonjour ${escapeHtml(invitation.nom)},</p>
           <p style="margin:0 0 14px;font-size:14px;">
             ${escapeHtml(config.nom)} a préparé votre contrat de courtage hypothécaire.
             Le lien ci-dessous vous permet de le relire en entier, de répondre à deux
             questions qui vous concernent, puis de le signer.
           </p>`;

  await envoyerEnSerie([
    () =>
      sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: invitation.courriel,
        subject: correction
          ? correction.aSigne
            ? 'Votre contrat de courtage a été corrigé — à signer de nouveau'
            : 'Votre contrat de courtage a été corrigé — nouveau lien de signature'
          : 'Votre contrat de courtage hypothécaire à signer',
        reply_to: config.courriel,
        html: wrapEmailHtml(
          `${entete}
           ${suite ? `<p style="margin:0 0 14px;font-size:14px;">${escapeHtml(suite)}</p>` : ''}
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
  ]);
}

/* ------------------------------------------------------------------ */
/*  Avis internes                                                      */
/* ------------------------------------------------------------------ */

/** Prévient la courtière qu'un contrat est parti en signature et qui reste à signer. */
export async function envoyerAvisEnAttente(
  env: ResendEnv,
  donnees: DonneesContrat,
  ordre: ReadonlyArray<{ nom: string; courriel: string }>,
  mode: 'distance' | 'presence' = 'distance',
  correction?: { readonly changements: readonly string[]; readonly signaturesEcartees: readonly string[] },
): Promise<void> {
  await sendEmail(env.apiKey, {
    from: env.fromEmail,
    to: env.notifyEmail,
    subject: correction
      ? `Contrat de courtage corrigé — de nouveau en signature`
      : `Contrat de courtage en signature — ${ordre.length} signataire${ordre.length > 1 ? 's' : ''}`,
    html: wrapEmailHtml(
      `<h1 style="font-size:19px;margin:0 0 6px;">${correction ? 'Contrat corrigé, de nouveau en signature' : 'Contrat envoyé en signature'}</h1>
       ${
         correction
           ? `${blocCorrection(correction.changements)}
       <p style="margin:0 0 14px;font-size:14px;">${
         correction.signaturesEcartees.length > 0
           ? `Signatures écartées (portaient sur l’ancien texte) : ${escapeHtml(correction.signaturesEcartees.join(', '))}.`
           : 'Aucune signature n’avait encore été recueillie.'
       }</p>`
           : ''
       }
       <p style="margin:0 0 18px;color:#6b6257;font-size:14px;">
         ${
           mode === 'presence'
             ? 'Le contrat est prêt. Tendez l’appareil au premier signataire ; les suivants passeront à leur tour, dans l’ordre ci-dessous.'
             : 'Le contrat est parti au premier signataire. Chacun recevra son lien quand le précédent aura signé.'
         }
         Vous signerez en dernier, quand ils auront tous répondu.
       </p>
       ${sectionContrat(donnees)}
       ${bloc(
         'Ordre de signature',
         renderDataRows(
           ordre.map((i, rang) => [`${rang + 1}. ${escapeHtml(i.nom)}`, escapeHtml(i.courriel)]),
         ),
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

/**
 * Prévient les emprunteurs qu'un contrat en cours vient d'être annulé par la courtière —
 * ceux que `destinatairesAnnulation` retient, jamais les suivants. Leur lien ne fonctionne plus : un courriel qui ne dit rien laisserait chacun cliquer sur
 * un lien mort et croire à une panne. Envoyé en série, comme le reste.
 */
export async function envoyerAnnulation(
  env: ResendEnv,
  destinataires: ReadonlyArray<{ nom: string; courriel: string; aSigne: boolean }>,
): Promise<void> {
  const config = loadSiteConfig();

  await envoyerEnSerie(
    destinataires.map((destinataire) => async () => {
      await sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: destinataire.courriel,
        subject: 'Votre contrat de courtage a été annulé',
        html: wrapEmailHtml(
          `<h1 style="font-size:19px;margin:0 0 6px;">Contrat annulé</h1>
           <p style="margin:0 0 14px;font-size:14px;">
             Bonjour ${escapeHtml(destinataire.nom)}, le contrat de courtage préparé par
             ${escapeHtml(config.nom)} a été annulé. ${
               destinataire.aSigne
                 ? 'Votre signature ne sera pas utilisée : aucun contrat ne sera produit à partir de ce dossier.'
                 : 'Le lien de signature que vous avez reçu ne fonctionne plus, et aucun contrat ne sera produit à partir de ce dossier.'
             }
           </p>
           <p style="margin:0;font-size:14px;">
             Si vous avez une question, écrivez à
             <a href="mailto:${escapeHtml(config.courriel)}" style="color:#a85f38;">${escapeHtml(config.courriel)}</a>
             ou appelez le ${escapeHtml(config.telephone)}.
           </p>`,
        ),
      });
    }),
  );
}

/**
 * Prévient les emprunteurs déjà atteints — sauf le premier signataire, qui reçoit sa
 * nouvelle invitation — que le contrat a été corrigé. Celui qui a signé doit apprendre que
 * sa signature a été écartée et qu'un nouveau lien lui viendra à son tour ; celui qui
 * attendait avec un lien en main, que ce lien ne fonctionne plus. Sans ce courriel, l'un
 * croirait avoir fini, l'autre cliquerait sur un lien mort.
 */
export async function envoyerAvisCorrection(
  env: ResendEnv,
  destinataires: ReadonlyArray<{ nom: string; courriel: string; aSigne: boolean }>,
  changements: readonly string[],
): Promise<void> {
  const config = loadSiteConfig();

  await envoyerEnSerie(
    destinataires.map((destinataire) => async () => {
      await sendEmail(env.apiKey, {
        from: env.fromEmail,
        to: destinataire.courriel,
        subject: 'Votre contrat de courtage a été corrigé',
        reply_to: config.courriel,
        html: wrapEmailHtml(
          `<h1 style="font-size:19px;margin:0 0 6px;">Votre contrat a été corrigé</h1>
           <p style="margin:0 0 14px;font-size:14px;">
             Bonjour ${escapeHtml(destinataire.nom)}, ${escapeHtml(config.nom)} a corrigé le
             contrat de courtage hypothécaire. ${
               destinataire.aSigne
                 ? 'Votre signature portait sur l’ancien texte : elle a été écartée.'
                 : 'Le lien de signature que vous avez reçu ne fonctionne plus.'
             }
             Vous recevrez un nouveau lien pour relire et signer le contrat corrigé dès que
             votre tour viendra.
           </p>
           ${blocCorrection(changements)}
           <p style="margin:0;font-size:14px;">
             Si vous avez une question, écrivez à
             <a href="mailto:${escapeHtml(config.courriel)}" style="color:#a85f38;">${escapeHtml(config.courriel)}</a>
             ou appelez le ${escapeHtml(config.telephone)}.
           </p>`,
        ),
      });
    }),
  );
}
