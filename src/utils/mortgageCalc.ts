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
 * SCHL insurance rate based on LTV ratio.
 * Used in the Simulator where we calculate LTV iteratively.
 */
export function tauxPrimeSCHL(ltv: number): number {
  if (ltv <= 0.65) return 0.006;
  if (ltv <= 0.75) return 0.017;
  if (ltv <= 0.80) return 0.024;
  if (ltv <= 0.85) return 0.028;
  if (ltv <= 0.90) return 0.031;
  if (ltv <= 0.95) return 0.04;
  return 0;
}

/**
 * SCHL insurance premium amount.
 * Used in the Calculator where ratio tiers are applied directly.
 * Returns 0 if down payment ≥ 20% or < 5% (illegal).
 */
export function calculateSCHL(prix: number, mise: number): number {
  const ratio = (mise / prix) * 100;
  if (ratio >= 20 || ratio < 5) return 0;
  const pret = prix - mise;
  if (ratio < 10) return pret * 0.04;
  if (ratio < 15) return pret * 0.031;
  return pret * 0.028;
}

/**
 * Minimum required down payment — Canadian rules.
 * 5% on first $500k, 10% on $500k–$999,999, 20% if ≥ $1M.
 */
export function miseMinimale(prix: number): number {
  if (prix <= 500_000) return prix * 0.05;
  if (prix < 1_000_000) return 25_000 + (prix - 500_000) * 0.1;
  return prix * 0.2;
}

/**
 * Maximum purchase price supported by a given down payment.
 * Returns the highest prix such that miseMinimale(prix) <= mise.
 * Considers both insured (<$1M) and conventional (≥$1M) tiers and
 * picks whichever produces the higher feasible price.
 */
export function prixMaxParMise(mise: number): number {
  if (mise <= 0) return 0;
  // Tier 1: prix ≤ 500k requires mise ≥ 5%
  if (mise < 25_000) return mise / 0.05;
  // Tier 2: 500k < prix < 1M requires mise ≥ 25k + 10% of (prix − 500k)
  const tier2 = Math.min((mise - 25_000) / 0.1 + 500_000, 999_999);
  // Tier 3: prix ≥ 1M requires mise ≥ 20%
  const tier3 = mise / 0.2;
  if (tier3 >= 1_000_000) return Math.max(tier2, tier3);
  return tier2;
}

/**
 * Quebec land transfer tax (droits de mutation / taxe de bienvenue).
 */
export function droitsMutation(prix: number): number {
  const tranches = [
    { seuil: 58_900, taux: 0.005 },
    { seuil: 294_600, taux: 0.01 },
    { seuil: 500_000, taux: 0.015 },
    { seuil: Infinity, taux: 0.02 },
  ];
  let dm = 0;
  let prev = 0;
  for (const t of tranches) {
    const base = Math.min(prix, t.seuil);
    if (base > prev) dm += (base - prev) * t.taux;
    prev = t.seuil;
    if (prix <= t.seuil) break;
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
 * @returns        { prix, miseMin } — purchase price and required minimum down payment
 */
export function calcAbsoluteMax(
  pretMax: number
): { prix: number; miseMin: number } {
  if (pretMax <= 0) return { prix: 0, miseMin: 0 };

  // --- Conventional scenario (≥ $1M, 20% down, no SCHL) ---
  const prixConv = pretMax / 0.8;
  // Only valid if the loan at that price is ≥ 20% down
  const isConvValid = prixConv >= 1_000_000;

  // --- Insured scenario (< $1M, min down payment, SCHL applies) ---
  // Iterate to converge: prix = (pretMax / (1 + SCHL_rate)) + miseMinimale(prix)
  // Initial guess capped just under $1M so high pretMax values don't short-circuit.
  let prixIns = Math.min(pretMax / 0.95, 999_999);
  let miseIns = miseMinimale(prixIns);

  for (let i = 0; i < 30; i++) {
    const ltv = (prixIns - miseIns) / prixIns;
    const schlRate = tauxPrimeSCHL(ltv);
    const baseLoan = pretMax / (1 + schlRate);
    let nextPrix = baseLoan + miseIns;
    if (nextPrix >= 1_000_000) nextPrix = 999_999;
    if (Math.abs(nextPrix - prixIns) < 10) {
      prixIns = nextPrix;
      miseIns = miseMinimale(prixIns);
      break;
    }
    prixIns = nextPrix;
    miseIns = miseMinimale(prixIns);
  }

  const insValid = prixIns > 0 && prixIns < 1_000_000;

  if (isConvValid && (!insValid || prixConv > prixIns)) {
    return { prix: Math.round(prixConv), miseMin: Math.round(prixConv * 0.2) };
  }

  if (insValid) {
    return { prix: Math.round(prixIns), miseMin: Math.round(miseIns) };
  }

  // Fallback: conventional even if < $1M (borrower must put 20%)
  return { prix: Math.round(pretMax / 0.8), miseMin: Math.round(pretMax / 4) };
}
