/**
 * Source de vérité du dossier client — partagée entre `/dossiers` (l'écran de la courtière),
 * `/mon-dossier` (le portail du client) et les endpoints `crm-*`.
 *
 * Comme `reseauCourtiers.ts` et `contratCourtage.ts`, ce catalogue fait office de **whitelist
 * de validation côté serveur** : une étape, un document ou un état hors catalogue fait échouer
 * la requête plutôt que de s'écrire en base.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 * 1. **Le CRM porte le suivi, pas le dossier de crédit.** `CHAMPS_CONSERVES` énumère
 *    limitativement ce qu'un dossier retient d'une demande de financement. Les revenus, la
 *    date de naissance, l'évaluation de crédit et les dettes continuent de ne vivre que dans
 *    le courriel interne que `/api/demande-submit` envoie déjà. Le registre officiel du
 *    dossier est celui d'Hypotheca ; ceci est un outil de suivi. Un test verrouille la liste.
 * 2. **Ce que voit Stéphanie n'est pas ce que lit le client.** Chaque étape porte deux
 *    libellés, et `perdu` n'est pas montrée du tout — un dossier abandonné ne l'annonce pas
 *    à celui qui l'a déposé.
 *
 * @module dossiersClients
 */

/* ------------------------------------------------------------------ */
/*  Étapes du dossier                                                  */
/* ------------------------------------------------------------------ */

/**
 * Le parcours d'un dossier hypothécaire, de la demande au financement.
 *
 * `libelle` est ce que Stéphanie lit dans son pipeline ; `libelleClient` et
 * `explicationClient` sont ce que le client lit dans son portail. Les deux ne disent pas la
 * même chose : « Soumis au prêteur » est un fait interne, « Votre dossier est chez le
 * prêteur » est une nouvelle. Un portail qui recopie le vocabulaire interne oblige le client
 * à le traduire, et il appelle plutôt que de le faire.
 */
export const ETAPES = {
  /**
   * Un contact entré par un formulaire, que Stéphanie n'a pas encore qualifié.
   *
   * `visibleClient: false`, et c'est tout l'intérêt : quelqu'un qui a demandé un rappel ou le
   * calcul de son versement ne doit pas recevoir un portail annonçant « Demande reçue » avec
   * une liste de douze pièces qu'il n'a jamais accepté de fournir. Le portail ne s'ouvre qu'à
   * la qualification — c'est-à-dire au passage à `nouveau`, qui sème alors la checklist.
   */
  prospect: {
    libelle: 'Prospect à qualifier',
    libelleClient: 'Premier contact',
    explicationClient: '',
    visibleClient: false,
    clot: false,
  },
  nouveau: {
    libelle: 'Demande reçue',
    libelleClient: 'Demande reçue',
    explicationClient:
      'Votre demande est arrivée. Stéphanie la lit et vous contacte sous peu pour valider votre situation.',
    visibleClient: true,
    clot: false,
  },
  contact: {
    libelle: 'Premier contact fait',
    libelleClient: 'Premier échange fait',
    explicationClient:
      'Vous vous êtes parlé. Stéphanie prépare la liste des documents dont elle a besoin pour monter votre dossier.',
    visibleClient: true,
    clot: false,
  },
  documents: {
    libelle: 'Cueillette des documents',
    libelleClient: 'Documents à réunir',
    explicationClient:
      'C’est l’étape où votre dossier avance le plus vite si vous y participez : chaque pièce reçue rapproche la soumission au prêteur.',
    visibleClient: true,
    clot: false,
  },
  analyse: {
    libelle: 'Analyse et magasinage des taux',
    libelleClient: 'Analyse en cours',
    explicationClient:
      'Stéphanie compare les prêteurs et les conditions pour votre situation. Rien à faire de votre côté.',
    visibleClient: true,
    clot: false,
  },
  soumis: {
    libelle: 'Soumis au prêteur',
    libelleClient: 'Dossier chez le prêteur',
    explicationClient:
      'Votre dossier est entre les mains du prêteur retenu. Le délai de réponse varie de quelques heures à quelques jours.',
    visibleClient: true,
    clot: false,
  },
  approuve: {
    libelle: 'Approbation obtenue',
    libelleClient: 'Approuvé',
    explicationClient:
      'Le prêteur a approuvé votre financement. Il reste à remplir les conditions et à passer chez le notaire.',
    visibleClient: true,
    clot: false,
  },
  notaire: {
    libelle: 'Chez le notaire',
    libelleClient: 'Chez le notaire',
    explicationClient:
      'Le dossier est transmis au notaire pour la signature. Il vous contactera pour fixer le rendez-vous.',
    visibleClient: true,
    clot: false,
  },
  finance: {
    libelle: 'Financé — dossier clos',
    libelleClient: 'Financé',
    explicationClient:
      'Tout est signé et déboursé. Merci de votre confiance — Stéphanie reste disponible pour la suite.',
    visibleClient: true,
    clot: true,
  },
  /**
   * Interne. Le portail d'un dossier `perdu` montre un écran neutre : annoncer
   * « votre dossier a été abandonné » à quelqu'un qui consulte son suivi serait à la fois
   * blessant et faux — un dossier qui n'aboutit pas se raconte de vive voix, pas par un écran.
   */
  perdu: {
    libelle: 'Non abouti',
    libelleClient: 'Dossier inactif',
    explicationClient: '',
    visibleClient: false,
    clot: true,
  },
} as const;

export type CleEtape = keyof typeof ETAPES;

/**
 * La progression, dans l'ordre. `perdu` en est **absente** : ce n'est pas une étape du
 * parcours mais une sortie de route, et la faire figurer dans la frise donnerait à croire
 * qu'on y arrive en avançant.
 */
export const ORDRE_ETAPES = [
  'prospect',
  'nouveau',
  'contact',
  'documents',
  'analyse',
  'soumis',
  'approuve',
  'notaire',
  'finance',
] as const satisfies readonly CleEtape[];

/** Les étapes que le portail client affiche dans sa frise. */
export const ETAPES_CLIENT = ORDRE_ETAPES.filter((cle) => ETAPES[cle].visibleClient);

/** Position dans la progression, ou `-1` pour une étape hors parcours (`perdu`). */
export function rangEtape(cle: CleEtape): number {
  return (ORDRE_ETAPES as readonly CleEtape[]).indexOf(cle);
}

/** L'étape d'après, pour le bouton « avancer ». `null` en bout de course ou hors parcours. */
export function etapeSuivante(cle: CleEtape): CleEtape | null {
  const rang = rangEtape(cle);
  if (rang === -1) return null;
  return ORDRE_ETAPES[rang + 1] ?? null;
}

/** Vrai si le dossier n'attend plus rien — financé ou non abouti. */
export function etapeClot(cle: CleEtape): boolean {
  return ETAPES[cle].clot;
}

/* ------------------------------------------------------------------ */
/*  Origine et consentement                                            */
/* ------------------------------------------------------------------ */

/**
 * Par quelle porte la fiche est entrée. Fait du système, pas réponse du client — d'où sa
 * place au premier niveau du dossier plutôt que dans `profil`.
 *
 * C'est aussi la seule donnée qui permette de dire, en fin de trimestre, quels formulaires
 * produisent des clients et lesquels ne produisent que du volume.
 */
export const ORIGINES = {
  demande: 'Demande de financement',
  rappel: 'Demande de rappel',
  contact: 'Formulaire de contact',
  refinancement: 'Funnel refinancement',
  refinancement_v2: 'Funnel refinancement V2',
  partenaire: 'Référence d’un partenaire',
  calculateur: 'Calculateur de versement',
  penalite: 'Calculateur de pénalité',
  outils: 'Hub d’outils',
  manuel: 'Saisie manuelle',
} as const;

export type CleOrigine = keyof typeof ORIGINES;

/**
 * Sur quoi repose le droit de rappeler cette personne.
 *
 * Même question que `BASES_CONSENTEMENT` dans `reseauCourtiers.ts`, et pour la même raison :
 * c'est ce qui répond, six mois plus tard, à « pourquoi l'appelez-vous ». Les deux carnets
 * ne partagent pas les clés, parce qu'ils ne parlent pas des mêmes gestes — un professionnel
 * dont l'adresse est publiée n'a rien à voir avec quelqu'un qui a rempli un formulaire.
 */
export const BASES_CONSENTEMENT = {
  expresse: 'A demandé à être contacté',
  tiers: 'Transmis par un partenaire',
  service_demande: 'A demandé un rapport, rien de plus',
} as const;

export type CleConsentement = keyof typeof BASES_CONSENTEMENT;

/**
 * La base attachée à chaque porte d'entrée.
 *
 * ⚠️ `calculateur` vaut `service_demande` et non `expresse` : **ce formulaire n'a aucune case
 * de consentement**. La personne a demandé que son calcul lui soit envoyé, pas qu'on la
 * rappelle. La fiche l'affiche en clair pour que la distinction survive au passage du temps —
 * une liste où tout le monde a « accepté d'être contacté » ne vaut rien le jour où il faut
 * le prouver.
 */
export const CONSENTEMENT_PAR_ORIGINE = {
  demande: 'expresse',
  rappel: 'expresse',
  contact: 'expresse',
  refinancement: 'expresse',
  refinancement_v2: 'expresse',
  outils: 'expresse',
  penalite: 'expresse',
  partenaire: 'tiers',
  calculateur: 'service_demande',
  manuel: 'expresse',
} as const satisfies Record<CleOrigine, CleConsentement>;

/**
 * À quelle étape une fiche naît, selon la porte par laquelle elle est entrée.
 *
 * `/demande` ouvre un **dossier**, pas un prospect : la personne a rempli quarante-cinq
 * champs, déclaré sa situation d'emploi et consenti à l'enquête de crédit. La traiter comme
 * un contact à qualifier serait lui refermer au nez le portail qu'elle a mérité.
 *
 * Tout le reste ouvre un **prospect**. Un nom et un téléphone laissés au bas d'un calculateur
 * ne disent pas qu'on a un dossier ; ils disent qu'on a quelqu'un à rappeler.
 *
 * La saisie manuelle ouvre un dossier : si Stéphanie prend la peine de créer la fiche
 * elle-même, la qualification a déjà eu lieu dans sa tête.
 */
export const ETAPE_INITIALE = {
  demande: 'nouveau',
  manuel: 'nouveau',
  rappel: 'prospect',
  contact: 'prospect',
  refinancement: 'prospect',
  refinancement_v2: 'prospect',
  partenaire: 'prospect',
  calculateur: 'prospect',
  penalite: 'prospect',
  outils: 'prospect',
} as const satisfies Record<CleOrigine, CleEtape>;

export function origineValide(valeur: unknown): valeur is CleOrigine {
  return typeof valeur === 'string' && Object.hasOwn(ORIGINES, valeur);
}

export function consentementValide(valeur: unknown): valeur is CleConsentement {
  return typeof valeur === 'string' && Object.hasOwn(BASES_CONSENTEMENT, valeur);
}

/* ------------------------------------------------------------------ */
/*  Catalogue des documents                                            */
/* ------------------------------------------------------------------ */

/**
 * Les pièces qu'un dossier hypothécaire réclame.
 *
 * Le `pourquoi` n'est pas de la décoration : une liste de documents sans raison est une
 * corvée, la même liste avec sa raison est une démarche. C'est la seule chose qui distingue
 * ce portail d'un courriel qui dit « envoyez-moi vos papiers ».
 *
 * La `precision` ne figure que là où la forme du document compte — un relevé bancaire amputé
 * d'une page est un relevé à redemander, donc à ne pas laisser deviner.
 */
export const DOCUMENTS = {
  piece_identite: {
    libelle: 'Pièce d’identité avec photo',
    pourquoi: 'Le prêteur doit vérifier votre identité avant d’étudier le dossier.',
    precision: 'Recto-verso, lisible, non expirée.',
  },
  talons_paie: {
    libelle: 'Deux talons de paie récents',
    pourquoi: 'Ils confirment votre revenu actuel et la régularité de vos versements.',
    precision: 'Les deux plus récents, avec le cumulatif de l’année.',
  },
  lettre_emploi: {
    libelle: 'Lettre d’emploi',
    pourquoi: 'Elle atteste votre poste, votre salaire et votre ancienneté — ce que le talon de paie seul ne prouve pas.',
    precision: 'Datée de moins de 30 jours, signée par l’employeur.',
  },
  t4: {
    libelle: 'T4 et relevé 1 des deux dernières années',
    pourquoi: 'Ils montrent l’historique de revenu, y compris les bonis et les commissions.',
    precision: '',
  },
  avis_cotisation: {
    libelle: 'Avis de cotisation des deux dernières années',
    pourquoi: 'Pour un travailleur autonome, c’est la preuve de revenu que le prêteur reconnaît.',
    precision: 'Les deux années complètes, fédéral et provincial.',
  },
  etats_financiers: {
    libelle: 'États financiers de l’entreprise (2 ans)',
    pourquoi: 'Ils permettent au prêteur de distinguer le revenu de l’entreprise du vôtre.',
    precision: '',
  },
  releves_bancaires: {
    libelle: 'Relevés bancaires des 90 derniers jours',
    pourquoi: 'Le prêteur doit voir que la mise de fonds est accumulée, et non empruntée la veille.',
    precision: 'Les 90 jours complets, sans page manquante, avec votre nom visible.',
  },
  preuve_mise_de_fonds: {
    libelle: 'Preuve de mise de fonds',
    pourquoi: 'Elle établit d’où vient l’argent du comptant — c’est une exigence, pas une curiosité.',
    precision: '',
  },
  lettre_don: {
    libelle: 'Lettre de don',
    pourquoi: 'Un montant donné par un proche doit être déclaré comme don, et non comme prêt.',
    precision: 'Signée par le donateur, précisant que la somme n’est pas remboursable.',
  },
  promesse_achat: {
    libelle: 'Promesse d’achat acceptée',
    pourquoi: 'C’est le document qui fixe le prix, la date de possession et les conditions.',
    precision: 'Avec toutes les annexes et contre-propositions signées.',
  },
  releve_hypothecaire: {
    libelle: 'Relevé hypothécaire actuel',
    pourquoi: 'Il donne le solde, le taux et la date d’échéance — nécessaires pour calculer ce qu’un refinancement vous coûte ou vous rapporte.',
    precision: '',
  },
  compte_taxes: {
    libelle: 'Comptes de taxes municipales et scolaires',
    pourquoi: 'Les taxes entrent dans le calcul de votre capacité d’emprunt.',
    precision: 'Les comptes de l’année en cours.',
  },
  evaluation_municipale: {
    libelle: 'Évaluation municipale',
    pourquoi: 'Elle sert de première référence de valeur avant l’évaluation du prêteur.',
    precision: '',
  },
  declaration_copropriete: {
    libelle: 'Déclaration de copropriété et états financiers du syndicat',
    pourquoi: 'Le prêteur évalue la santé financière de la copropriété autant que la vôtre.',
    precision: '',
  },
  baux_locataires: {
    libelle: 'Baux des locataires',
    pourquoi: 'Les revenus locatifs ne comptent que s’ils sont documentés.',
    precision: 'Tous les baux en vigueur.',
  },
  preuve_vente: {
    libelle: 'Preuve de vente de la propriété actuelle',
    pourquoi: 'Si la mise de fonds vient de cette vente, le prêteur doit la voir conclue.',
    precision: 'Acte de vente ou promesse acceptée sans condition.',
  },
} as const;

export type CleDocument = keyof typeof DOCUMENTS;

/**
 * De qui relève la pièce. Le même document peut être réclamé deux fois dans un dossier à
 * deux emprunteurs — et ce sont bien deux choses à réclamer, pas une case pour deux.
 */
export const DESTINATAIRES = {
  emprunteur: 'Emprunteur',
  co_emprunteur: 'Co-emprunteur',
  dossier: 'Le dossier',
} as const;

export type CleDestinataire = keyof typeof DESTINATAIRES;

export const ETATS_DOCUMENT = {
  a_fournir: 'À fournir',
  recu: 'Reçu',
  non_requis: 'Non requis',
} as const;

export type CleEtatDocument = keyof typeof ETATS_DOCUMENT;

/** Une ligne de checklist telle que la sème `documentsRequis` — sans horodatage : le service les pose. */
export interface DocumentRequis {
  readonly cle: CleDocument;
  readonly pourQui: CleDestinataire;
}

/** Deux lignes ne font doublon que si elles visent la même pièce **et** la même personne. */
export function memeLigne(a: DocumentRequis, b: DocumentRequis): boolean {
  return a.cle === b.cle && a.pourQui === b.pourQui;
}

/* ------------------------------------------------------------------ */
/*  Le profil retenu d'une demande                                     */
/* ------------------------------------------------------------------ */

/**
 * **La whitelist du principe n°1.** Clé du formulaire `/demande` → clé du profil conservé.
 *
 * Tout ce qui n'est pas ici n'entre pas dans le CRM : date de naissance, revenus, mise de
 * fonds, auto-évaluation du crédit, faillite passée, dettes, employeur, adresse personnelle.
 * Ces champs restent dans le courriel interne que `/api/demande-submit` envoie déjà à
 * Stéphanie — un courriel qu'elle archive comme elle l'entend, plutôt qu'une base de données
 * nominative qui grossit toute seule sur un site public.
 *
 * ⚠️ Un test verrouille cette liste. Y ajouter un champ sensible « juste pour l'afficher »
 * est exactement la façon dont un outil de suivi devient un dossier de crédit.
 */
export const CHAMPS_CONSERVES = {
  type_demande: 'typeDemande',
  statut_emploi: 'statutEmploi',
  co_emprunteur: 'coEmprunteur',
  co_statut_emploi: 'coStatutEmploi',
  promesse_achat: 'promesseAchat',
  source_fonds: 'sourceFonds',
  type_propriete: 'typePropriete',
  usage_propriete: 'usagePropriete',
  vente_propriete: 'ventePropriete',
  date_possession: 'datePossession',
  prix_vise: 'prixVise',
  adresse_propriete: 'adressePropriete',
  pref_contact: 'prefContact',
  moment_contact: 'momentContact',
  source: 'source',
} as const;

export type CleProfil = (typeof CHAMPS_CONSERVES)[keyof typeof CHAMPS_CONSERVES];

/** Ce qu'un dossier retient d'une demande. Tout est facultatif : un dossier créé à la main n'en a rien. */
export type ProfilDemande = Partial<Record<CleProfil, string>>;

/* ------------------------------------------------------------------ */
/*  Semis de la checklist                                              */
/* ------------------------------------------------------------------ */

/** Les statuts d'emploi qui appellent des preuves de salariat. Mêmes clés que `/demande`. */
const EMPLOI_SALARIE = new Set(['salarie', 'commission', 'contractuel']);

function documentsEmploi(statut: string | undefined, pourQui: CleDestinataire): DocumentRequis[] {
  if (!statut) return [];
  if (statut === 'travailleur_autonome') {
    return [
      { cle: 'avis_cotisation', pourQui },
      { cle: 'etats_financiers', pourQui },
    ];
  }
  if (EMPLOI_SALARIE.has(statut)) {
    return [
      { cle: 'talons_paie', pourQui },
      { cle: 'lettre_emploi', pourQui },
      { cle: 't4', pourQui },
    ];
  }
  // `sans_emploi` ou statut inconnu : rien de semé. Mieux vaut une checklist courte que
  // Stéphanie complète, qu'une liste de documents inapplicables que le client tente de réunir.
  return [];
}

/**
 * Sème la checklist initiale à partir du profil retenu de la demande.
 *
 * Le vocabulaire est **celui de `/demande`** (`LABELS` dans `api/demande-submit.ts`) : les
 * deux bouts doivent parler pareil, sinon un « travailleur autonome » qui coche sa case dans
 * le formulaire ne déclencherait pas les documents qui le concernent.
 *
 * Ce n'est qu'un point de départ — Stéphanie ajoute et retire des lignes à la fiche. Une
 * liste semée à côté est une liste qu'elle corrige ; une liste vide est une liste qu'elle
 * écrit en entier.
 */
export function documentsRequis(profil: ProfilDemande): DocumentRequis[] {
  const lignes: DocumentRequis[] = [{ cle: 'piece_identite', pourQui: 'emprunteur' }];

  lignes.push(...documentsEmploi(profil.statutEmploi, 'emprunteur'));

  if (profil.coEmprunteur === 'deux') {
    lignes.push({ cle: 'piece_identite', pourQui: 'co_emprunteur' });
    lignes.push(...documentsEmploi(profil.coStatutEmploi, 'co_emprunteur'));
  }

  if (profil.typeDemande === 'refinancement') {
    lignes.push(
      { cle: 'releve_hypothecaire', pourQui: 'dossier' },
      { cle: 'compte_taxes', pourQui: 'dossier' },
      { cle: 'evaluation_municipale', pourQui: 'dossier' },
    );
  } else {
    lignes.push(
      { cle: 'releves_bancaires', pourQui: 'dossier' },
      { cle: 'preuve_mise_de_fonds', pourQui: 'dossier' },
    );
    if (profil.promesseAchat === 'oui') lignes.push({ cle: 'promesse_achat', pourQui: 'dossier' });
    if (profil.sourceFonds === 'don') lignes.push({ cle: 'lettre_don', pourQui: 'dossier' });
  }

  if (profil.sourceFonds === 'vente' || profil.ventePropriete === 'oui') {
    lignes.push({ cle: 'preuve_vente', pourQui: 'dossier' });
  }
  if (profil.typePropriete === 'condo') {
    lignes.push({ cle: 'declaration_copropriete', pourQui: 'dossier' });
  }
  if (profil.usagePropriete === 'revenus') {
    lignes.push({ cle: 'baux_locataires', pourQui: 'dossier' });
  }

  // Un semis peut proposer deux fois la même pièce (vente + source des fonds, par exemple).
  return lignes.filter(
    (ligne, i) => lignes.findIndex((autre) => memeLigne(ligne, autre)) === i,
  );
}

/* ------------------------------------------------------------------ */
/*  Longueurs maximales                                                */
/* ------------------------------------------------------------------ */

export const LONGUEURS = {
  nom: 120,
  courriel: 200,
  telephone: 40,
  notes: 4000,
  note: 1000,
  profil: 200,
  motif: 500,
} as const;

/** Au-delà, un dossier sans mouvement remonte dans les urgences de l'écran. */
export const DELAI_SANS_MOUVEMENT_JOURS = 7;

/* ------------------------------------------------------------------ */
/*  Validation des entrées                                             */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

/** Normalise un champ libre : espaces réduits, découpé à la longueur permise. */
export function normaliser(valeur: unknown, max: number): string {
  if (typeof valeur !== 'string') return '';
  return valeur.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Les notes gardent leurs retours à la ligne — c'est un bloc-notes, pas un champ. */
export function normaliserBloc(valeur: unknown, max: number): string {
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

/**
 * Les chiffres d'un numéro, sans indicatif de pays. Clé de dédoublonnage **de repli**, pour
 * les fiches sans adresse — une référence de partenaire ne porte qu'un téléphone.
 *
 * `450 555-1234`, `(450) 555-1234` et `+1 450 555 1234` donnent la même clé : sans cela, la
 * même personne référée deux fois ferait deux fiches, ce que le dédoublonnage doit empêcher.
 */
export function cleTelephone(valeur: string): string {
  const chiffres = valeur.replace(/\D/g, '');
  const sansPays = chiffres.length === 11 && chiffres.startsWith('1') ? chiffres.slice(1) : chiffres;
  return sansPays.length >= 7 ? sansPays : '';
}

export function etapeValide(valeur: unknown): valeur is CleEtape {
  return typeof valeur === 'string' && Object.hasOwn(ETAPES, valeur);
}

export function documentValide(valeur: unknown): valeur is CleDocument {
  return typeof valeur === 'string' && Object.hasOwn(DOCUMENTS, valeur);
}

export function destinataireValide(valeur: unknown): valeur is CleDestinataire {
  return typeof valeur === 'string' && Object.hasOwn(DESTINATAIRES, valeur);
}

export function etatDocumentValide(valeur: unknown): valeur is CleEtatDocument {
  return typeof valeur === 'string' && Object.hasOwn(ETATS_DOCUMENT, valeur);
}

export interface DonneesDossier {
  readonly nom: string;
  readonly courriel: string;
  readonly telephone: string;
  readonly notes: string;
  readonly profil: ProfilDemande;
}

/**
 * Ne retient d'un objet que les clés de `CHAMPS_CONSERVES`.
 *
 * C'est ici que le principe n°1 s'applique concrètement : le reste du formulaire est traversé
 * sans être lu. Un champ ajouté à `/demande` demain n'entrera donc pas dans le CRM par
 * inadvertance — il faudra l'inscrire ici, c'est-à-dire le décider.
 */
export function extraireProfil(brut: unknown): ProfilDemande {
  if (typeof brut !== 'object' || brut === null) return {};
  const source = brut as Record<string, unknown>;
  const profil: ProfilDemande = {};

  for (const [cleFormulaire, cleProfil] of Object.entries(CHAMPS_CONSERVES)) {
    // Le formulaire envoie parfois la clé du profil (réédition depuis /dossiers), parfois
    // celle du formulaire (soumission de /demande) : on accepte les deux plutôt que d'obliger
    // l'écran à traduire.
    const valeur = normaliser(source[cleFormulaire] ?? source[cleProfil], LONGUEURS.profil);
    if (valeur) profil[cleProfil] = valeur;
  }
  return profil;
}

/**
 * Valide une fiche soumise par `/dossiers`, ou dérivée d'une entrée de formulaire.
 *
 * **L'adresse courriel est facultative**, et c'est une concession délibérée : une référence
 * de partenaire ne porte qu'un nom et un téléphone. Refuser cette fiche perdrait précisément
 * le prospect qu'on cherche à ne plus perdre. Mais il faut un moyen de joindre la personne
 * *et* de la reconnaître, d'où l'exigence d'au moins l'un des deux — une fiche sans adresse
 * ni téléphone n'est pas un contact, c'est un nom.
 */
export function parserDonneesDossier(brut: unknown): Resultat<DonneesDossier> {
  if (typeof brut !== 'object' || brut === null) return { ok: false, erreur: 'Requête invalide.' };
  const source = brut as Record<string, unknown>;

  const nom = normaliser(source.nom, LONGUEURS.nom);
  if (nom.length < 2) return { ok: false, erreur: 'Le nom du client est requis.' };

  const courrielBrut = normaliser(source.courriel, LONGUEURS.courriel);
  if (courrielBrut && !courrielValide(courrielBrut)) {
    return { ok: false, erreur: 'Adresse courriel invalide.' };
  }

  const telephone = normaliser(source.telephone, LONGUEURS.telephone);
  if (!courrielBrut && !cleTelephone(telephone)) {
    return { ok: false, erreur: 'Il faut au moins une adresse courriel ou un téléphone.' };
  }

  return {
    ok: true,
    valeur: {
      nom,
      courriel: courrielBrut ? normaliserCourriel(courrielBrut) : '',
      telephone,
      notes: normaliserBloc(source.notes, LONGUEURS.notes),
      profil: extraireProfil(source.profil ?? source),
    },
  };
}

/**
 * Construit les données d'un dossier à partir de la charge utile de `/demande`.
 *
 * Le formulaire envoie `prenom` et `nom` séparément ; le dossier n'en garde qu'un nom
 * complet — deux champs pour désigner une personne dans un carnet de suivi, c'est un champ
 * de trop et deux façons de l'écrire.
 */
export function depuisDemande(payload: unknown): Resultat<DonneesDossier> {
  if (typeof payload !== 'object' || payload === null) return { ok: false, erreur: 'Requête invalide.' };
  const source = payload as Record<string, unknown>;

  const nomComplet = normaliser(
    `${normaliser(source.prenom, LONGUEURS.nom)} ${normaliser(source.nom, LONGUEURS.nom)}`,
    LONGUEURS.nom,
  );

  return parserDonneesDossier({
    nom: nomComplet,
    courriel: source.courriel,
    telephone: source.telephone,
    notes: '',
    profil: source,
  });
}
