/**
 * Formulaire « Profil des emprunteurs » (Hypotheca / AMF) — catalogue et validation.
 *
 * Source de vérité partagée entre la page /profil-emprunteur (rendu des tuiles), la page
 * /signer (récapitulatif du co-signataire), les endpoints /api/profil-submit et
 * /api/profil-cosigner (whitelist de validation + libellés courriel) et le service
 * d'estampage PDF (coordonnées).
 *
 * ⚠️ LES COORDONNÉES SONT CELLES DU MODÈLE PDF FOURNI PAR HYPOTHECA.
 * Elles ont été extraites du document original (position du glyphe « □ », repère PDF
 * origine bas-gauche, page US Letter 612 × 792 pt). Si Hypotheca révise le formulaire,
 * il faut :
 *   1. régénérer src/data/profilEmprunteursModele.ts (`node scripts/encode-modele.mjs <pdf>`) ;
 *   2. réextraire les coordonnées et les mettre à jour ici ;
 *   3. relancer `npx vitest run` puis vérifier un PDF généré à l'œil.
 * Rien d'autre dans le code ne connaît la géométrie du document.
 *
 * Placé dans src/utils/ parce que netlify.toml inclut déjà `src/utils/**` dans les
 * included_files des fonctions SSR.
 *
 * @module profilEmprunteurs
 */

/** Point du repère PDF : [x, y], origine en bas à gauche de la page. */
export type PointPdf = readonly [x: number, y: number];

export interface OptionProfil {
  readonly cle: string;
  /** Libellé exact du modèle PDF — réutilisé tel quel dans les courriels et le récapitulatif. */
  readonly label: string;
  /** Position du glyphe « □ » correspondant dans le modèle. */
  readonly caseAcocher: PointPdf;
}

export type QuestionId =
  | 'experience'
  | 'connaissances'
  | 'absorption'
  | 'remboursement'
  | 'apports'
  | 'besoins'
  | 'virtuel'
  | 'priorite';

export interface QuestionProfil {
  readonly id: QuestionId;
  /** Phrase exacte du formulaire — celle qui sera signée. Utilisée dans le récapitulatif. */
  readonly intitule: string;
  /** Reformulation courte et humaine, affichée en tête de tuile pendant le parcours. */
  readonly question: string;
  /** Précision facultative sous la question. */
  readonly precision?: string;
  /** `liste` = options longues empilées ; `grille` = options courtes en grille. */
  readonly disposition: 'liste' | 'grille';
  readonly options: readonly OptionProfil[];
}

/* ------------------------------------------------------------------ */
/*  Les 8 questions du formulaire                                      */
/* ------------------------------------------------------------------ */

export const QUESTIONS: readonly QuestionProfil[] = [
  {
    id: 'experience',
    intitule: 'Notre niveau d’expérience avec les produits hypothécaires est :',
    question: 'Votre expérience avec les produits hypothécaires ?',
    disposition: 'liste',
    options: [
      { cle: 'reduit', label: 'Réduit (jamais eu d’hypothèque)', caseAcocher: [28.1, 508.8] },
      { cle: 'moyen', label: 'Moyen (déjà eu une ou deux hypothèques)', caseAcocher: [28.1, 490.2] },
      { cle: 'excellent', label: 'Excellent (déjà eu plusieurs hypothèques)', caseAcocher: [28.1, 471.5] },
    ],
  },
  {
    id: 'connaissances',
    intitule:
      'Nos connaissances des caractéristiques et particularités des produits hypothécaires disponibles sur le marché sont :',
    question: 'Vos connaissances des produits offerts sur le marché ?',
    precision: 'Il n’y a pas de mauvaise réponse — c’est ce qui me dit jusqu’où entrer dans les détails.',
    disposition: 'liste',
    options: [
      {
        cle: 'reduites',
        label: 'Réduites, à part le taux nous ne connaissons pas vraiment les autres options',
        caseAcocher: [28.1, 422.9],
      },
      {
        cle: 'moyennes',
        label:
          'Moyennes, nous connaissons quelques produits et options mais nous ne sommes pas aptes à bien les comparer',
        caseAcocher: [28.1, 404.3],
      },
      {
        cle: 'elevees',
        label:
          'Élevées, nous connaissons la majorité des produits hypothécaires et sommes capables de bien les comparer',
        caseAcocher: [28.1, 385.6],
      },
    ],
  },
  {
    id: 'absorption',
    intitule:
      'Notre capacité financière nous permettrait d\'absorber des augmentations du versement mensuel durant le terme jusqu’à :',
    question: 'Quelle hausse du versement mensuel pourriez-vous absorber ?',
    precision: 'Pendant le terme, si les taux montaient.',
    disposition: 'grille',
    options: [
      { cle: '0', label: '0 $', caseAcocher: [28.1, 340.9] },
      { cle: '100', label: '100 $', caseAcocher: [113.2, 340.9] },
      { cle: '250', label: '250 $', caseAcocher: [198.2, 340.9] },
      { cle: '500', label: '500 $', caseAcocher: [283.2, 340.9] },
      { cle: 'autre', label: 'Autre montant', caseAcocher: [354.1, 340.9] },
    ],
  },
  {
    id: 'remboursement',
    intitule: 'Les probabilités que nous remboursions notre hypothèque en entier avant la fin du terme sont :',
    question: 'Rembourser l’hypothèque en entier avant la fin du terme ?',
    precision: 'Par exemple si vous vendiez la propriété ou receviez une somme importante.',
    disposition: 'grille',
    options: [
      { cle: 'tres_faibles', label: 'Très faibles', caseAcocher: [28.1, 304.3] },
      { cle: 'faibles', label: 'Faibles', caseAcocher: [113.2, 304.3] },
      { cle: 'moyennes', label: 'Moyennes', caseAcocher: [198.2, 304.3] },
      { cle: 'elevees', label: 'Élevées', caseAcocher: [283.2, 304.3] },
    ],
  },
  {
    id: 'apports',
    intitule:
      'Les probabilités que nous ayons des apports en capital importants (plus de 15% du solde) à faire pendant le terme sont :',
    question: 'Faire des versements de capital importants pendant le terme ?',
    precision: 'On parle de plus de 15 % du solde — un héritage, un boni, la vente d’un actif.',
    disposition: 'grille',
    options: [
      { cle: 'tres_faibles', label: 'Très faibles', caseAcocher: [28.1, 267.7] },
      { cle: 'faibles', label: 'Faibles', caseAcocher: [113.2, 267.7] },
      { cle: 'moyennes', label: 'Moyennes', caseAcocher: [198.2, 267.7] },
      { cle: 'elevees', label: 'Élevées', caseAcocher: [283.2, 267.7] },
    ],
  },
  {
    id: 'besoins',
    intitule:
      'Les probabilités que nous ayons besoin d’importantes sommes d’argent au cours des 5 prochaines années sont :',
    question: 'Avoir besoin de sommes importantes d’ici 5 ans ?',
    precision: 'Rénovations, études, démarrage d’entreprise, imprévu.',
    disposition: 'grille',
    options: [
      { cle: 'tres_faibles', label: 'Très faibles', caseAcocher: [28.1, 231.1] },
      { cle: 'faibles', label: 'Faibles', caseAcocher: [113.2, 231.1] },
      { cle: 'moyennes', label: 'Moyennes', caseAcocher: [198.2, 231.1] },
      { cle: 'elevees', label: 'Élevées', caseAcocher: [283.2, 231.1] },
    ],
  },
  {
    id: 'virtuel',
    intitule:
      'Notre niveau de confort à traiter avec notre prêteur uniquement de façon virtuelle (Tél., internet, poste) est :',
    question: 'Votre confort à traiter avec un prêteur 100 % virtuel ?',
    precision: 'Certains prêteurs n’ont aucune succursale — souvent ceux qui offrent les meilleurs taux.',
    disposition: 'grille',
    options: [
      { cle: 'nul', label: 'Nul', caseAcocher: [28.1, 194.5] },
      { cle: 'correct', label: 'Correct', caseAcocher: [113.2, 194.5] },
      { cle: 'bon', label: 'Bon', caseAcocher: [198.2, 194.5] },
      { cle: 'eleve', label: 'Élevé', caseAcocher: [283.2, 194.5] },
    ],
  },
  {
    id: 'priorite',
    intitule: 'Notre priorité concernant le remboursement de l’hypothèque est :',
    question: 'Votre priorité pour le remboursement ?',
    precision: 'Une seule — celle qui compte le plus pour vous.',
    disposition: 'liste',
    options: [
      { cle: 'vite', label: 'Rembourser le plus vite possible', caseAcocher: [28.1, 157.8] },
      { cle: 'petit_paiement', label: 'Avoir le plus petit paiement possible', caseAcocher: [28.1, 143.2] },
      { cle: 'moins_interet', label: 'Payer le moins d’intérêt possible', caseAcocher: [28.1, 128.5] },
    ],
  },
];

/** Index d'accès direct par identifiant de question. */
export const QUESTIONS_PAR_ID: Readonly<Record<QuestionId, QuestionProfil>> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q]),
) as Record<QuestionId, QuestionProfil>;

/* ------------------------------------------------------------------ */
/*  Géométrie des champs libres et des signatures                      */
/* ------------------------------------------------------------------ */

/** Clé de l'option « Autre » de la question `absorption` — la seule qui ouvre un champ. */
export const CLE_AUTRE = 'autre';

/** Où écrire le montant « Autre » (la ligne pointillée se termine déjà par un « $ »). */
export const POSITION_AUTRE_MONTANT: PointPdf = [398, 342.9];

export const AUTRE_MONTANT_MIN = 1;
export const AUTRE_MONTANT_MAX = 100_000;

export const MAX_SIGNATAIRES = 3;

export interface ZoneSignature {
  /** Coin bas-gauche du tracé. */
  readonly trace: PointPdf;
  /** Origine du texte de la date. */
  readonly date: PointPdf;
}

/** Les trois lignes « Signature emprunteur N » du modèle, de haut en bas. */
export const ZONES_SIGNATURE: readonly ZoneSignature[] = [
  { trace: [145.3, 98.2], date: [385, 96.2] },
  { trace: [145.3, 73.8], date: [385, 71.8] },
  { trace: [145.3, 49.4], date: [385, 47.4] },
];

/** Gabarit d'ajustement du tracé : il est réduit pour tenir dedans, ratio conservé. */
export const TRACE_LARGEUR_MAX = 185;
export const TRACE_HAUTEUR_MAX = 24;

/** Texte exact de l'attestation cochée par chaque signataire — conservé dans la preuve. */
export const TEXTE_ATTESTATION =
  'Je confirme que ces réponses reflètent notre vision commune et que ce tracé vaut ma signature.';

/* ------------------------------------------------------------------ */
/*  Réponses — types et validation                                     */
/* ------------------------------------------------------------------ */

export interface ReponsesProfil {
  readonly choix: Readonly<Record<QuestionId, string>>;
  /** Renseigné si et seulement si `choix.absorption === 'autre'`. */
  readonly autreMontant: number | null;
}

function chaine(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/**
 * Valide un bloc de réponses reçu du client contre le catalogue ci-dessus.
 * Retourne `null` à la moindre valeur inconnue — le catalogue fait office de whitelist,
 * rien de ce que le navigateur envoie n'est repris tel quel.
 */
export function parserReponses(payload: unknown): ReponsesProfil | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const brut = payload as Record<string, unknown>;

  const choix: Partial<Record<QuestionId, string>> = {};
  for (const question of QUESTIONS) {
    const cle = chaine(brut[question.id]);
    if (!question.options.some((o) => o.cle === cle)) return null;
    choix[question.id] = cle;
  }

  let autreMontant: number | null = null;
  if (choix.absorption === CLE_AUTRE) {
    const valeur = brut.autre_montant;
    const nombre = typeof valeur === 'number' ? valeur : Number(chaine(valeur).replace(/\s/g, ''));
    if (!Number.isInteger(nombre) || nombre < AUTRE_MONTANT_MIN || nombre > AUTRE_MONTANT_MAX) {
      return null;
    }
    autreMontant = nombre;
  } else if (
    brut.autre_montant !== undefined &&
    brut.autre_montant !== null &&
    String(brut.autre_montant).trim() !== ''
  ) {
    // Un montant envoyé sans avoir choisi « Autre » signale un client incohérent.
    return null;
  }

  return { choix: choix as Record<QuestionId, string>, autreMontant };
}

/**
 * Sépare les milliers par une espace ordinaire (convention fr-CA), sans passer par `Intl` :
 * les espaces fines insécables qu'il produit ne sont pas encodables par les polices
 * standard du PDF. Le montant doit s'écrire pareil dans le récapitulatif, le courriel et
 * le document.
 */
export function formatMontant(montant: number): string {
  return String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Libellé lisible d'une réponse — utilisé dans les courriels et le récapitulatif. */
export function libelleReponse(id: QuestionId, cle: string, autreMontant: number | null = null): string {
  const option = QUESTIONS_PAR_ID[id].options.find((o) => o.cle === cle);
  if (!option) return '—';
  if (id === 'absorption' && cle === CLE_AUTRE && autreMontant !== null) {
    return `${formatMontant(autreMontant)} $`;
  }
  return option.label;
}

/** Les 8 réponses sous forme de paires [intitulé du formulaire, réponse choisie]. */
export function resumerReponses(reponses: ReponsesProfil): Array<[string, string]> {
  return QUESTIONS.map((q) => [
    q.intitule,
    libelleReponse(q.id, reponses.choix[q.id], reponses.autreMontant),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Signataires                                                        */
/* ------------------------------------------------------------------ */

export interface Signataire {
  readonly nom: string;
  readonly courriel: string;
}

export const NOM_MIN = 2;
export const NOM_MAX = 60;

const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

export function estCourrielValide(valeur: string): boolean {
  return EMAIL_RE.test(valeur) && valeur.length <= 120;
}

/**
 * Valide la liste des signataires : 1 à 3, noms plausibles, courriels valides et
 * **distincts entre eux** — deux signataires qui partagent une adresse ruineraient la
 * seule chose que la chaîne de signature prouve (le contrôle d'une boîte distincte).
 */
export function parserSignataires(payload: unknown): Signataire[] | null {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > MAX_SIGNATAIRES) return null;

  const signataires: Signataire[] = [];
  const adressesVues = new Set<string>();

  for (const entree of payload) {
    if (typeof entree !== 'object' || entree === null) return null;
    const brut = entree as Record<string, unknown>;
    const nom = chaine(brut.nom);
    const courriel = chaine(brut.courriel).toLowerCase();

    if (nom.length < NOM_MIN || nom.length > NOM_MAX) return null;
    if (!estCourrielValide(courriel)) return null;
    if (adressesVues.has(courriel)) return null;

    adressesVues.add(courriel);
    signataires.push({ nom, courriel });
  }

  return signataires;
}

/* ------------------------------------------------------------------ */
/*  Tracés de signature (PNG)                                          */
/* ------------------------------------------------------------------ */

export const SIGNATURE_POIDS_MAX = 500 * 1024;
export const SIGNATURE_LARGEUR_MAX_PX = 2000;
export const SIGNATURE_HAUTEUR_MAX_PX = 800;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decoderBase64(base64: string): Uint8Array | null {
  try {
    // atob existe dans le runtime des fonctions Netlify (Node ≥ 16) comme dans le navigateur.
    const binaire = atob(base64);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
    return octets;
  } catch {
    return null;
  }
}

/**
 * Décode et valide un tracé de signature reçu en `data:image/png;base64,…`.
 *
 * Le PNG n'est jamais pris au mot : nombre magique, poids et dimensions (lues dans le
 * chunk IHDR) sont vérifiés avant que pdf-lib ne touche aux octets. Retourne `null` si
 * quoi que ce soit cloche.
 */
export function decoderTraceSignature(dataUrl: unknown): Uint8Array | null {
  const valeur = chaine(dataUrl);
  const prefixe = 'data:image/png;base64,';
  if (!valeur.startsWith(prefixe)) return null;

  const base64 = valeur.slice(prefixe.length);
  // 4/3 : facteur d'expansion du base64. Écarte les charges trop lourdes avant de décoder.
  if (base64.length > SIGNATURE_POIDS_MAX * 1.4) return null;

  const octets = decoderBase64(base64);
  if (!octets || octets.length < 24 || octets.length > SIGNATURE_POIDS_MAX) return null;

  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (octets[i] !== PNG_MAGIC[i]) return null;
  }

  // IHDR : largeur et hauteur en entiers 32 bits big-endian aux offsets 16 et 20.
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const largeur = vue.getUint32(16);
  const hauteur = vue.getUint32(20);
  if (largeur < 8 || hauteur < 8) return null;
  if (largeur > SIGNATURE_LARGEUR_MAX_PX || hauteur > SIGNATURE_HAUTEUR_MAX_PX) return null;

  return octets;
}
