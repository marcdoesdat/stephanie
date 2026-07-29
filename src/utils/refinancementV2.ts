/**
 * Funnel publicitaire /refinancement-v2 — tranches, libellés et calcul d'équité.
 *
 * La V2 ne demande aucun chiffre exact : le prospect choisit une tranche de valeur et
 * une tranche de solde. L'équité est donc *déduite* du milieu de chaque tranche, jamais
 * déclarée. Ces estimations servent uniquement à qualifier le lead à l'interne — elles
 * ne sont jamais présentées comme un montant ferme.
 *
 * Ce module est la source de vérité partagée entre la page (rendu des cartes) et
 * l'endpoint /api/refinancement-v2-submit (whitelist de validation + libellés courriel),
 * sur le modèle de la table LABELS de src/pages/api/refinancement-submit.ts.
 *
 * Placé dans src/utils/ parce que netlify.toml inclut déjà `src/utils/**` dans les
 * included_files des fonctions SSR.
 *
 * @module refinancementV2
 */

/** Ratio d'équité sous lequel le dossier est signalé « faible » à l'interne. */
export const RATIO_EQUITE_MIN = 0.2;

/** Prêt maximal usuel en refinancement conventionnel : 80 % de la valeur marchande. */
export const LTV_MAX = 0.8;

/* ────────────────────────────── Q1 — Intention ────────────────────────────── */

export const INTENTIONS = {
  baisser_paiements: 'Baisser mes paiements mensuels',
  effacer_dettes: 'Effacer mes dettes à taux élevé (cartes, prêt auto, marge)',
  financer_renos: 'Financer des rénovations sans toucher aux économies',
  racheter_part: 'Racheter la part de mon ex / conjoint',
} as const;

export type IntentionCle = keyof typeof INTENTIONS;

/* ───────────────────── Q2 / Q3 — Tranches de valeur et de solde ───────────────────── */

export interface TrancheValeur {
  readonly label: string;
  /** Milieu de tranche utilisé pour le calcul d'équité. */
  readonly milieu: number;
}

export interface TrancheSolde {
  readonly label: string;
  /** Milieu de tranche, ou `null` quand le prospect ne connaît pas son solde. */
  readonly milieu: number | null;
}

export type ValeurCle = '300_400' | '400_500' | '500_650' | '650_plus';
export type SoldeCle = 'moins_200' | '200_350' | '350_500' | 'ne_sais_pas';

export const VALEURS: Record<ValeurCle, TrancheValeur> = {
  '300_400': { label: '300 000 $ à 400 000 $', milieu: 350_000 },
  '400_500': { label: '400 000 $ à 500 000 $', milieu: 450_000 },
  '500_650': { label: '500 000 $ à 650 000 $', milieu: 575_000 },
  // Tranche ouverte : on reste volontairement conservateur pour ne pas gonfler l'estimation.
  '650_plus': { label: '650 000 $ et plus', milieu: 725_000 },
};

export const SOLDES: Record<SoldeCle, TrancheSolde> = {
  moins_200: { label: 'Moins de 200 000 $', milieu: 150_000 },
  '200_350': { label: '200 000 $ à 350 000 $', milieu: 275_000 },
  '350_500': { label: '350 000 $ à 500 000 $', milieu: 425_000 },
  ne_sais_pas: { label: 'Je ne suis pas sûr', milieu: null },
};

/* ────────────────────────────── Gardes de type ────────────────────────────── */

export function estIntentionCle(value: string): value is IntentionCle {
  return Object.prototype.hasOwnProperty.call(INTENTIONS, value);
}

export function estValeurCle(value: string): value is ValeurCle {
  return Object.prototype.hasOwnProperty.call(VALEURS, value);
}

export function estSoldeCle(value: string): value is SoldeCle {
  return Object.prototype.hasOwnProperty.call(SOLDES, value);
}

/* ────────────────────────────── Libellés ────────────────────────────── */

/** Libellé lisible d'une intention ; retourne la valeur brute si la clé est inconnue. */
export function libelleIntention(value: string): string {
  return estIntentionCle(value) ? INTENTIONS[value] : value;
}

/** Libellé lisible d'une tranche de valeur ; retourne la valeur brute si la clé est inconnue. */
export function libelleValeur(value: string): string {
  return estValeurCle(value) ? VALEURS[value].label : value;
}

/** Libellé lisible d'une tranche de solde ; retourne la valeur brute si la clé est inconnue. */
export function libelleSolde(value: string): string {
  return estSoldeCle(value) ? SOLDES[value].label : value;
}

/* ────────────────────────────── Calcul d'équité ────────────────────────────── */

/**
 * - `bonne` : équité estimée ≥ 20 % de la valeur — refinancement conventionnel plausible.
 * - `faible` : équité estimée < 20 % — le lead reste valide, mais à valider avant l'appel.
 * - `inconnue` : le prospect ignore son solde — rien ne peut être déduit.
 */
export type NiveauEquite = 'bonne' | 'faible' | 'inconnue';

export interface Equite {
  /** Milieu de la tranche de valeur choisie. */
  valeurEstimee: number;
  /** Milieu de la tranche de solde choisie, ou `null` si « Je ne suis pas sûr ». */
  soldeEstime: number | null;
  /** Valeur estimée − solde estimé (peut être négatif). */
  equite: number | null;
  /** equite / valeurEstimee. */
  ratio: number | null;
  /** Montant refinançable estimé : max(0, valeur × 80 % − solde). */
  disponible80: number | null;
  niveau: NiveauEquite;
}

/** Classe un ratio d'équité. La frontière de 20 % est incluse dans « bonne ». */
export function classerRatio(ratio: number): Exclude<NiveauEquite, 'inconnue'> {
  return ratio < RATIO_EQUITE_MIN ? 'faible' : 'bonne';
}

/**
 * Déduit l'équité à partir des deux tranches choisies dans le funnel.
 *
 * @returns `null` si l'une des clés est invalide — l'appelant doit alors rejeter la soumission.
 */
export function evaluerEquite(valeurCle: string, soldeCle: string): Equite | null {
  if (!estValeurCle(valeurCle) || !estSoldeCle(soldeCle)) return null;

  const valeurEstimee = VALEURS[valeurCle].milieu;
  const soldeEstime = SOLDES[soldeCle].milieu;

  if (soldeEstime === null) {
    return {
      valeurEstimee,
      soldeEstime: null,
      equite: null,
      ratio: null,
      disponible80: null,
      niveau: 'inconnue',
    };
  }

  const equite = valeurEstimee - soldeEstime;
  const ratio = equite / valeurEstimee;

  return {
    valeurEstimee,
    soldeEstime,
    equite,
    ratio,
    disponible80: Math.max(0, Math.round(valeurEstimee * LTV_MAX - soldeEstime)),
    niveau: classerRatio(ratio),
  };
}
