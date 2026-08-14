/**
 * Formulaire « Contrat de courtage hypothécaire » (Hypotheca) — catalogue et validation.
 *
 * Source de vérité partagée entre la page /contrat (saisie par la courtière), la page
 * /signer-contrat (récapitulatif et signature de l'emprunteur), les endpoints
 * /api/contrat-creer et /api/contrat-signer (whitelist de validation + libellés courriel)
 * et le service d'estampage PDF (coordonnées).
 *
 * ⚠️ LES COORDONNÉES SONT CELLES DU MODÈLE PDF FOURNI PAR HYPOTHECA.
 * Elles ont été extraites du document original en repérant, glyphe par glyphe, le début de
 * chaque ligne pointillée « ____ » et chaque case « □ » (repère PDF origine bas-gauche,
 * pages 612 × 1008 pt — format légal, pas lettre). Si Hypotheca révise le contrat, il faut :
 *   1. régénérer src/data/contratCourtageModele.ts
 *      (`node scripts/encode-modele.mjs <pdf> contrat`) ;
 *   2. réextraire les coordonnées et les mettre à jour ici ;
 *   3. relancer `npx vitest run` puis vérifier un PDF généré à l'œil.
 * Rien d'autre dans le code ne connaît la géométrie du document.
 *
 * Placé dans src/utils/ parce que netlify.toml inclut déjà `src/utils/**` dans les
 * included_files des fonctions SSR.
 *
 * @module contratCourtage
 */

/** Point du repère PDF : [x, y], origine en bas à gauche de la page. */
export type PointPdf = readonly [x: number, y: number];

/** Les quatre pages du modèle. */
export type NumeroPage = 1 | 2 | 3 | 4;

/** Un emplacement de texte : où écrire, sur quelle page, et dans quelle largeur. */
export interface Emplacement {
  readonly page: NumeroPage;
  readonly point: PointPdf;
  /** Largeur utile de la ligne pointillée, en points. Le texte est réduit pour y tenir. */
  readonly largeur: number;
}

/** Une case à cocher du modèle : position du glyphe « □ » ou « ☐ ». */
export interface Case {
  readonly page: NumeroPage;
  readonly point: PointPdf;
}

export const PAGE_LARGEUR = 612;
export const PAGE_HAUTEUR = 1008;

/* ------------------------------------------------------------------ */
/*  1. En-tête — le courtier                                           */
/*                                                                     */
/*  Jamais saisi : ces quatre champs viennent de siteConfig.json. Le    */
/*  modèle d'Hypotheca les laisse vides, contrairement au formulaire    */
/*  « Profil des emprunteurs » qui les porte déjà imprimés.             */
/* ------------------------------------------------------------------ */

export const COURTIER = {
  nom: { page: 1, point: [203.3, 885.7], largeur: 210 },
  amf: { page: 1, point: [492.1, 885.7], largeur: 91 },
  adresse: { page: 1, point: [70.1, 861.2], largeur: 362 },
  telephone: { page: 1, point: [488.1, 861.2], largeur: 91 },
} as const satisfies Record<string, Emplacement>;

/* ------------------------------------------------------------------ */
/*  2. Identification des emprunteurs                                  */
/* ------------------------------------------------------------------ */

export const MAX_EMPRUNTEURS = 3;

export interface LignesEmprunteur {
  readonly prenom: Emplacement;
  readonly nom: Emplacement;
  readonly telephone: Emplacement;
  readonly adresse: Emplacement;
  readonly courriel: Emplacement;
}

/**
 * Les trois blocs « Emprunteur N » de la page 1. Chaque bloc tient sur deux lignes :
 * prénom / nom / téléphone, puis adresse / courriel.
 */
export const EMPRUNTEURS: readonly LignesEmprunteur[] = [
  {
    prenom: { page: 1, point: [134.8, 803.4], largeur: 133 },
    nom: { page: 1, point: [296.5, 803.4], largeur: 137 },
    telephone: { page: 1, point: [486.8, 803.4], largeur: 96 },
    adresse: { page: 1, point: [70.1, 778.9], largeur: 312 },
    courriel: { page: 1, point: [427.1, 778.9], largeur: 156 },
  },
  {
    prenom: { page: 1, point: [134.8, 754.6], largeur: 133 },
    nom: { page: 1, point: [296.5, 754.6], largeur: 137 },
    telephone: { page: 1, point: [486.8, 754.6], largeur: 96 },
    adresse: { page: 1, point: [70.1, 730.1], largeur: 312 },
    courriel: { page: 1, point: [427.1, 730.1], largeur: 156 },
  },
  {
    prenom: { page: 1, point: [134.8, 705.7], largeur: 133 },
    nom: { page: 1, point: [296.5, 705.7], largeur: 137 },
    telephone: { page: 1, point: [486.8, 705.7], largeur: 96 },
    adresse: { page: 1, point: [70.1, 681.2], largeur: 312 },
    courriel: { page: 1, point: [427.1, 681.2], largeur: 156 },
  },
];

/* ------------------------------------------------------------------ */
/*  3. Divulgations sur la rémunération et les activités               */
/* ------------------------------------------------------------------ */

/** Deux lignes libres : « rétribution d'une autre entité, tel que : ____ / ____ ». */
export const RETRIBUTION_AUTRE_ENTITE: readonly Emplacement[] = [
  { page: 1, point: [28.1, 545.3], largeur: 243 },
  { page: 1, point: [28.1, 533.0], largeur: 243 },
];

/** Deux lignes libres : « partager sa rétribution, tel que : ____ / ____ ». */
export const PARTAGE_RETRIBUTION: readonly Emplacement[] = [
  { page: 1, point: [28.1, 491.5], largeur: 243 },
  { page: 1, point: [28.1, 479.4], largeur: 243 },
];

export const AUTRE_CABINET: Emplacement = { page: 1, point: [153.6, 430.6], largeur: 210 };

export const NB_PRETEURS_CABINET: Emplacement = { page: 1, point: [248.1, 360.5], largeur: 40 };
export const NB_PRETEURS_COURTIER: Emplacement = { page: 1, point: [284.0, 331.2], largeur: 40 };
export const PRETEUR_MAJORITAIRE: Emplacement = { page: 1, point: [400.1, 301.8], largeur: 142 };

/** « Les logiciels utilisés peuvent inclure : Microsoft 365 - Filogix - Mailjet - ____ ». */
export const AUTRES_LOGICIELS: Emplacement = { page: 1, point: [432.4, 102.2], largeur: 151 };

/* ------------------------------------------------------------------ */
/*  4. Collaborateur (assurances) — page 2                             */
/* ------------------------------------------------------------------ */

export const COLLABORATEUR: Emplacement = { page: 2, point: [98.9, 811.2], largeur: 289 };

/**
 * Les trois cases « ____/____/____ » qui suivent le collaborateur : ce sont les initiales
 * des trois emprunteurs, pas une date — même gabarit qu'aux deux blocs « Initiales » de la
 * page 3.
 */
export const INITIALES_COLLABORATEUR: readonly Emplacement[] = [
  { page: 2, point: [397.0, 811.2], largeur: 36 },
  { page: 2, point: [437.0, 811.2], largeur: 36 },
  { page: 2, point: [477.2, 811.2], largeur: 36 },
];

/* ------------------------------------------------------------------ */
/*  5. Personnes politiquement vulnérables (PPV) — page 2              */
/* ------------------------------------------------------------------ */

export const PPV_CASES = {
  oui: { page: 2, point: [28.1, 593.6] },
  non: { page: 2, point: [89.4, 593.6] },
} as const satisfies Record<string, Case>;

/* ------------------------------------------------------------------ */
/*  6. Caractéristiques du financement recherché — page 2              */
/* ------------------------------------------------------------------ */

export const ADRESSE_PROJET: Emplacement = { page: 2, point: [108.7, 489.2], largeur: 473 };

export interface OptionCase {
  readonly cle: string;
  /** Libellé exact du modèle — réutilisé tel quel dans les courriels et le récapitulatif. */
  readonly label: string;
  readonly caseAcocher: Case;
}

/**
 * Les huit types de financement. Ce sont des cases à cocher indépendantes sur le modèle :
 * plusieurs peuvent s'appliquer au même dossier (un refinancement assorti d'une marge, par
 * exemple), donc la sélection est multiple.
 */
export const TYPES_FINANCEMENT: readonly OptionCase[] = [
  { cle: 'achat_conventionnel', label: 'Achat conventionnel', caseAcocher: { page: 2, point: [28.1, 463.0] } },
  { cle: 'achat_assure', label: 'Achat assuré', caseAcocher: { page: 2, point: [311.6, 463.0] } },
  { cle: 'preautorisation', label: 'Préautorisation', caseAcocher: { page: 2, point: [28.1, 448.3] } },
  { cle: 'hypotheque_inversee', label: 'Hypothèque inversée', caseAcocher: { page: 2, point: [311.6, 448.3] } },
  { cle: 'refinancement', label: 'Refinancement', caseAcocher: { page: 2, point: [28.1, 433.7] } },
  { cle: 'subrogation', label: 'Subrogation / transfert', caseAcocher: { page: 2, point: [311.6, 433.7] } },
  { cle: 'marge_credit', label: 'Marge de crédit hypothécaire', caseAcocher: { page: 2, point: [28.1, 419.0] } },
  { cle: 'rachat_part', label: 'Rachat de part', caseAcocher: { page: 2, point: [311.6, 419.0] } },
];

export const AUTRES_PRECISIONS: Emplacement = { page: 2, point: [286.2, 396.5], largeur: 294 };

export const MONTANT_PRET: Emplacement = { page: 2, point: [170.0, 359.9], largeur: 110 };
export const ASSURANCE_HYPOTHECAIRE: Emplacement = { page: 2, point: [170.0, 335.4], largeur: 110 };
export const TOTAL_PRET: Emplacement = { page: 2, point: [170.0, 311.0], largeur: 110 };

export const TAUX_INTERET: Emplacement = { page: 2, point: [169.9, 286.7], largeur: 36 };
export const TYPES_TAUX: readonly OptionCase[] = [
  { cle: 'fixe', label: 'Fixe', caseAcocher: { page: 2, point: [225.2, 286.7] } },
  { cle: 'variable', label: 'Variable', caseAcocher: { page: 2, point: [262.2, 286.7] } },
];

export const AMORTISSEMENT_ANS: Emplacement = { page: 2, point: [170.0, 262.2], largeur: 36 };
export const AMORTISSEMENT_MOIS: Emplacement = { page: 2, point: [226.5, 262.2], largeur: 36 };
export const TERME_ANS: Emplacement = { page: 2, point: [169.9, 237.8], largeur: 36 };
export const TERME_MOIS: Emplacement = { page: 2, point: [226.5, 237.8], largeur: 36 };

export const VERSEMENT: Emplacement = { page: 2, point: [170.0, 213.4], largeur: 110 };
export const RANG: Emplacement = { page: 2, point: [169.9, 189.0], largeur: 36 };

/** Quatre lignes libres pour les exigences particulières de l'emprunteur. */
export const AUTRES_EXIGENCES: readonly Emplacement[] = [
  { page: 2, point: [28.1, 150.5], largeur: 552 },
  { page: 2, point: [28.1, 135.8], largeur: 552 },
  { page: 2, point: [28.1, 121.2], largeur: 552 },
  { page: 2, point: [28.1, 106.6], largeur: 552 },
];

/* ------------------------------------------------------------------ */
/*  7. Frais, honoraires et résiliation — page 3                       */
/* ------------------------------------------------------------------ */

export const FRAIS_ETUDE: Emplacement = { page: 3, point: [274.3, 689.2], largeur: 73 };

export const HONORAIRES_MONTANT: Emplacement = { page: 3, point: [273.3, 633.0], largeur: 73 };
export const HONORAIRES_POURCENTAGE: Emplacement = { page: 3, point: [417.2, 633.0], largeur: 36 };

/** Bloc « Initiales » sous la clause de perception de la rétribution. */
export const INITIALES_RETRIBUTION: readonly Emplacement[] = [
  { page: 3, point: [238.8, 447.4], largeur: 32 },
  { page: 3, point: [274.2, 447.4], largeur: 32 },
  { page: 3, point: [309.9, 447.4], largeur: 32 },
];

export const DOUBLE_REMUNERATION: readonly OptionCase[] = [
  {
    cle: 'ne_recevra_pas',
    label: 'Le cabinet ne recevra pas de commission du prêteur',
    caseAcocher: { page: 3, point: [28.1, 372.4] },
  },
  {
    cle: 'recevra',
    label: 'Le cabinet recevra une commission du prêteur',
    caseAcocher: { page: 3, point: [28.1, 340.6] },
  },
];

/** Deux lignes libres : « Raison de la double rémunération le cas échéant ». */
export const RAISON_DOUBLE_REMUNERATION: readonly Emplacement[] = [
  { page: 3, point: [28.1, 298.4], largeur: 552 },
  { page: 3, point: [28.1, 286.3], largeur: 552 },
];

export const RESILIATION_MONTANT: Emplacement = { page: 3, point: [349.4, 193.4], largeur: 50 };
export const RESILIATION_POURCENTAGE: Emplacement = { page: 3, point: [483.6, 193.4], largeur: 27 };

/** Bloc « Initiales » sous la clause de frais de résiliation. */
export const INITIALES_RESILIATION: readonly Emplacement[] = [
  { page: 3, point: [284.0, 169.1], largeur: 32 },
  { page: 3, point: [319.5, 169.1], largeur: 32 },
  { page: 3, point: [355.2, 169.1], largeur: 32 },
];

/* ------------------------------------------------------------------ */
/*  8. Confirmation et signatures — page 4                             */
/* ------------------------------------------------------------------ */

/** « … communiqués à leur courtier et au nouveau cabinet … Oui ☐ / Non ☐ ». */
export const TRANSFERT_CABINET_CASES = {
  oui: { page: 4, point: [112.7, 823.3] },
  non: { page: 4, point: [148.9, 823.3] },
} as const satisfies Record<string, Case>;

export const CONSENTEMENTS_VALIDES_JUSQUAU: Emplacement = { page: 4, point: [355.7, 772.1], largeur: 96 };

export interface ZoneSignature {
  /** Coin bas-gauche du tracé. */
  readonly trace: PointPdf;
  /** Origine du texte de la date. */
  readonly date: PointPdf;
  readonly page: NumeroPage;
}

/** La ligne « Signature du courtier ». */
export const ZONE_SIGNATURE_COURTIER: ZoneSignature = {
  page: 4,
  trace: [136.5, 747.7],
  date: [374.9, 747.7],
};

/** Les trois lignes « Signature emprunteur N », de haut en bas. */
export const ZONES_SIGNATURE_EMPRUNTEURS: readonly ZoneSignature[] = [
  { page: 4, trace: [136.8, 723.2], date: [374.9, 723.2] },
  { page: 4, trace: [136.8, 698.9], date: [374.9, 698.9] },
  { page: 4, trace: [136.8, 674.4], date: [374.9, 674.4] },
];

/** Gabarit d'ajustement du tracé : il est réduit pour tenir dedans, ratio conservé. */
export const TRACE_LARGEUR_MAX = 185;
export const TRACE_HAUTEUR_MAX = 22;

/* ------------------------------------------------------------------ */
/*  9. Vérification de l'identité — page 4, réservée à la courtière    */
/* ------------------------------------------------------------------ */

/** Abscisse de chaque colonne « Emprunteur N » du tableau d'identité. */
export const COLONNES_IDENTITE: readonly number[] = [169.9, 311.7, 453.6];
export const LARGEUR_COLONNE_IDENTITE = 91;

export type LigneIdentiteId =
  | 'dossier_credit_numero'
  | 'dossier_credit_date'
  | 'document1'
  | 'document1_numero'
  | 'document1_delivre_par'
  | 'document1_expiration'
  | 'document2'
  | 'document2_numero'
  | 'document2_delivre_par'
  | 'document2_expiration';

export interface LigneIdentite {
  readonly id: LigneIdentiteId;
  /** Libellé exact du modèle. */
  readonly label: string;
  /** Ordonnée de la ligne — l'abscisse vient de COLONNES_IDENTITE. */
  readonly y: number;
}

export const LIGNES_IDENTITE: readonly LigneIdentite[] = [
  { id: 'dossier_credit_numero', label: '(1) # du dossier de crédit', y: 403.4 },
  { id: 'dossier_credit_date', label: '(2) Date du dossier de crédit', y: 391.2 },
  { id: 'document1', label: '(3) Document 1', y: 369.2 },
  { id: 'document1_numero', label: '(4) # du document d’identité', y: 357.1 },
  { id: 'document1_delivre_par', label: '(5) Délivré par', y: 344.9 },
  { id: 'document1_expiration', label: '(6) Date d’expiration', y: 332.6 },
  { id: 'document2', label: '(7) Document 2', y: 320.4 },
  { id: 'document2_numero', label: '(8) # du document d’identité', y: 308.3 },
  { id: 'document2_delivre_par', label: '(9) Délivré par', y: 296.0 },
  { id: 'document2_expiration', label: '(10) Date d’expiration', y: 283.8 },
];

export const DATE_VERIFICATION: Emplacement = { page: 4, point: [169.9, 259.4], largeur: 91 };

/* ------------------------------------------------------------------ */
/*  Texte de l'attestation signée                                      */
/* ------------------------------------------------------------------ */

/**
 * Texte exact coché par chaque emprunteur avant de signer — conservé dans la preuve.
 *
 * Il dit « affiché ci-dessus » parce que la page de signature affiche réellement les quatre
 * pages du contrat (voir /api/contrat-apercu). Toute reformulation de cette phrase doit
 * rester vraie de ce que l'écran montre : une attestation qui affirme plus que ce qui a été
 * présenté ruinerait la preuve qu'elle est censée constituer.
 */
export const TEXTE_ATTESTATION =
  'J’ai lu en entier le contrat de courtage affiché ci-dessus, je le comprends, et ce tracé vaut ma signature.';

/* ================================================================== */
/*  Données du contrat — types et validation                          */
/* ================================================================== */

export interface Emprunteur {
  readonly prenom: string;
  readonly nom: string;
  readonly telephone: string;
  readonly adresse: string;
  readonly courriel: string;
}

export interface DonneesContrat {
  readonly emprunteurs: readonly Emprunteur[];

  /* Divulgations */
  readonly retributionAutreEntite: string;
  readonly partageRetribution: string;
  readonly autreCabinet: string;
  readonly nbPreteursCabinet: string;
  readonly nbPreteursCourtier: string;
  readonly preteurMajoritaire: string;
  readonly autresLogiciels: string;

  /* Collaborateur */
  readonly collaborateur: string;

  /* Financement */
  readonly adresseProjet: string;
  readonly typesFinancement: readonly string[];
  readonly autresPrecisions: string;
  readonly montantPret: string;
  readonly assuranceHypothecaire: string;
  readonly totalPret: string;
  readonly tauxInteret: string;
  readonly typeTaux: 'fixe' | 'variable' | null;
  readonly amortissementAns: string;
  readonly amortissementMois: string;
  readonly termeAns: string;
  readonly termeMois: string;
  readonly versement: string;
  readonly rang: string;
  readonly autresExigences: string;

  /* Frais et honoraires */
  readonly fraisEtude: string;
  readonly honorairesMontant: string;
  readonly honorairesPourcentage: string;
  readonly doubleRemuneration: 'ne_recevra_pas' | 'recevra' | null;
  readonly raisonDoubleRemuneration: string;
  readonly resiliationMontant: string;
  readonly resiliationPourcentage: string;

  /* Confirmation */
  readonly consentementsValidesJusquau: string;

  /* Vérification d'identité — réservée à la courtière */
  readonly identite: Readonly<Record<LigneIdentiteId, readonly string[]>>;
  readonly dateVerification: string;
}

/* ------------------------------------------------------------------ */
/*  Ce que l'emprunteur répond lui-même                                */
/* ------------------------------------------------------------------ */

/**
 * Deux questions du contrat ne sont pas des données du dossier : ce sont des réponses qui
 * appartiennent à l'emprunteur.
 *
 *  • **PPV** — « Veuillez indiquer si l'une des situations suivantes s'applique à l'un des
 *    emprunteurs ». Laisser la courtière déclarer à leur place qu'ils ne sont pas
 *    politiquement vulnérables n'a aucune valeur : elle n'en sait rien.
 *  • **Transfert au nouveau cabinet** — c'est un consentement, pas un fait.
 *
 * S'y ajoute la confirmation des coordonnées : la courtière les saisit souvent de mémoire ou
 * d'après un échange téléphonique, et l'emprunteur est le seul à pouvoir les corriger.
 *
 * C'est parce que ces réponses arrivent **après** l'envoi que la courtière signe en dernier :
 * elle voit le contrat définitif avant de s'engager.
 */
export interface ReponsesEmprunteur {
  readonly ppv: 'oui' | 'non';
  readonly transfertCabinet: 'oui' | 'non';
  /** Corrigées par l'emprunteur ; vides s'il n'a rien changé à ce que la courtière a saisi. */
  readonly telephone: string;
  readonly adresse: string;
}

/**
 * Le contrat ne porte qu'**une** case PPV pour tout le monde, et la question est posée au
 * pluriel : « … s'applique à l'un des emprunteurs ». Il suffit donc d'un seul « oui » pour
 * que la case « Oui » soit cochée. Répondre « Non » parce que deux emprunteurs sur trois
 * l'ont dit serait une fausse déclaration.
 *
 * `null` tant que personne n'a répondu : cocher « Non » d'office reviendrait à déclarer, au
 * nom de gens à qui on n'a rien demandé, qu'ils ne sont pas politiquement vulnérables. Une
 * case vide se voit ; une fausse déclaration, non.
 */
export function agregerPpv(
  reponses: ReadonlyArray<ReponsesEmprunteur | null | undefined>,
): 'oui' | 'non' | null {
  const donnees = reponses.filter((r): r is ReponsesEmprunteur => r != null);
  if (donnees.length === 0) return null;
  return donnees.some((r) => r.ppv === 'oui') ? 'oui' : 'non';
}

/**
 * Le transfert au nouveau cabinet est un **consentement collectif** : le refus d'un seul
 * emprunteur doit primer. Un dossier où l'un dit non et l'autre oui se coche « Non ».
 *
 * Tant qu'aucune réponse n'est parvenue, on ne coche rien — d'où le `null`.
 */
export function agregerTransfert(
  reponses: ReadonlyArray<ReponsesEmprunteur | null | undefined>,
): 'oui' | 'non' | null {
  // `!= null` et non `!== null` : un dossier écrit par une version antérieure n'a pas de
  // champ `reponses`, et laisser passer `undefined` ici faisait planter la finalisation.
  const donnees = reponses.filter((r): r is ReponsesEmprunteur => r != null);
  if (donnees.length === 0) return null;
  return donnees.some((r) => r.transfertCabinet === 'non') ? 'non' : 'oui';
}

/**
 * Valide les réponses d'un emprunteur reçues au moment de signer. Retourne `null` à la
 * moindre valeur inconnue — comme partout ailleurs, le catalogue fait office de whitelist.
 */
export function parserReponsesEmprunteur(payload: unknown): ReponsesEmprunteur | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const brut = payload as Record<string, unknown>;

  const ppv = optionParmi(brut.ppv, ['oui', 'non'] as const);
  const transfertCabinet = optionParmi(brut.transfertCabinet, ['oui', 'non'] as const);
  if (!ppv || !transfertCabinet) return null;

  return {
    ppv,
    transfertCabinet,
    telephone: chaine(brut.telephone, 40),
    adresse: chaine(brut.adresse, 160),
  };
}

/** Libellé lisible des réponses d'un emprunteur — courriels et trace de preuve. */
export function resumerReponsesEmprunteur(reponses: ReponsesEmprunteur): Array<[string, string]> {
  const paires: Array<[string, string]> = [
    ['Personne politiquement vulnérable', reponses.ppv === 'oui' ? 'Oui' : 'Non'],
    ['Consent au transfert au nouveau cabinet', reponses.transfertCabinet === 'oui' ? 'Oui' : 'Non'],
  ];
  if (reponses.telephone) paires.push(['Téléphone confirmé', reponses.telephone]);
  if (reponses.adresse) paires.push(['Adresse confirmée', reponses.adresse]);
  return paires;
}

/* ------------------------------------------------------------------ */
/*  Réglages mémorisés d'un contrat à l'autre                          */
/* ------------------------------------------------------------------ */

/**
 * Les champs qui décrivent le cabinet et les usages de la courtière plutôt que le dossier
 * du client : ils sont identiques d'un contrat à l'autre et méritent d'être mémorisés (voir
 * src/services/reglagesCourtiere.ts).
 *
 * Ne jamais y ajouter un champ propre au client — il serait reporté d'un dossier au suivant,
 * et personne ne remarquerait qu'un contrat porte l'adresse ou le montant du précédent.
 */
export const CLES_DEFAUTS = [
  'nbPreteursCabinet',
  'nbPreteursCourtier',
  'preteurMajoritaire',
  'autresLogiciels',
  'autreCabinet',
  'collaborateur',
  'retributionAutreEntite',
  'partageRetribution',
  'fraisEtude',
  'honorairesMontant',
  'honorairesPourcentage',
  'resiliationMontant',
  'resiliationPourcentage',
  'doubleRemuneration',
] as const;

export type CleDefaut = (typeof CLES_DEFAUTS)[number];

/* ------------------------------------------------------------------ */
/*  Bornes                                                             */
/* ------------------------------------------------------------------ */

export const NOM_MIN = 2;
export const NOM_MAX = 60;
/** Plafond générique d'un champ d'une ligne. Le rétrécissement typographique fait le reste. */
export const CHAMP_MAX = 200;
/** Plafond d'un champ multiligne (rétribution, exigences, raison). */
export const CHAMP_LONG_MAX = 600;

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

export function estCourrielValide(valeur: string): boolean {
  return EMAIL_RE.test(valeur) && valeur.length <= 120;
}

function chaine(valeur: unknown, max = CHAMP_MAX): string {
  if (typeof valeur !== 'string') return '';
  // Les sauts de ligne sont normalisés : le PDF n'a que des lignes fixes, et un « \n »
  // égaré déformerait la mesure de largeur au moment d'estamper.
  return valeur.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Champ multiligne : on garde les retours pour pouvoir répartir sur les lignes du modèle.
 *
 * Les lignes vides sont supprimées, pas seulement normalisées : le modèle ne réserve que
 * deux à quatre lignes à ces champs, et une ligne blanche en consommerait une pour rien.
 */
function texteLong(valeur: unknown, max = CHAMP_LONG_MAX): string {
  if (typeof valeur !== 'string') return '';
  return valeur
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '')
    .join('\n')
    .slice(0, max);
}

/**
 * Découpe un texte libre sur les lignes disponibles du modèle. Les retours à la ligne de
 * la saisie sont respectés d'abord ; ce qui dépasse est réparti au mot près. Les lignes en
 * trop sont abandonnées — le modèle n'en a pas davantage, et déborder par-dessus le texte
 * imprimé serait pire que tronquer.
 */
export function repartirSurLignes(texte: string, nombreLignes: number, caracteresParLigne: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split('\n')) {
    if (paragraphe === '') continue;
    let courante = '';
    for (const mot of paragraphe.split(' ')) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (essai.length <= caracteresParLigne || courante === '') {
        courante = essai;
      } else {
        lignes.push(courante);
        courante = mot;
      }
    }
    if (courante) lignes.push(courante);
  }
  return lignes.slice(0, nombreLignes);
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Valide la liste des emprunteurs : 1 à 3, noms plausibles, courriels valides et
 * **distincts entre eux** — deux emprunteurs qui partagent une adresse ruineraient la
 * seule chose que la chaîne de signature prouve (le contrôle d'une boîte distincte).
 */
export function parserEmprunteurs(payload: unknown): Emprunteur[] | null {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > MAX_EMPRUNTEURS) return null;

  const emprunteurs: Emprunteur[] = [];
  const adressesVues = new Set<string>();

  for (const entree of payload) {
    if (typeof entree !== 'object' || entree === null) return null;
    const brut = entree as Record<string, unknown>;

    const prenom = chaine(brut.prenom, NOM_MAX);
    const nom = chaine(brut.nom, NOM_MAX);
    const courriel = chaine(brut.courriel, 120).toLowerCase();

    if (prenom.length < NOM_MIN || nom.length < NOM_MIN) return null;
    if (!estCourrielValide(courriel)) return null;
    if (adressesVues.has(courriel)) return null;
    adressesVues.add(courriel);

    emprunteurs.push({
      prenom,
      nom,
      courriel,
      telephone: chaine(brut.telephone, 40),
      adresse: chaine(brut.adresse, 160),
    });
  }

  return emprunteurs;
}

function optionParmi<T extends string>(valeur: unknown, permises: readonly T[]): T | null {
  const v = chaine(valeur, 40);
  return (permises as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Valide les données d'un contrat reçues du navigateur.
 *
 * Le catalogue ci-dessus fait office de whitelist : toute case, tout type de financement et
 * toute option inconnue fait échouer la validation. Les champs libres sont normalisés et
 * plafonnés, jamais repris tels quels.
 *
 * Retourne `null` si quoi que ce soit d'obligatoire manque ou ne correspond pas.
 */
export function parserDonneesContrat(payload: unknown): DonneesContrat | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const brut = payload as Record<string, unknown>;

  const emprunteurs = parserEmprunteurs(brut.emprunteurs);
  if (!emprunteurs) return null;

  // Type de taux et double rémunération sont facultatifs : une préautorisation peut être
  // signée avant qu'un taux soit arrêté, et un contrat sans honoraires n'a pas à trancher
  // la divulgation additionnelle.
  const typeTaux = brut.typeTaux == null || brut.typeTaux === '' ? null : optionParmi(brut.typeTaux, ['fixe', 'variable'] as const);
  if (brut.typeTaux != null && brut.typeTaux !== '' && typeTaux === null) return null;

  const doubleRemuneration =
    brut.doubleRemuneration == null || brut.doubleRemuneration === ''
      ? null
      : optionParmi(brut.doubleRemuneration, ['ne_recevra_pas', 'recevra'] as const);
  if (brut.doubleRemuneration != null && brut.doubleRemuneration !== '' && doubleRemuneration === null) return null;

  if (!Array.isArray(brut.typesFinancement)) return null;
  const clesConnues = new Set(TYPES_FINANCEMENT.map((t) => t.cle));
  const typesFinancement: string[] = [];
  for (const valeur of brut.typesFinancement) {
    const cle = chaine(valeur, 40);
    if (!clesConnues.has(cle)) return null;
    if (!typesFinancement.includes(cle)) typesFinancement.push(cle);
  }

  /* Tableau de vérification d'identité : une valeur par emprunteur, dans l'ordre. */
  const identiteBrute = (brut.identite ?? {}) as Record<string, unknown>;
  const identite = {} as Record<LigneIdentiteId, readonly string[]>;
  for (const ligne of LIGNES_IDENTITE) {
    const valeurs = identiteBrute[ligne.id];
    if (valeurs !== undefined && !Array.isArray(valeurs)) return null;
    identite[ligne.id] = Array.isArray(valeurs)
      ? valeurs.slice(0, MAX_EMPRUNTEURS).map((v) => chaine(v, 60))
      : [];
  }

  return {
    emprunteurs,

    retributionAutreEntite: texteLong(brut.retributionAutreEntite),
    partageRetribution: texteLong(brut.partageRetribution),
    autreCabinet: chaine(brut.autreCabinet),
    nbPreteursCabinet: chaine(brut.nbPreteursCabinet, 10),
    nbPreteursCourtier: chaine(brut.nbPreteursCourtier, 10),
    preteurMajoritaire: chaine(brut.preteurMajoritaire),
    autresLogiciels: chaine(brut.autresLogiciels),

    collaborateur: chaine(brut.collaborateur),

    adresseProjet: chaine(brut.adresseProjet, 200),
    typesFinancement,
    autresPrecisions: chaine(brut.autresPrecisions),
    montantPret: chaine(brut.montantPret, 20),
    assuranceHypothecaire: chaine(brut.assuranceHypothecaire, 20),
    totalPret: chaine(brut.totalPret, 20),
    tauxInteret: chaine(brut.tauxInteret, 10),
    typeTaux,
    amortissementAns: chaine(brut.amortissementAns, 4),
    amortissementMois: chaine(brut.amortissementMois, 4),
    termeAns: chaine(brut.termeAns, 4),
    termeMois: chaine(brut.termeMois, 4),
    versement: chaine(brut.versement, 20),
    rang: chaine(brut.rang, 10),
    autresExigences: texteLong(brut.autresExigences),

    fraisEtude: chaine(brut.fraisEtude, 20),
    honorairesMontant: chaine(brut.honorairesMontant, 20),
    honorairesPourcentage: chaine(brut.honorairesPourcentage, 10),
    doubleRemuneration,
    raisonDoubleRemuneration: texteLong(brut.raisonDoubleRemuneration),
    resiliationMontant: chaine(brut.resiliationMontant, 20),
    resiliationPourcentage: chaine(brut.resiliationPourcentage, 10),

    consentementsValidesJusquau: chaine(brut.consentementsValidesJusquau, 40),

    identite,
    dateVerification: chaine(brut.dateVerification, 40),
  };
}

/* ------------------------------------------------------------------ */
/*  Résumés lisibles — courriels et récapitulatif de signature         */
/* ------------------------------------------------------------------ */

export function nomComplet(emprunteur: Emprunteur): string {
  return `${emprunteur.prenom} ${emprunteur.nom}`.trim();
}

/** Initiales estampées dans les blocs « ____/____/____ ». */
export function initialesDe(emprunteur: Emprunteur): string {
  const lettre = (mot: string): string => (mot.trim()[0] ?? '').toUpperCase();
  return `${lettre(emprunteur.prenom)}${lettre(emprunteur.nom)}`;
}

function libelleCases(cles: readonly string[], catalogue: readonly OptionCase[]): string {
  const labels = catalogue.filter((o) => cles.includes(o.cle)).map((o) => o.label);
  return labels.length ? labels.join(', ') : '—';
}

/** Le contrat en paires [libellé, valeur], pour les courriels et l'écran de signature. */
export function resumerContrat(donnees: DonneesContrat): Array<[string, string]> {
  const ou = (valeur: string): string => (valeur === '' ? '—' : valeur);
  const paires: Array<[string, string]> = [];

  for (const [index, emprunteur] of donnees.emprunteurs.entries()) {
    paires.push([
      `Emprunteur ${index + 1}`,
      `${nomComplet(emprunteur)} — ${emprunteur.courriel}${emprunteur.telephone ? ` — ${emprunteur.telephone}` : ''}`,
    ]);
  }

  paires.push(['Adresse du projet', ou(donnees.adresseProjet)]);
  paires.push(['Type de financement', libelleCases(donnees.typesFinancement, TYPES_FINANCEMENT)]);
  if (donnees.autresPrecisions) paires.push(['Autres précisions', donnees.autresPrecisions]);
  paires.push(['Montant du prêt', ou(donnees.montantPret)]);
  if (donnees.assuranceHypothecaire) paires.push(['Assurance hypothécaire', donnees.assuranceHypothecaire]);
  if (donnees.totalPret) paires.push(['Total du prêt', donnees.totalPret]);
  paires.push([
    'Taux d’intérêt',
    donnees.tauxInteret
      ? `${donnees.tauxInteret} %${donnees.typeTaux ? ` (${donnees.typeTaux === 'fixe' ? 'Fixe' : 'Variable'})` : ''}`
      : '—',
  ]);
  paires.push([
    'Amortissement',
    donnees.amortissementAns || donnees.amortissementMois
      ? `${donnees.amortissementAns || '0'} ans ${donnees.amortissementMois || '0'} mois`
      : '—',
  ]);
  paires.push([
    'Terme',
    donnees.termeAns || donnees.termeMois ? `${donnees.termeAns || '0'} ans ${donnees.termeMois || '0'} mois` : '—',
  ]);
  if (donnees.versement) paires.push(['Versement (cap. + int.)', donnees.versement]);
  if (donnees.rang) paires.push(['Rang', donnees.rang]);
  if (donnees.autresExigences) paires.push(['Autres exigences', donnees.autresExigences]);

  paires.push(['Frais d’étude de dossier', ou(donnees.fraisEtude)]);
  paires.push([
    'Honoraires',
    donnees.honorairesMontant || donnees.honorairesPourcentage
      ? `${donnees.honorairesMontant || '—'}${donnees.honorairesPourcentage ? ` (${donnees.honorairesPourcentage} %)` : ''}`
      : '—',
  ]);
  if (donnees.doubleRemuneration) {
    paires.push(['Divulgation additionnelle', libelleCases([donnees.doubleRemuneration], DOUBLE_REMUNERATION)]);
  }
  if (donnees.raisonDoubleRemuneration) {
    paires.push(['Raison de la double rémunération', donnees.raisonDoubleRemuneration]);
  }
  if (donnees.resiliationMontant || donnees.resiliationPourcentage) {
    paires.push([
      'Frais de résiliation',
      `${donnees.resiliationMontant || '—'}${donnees.resiliationPourcentage ? ` ou ${donnees.resiliationPourcentage} %` : ''}`,
    ]);
  }

  if (donnees.collaborateur) paires.push(['Collaborateur (assurances)', donnees.collaborateur]);
  if (donnees.consentementsValidesJusquau) {
    paires.push(['Consentements valides jusqu’au', donnees.consentementsValidesJusquau]);
  }

  return paires;
}
