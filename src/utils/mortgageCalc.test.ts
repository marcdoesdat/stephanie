import { describe, it, expect } from 'vitest';
import {
  PLAFOND_ASSURABLE,
  calcAbsoluteMax,
  calculateSCHL,
  miseMinimale,
  prixMaxParMise,
  tauxPrimeAssurance,
} from './mortgageCalc';

// Règles fédérales en vigueur depuis le 15 décembre 2024.
describe('mise de fonds minimale et plafond assurable de 1,5 M$', () => {
  it('5 % jusqu’à 500 000 $, 10 % au-delà, 20 % à 1,5 M$ et plus', () => {
    expect(miseMinimale(400_000)).toBe(20_000);
    expect(miseMinimale(1_200_000)).toBe(95_000);
    expect(miseMinimale(PLAFOND_ASSURABLE - 1)).toBeCloseTo(124_999.9, 1);
    expect(miseMinimale(PLAFOND_ASSURABLE)).toBe(300_000);
  });

  it('le prix maximal permis par une mise suit les mêmes tranches', () => {
    expect(prixMaxParMise(20_000)).toBe(400_000);
    expect(prixMaxParMise(100_000)).toBe(1_250_000);
    // Entre 125 000 $ et 300 000 $, la mise plafonne juste sous 1,5 M$
    expect(prixMaxParMise(200_000)).toBe(PLAFOND_ASSURABLE - 1);
    expect(prixMaxParMise(300_000)).toBe(1_500_000);
    for (const mise of [20_000, 60_000, 100_000, 124_000, 200_000, 400_000]) {
      expect(miseMinimale(prixMaxParMise(mise))).toBeLessThanOrEqual(mise + 1e-6);
    }
  });

  it('le scénario de mise minimale reste assuré sous 1,5 M$', () => {
    const r = calcAbsoluteMax(1_000_000);
    expect(r.prix).toBeGreaterThan(1_000_000);
    expect(r.prix).toBeLessThan(PLAFOND_ASSURABLE);
    expect(r.miseMin).toBeLessThan(r.prix * 0.2);
  });
});

describe('surprime de 0,20 % au-delà de 25 ans', () => {
  it('s’ajoute au taux de la prime, et seulement s’il y a une prime', () => {
    expect(tauxPrimeAssurance(0.9, 25)).toBeCloseTo(0.031, 10);
    expect(tauxPrimeAssurance(0.9, 30)).toBeCloseTo(0.033, 10);
    expect(tauxPrimeAssurance(0.96, 30)).toBe(0);
  });

  it('calculateSCHL la porte sur 30 ans, jamais avec 20 % de mise', () => {
    expect(calculateSCHL(400_000, 40_000)).toBeCloseTo(360_000 * 0.031, 6);
    expect(calculateSCHL(400_000, 40_000, 30)).toBeCloseTo(360_000 * 0.033, 6);
    expect(calculateSCHL(400_000, 80_000, 30)).toBe(0);
  });

  it('une mise d’exactement 5 % paie la prime de 4 %, malgré l’arrondi', () => {
    for (const prix of [300_000, 421_053, 499_999]) {
      expect(tauxPrimeAssurance((prix - prix * 0.05) / prix, 25)).toBe(0.04);
    }
  });

  it('réduit le prix atteignable du scénario de mise minimale', () => {
    expect(calcAbsoluteMax(400_000, 30).prix).toBeLessThan(calcAbsoluteMax(400_000, 25).prix);
  });
});
