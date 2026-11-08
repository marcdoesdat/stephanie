// Shared mortgage calculation utilities — Canadian rules
// Used by Calculator.astro, Simulator.astro, and amortissement.astro

/** Format a number as CAD currency (fr-CA locale, no decimals) */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Effective monthly rate from an annual nominal rate,
 * using Canadian standard semi-annual compounding.
 */
export function tauxMensuel(tauxAnnuel: number): number {
  return tauxPeriodique(tauxAnnuel, 12);
}

/**
 * Effective per-period rate from an annual nominal rate,
 * using Canadian standard semi-annual compounding.
 * @param freq Number of periods per year (12 = monthly, 26 = bi-weekly, 52 = weekly)
 */
export function tauxPeriodique(tauxAnnuel: number, freq: number): number {
  return Math.pow(Math.pow(1 + tauxAnnuel / 100 / 2, 2), 1 / freq) - 1;
}

/**
 * Standard (non-accelerated) periodic mortgage payment, Canadian rules.
 * Used by Calculator and amortissement to keep both pages consistent.
 */
export function calcPaiement(
  prêtTotal: number,
  tauxAnnuel: number,
  amortAns: number,
  freq: number
): number {
  const r = tauxPeriodique(tauxAnnuel, freq);
  const n = amortAns * freq;
  if (r <= 0) return prêtTotal / n;
  return (prêtTotal * r) / (1 - Math.pow(1 + r, -n));
}

/** PV (present value / loan amount) from a monthly payment */
export function pvFromPmt(pmt: number, r: number, n: number): number {
  if (pmt <= 0 || r <= 0) return 0;
  return (pmt * (Math.pow(1 + r, n) - 1)) / (r * Math.pow(1 + r, n));
}

/**
 * Plafond des prêts assurés (SCHL et autres assureurs) depuis le 15 décembre 2024 : une
 * propriété de 1,5 M$ ou plus ne peut pas être assurée, donc exige 20 % de mise de fonds.
 * Le plafond vaut pour tous les acheteurs, pas seulement pour un premier achat.
 */
export const PLAFOND_ASSURABLE = 1_500_000;

/** Amortissement maximal d'un prêt assuré, hors premier achat et construction neuve. */
export const AMORTISSEMENT_ASSURE_STANDARD = 25;

/**
 * Depuis le 15 décembre 2024, un prêt assuré peut être amorti sur 30 ans pour un premier achat
 * ou une construction neuve. L'assureur ajoute alors 0,20 % au taux de la prime.
 */
export const SURPRIME_AMORTISSEMENT_PROLONGE = 0.002;

/**
 * SCHL insurance rate based on LTV ratio.
 * Used in the Simulator where we calculate LTV iteratively.
 */
export function tauxPrimeSCHL(ltv: number): number {
  if (ltv <= 0.65) return 0.006;
  if (ltv <= 0.75) return 0.017;
  if (ltv <= 0.80) return 0.024;
  if (ltv <= 0.85) return 0.028;
  if (ltv <= 0.90) return 0.031;
  // Une mise de fonds d'exactement 5 % donne un ratio de 0,95 que l'arrondi flottant peut
  // pousser à 0,950000000001 — et la prime tombait alors à zéro.
  if (ltv <= 0.95 + 1e-9) return 0.04;
  return 0;
}

/**
 * Taux de prime d'un prêt assuré, surprime d'amortissement prolongé comprise : au-delà de
 * 25 ans, l'assureur ajoute 0,20 %. Rien n'est ajouté quand il n'y a pas de prime.
 */
export function tauxPrimeAssurance(ltv: number, amortAns: number): number {
  const base = tauxPrimeSCHL(ltv);
  return base > 0 && amortAns > AMORTISSEMENT_ASSURE_STANDARD
    ? base + SURPRIME_AMORTISSEMENT_PROLONGE
    : base;
}

/**
 * SCHL insurance premium amount.
 * Used in the Calculator where ratio tiers are applied directly.
 * Returns 0 if down payment ≥ 20% or < 5% (illegal).
 * Au-delà de 25 ans d'amortissement, la surprime de 0,20 % s'ajoute au taux.
 */
export function calculateSCHL(prix: number, mise: number, amortAns: number = AMORTISSEMENT_ASSURE_STANDARD): number {
  const ratio = (mise / prix) * 100;
  if (ratio >= 20 || ratio < 5) return 0;
  const pret = prix - mise;
  const surprime = amortAns > AMORTISSEMENT_ASSURE_STANDARD ? SURPRIME_AMORTISSEMENT_PROLONGE : 0;
  if (ratio < 10) return pret * (0.04 + surprime);
  if (ratio < 15) return pret * (0.031 + surprime);
  return pret * (0.028 + surprime);
}

/**
 * Minimum required down payment — Canadian rules (updated Dec 15 2024).
 * 5 % on first $500 k, 10 % on $500 k–$1.5 M, 20 % at $1.5 M and more.
 * Le plafond de 1,5 M$ vaut pour tous les acheteurs : seul l'amortissement de 30 ans
 * est réservé au premier achat et à la construction neuve.
 */
export function miseMinimale(prix: number): number {
  if (prix <= 500_000) return prix * 0.05;
  if (prix < PLAFOND_ASSURABLE) return 25_000 + (prix - 500_000) * 0.1;
  return prix * 0.2;
}

/**
 * Maximum purchase price supported by a given down payment.
 * Returns the highest prix such that miseMinimale(prix) <= mise.
 * Considers both insured (< $1.5M) and conventional (≥ $1.5M) tiers and
 * picks whichever produces the higher feasible price.
 */
export function prixMaxParMise(mise: number): number {
  if (mise <= 0) return 0;
  // Tiers 1–2: prix < 1.5M requires 5 % up to 500k, then 10 % of (prix − 500k)
  const tier2 = prixAssurableParMise(mise);
  // Tier 3: prix ≥ 1.5M requires mise ≥ 20%
  const tier3 = mise / 0.2;
  if (tier3 >= PLAFOND_ASSURABLE) return Math.max(tier2, tier3);
  return tier2;
}

/** Le prix le plus élevé qu'une mise de fonds permet avec un prêt assuré — donc sous 1,5 M$. */
export function prixAssurableParMise(mise: number): number {
  if (mise <= 0) return 0;
  if (mise < 25_000) return mise / 0.05;
  return Math.min((mise - 25_000) / 0.1 + 500_000, PLAFOND_ASSURABLE - 1);
}

/**
 * Quebec land transfer tax (droits de mutation / taxe de bienvenue).
 *
 * By default uses the provincial 4-tranche schedule (2026):
 *   0 – 62 900 $ at 0.5 %, 62 900 – 315 000 $ at 1.0 %,
 *   315 000 – 500 000 $ at 1.5 %, 500 000 $+ at 2.0 %.
 *
 * Pass `municipalTranches` to replace the third+ tranches with
 * city-specific brackets.  The first two tranches are always the
 * provincial ones.
 */
export function droitsMutation(
  prix: number,
  municipalTranches?: { max: number; taux: number }[],
): number {
  const provincial = [
    { max: 62_900,  taux: 0.005 },
    { max: 315_000, taux: 0.01  },
  ];
  const municipal = municipalTranches ?? [
    { max: 500_000, taux: 0.015 },
    { max: Infinity, taux: 0.02 },
  ];
  const tranches = [...provincial, ...municipal];

  let dm = 0;
  let prev = 0;
  for (const t of tranches) {
    const base = Math.min(prix, t.max);
    if (base > prev) dm += (base - prev) * t.taux;
    prev = t.max;
    if (prix <= t.max) break;
  }
  return dm;
}

/**
 * Find the absolute maximum purchase price a borrower can afford
 * based purely on income/debt capacity (ignores their available down payment).
 *
 * Uses the minimum required down payment at each candidate price.
 * Performs iterative convergence separately for insured (<$1M) and
 * conventional (≥$1M) scenarios, then returns the higher feasible price.
 *
 * @param pretMax  Maximum affordable TOTAL loan (PV) at the stress-test rate
 * @param amortAns Amortissement retenu — au-delà de 25 ans, la prime porte la surprime
 * @returns        { prix, miseMin } — purchase price and required minimum down payment
 */
export function calcAbsoluteMax(
  pretMax: number,
  amortAns: number = AMORTISSEMENT_ASSURE_STANDARD,
): { prix: number; miseMin: number } {
  if (pretMax <= 0) return { prix: 0, miseMin: 0 };

  // --- Conventional scenario (> $1.5M, 20% down, no CMHC) ---
  const prixConv = pretMax / 0.8;
  // Only valid if the price exceeds the insured mortgage cap ($1.5 M as of Dec 15 2024)
  const isConvValid = prixConv >= PLAFOND_ASSURABLE;

  // --- Insured scenario (≤ $1.5M, min down payment, CMHC applies) ---
  // Iterate to converge: prix = (pretMax / (1 + SCHL_rate)) + miseMinimale(prix)
  // Initial guess capped just under $1.5M so high pretMax values don't short-circuit.
  let prixIns = Math.min(pretMax / 0.95, PLAFOND_ASSURABLE - 1);
  let miseIns = miseMinimale(prixIns);

  for (let i = 0; i < 30; i++) {
    const ltv = (prixIns - miseIns) / prixIns;
    const schlRate = tauxPrimeAssurance(ltv, amortAns);
    const baseLoan = pretMax / (1 + schlRate);
    let nextPrix = baseLoan + miseIns;
    if (nextPrix >= PLAFOND_ASSURABLE) nextPrix = PLAFOND_ASSURABLE - 1;
    if (Math.abs(nextPrix - prixIns) < 10) {
      prixIns = nextPrix;
      miseIns = miseMinimale(prixIns);
      break;
    }
    prixIns = nextPrix;
    miseIns = miseMinimale(prixIns);
  }

  const insValid = prixIns > 0 && prixIns < PLAFOND_ASSURABLE;

  if (isConvValid && (!insValid || prixConv > prixIns)) {
    return { prix: Math.round(prixConv), miseMin: Math.round(prixConv * 0.2) };
  }

  if (insValid) {
    return { prix: Math.round(prixIns), miseMin: Math.round(miseIns) };
  }

  // Fallback: conventional even below the insured cap (borrower must put 20%)
  return { prix: Math.round(pretMax / 0.8), miseMin: Math.round(pretMax / 4) };
}
