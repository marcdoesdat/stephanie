import { describe, it, expect } from 'vitest';
import {
  INTENTIONS,
  VALEURS,
  SOLDES,
  RATIO_EQUITE_MIN,
  LTV_MAX,
  classerRatio,
  evaluerEquite,
  estIntentionCle,
  estValeurCle,
  estSoldeCle,
  libelleIntention,
  libelleValeur,
  libelleSolde,
} from './refinancementV2';

describe('gardes de type', () => {
  it('reconnaît les clés valides', () => {
    expect(estIntentionCle('effacer_dettes')).toBe(true);
    expect(estValeurCle('500_650')).toBe(true);
    expect(estSoldeCle('ne_sais_pas')).toBe(true);
  });

  it('rejette les clés inconnues et vides', () => {
    expect(estIntentionCle('acheter_chalet')).toBe(false);
    expect(estValeurCle('')).toBe(false);
    expect(estSoldeCle('1_000_000')).toBe(false);
  });

  it("ne confond pas les propriétés héritées d'Object avec des clés", () => {
    expect(estValeurCle('toString')).toBe(false);
    expect(estSoldeCle('constructor')).toBe(false);
    expect(estIntentionCle('hasOwnProperty')).toBe(false);
  });
});

describe('libellés', () => {
  it('retourne le libellé lisible', () => {
    expect(libelleIntention('baisser_paiements')).toBe('Baisser mes paiements mensuels');
    expect(libelleValeur('300_400')).toBe('300 000 $ à 400 000 $');
    expect(libelleSolde('ne_sais_pas')).toBe('Je ne suis pas sûr');
  });

  it('retombe sur la valeur brute quand la clé est inconnue', () => {
    expect(libelleValeur('inconnu')).toBe('inconnu');
  });

  it('couvre toutes les clés déclarées', () => {
    for (const cle of Object.keys(INTENTIONS)) expect(libelleIntention(cle)).not.toBe(cle);
    for (const cle of Object.keys(VALEURS)) expect(libelleValeur(cle)).not.toBe(cle);
    for (const cle of Object.keys(SOLDES)) expect(libelleSolde(cle)).not.toBe(cle);
  });
});

describe('classerRatio', () => {
  it('classe « bonne » à partir de 20 % inclusivement', () => {
    expect(classerRatio(RATIO_EQUITE_MIN)).toBe('bonne');
    expect(classerRatio(0.35)).toBe('bonne');
  });

  it('classe « faible » sous 20 %', () => {
    expect(classerRatio(0.199)).toBe('faible');
    expect(classerRatio(0)).toBe('faible');
    expect(classerRatio(-0.2)).toBe('faible');
  });
});

describe('evaluerEquite', () => {
  it('calcule une équité confortable', () => {
    // 575 000 − 150 000 = 425 000 (73,9 %) ; disponible = 575 000 × 0,80 − 150 000
    const r = evaluerEquite('500_650', 'moins_200');
    expect(r).not.toBeNull();
    expect(r?.valeurEstimee).toBe(575_000);
    expect(r?.soldeEstime).toBe(150_000);
    expect(r?.equite).toBe(425_000);
    expect(r?.ratio).toBeCloseTo(0.7391, 4);
    expect(r?.disponible80).toBe(310_000);
    expect(r?.niveau).toBe('bonne');
  });

  it('signale une équité faible', () => {
    // 350 000 − 425 000 = −75 000 : le solde estimé dépasse la valeur estimée
    const r = evaluerEquite('300_400', '350_500');
    expect(r?.equite).toBe(-75_000);
    expect(r?.ratio).toBeLessThan(0);
    expect(r?.niveau).toBe('faible');
  });

  it('ne retourne jamais un montant disponible négatif', () => {
    const r = evaluerEquite('300_400', '350_500');
    expect(r?.disponible80).toBe(0);
  });

  it('retourne « inconnue » quand le solde est ignoré', () => {
    const r = evaluerEquite('400_500', 'ne_sais_pas');
    expect(r?.niveau).toBe('inconnue');
    expect(r?.valeurEstimee).toBe(450_000);
    expect(r?.soldeEstime).toBeNull();
    expect(r?.equite).toBeNull();
    expect(r?.ratio).toBeNull();
    expect(r?.disponible80).toBeNull();
  });

  it('retourne null sur une clé invalide', () => {
    expect(evaluerEquite('700_800', 'moins_200')).toBeNull();
    expect(evaluerEquite('300_400', 'beaucoup')).toBeNull();
    expect(evaluerEquite('', '')).toBeNull();
  });

  it('reste cohérent sur toutes les combinaisons de tranches', () => {
    for (const valeurCle of Object.keys(VALEURS)) {
      for (const soldeCle of Object.keys(SOLDES)) {
        const r = evaluerEquite(valeurCle, soldeCle);
        expect(r).not.toBeNull();
        if (!r) continue;

        if (r.niveau === 'inconnue') {
          expect(r.disponible80).toBeNull();
          continue;
        }
        expect(r.disponible80).toBeGreaterThanOrEqual(0);
        expect(r.disponible80).toBeLessThanOrEqual(r.valeurEstimee * LTV_MAX);
        expect(r.niveau).toBe(classerRatio(r.ratio as number));
      }
    }
  });
});
