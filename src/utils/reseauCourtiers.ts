/**
 * Source de vérité du réseau de partenaires — partagée entre `/reseau` et les endpoints
 * `reseau-*`.
 *
 * `/partenaires` est la porte entrante : un professionnel arrive de lui-même et réfère un
 * client. Ce module sert le mouvement inverse — Stéphanie qui approche un professionnel,
 * un par un, et qui se souvient de qui elle a relancé.
 *
 * Comme `contratCourtage.ts`, ce catalogue fait office de **whitelist de validation côté
 * serveur** : une profession, un état ou une base de consentement hors catalogue fait
 * échouer la requête plutôt que de s'écrire en base.
 *
 * ⚠️ Les gabarits sont un **point de départ**, pas le texte final : Stéphanie relit et
 * retouche avant d'envoyer, et c'est le texte réellement expédié qui est journalisé. Un
 * courriel d'approche qu'on ne peut pas retoucher se reconnaît à dix mètres.
 *
 * @module reseauCourtiers
 */

/* ------------------------------------------------------------------ */
/*  Catalogues                                                         */
/* ------------------------------------------------------------------ */

/**
 * Les mêmes clés que `/api/partenaires-submit` : les deux bouts du réseau doivent parler
 * le même vocabulaire, sinon un partenaire entrant et le même contact sortant ne se
 * rejoignent jamais dans les statistiques.
 */
export const PROFESSIONS = {
  'courtier-immobilier': 'Courtier immobilier',
  'planificateur-financier': 'Planificateur financier / Conseiller',
  notaire: 'Notaire',
  comptable: 'Comptable',
  autre: 'Autre profession',
} as const;

export type CleProfession = keyof typeof PROFESSIONS;

/**
 * `refuse` couvre les deux façons de dire non : le refus exprimé de vive voix et le retrait
 * demandé par le lien de désabonnement. Les deux valent la même chose — **on n'écrit plus**.
 */
export const ETATS = {
  a_contacter: 'À contacter',
  contacte: 'Contacté',
  relance: 'Relancé',
  en_discussion: 'En discussion',
  partenaire: 'Partenaire',
  refuse: 'Ne plus contacter',
} as const;

export type CleEtat = keyof typeof ETATS;

/**
 * Sur quoi repose le droit de lui écrire (LCAP). Ce champ n'est pas décoratif : c'est ce
 * qui répond, un an plus tard, à « pourquoi avez-vous mon adresse ». D'où la source
 * obligatoire à côté.
 */
export const BASES_CONSENTEMENT = {
  tacite_publie: 'Adresse professionnelle publiée',
  relation_existante: 'Relation d’affaires existante',
  expresse: 'Consentement exprès obtenu',
} as const;

export type CleConsentement = keyof typeof BASES_CONSENTEMENT;

/** Au-delà, un contact « contacté » sans réponse remonte dans les urgences. */
export const DELAI_SANS_REPONSE_JOURS = 10;

/**
 * Plafond d'envois par jour. Ce n'est pas une limite technique de Resend : c'est un
 * garde-fou de délivrabilité. Une centaine d'approches parties le même matin ressemble,
 * vue d'un filtre anti-pourriel, exactement à ce qu'on ne veut pas être.
 *
 * Fixé bas **parce que les approches partent du domaine commun** : tant que
 * `RESEND_FROM_RESEAU` n'est pas configurée, une plainte pour pourriel n'atteint pas
 * seulement la prospection, elle atteint les liens de signature et les accusés de rappel.
 * Le volume est la seule variable qui reste sous notre contrôle. À remonter le jour où un
 * sous-domaine d'envoi distinct sera vérifié.
 */
export const PLAFOND_QUOTIDIEN = 12;

/* ------------------------------------------------------------------ */
/*  Longueurs maximales                                                */
/* ------------------------------------------------------------------ */

export const LONGUEURS = {
  nom: 120,
  courriel: 200,
  telephone: 40,
  agence: 120,
  secteur: 120,
  notes: 2000,
  source: 200,
  objet: 200,
  corps: 6000,
} as const;

/* ------------------------------------------------------------------ */
/*  Gabarits                                                           */
/* ------------------------------------------------------------------ */

export interface Gabarit {
  /** Nom affiché dans le sélecteur. */
  readonly nom: string;
  /** Une ligne pour savoir quand s'en servir. */
  readonly resume: string;
  readonly objet: string;
  readonly corps: string;
  readonly objetParProfession?: Partial<Record<CleProfession, string>>;
  readonly corpsParProfession?: Partial<Record<CleProfession, string>>;
}

const SIGNATURE_OUVERTE = 'Au plaisir,';

/**
 * L'argumentaire par profession reprend le fond déjà écrit sur `/partenaires` : ce qui
 * inquiète un notaire n'est pas ce qui inquiète un comptable, et un courriel qui parle à
 * tout le monde ne parle à personne.
 */
export const GABARITS = {
  introduction: {
    nom: 'Introduction',
    resume: 'Premier contact. Une raison d’être écrit, une demande courte.',
    objet: 'Financement hypothécaire — une collaboration ?',
    objetParProfession: {
      'courtier-immobilier': 'Que vos offres ne tombent plus sur le financement',
      notaire: 'Des dossiers de financement prêts le jour de la signature',
      comptable: 'Vos clients à revenus non standards et leur financement',
      'planificateur-financier': 'Le financement hypothécaire dans vos stratégies',
    },
    corps: `Bonjour {{prenom}},

Je suis {{courtiere}}, courtière hypothécaire{{#secteur}} dans le secteur de {{secteur}}{{/secteur}}. Je vous écris parce que nos clients sont souvent les mêmes, à quelques semaines d’intervalle.

Ce que j’apporte, c’est de la prévisibilité : plus de vingt prêteurs comparés, un dossier suivi jusqu’au déboursé, et un appel de ma part dès qu’une condition bouge — vous n’apprenez jamais une mauvaise nouvelle par votre client.

Et votre client reste le vôtre : je ne lui propose jamais autre chose que le financement que vous m’avez confié.

Si l’idée vous parle, j’aimerais vous parler quinze minutes. Sans engagement — simplement pour que vous sachiez à qui vous adresser le jour où un dossier coince.

${SIGNATURE_OUVERTE}`,
    corpsParProfession: {
      'courtier-immobilier': `Bonjour {{prenom}},

Je suis {{courtiere}}, courtière hypothécaire{{#secteur}} dans le secteur de {{secteur}}{{/secteur}}. Je vous écris parce qu’une vente sur deux se joue ailleurs que sur la visite : elle se joue sur le financement.

Ce que j’apporte à un courtier immobilier, c’est de la prévisibilité. Une préapprobation solide avant les visites — pas une estimation au téléphone. Un dossier qui ferme à la date prévue. Et un appel de ma part dès qu’une condition bouge : vous n’apprenez jamais une mauvaise nouvelle par votre client.

Et votre client reste le vôtre : je ne lui propose jamais autre chose que le financement que vous m’avez confié.

Si l’idée vous parle, j’aimerais vous parler quinze minutes. Sans engagement — simplement pour que vous sachiez à qui vous adresser le jour où une offre tient à un détail de financement.

${SIGNATURE_OUVERTE}`,
      notaire: `Bonjour {{prenom}},

Je suis {{courtiere}}, courtière hypothécaire{{#secteur}} dans le secteur de {{secteur}}{{/secteur}}. Je vous écris parce qu’un dossier de financement qui traîne, c’est une signature qui dérape — et c’est votre horaire qui absorbe le retard.

Ma façon de travailler tient en une phrase : vous savez où en est le dossier avant d’avoir à le demander. Conditions de prêt remplies, documents complets, date de déboursé confirmée — je communique avec votre étude sans attendre la veille.

Si vous voyez passer des clients qui cherchent encore leur financement, j’aimerais vous parler quinze minutes. Vous saurez à qui les adresser, et je saurai comment votre étude préfère être tenue au courant.

${SIGNATURE_OUVERTE}`,
      comptable: `Bonjour {{prenom}},

Je suis {{courtiere}}, courtière hypothécaire{{#secteur}} dans le secteur de {{secteur}}{{/secteur}}. Je vous écris pour un cas que vous connaissez mieux que personne : le client dont l’optimisation fiscale, parfaitement légitime, fait dire « non » à sa banque.

Travailleurs autonomes, revenus de dividendes, revenus locatifs, deux années inégales : ce sont exactement les dossiers où une courtière change le résultat. Je connais les prêteurs qui lisent des états financiers et des avis de cotisation plutôt qu’un seul chiffre sur un T4.

Si vous avez un client dans cette situation — ou si vous en verrez un cette année, ce qui est plus probable — j’aimerais vous parler quinze minutes.

${SIGNATURE_OUVERTE}`,
      'planificateur-financier': `Bonjour {{prenom}},

Je suis {{courtiere}}, courtière hypothécaire{{#secteur}} dans le secteur de {{secteur}}{{/secteur}}. Je vous écris parce que l’hypothèque est souvent le plus gros poste du bilan de vos clients, et le moins souvent optimisé.

Renouvellement mal chronométré, refinancement pour libérer des liquidités, structuration de la dette avant un achat locatif : ce sont des leviers qui appartiennent au plan, pas au hasard du renouvellement automatique. On parle le même langage — chiffres, scénarios, projections — et je travaille pour que la solution hypothécaire serve la stratégie, pas l’inverse.

Si vous voulez qu’on regarde comment ça pourrait s’articuler, quinze minutes suffisent pour commencer.

${SIGNATURE_OUVERTE}`,
    },
  },

  relance: {
    nom: 'Relance',
    resume: 'Quelques jours après l’introduction, quand rien n’est revenu.',
    objet: 'Suite à mon message',
    corps: `Bonjour {{prenom}},

Je vous ai écrit il y a quelques jours au sujet du financement hypothécaire de vos clients. Le message est probablement passé sous la pile — c’est ce qui arrive aux courriels qui ne demandent rien d’urgent.

Je le résume en une ligne : quand un de vos clients a besoin d’un financement, vous pouvez me l’envoyer, je m’en occupe jusqu’à la signature et je vous tiens informé à chaque étape.

Si ce n’est pas le bon moment, dites-le moi simplement — je n’insisterai pas.

${SIGNATURE_OUVERTE}`,
  },

  derniere_relance: {
    nom: 'Dernière relance',
    resume: 'La sortie propre : on ferme soi-même la porte avant qu’on nous la ferme.',
    objet: 'Dernier message de ma part',
    corps: `Bonjour {{prenom}},

Je ne vous écrirai plus après ce message — vous avez sûrement d’autres priorités, et je préfère fermer la porte moi-même plutôt que d’encombrer votre boîte.

Si un jour un de vos clients cherche un financement hypothécaire, mon numéro est le {{telephone}}. Vous n’aurez rien à m’expliquer : je reprendrai le dossier là où il en est.

Bonne continuation, et merci pour votre temps.

${SIGNATURE_OUVERTE}`,
  },

  apres_rencontre: {
    nom: 'Après une rencontre',
    resume: 'Le lendemain d’un café ou d’un appel : on écrit ce qu’on a dit.',
    objet: 'Merci pour l’échange',
    corps: `Bonjour {{prenom}},

Merci pour le temps que vous m’avez accordé{{#agence}} chez {{agence}}{{/agence}}. J’ai trouvé l’échange utile, et je repars avec une idée claire de votre façon de travailler.

Pour que vous l’ayez par écrit : dès qu’un de vos clients a besoin d’un financement, vous m’écrivez à {{courriel}} ou vous m’appelez au {{telephone}}. Je le rappelle dans la journée, et je vous confirme où en est le dossier à chaque étape — préapprobation, approbation, conditions levées, date de déboursé.

Au plaisir de travailler ensemble.

${SIGNATURE_OUVERTE}`,
  },

  reactivation: {
    nom: 'Réactivation',
    resume: 'Un contact qui dort depuis des mois, avec une vraie raison d’écrire.',
    objet: 'On se reparle ?',
    corps: `Bonjour {{prenom}},

On s’est parlé il y a un bon moment, et je me permets de reprendre contact : le marché hypothécaire a bougé assez pour que la conversation vaille d’être reprise.

Concrètement, ça veut dire des clients qui pensaient ne pas se qualifier et qui se qualifient, et des renouvellements où quelques dixièmes de point changent le versement de façon visible.

Si vous avez un dossier en tête, envoyez-le moi. Sinon, gardez simplement mon numéro : {{telephone}}.

${SIGNATURE_OUVERTE}`,
  },
} as const satisfies Record<string, Gabarit>;

export type CleGabarit = keyof typeof GABARITS;

export const CLES_GABARIT = Object.keys(GABARITS) as CleGabarit[];

/* ------------------------------------------------------------------ */
/*  Rendu des gabarits                                                 */
/* ------------------------------------------------------------------ */

/** Les variables qu'un gabarit a le droit d'employer. Toute autre fait échouer le rendu. */
export interface VariablesGabarit {
  readonly prenom: string;
  readonly nom: string;
  readonly agence: string;
  readonly secteur: string;
  readonly courtiere: string;
  readonly organisation: string;
  readonly telephone: string;
  readonly courriel: string;
  readonly site: string;
}

const NOM_VARIABLE = /^[a-z_]+$/;

/**
 * Le prénom, tel qu'on le dirait à l'oral. Un contact n'a qu'un champ `nom` — lui demander
 * de le scinder en deux serait de la saisie pour rien.
 */
export function prenomDe(nom: string): string {
  const premier = nom.trim().split(/\s+/)[0] ?? '';
  return premier;
}

/**
 * Substitution stricte, avec sections conditionnelles pour les champs facultatifs :
 *
 * - `{{variable}}` — remplacée ; **une variable inconnue lève**. Laisser passer un
 *   `{{prenom}}` en clair dans un courriel parti est exactement ce qu'on veut rendre
 *   impossible.
 * - `{{#agence}}…{{/agence}}` — le bloc n'est rendu que si la variable est non vide.
 *   C'est ce qui permet d'écrire « merci pour l'accueil chez RE/MAX » sans produire
 *   « merci pour l'accueil chez  » quand l'agence est inconnue.
 */
export function rendreTexte(modele: string, variables: VariablesGabarit): string {
  const table = variables as unknown as Record<string, string | undefined>;

  const lire = (cle: string): string => {
    if (!NOM_VARIABLE.test(cle) || !(cle in table)) {
      throw new Error(`Variable de gabarit inconnue : {{${cle}}}`);
    }
    return table[cle] ?? '';
  };

  // Sections d'abord : leur contenu passe ensuite par la substitution simple.
  const sansSections = modele.replace(
    /\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_tout, cle: string, interieur: string) => (lire(cle) === '' ? '' : interieur),
  );

  return sansSections.replace(/\{\{([a-z_]+)\}\}/g, (_tout, cle: string) => lire(cle));
}

/** Le gabarit à employer pour cette profession — la variante si elle existe, sinon le fond commun. */
export function gabaritPour(
  cle: CleGabarit,
  profession: CleProfession,
): { objet: string; corps: string } {
  const gabarit: Gabarit = GABARITS[cle];
  return {
    objet: gabarit.objetParProfession?.[profession] ?? gabarit.objet,
    corps: gabarit.corpsParProfession?.[profession] ?? gabarit.corps,
  };
}

/** Vrai si la clé désigne un gabarit du catalogue. */
export function gabaritValide(valeur: unknown): valeur is CleGabarit {
  return typeof valeur === 'string' && Object.hasOwn(GABARITS, valeur);
}

/* ------------------------------------------------------------------ */
/*  États                                                              */
/* ------------------------------------------------------------------ */

/**
 * L'état après un envoi. Un contact déjà en discussion ou déjà partenaire ne « régresse »
 * pas parce qu'on lui a écrit : lui envoyer un mot après une rencontre ne le renvoie pas
 * au statut de prospect.
 */
export function etatApresEnvoi(actuel: CleEtat): CleEtat {
  if (actuel === 'a_contacter') return 'contacte';
  if (actuel === 'contacte') return 'relance';
  return actuel;
}

/** Un contact retiré ou refusé ne reçoit plus rien. C'est la règle qui ne souffre aucune exception. */
export function peutRecevoir(etat: CleEtat): boolean {
  return etat !== 'refuse';
}

/* ------------------------------------------------------------------ */
/*  Validation des entrées                                             */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

export interface DonneesContact {
  readonly nom: string;
  readonly courriel: string;
  readonly telephone: string;
  readonly agence: string;
  readonly secteur: string;
  readonly profession: CleProfession;
  readonly notes: string;
  readonly consentement: { readonly base: CleConsentement; readonly source: string };
}

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

/** Normalise un champ libre : espaces réduits, découpé à la longueur permise. */
export function normaliser(valeur: unknown, max: number): string {
  if (typeof valeur !== 'string') return '';
  return valeur.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Les notes gardent leurs retours à la ligne — c'est un bloc-notes, pas un champ. */
function normaliserBloc(valeur: unknown, max: number): string {
  if (typeof valeur !== 'string') return '';
  return valeur.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, max);
}

export function courrielValide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && valeur.length <= LONGUEURS.courriel && EMAIL_RE.test(valeur.trim());
}

/** Forme canonique d'une adresse — sert aussi de clé de dédoublonnage. */
export function normaliserCourriel(valeur: string): string {
  return valeur.trim().toLowerCase().slice(0, LONGUEURS.courriel);
}

export function professionValide(valeur: unknown): valeur is CleProfession {
  return typeof valeur === 'string' && Object.hasOwn(PROFESSIONS, valeur);
}

export function etatValide(valeur: unknown): valeur is CleEtat {
  return typeof valeur === 'string' && Object.hasOwn(ETATS, valeur);
}

export function consentementValide(valeur: unknown): valeur is CleConsentement {
  return typeof valeur === 'string' && Object.hasOwn(BASES_CONSENTEMENT, valeur);
}

/**
 * Valide une fiche de contact soumise par le formulaire.
 *
 * La **source du consentement** est obligatoire, au même titre que le nom : c'est la seule
 * chose qui, un an plus tard, répond à « où avez-vous pris mon adresse ». La rendre
 * facultative reviendrait à ne jamais la remplir.
 */
export function parserContact(brut: unknown): Resultat<DonneesContact> {
  if (typeof brut !== 'object' || brut === null) return { ok: false, erreur: 'Requête invalide.' };
  const source = brut as Record<string, unknown>;

  const nom = normaliser(source.nom, LONGUEURS.nom);
  if (nom.length < 2) return { ok: false, erreur: 'Le nom du contact est requis.' };

  if (!courrielValide(source.courriel)) return { ok: false, erreur: 'Adresse courriel invalide.' };
  const courriel = normaliserCourriel(source.courriel);

  if (!professionValide(source.profession)) return { ok: false, erreur: 'Profession inconnue.' };

  const consentementBrut =
    typeof source.consentement === 'object' && source.consentement !== null
      ? (source.consentement as Record<string, unknown>)
      : {};
  if (!consentementValide(consentementBrut.base)) {
    return { ok: false, erreur: 'Base de consentement inconnue.' };
  }
  const sourceConsentement = normaliser(consentementBrut.source, LONGUEURS.source);
  if (sourceConsentement.length < 3) {
    return { ok: false, erreur: 'Indiquez d’où vient cette adresse (exigence anti-pourriel).' };
  }

  return {
    ok: true,
    valeur: {
      nom,
      courriel,
      telephone: normaliser(source.telephone, LONGUEURS.telephone),
      agence: normaliser(source.agence, LONGUEURS.agence),
      secteur: normaliser(source.secteur, LONGUEURS.secteur),
      profession: source.profession,
      notes: normaliserBloc(source.notes, LONGUEURS.notes),
      consentement: { base: consentementBrut.base, source: sourceConsentement },
    },
  };
}

export interface MessageSortant {
  readonly gabarit: CleGabarit;
  readonly objet: string;
  readonly corps: string;
}

/**
 * Valide le message tel qu'il part réellement.
 *
 * Le gabarit doit appartenir au catalogue — il sert d'étiquette dans le journal — mais
 * l'objet et le corps sont libres : ce sont ceux que Stéphanie a relus à l'écran, et c'est
 * ce texte-là, pas le modèle, qui sera archivé.
 */
export function parserMessage(brut: unknown): Resultat<MessageSortant> {
  if (typeof brut !== 'object' || brut === null) return { ok: false, erreur: 'Requête invalide.' };
  const source = brut as Record<string, unknown>;

  if (!gabaritValide(source.gabarit)) return { ok: false, erreur: 'Gabarit inconnu.' };

  const objet = normaliser(source.objet, LONGUEURS.objet);
  if (objet.length < 3) return { ok: false, erreur: 'L’objet du courriel est requis.' };

  const corps = normaliserBloc(source.corps, LONGUEURS.corps);
  if (corps.length < 20) return { ok: false, erreur: 'Le message est trop court.' };

  return { ok: true, valeur: { gabarit: source.gabarit, objet, corps } };
}
