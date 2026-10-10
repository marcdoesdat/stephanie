// Capacité d'emprunt — le calcul du simulateur, sorti de Simulator.astro pour n'exister qu'à
// un seul endroit. Le simulateur complet (/outils#simulateur) et le calculateur express de
// l'accueil l'appellent tous deux : mêmes entrées, même chiffre. Deux copies auraient fini
// par montrer 412 000 $ à l'accueil et 398 000 $ une page plus loin.
//
// Règles canadiennes : test de résistance (taux + 2 % ou 5,25 %, le plus élevé), ratios
// ABD/ATD 39/44 % (assuré) et 35/42 % (conventionnel), prime SCHL, mise de fonds minimale.

import {
  calcPaiement,
  calcAbsoluteMax,
  miseMinimale,
  prixMaxParMise,
  pvFromPmt,
  tauxMensuel,
  tauxPrimeSCHL,
} from './mortgageCalc';

export const TAUX_QUALIFICATION_PLANCHER = 5.25;

export const RATIOS = {
  assure: { abd: 0.39, atd: 0.44 },
  conventionnel: { abd: 0.35, atd: 0.42 },
} as const;

/** Part des frais de condo que les prêteurs comptent dans l'ABD (et donc dans l'ATD). */
export const PART_FRAIS_CONDO = 0.5;

/**
 * Part du solde des cartes de crédit et du crédit rotatif (marges) que les prêteurs comptent
 * comme paiement mensuel dans l'ATD. Le calculateur express demande le solde, pas un paiement :
 * personne ne connaît « le paiement » d'une marge, tout le monde connaît ce qu'il doit.
 */
export const PART_SOLDE_ROTATIF = 0.03;

/** Les paiements fixes d'un ménage, cartes et marges comprises — ce que le calcul appelle « dettes ». */
export function dettesEquivalentes(paiementsFixes: number, soldeRotatif: number): number {
  return paiementsFixes + soldeRotatif * PART_SOLDE_ROTATIF;
}

/**
 * Hypothèses de frais de propriété : valeurs par défaut du simulateur complet, et seules
 * valeurs du calculateur express. C'est ce partage qui garantit le même chiffre aux deux
 * endroits — le simulateur les lit d'ici plutôt que de les répéter dans son HTML.
 */
export const FRAIS_DEFAUT = { taxes: 250, chauffage: 100 } as const;
export const AMORTISSEMENT_DEFAUT = 25;

export interface EntreesCapacite {
  /** Revenu annuel brut du ménage */
  revenu: number;
  /** Paiements fixes mensuels (prêts, pension alimentaire, cartes) */
  dettes: number;
  mise: number;
  /** Taux contractuel annuel, en % */
  taux: number;
  amortAns: number;
  /** Frais mensuels de la propriété visée */
  taxes: number;
  chauffage: number;
  condo: number;
}

export type MotifEchec =
  | 'revenu_absent'
  | 'amortissement_30_ans'
  | 'revenu_insuffisant'
  | 'mise_absente';

export interface CapaciteCalculee {
  ok: true;
  assure: boolean;
  prixMax: number;
  pretBase: number;
  primeSCHL: number;
  pretTotal: number;
  /** Versement mensuel au taux contractuel */
  versement: number;
  /** Ratios en %, au taux de qualification */
  abd: number;
  atd: number;
  abdLimite: number;
  atdLimite: number;
  tauxQualification: number;
  /** Le revenu permettait davantage : c'est la mise de fonds qui fixe le prix. */
  plafonneParMise: boolean;
  /** Scénario « mise de fonds minimale » — capacité tirée du seul revenu */
  maxAbsolu: { prix: number; miseMin: number } | null;
}

export type ResultatCapacite = CapaciteCalculee | { ok: false; motif: MotifEchec };

/** Frais de propriété retenus dans les ratios : taxes, chauffage et la moitié du condo. */
export function fraisProprietes(taxes: number, chauffage: number, condo: number): number {
  return taxes + chauffage + condo * PART_FRAIS_CONDO;
}

export function tauxQualification(taux: number): number {
  return Math.max(taux + 2, TAUX_QUALIFICATION_PLANCHER);
}

export function calculerCapacite(e: EntreesCapacite): ResultatCapacite {
  const { revenu, dettes, mise, taux, amortAns } = e;
  if (!(revenu > 0)) return { ok: false, motif: 'revenu_absent' };

  const revMensuel = revenu / 12;
  const tauxStress = tauxQualification(taux);
  const rStress = tauxMensuel(tauxStress);
  const n = amortAns * 12;
  const fraisProp = fraisProprietes(e.taxes, e.chauffage, e.condo);

  // Prêt maximal au taux de qualification, sous les deux plafonds de ratios
  function maxPret(abd: number, atd: number): number {
    const pmtABD = revMensuel * abd - fraisProp;
    const pmtATD = revMensuel * atd - dettes - fraisProp;
    return pvFromPmt(Math.min(pmtABD, pmtATD), rStress, n);
  }
  const pretMaxAssure = maxPret(RATIOS.assure.abd, RATIOS.assure.atd);
  const pretMaxConv = maxPret(RATIOS.conventionnel.abd, RATIOS.conventionnel.atd);

  // Scénario assuré : la prime SCHL dépend du ratio prêt/valeur, qui dépend du prix — on itère
  let prixAssure = 0, baseAssure = 0, primeAssure = 0;
  if (pretMaxAssure > 0) {
    let prix = pretMaxAssure + mise;
    for (let i = 0; i < 10; i++) {
      const base = pretMaxAssure / (1 + tauxPrimeSCHL((prix - mise) / prix));
      prix = base + mise;
    }
    prixAssure = prix;
    baseAssure = prixAssure - mise;
    primeAssure = baseAssure * tauxPrimeSCHL(baseAssure / prixAssure);
  }
  const prixConv = pretMaxConv + mise;

  let assure: boolean, prixMax: number, pretBase: number, primeSCHL: number;
  if (amortAns > 25) {
    assure = false;
    prixMax = prixConv;
    pretBase = pretMaxConv;
    primeSCHL = 0;
    if (pretBase <= 0 || mise / prixMax < 0.20) return { ok: false, motif: 'amortissement_30_ans' };
  } else if (prixAssure > 0 && prixAssure < 1_000_000 && mise / prixAssure < 0.20) {
    assure = true;
    prixMax = prixAssure;
    pretBase = baseAssure;
    primeSCHL = primeAssure;
  } else {
    assure = false;
    prixMax = prixConv;
    pretBase = pretMaxConv;
    primeSCHL = 0;
  }

  if (pretBase <= 0) return { ok: false, motif: 'revenu_insuffisant' };

  // Mise de fonds minimale : si elle ne suffit pas au prix que le revenu permet, elle le plafonne
  let plafonneParMise = false;
  if (mise < miseMinimale(prixMax)) {
    const cap = prixMaxParMise(mise);
    if (cap < prixMax) {
      prixMax = cap;
      pretBase = prixMax - mise;
      primeSCHL = assure ? pretBase * tauxPrimeSCHL(pretBase / prixMax) : 0;
      plafonneParMise = true;
    }
  }
  // Sans mise de fonds, aucun prix n'est atteignable — et 0/0 afficherait « NaN % »
  if (!(prixMax > 0)) return { ok: false, motif: 'mise_absente' };

  const pretTotal = pretBase + primeSCHL;
  const pmtStress = calcPaiement(pretTotal, tauxStress, amortAns, 12);
  // Plafonds assurés : les plus permissifs, la mise de fonds actuelle mise de côté
  const absolu = pretMaxAssure > 0 ? calcAbsoluteMax(pretMaxAssure) : null;

  return {
    ok: true,
    assure,
    prixMax,
    pretBase,
    primeSCHL,
    pretTotal,
    versement: calcPaiement(pretTotal, taux, amortAns, 12),
    abd: ((pmtStress + fraisProp) / revMensuel) * 100,
    atd: ((pmtStress + fraisProp + dettes) / revMensuel) * 100,
    abdLimite: (assure ? RATIOS.assure.abd : RATIOS.conventionnel.abd) * 100,
    atdLimite: (assure ? RATIOS.assure.atd : RATIOS.conventionnel.atd) * 100,
    tauxQualification: tauxStress,
    plafonneParMise,
    maxAbsolu: absolu && absolu.prix > 0 ? absolu : null,
  };
}

/** La phrase qui explique un échec — partagée par les deux calculateurs. */
export function messageEchec(motif: MotifEchec, e: Pick<EntreesCapacite, 'dettes' | 'taxes' | 'chauffage' | 'condo'>): string | null {
  switch (motif) {
    case 'revenu_absent':
      return null;
    case 'amortissement_30_ans':
      return 'L’amortissement de 30 ans requiert une mise de fonds d’au moins 20 % du prix d’achat.';
    case 'mise_absente':
      return 'Une mise de fonds d’au moins 5 % du prix d’achat est requise.';
    case 'revenu_insuffisant': {
      const aDesDettes = e.dettes > 0;
      const aDesFrais = fraisProprietes(e.taxes, e.chauffage, e.condo) > 0;
      if (aDesDettes && aDesFrais) {
        return 'Vos charges mensuelles (dettes et frais de propriété) dépassent ce que votre revenu permet selon les ratios d’endettement. Augmentez le revenu ou réduisez les dettes et frais.';
      }
      if (aDesDettes) {
        return 'Vos dettes mensuelles dépassent ce que votre revenu permet selon les ratios d’endettement. Augmentez le revenu ou réduisez les dettes.';
      }
      if (aDesFrais) {
        return 'Les frais de propriété saisis dépassent ce que votre revenu permet selon les ratios d’endettement. Réduisez les frais de propriété ou augmentez le revenu.';
      }
      return 'Le revenu saisi est trop faible pour permettre un emprunt selon les ratios d’endettement.';
    }
  }
}

/** Lit un montant saisi « 80 000 », « 80000 » ou « 1 250,50 ». Toute saisie illisible vaut 0. */
export function lireMontant(s: string): number {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Formate un montant pour un champ de saisie : « 80 000 » (espace fine insécable). */
export function formaterSaisie(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---------------------------------------------------------------------------
// Passage du calculateur express au simulateur complet
// ---------------------------------------------------------------------------
// Par sessionStorage, jamais par l'URL : un revenu n'a rien à faire dans l'historique d'un
// appareil parfois partagé. Écrit au clic, lu une fois à l'arrivée, puis effacé.

export const CLE_TRANSFERT_EXPRESS = 'capacite-express';
export const TRANSFERT_VALIDITE_MS = 30 * 60 * 1000;

export interface TransfertExpress {
  revenu?: number;
  dettes?: number;
  mise?: number;
  condo?: number;
  taux?: number;
}

/**
 * Décode le transfert de façon défensive : un champ hors limites est écarté seul, un
 * transfert périmé ou illisible n'apporte rien. Le simulateur garde alors ses défauts.
 */
export function decoderTransfert(raw: string | null, maintenant: number): TransfertExpress | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const ts = d.ts;
  if (typeof ts !== 'number' || maintenant - ts > TRANSFERT_VALIDITE_MS || ts - maintenant > 60_000) return null;

  const montant = (v: unknown, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;

  const t: TransfertExpress = {};
  const revenu = montant(d.revenu, 100_000_000);
  const dettes = montant(d.dettes, 1_000_000);
  const mise = montant(d.mise, 100_000_000);
  const condo = montant(d.condo, 100_000);
  const taux = typeof d.taux === 'number' && d.taux >= 0.5 && d.taux <= 20 ? d.taux : undefined;
  if (revenu !== undefined) t.revenu = revenu;
  if (dettes !== undefined) t.dettes = dettes;
  if (mise !== undefined) t.mise = mise;
  if (condo !== undefined) t.condo = condo;
  if (taux !== undefined) t.taux = taux;
  return Object.keys(t).length > 0 ? t : null;
}
