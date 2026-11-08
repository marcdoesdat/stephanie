// Capacité d'emprunt — le calcul du simulateur, sorti de Simulator.astro pour n'exister qu'à
// un seul endroit. Le simulateur complet (/outils#simulateur) et le calculateur express de
// l'accueil l'appellent tous deux : mêmes entrées, même chiffre. Deux copies auraient fini
// par montrer 412 000 $ à l'accueil et 398 000 $ une page plus loin.
//
// Règles canadiennes : test de résistance (taux + 2 % ou 5,25 %, le plus élevé), ratios
// ABD/ATD 39/44 % (assuré) et 35/42 % (conventionnel), prime SCHL, mise de fonds minimale.
// Depuis le 15 décembre 2024 : prêt assuré jusqu'à 1,5 M$ pour tous, et sur 30 ans pour un
// premier achat ou une construction neuve (surprime de 0,20 % sur la prime).

import {
  AMORTISSEMENT_ASSURE_STANDARD,
  PLAFOND_ASSURABLE,
  calcPaiement,
  calcAbsoluteMax,
  miseMinimale,
  prixAssurableParMise,
  prixMaxParMise,
  pvFromPmt,
  tauxMensuel,
  tauxPrimeAssurance,
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
  /**
   * Premier achat ou construction neuve : ce qui ouvre l'amortissement de 30 ans à un prêt
   * assuré (mise de fonds sous 20 %). Absent, la réponse est « non » — c'est la règle la plus
   * restrictive, jamais une admissibilité supposée.
   */
  premierAchatOuNeuf?: boolean;
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
  maxAbsolu: { prix: number; miseMin: number; assure: boolean } | null;
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

  // Un prêt assuré s'amortit sur 25 ans au plus, sauf premier achat ou construction neuve (30 ans)
  const assurable = amortAns <= AMORTISSEMENT_ASSURE_STANDARD || e.premierAchatOuNeuf === true;
  const tauxPrime = (ltv: number) => tauxPrimeAssurance(ltv, amortAns);

  // Scénario assuré : la prime SCHL dépend du ratio prêt/valeur, qui dépend du prix — on itère
  let prixAssure = 0, baseAssure = 0, primeAssure = 0;
  if (assurable && pretMaxAssure > 0) {
    let prix = pretMaxAssure + mise;
    for (let i = 0; i < 10; i++) {
      const base = pretMaxAssure / (1 + tauxPrime((prix - mise) / prix));
      prix = base + mise;
    }
    prixAssure = prix;
    baseAssure = prixAssure - mise;
    primeAssure = baseAssure * tauxPrime(baseAssure / prixAssure);
  }
  const prixConv = pretMaxConv + mise;

  let assure: boolean, prixMax: number, pretBase: number, primeSCHL: number;
  let plafonneParMise = false;
  if (!assurable) {
    // 30 ans sans premier achat ni construction neuve : conventionnel seulement, donc 20 % de mise
    assure = false;
    prixMax = prixConv;
    pretBase = pretMaxConv;
    primeSCHL = 0;
    if (pretBase > 0 && mise / prixMax < 0.20) return { ok: false, motif: 'amortissement_30_ans' };
  } else if (prixAssure > 0 && prixAssure < PLAFOND_ASSURABLE && mise / prixAssure < 0.20) {
    assure = true;
    prixMax = prixAssure;
    pretBase = baseAssure;
    primeSCHL = primeAssure;
  } else if (prixAssure >= PLAFOND_ASSURABLE && mise / prixConv < 0.20) {
    // Le revenu irait au-delà de 1,5 M$, mais la mise est sous 20 % : le prêt assuré s'arrête
    // sous le plafond, le conventionnel exige 20 % de mise. On retient le plus haut des deux —
    // jamais un prêt conventionnel avec moins de 20 % de mise.
    const prixI = prixAssurableParMise(mise);
    const prixC = Math.min(prixConv, mise / 0.20);
    plafonneParMise = true;
    if (prixI > 0 && mise / prixI < 0.20 && prixI >= prixC) {
      assure = true;
      prixMax = prixI;
      pretBase = prixI - mise;
      primeSCHL = pretBase * tauxPrime(pretBase / prixI);
    } else {
      assure = false;
      prixMax = prixC;
      pretBase = prixC - mise;
      primeSCHL = 0;
    }
  } else {
    assure = false;
    prixMax = prixConv;
    pretBase = pretMaxConv;
    primeSCHL = 0;
  }

  if (pretBase <= 0) return { ok: false, motif: 'revenu_insuffisant' };

  // Mise de fonds minimale : si elle ne suffit pas au prix que le revenu permet, elle le plafonne
  if (mise < miseMinimale(prixMax)) {
    const cap = prixMaxParMise(mise);
    if (cap < prixMax) {
      prixMax = cap;
      pretBase = prixMax - mise;
      primeSCHL = assure ? pretBase * tauxPrime(pretBase / prixMax) : 0;
      plafonneParMise = true;
    }
  }
  // Sans mise de fonds, aucun prix n'est atteignable — et 0/0 afficherait « NaN % »
  if (!(prixMax > 0)) return { ok: false, motif: 'mise_absente' };

  const pretTotal = pretBase + primeSCHL;
  const pmtStress = calcPaiement(pretTotal, tauxStress, amortAns, 12);
  // Mise de fonds minimale, la mise actuelle mise de côté : plafonds assurés quand le prêt peut
  // l'être, sinon 20 % sur la capacité conventionnelle.
  let maxAbsolu: CapaciteCalculee['maxAbsolu'] = null;
  if (assurable) {
    const a = pretMaxAssure > 0 ? calcAbsoluteMax(pretMaxAssure, amortAns) : null;
    if (a && a.prix > 0) maxAbsolu = { ...a, assure: a.prix < PLAFOND_ASSURABLE && a.miseMin < a.prix * 0.2 };
  } else if (pretMaxConv > 0) {
    const prix = pretMaxConv / 0.8;
    maxAbsolu = { prix: Math.round(prix), miseMin: Math.round(prix * 0.2), assure: false };
  }

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
    maxAbsolu,
  };
}

/**
 * Le revenu annuel le plus bas pour lequel `calculerCapacite` accorde ce prix avec cette mise,
 * sans autres dettes, avec les frais de propriété par défaut — le calcul rapide des pages villes.
 * Recherche par dichotomie sur le calcul du simulateur plutôt qu'une formule réécrite : la réponse
 * reste celle que donnerait le simulateur. Arrondi au millier supérieur. `null` si même un très
 * haut revenu ne suffit pas (mise de fonds sous le minimum, par exemple).
 */
export function revenuNecessaire(prix: number, mise: number, taux: number): number | null {
  const accorde = (revenu: number) => {
    const r = calculerCapacite({
      revenu, dettes: 0, mise, taux, amortAns: AMORTISSEMENT_DEFAUT,
      taxes: FRAIS_DEFAUT.taxes, chauffage: FRAIS_DEFAUT.chauffage, condo: 0,
    });
    return r.ok && r.prixMax >= prix;
  };
  let bas = 10_000;
  let haut = 2_000_000;
  if (!(prix > 0) || !accorde(haut)) return null;
  while (haut - bas > 100) {
    const milieu = (bas + haut) / 2;
    if (accorde(milieu)) haut = milieu;
    else bas = milieu;
  }
  return Math.ceil(haut / 1000) * 1000;
}

/** La phrase qui explique un échec — partagée par les deux calculateurs. */
export function messageEchec(motif: MotifEchec, e: Pick<EntreesCapacite, 'dettes' | 'taxes' | 'chauffage' | 'condo'>): string | null {
  switch (motif) {
    case 'revenu_absent':
      return null;
    case 'amortissement_30_ans':
      return 'Avec moins de 20 % de mise de fonds, l’amortissement de 30 ans est réservé au premier achat et à la construction neuve. Cochez la case si c’est votre cas, ou choisissez 25 ans.';
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
