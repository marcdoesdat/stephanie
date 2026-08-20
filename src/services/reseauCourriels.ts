/**
 * Courriels d'approche du réseau de partenaires — `/api/reseau-envoi`.
 *
 * Trois exigences se rencontrent ici, et aucune n'est négociable :
 *
 * 1. **La réponse doit atterrir dans sa vraie boîte.** Le message part du domaine du site,
 *    mais `reply_to` pointe sur son adresse Hypotheca. Sans cela, elle rate des réponses —
 *    ce qui est exactement le contraire du but.
 * 2. **La délivrabilité du site ne doit pas être mise en jeu.** De l'approche à froid partie
 *    de la même adresse que les liens de signature et les accusés de rappel finirait par
 *    faire glisser ceux-ci en indésirables. D'où `RESEND_FROM_RESEAU` : un sous-domaine
 *    d'envoi distinct, si configuré. Le repli sur l'adresse commune existe pour ne pas
 *    bloquer l'outil, pas parce que c'est équivalent.
 * 3. **La LCAP.** Tout courriel commercial non sollicité doit identifier son expéditeur
 *    (nom, organisation, adresse postale, moyen de contact) et offrir un retrait qui
 *    fonctionne. Le pied de page ci-dessous n'est donc pas décoratif : il est la condition
 *    de légalité de l'envoi, et `piedConformite` est appelé pour **chaque** message.
 *
 * @module reseauCourriels
 */

import { loadSiteConfig } from '../config';
import { escapeHtml, sendEmail, wrapEmailHtml, type ResendEnv } from './emailService';
import type { MessageSortant } from '../utils/reseauCourtiers';
import type { Contact } from './reseauContactService';

/** Accepte « adresse@domaine.ca » comme « Nom <adresse@domaine.ca> ». */
function adressePlausible(valeur: string): boolean {
  const debut = valeur.indexOf('<');
  const fin = valeur.indexOf('>');
  const adresse = debut >= 0 && fin > debut ? valeur.slice(debut + 1, fin) : valeur;
  return /^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(adresse.trim());
}

/**
 * L'adresse dédiée aux approches, si elle est configurée **et** utilisable.
 *
 * Une valeur mal formée (une coquille dans Netlify, un domaine oublié) retombe sur
 * l'adresse commune plutôt que de faire échouer chaque envoi sur un 4xx de Resend — mais
 * elle est signalée en console, et `/reseau` affiche alors l'avertissement « adresse
 * commune » : la coquille se voit à l'écran plutôt que de passer pour une configuration
 * réussie.
 */
export function adresseDediee(): string | null {
  const brut = process.env.RESEND_FROM_RESEAU?.trim();
  if (!brut) return null;
  if (!adressePlausible(brut)) {
    console.warn(`[reseauCourriels] RESEND_FROM_RESEAU illisible (« ${brut} ») — repli sur l'adresse commune.`);
    return null;
  }
  return brut;
}

/**
 * L'expéditeur des courriels d'approche. `RESEND_FROM_RESEAU` si elle est configurée dans
 * Netlify (sous-domaine dédié), sinon l'adresse d'envoi commune du site.
 */
export function expediteurReseau(env: ResendEnv): string {
  const adresse = adresseDediee() ?? env.fromEmail;
  // Resend accepte « Nom <adresse> » ; si la variable porte déjà un nom, on n'y touche pas.
  if (adresse.includes('<')) return adresse;
  return `${loadSiteConfig().nom} <${adresse}>`;
}

/** Le texte saisi, rendu en paragraphes. Les retours simples deviennent des sauts de ligne. */
function paragraphes(corps: string): string {
  return corps
    .split(/\n{2,}/)
    .map((bloc) => bloc.trim())
    .filter(Boolean)
    .map(
      (bloc) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#222222;">${escapeHtml(bloc).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n');
}

/**
 * Le pied de conformité : qui écrit, depuis quelle adresse postale, et comment faire cesser.
 * Le lien de retrait est écrit en toutes lettres plutôt que caché derrière un mot : un
 * désabonnement qu'il faut chercher n'en est pas un.
 */
export function piedConformite(lienDeRetrait: string): string {
  const config = loadSiteConfig();
  return `<div style="border-top:1px solid #dddddd;margin-top:22px;padding-top:12px;font-size:11px;line-height:1.5;color:#777777;">
      <p style="margin:0 0 6px;">
        Vous recevez ce message à votre adresse professionnelle parce que nos clientèles se
        croisent. ${escapeHtml(config.nom)}, ${escapeHtml(config.titre)} — ${escapeHtml(config.organisation)},
        ${escapeHtml(config.adresse)}. Téléphone&nbsp;: ${escapeHtml(config.telephone)}.
      </p>
      <p style="margin:0;">
        Pour ne plus jamais recevoir de courriel de ma part&nbsp;:
        <a href="${escapeHtml(lienDeRetrait)}" style="color:#777777;">me retirer de la liste</a>.
        Le retrait est immédiat.
      </p>
    </div>`;
}

/**
 * La signature, écrite comme on la taperait dans Outlook.
 *
 * `renderSignatureBlock()` du service commun est délibérément écartée : elle habille la
 * signature aux couleurs du site, ce qui a du sens sous un accusé de réception, et aucun
 * sous un courriel censé venir d'une personne. Le contenu, lui, est le même — c'est son
 * identité professionnelle et son numéro de certificat, pas de la décoration.
 */
function signaturePersonnelle(): string {
  const config = loadSiteConfig();
  const hote = config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<p style="margin:22px 0 0;font-size:14px;line-height:1.5;color:#222222;">
      ${escapeHtml(config.nom)}<br>
      ${escapeHtml(config.titre)} — ${escapeHtml(config.organisation)}<br>
      N&deg; de certificat AMF&nbsp;: ${escapeHtml(config.amf)}<br>
      ${escapeHtml(config.telephone)}<br>
      <a href="${escapeHtml(config.site_url)}" style="color:#1155cc;">${escapeHtml(hote)}</a>
    </p>`;
}

/** La version texte du message — même contenu, mêmes mentions obligatoires. */
function versionTexte(message: MessageSortant, lienDeRetrait: string): string {
  const config = loadSiteConfig();
  return [
    message.corps,
    '',
    `${config.nom}`,
    `${config.titre} — ${config.organisation}`,
    `N° de certificat AMF : ${config.amf}`,
    `${config.telephone} · ${config.courriel}`,
    config.site_url,
    '',
    '—',
    `Vous recevez ce message à votre adresse professionnelle. ${config.nom}, ${config.organisation}, ${config.adresse}.`,
    `Pour ne plus recevoir de courriel de ma part : ${lienDeRetrait}`,
  ].join('\n');
}

/**
 * L'enveloppe HTML — délibérément nue.
 *
 * Les autres courriels du site passent par `wrapEmailHtml` : fond sable, colonne centrée,
 * carte blanche à bordure. C'est le bon habillage pour un accusé de réception, qui **est**
 * un envoi automatique et gagne à en avoir l'air.
 *
 * Ici, c'est l'inverse. Une approche est un message d'une personne à une autre ; habillée en
 * infolettre, elle est lue comme une infolettre — c'est-à-dire supprimée, et parfois marquée
 * comme pourriel. Or le taux de plainte est précisément la variable qui compte, puisque ces
 * courriels partent (faute de sous-domaine dédié) de l'adresse qui porte aussi les liens de
 * signature. Le gabarit visuel du site est donc un luxe qu'on ne peut pas se payer.
 */
function enveloppePersonnelle(contenu: string): string {
  return `<!doctype html><html lang="fr-CA"><body style="margin:0;padding:0;background:#ffffff;">
    <div style="max-width:34em;padding:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#222222;">
      ${contenu}
    </div></body></html>`;
}

export function construireCourrielApproche(
  message: MessageSortant,
  lienDeRetrait: string,
): { html: string; texte: string } {
  const html = enveloppePersonnelle(
    `${paragraphes(message.corps)}
      ${signaturePersonnelle()}
      ${piedConformite(lienDeRetrait)}`,
  );
  return { html, texte: versionTexte(message, lienDeRetrait) };
}

/**
 * Envoie l'approche au contact, avec copie invisible dans la boîte de la courtière.
 *
 * La copie n'est pas un luxe : le carnet garde le texte, mais c'est dans son fil de
 * courriels qu'elle retrouvera la conversation quand le contact répondra.
 */
export async function envoyerApproche(
  env: ResendEnv,
  contact: Contact,
  message: MessageSortant,
  lienDeRetrait: string,
): Promise<void> {
  const config = loadSiteConfig();
  const { html, texte } = construireCourrielApproche(message, lienDeRetrait);

  await sendEmail(env.apiKey, {
    from: expediteurReseau(env),
    to: contact.courriel,
    bcc: env.notifyEmail,
    reply_to: config.courriel,
    subject: message.objet,
    html,
    text: texte,
    headers: {
      // Le bouton « Se désabonner » du client de messagerie, en plus du lien dans le corps.
      //
      // L'URL passe **avant** le `mailto:` : listé en premier, le mailto amenait Gmail et
      // Outlook à n'offrir qu'un courriel à écrire à la main — donc un retrait que rien
      // n'exécute tant que Stéphanie ne l'a pas lu. Un mécanisme qui attend une intervention
      // humaine n'est pas « sans délai » au sens de la LCAP.
      'List-Unsubscribe': `<${lienDeRetrait}>, <mailto:${config.courriel}?subject=Desabonnement>`,
      // Le retrait en un clic (RFC 8058). La crainte qui l'avait fait écarter — les aperçus
      // automatiques des messageries produisant des désabonnements fantômes — est
      // précisément ce contre quoi la RFC a été écrite : un antivirus ou un aperçu **visite**
      // le lien (GET), il ne poste pas `List-Unsubscribe=One-Click`. Le GET, lui, rend
      // toujours la page de confirmation et ne retire personne.
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Le rattrapage : un retrait qui n'a pas abouti                      */
/* ------------------------------------------------------------------ */

export interface RetraitEnEchec {
  /** L'identifiant tel qu'il est arrivé — abîmé ou non, c'est la seule piste. */
  readonly identifiant: string;
  /** Le jeton n'est pas reproduit ici : savoir s'il était là suffit à trancher la cause. */
  readonly jetonPresent: boolean;
  readonly verdict: string;
  readonly cause: string | null;
  readonly url: string;
  readonly ip: string;
  readonly recuLe: string;
}

/**
 * Prévient la courtière qu'un retrait n'a **pas** été enregistré.
 *
 * La page dit « c'est fait » à la personne dans tous les cas, et c'est la bonne réponse à lui
 * faire : distinguer les cas ferait du lien un moyen de tester des identifiants, et « lien
 * invalide » est la pire chose à lire quand on vient de demander qu'on cesse de vous écrire.
 * Mais cette promesse crée une dette — quelqu'un doit la tenir. C'est ce courriel : il porte
 * de quoi retrouver la fiche et la retirer à la main.
 *
 * Il part vers la boîte interne, jamais vers la personne.
 */
export async function alerterRetraitNonEnregistre(
  env: ResendEnv,
  echec: RetraitEnEchec,
): Promise<void> {
  const config = loadSiteConfig();
  const lignes: Array<[string, string]> = [
    ['Reçu le', echec.recuLe],
    ['Identifiant du contact', echec.identifiant || '(absent)'],
    ['Jeton fourni', echec.jetonPresent ? 'oui' : 'non'],
    ['Verdict', echec.verdict],
    ['Cause technique', echec.cause ?? '—'],
    ['Lien appelé', echec.url],
    ['Adresse IP', echec.ip || '—'],
  ];

  const html = wrapEmailHtml(
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f1e1c;">
        <strong>Un désabonnement n’a pas été enregistré.</strong>
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1f1e1c;">
        La personne a vu la page « c’est fait » — c’est ce qu’il fallait lui répondre. Mais sa
        fiche est <strong>toujours active</strong> dans le carnet du réseau. Retrouvez-la sur
        <a href="${escapeHtml(config.site_url)}/reseau" style="color:#a85f38;">/reseau</a> et
        passez-la à « Ne plus contacter ». Tant que ce n’est pas fait, elle peut recevoir un
        autre courriel.
      </p>
      <table style="border-collapse:collapse;font-size:13px;color:#1f1e1c;">
        ${lignes
          .map(
            ([cle, valeur]) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#6b6459;">${escapeHtml(cle)}</td><td style="padding:4px 0;">${escapeHtml(valeur)}</td></tr>`,
          )
          .join('')}
      </table>`,
  );

  await sendEmail(env.apiKey, {
    from: `${config.nom} <${env.fromEmail}>`,
    to: env.notifyEmail,
    subject: '⚠️ Désabonnement non enregistré — fiche à retirer à la main',
    html,
    text: [
      'Un désabonnement n’a pas été enregistré.',
      '',
      'La personne a vu la page « c’est fait », mais sa fiche est toujours active dans le',
      'carnet du réseau. Passez-la à « Ne plus contacter » sur /reseau.',
      '',
      ...lignes.map(([cle, valeur]) => `${cle} : ${valeur}`),
    ].join('\n'),
  });
}
