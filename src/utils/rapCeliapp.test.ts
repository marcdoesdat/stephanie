import { describe, expect, it } from 'vitest';
import {
  ANNEE_PARAMETRES,
  comparerRapCeliapp,
  debutRemboursementRap,
  droitsReerAnnuels,
  economieImpot,
  impotCombine,
  impotFederal,
  impotQuebec,
  lireNombre,
  messageMotif,
  montantPersonnelFederal,
  planCeliapp,
  type EntreesRapCeliapp,
  type MotifRapCeliapp,
} from './rapCeliapp';

// Date de référence des tests : 2026-05-14 — première cotisation en 2026, paramètres de 2026.
//
// Rappel des paramètres 2026 vérifiés à la main ci-dessous :
//   Fédéral : 14 % ≤ 58 523 ; 20,5 % ≤ 117 045 ; 26 % ≤ 181 440 ; 29 % ≤ 258 482 ; 33 % au-delà.
//             Crédit de base : 14 % × 16 452 = 2 303,28 (revenu net ≤ 181 440).
//             Abattement du Québec : l'impôt fédéral de base × (1 − 0,165) = × 0,835.
//   Québec  : 14 % ≤ 54 345 ; 19 % ≤ 108 680 ; 24 % ≤ 132 245 ; 25,75 % au-delà.
//             Crédit de base : 14 % × 18 952 = 2 653,28.

const entrees = (e: Partial<EntreesRapCeliapp> = {}): EntreesRapCeliapp => ({
  revenu: 60_000,
  reerActuel: 10_000,
  epargneAnnuelle: 10_000,
  annees: 3,
  anneeDepart: 2026,
  ...e,
});

function scenarios(e: Partial<EntreesRapCeliapp>) {
  const r = comparerRapCeliapp(entrees(e));
  if (!r.ok) throw new Error(`motif inattendu : ${r.motif}`);
  return r;
}

describe('impôt combiné 2026 — vérifié à la main', () => {
  it('20 000 $ : sous le premier palier des deux côtés', () => {
    // Fédéral : 20 000 × 14 % = 2 800 − 2 303,28 = 496,72 × 0,835 = 414,7612
    // Québec  : 20 000 × 14 % = 2 800 − 2 653,28 = 146,72
    expect(impotFederal(20_000)).toBeCloseTo(414.7612, 4);
    expect(impotQuebec(20_000)).toBeCloseTo(146.72, 4);
    expect(impotCombine(20_000).total).toBeCloseTo(561.4812, 4);
  });

  it('60 000 $ : deuxième palier des deux côtés', () => {
    // Fédéral : 58 523 × 14 % = 8 193,22 ; 1 477 × 20,5 % = 302,785 → 8 496,005
    //           − 2 303,28 = 6 192,725 × 0,835 = 5 170,925375
    // Québec  : 54 345 × 14 % = 7 608,30 ; 5 655 × 19 % = 1 074,45 → 8 682,75
    //           − 2 653,28 = 6 029,47
    expect(impotFederal(60_000)).toBeCloseTo(5_170.925375, 4);
    expect(impotQuebec(60_000)).toBeCloseTo(6_029.47, 4);
    expect(impotCombine(60_000).total).toBeCloseTo(11_200.395375, 4);
  });

  it('100 000 $', () => {
    // Fédéral : 8 193,22 + 41 477 × 20,5 % (8 502,785) = 16 696,005 − 2 303,28 = 14 392,725
    //           × 0,835 = 12 017,925375
    // Québec  : 7 608,30 + 45 655 × 19 % (8 674,45) = 16 282,75 − 2 653,28 = 13 629,47
    expect(impotCombine(100_000).federal).toBeCloseTo(12_017.925375, 4);
    expect(impotCombine(100_000).quebec).toBeCloseTo(13_629.47, 4);
    expect(impotCombine(100_000).total).toBeCloseTo(25_647.395375, 4);
  });

  it('200 000 $ : montant personnel fédéral réduit, dernier palier québécois', () => {
    // Fédéral : 8 193,22 + 58 522 × 20,5 % (11 997,01) + 64 395 × 26 % (16 742,70)
    //           + 18 560 × 29 % (5 382,40) = 42 315,33
    //           MPB : 16 452 − 1 623 × 18 560 / 77 042 = 16 061,0070… ; × 14 % = 2 248,5410
    //           (42 315,33 − 2 248,5410) × 0,835 = 33 455,7688
    // Québec  : 7 608,30 + 54 335 × 19 % (10 323,65) + 23 565 × 24 % (5 655,60)
    //           + 67 755 × 25,75 % (17 446,9125) = 41 034,4625 − 2 653,28 = 38 381,1825
    expect(montantPersonnelFederal(200_000)).toBeCloseTo(16_061.007, 3);
    expect(impotFederal(200_000)).toBeCloseTo(33_455.7688, 3);
    expect(impotQuebec(200_000)).toBeCloseTo(38_381.1825, 4);
  });

  it('aucun impôt sous les montants personnels de base, jamais négatif', () => {
    // 15 000 × 14 % = 2 100 : moins que 2 303,28 (fédéral) et que 2 653,28 (Québec)
    expect(impotCombine(15_000)).toEqual({ federal: 0, quebec: 0, total: 0 });
    expect(impotCombine(0).total).toBe(0);
    expect(impotCombine(-5_000).total).toBe(0);
  });

  it('montant personnel fédéral : plein jusqu’à 181 440 $, minimal dès 258 482 $', () => {
    expect(montantPersonnelFederal(181_440)).toBe(16_452);
    expect(montantPersonnelFederal(258_482)).toBe(14_829);
    expect(montantPersonnelFederal(500_000)).toBe(14_829);
  });
});

describe('remboursement d’impôt = différence d’impôt', () => {
  it('une déduction qui fait franchir un palier : pas le taux marginal × la déduction', () => {
    // 62 000 → 54 000 : la déduction de 8 000 traverse les deux seuils (58 523 et 54 345).
    // Fédéral : 3 477 × 20,5 % + 4 523 × 14 % = 712,785 + 633,22 = 1 346,005 × 0,835 = 1 123,914175
    // Québec  : 7 655 × 19 % + 345 × 14 % = 1 454,45 + 48,30 = 1 502,75
    // Total 2 626,664175 — le taux marginal à 62 000 $ (0,205 × 0,835 + 0,19 = 36,1175 %)
    // aurait annoncé 2 889,40 $, soit 263 $ de trop.
    const eco = economieImpot(62_000, 8_000);
    expect(eco.federal).toBeCloseTo(1_123.914175, 4);
    expect(eco.quebec).toBeCloseTo(1_502.75, 4);
    expect(eco.total).toBeCloseTo(2_626.664175, 4);
    expect(eco.total).toBeLessThan(8_000 * 0.361175 - 200);
  });

  it('une déduction plus grande que le revenu ne descend pas sous zéro', () => {
    expect(economieImpot(20_000, 50_000).total).toBeCloseTo(impotCombine(20_000).total, 6);
  });
});

describe('plafonds des régimes', () => {
  it('CELIAPP : 8 000 $ par année, report d’au plus 8 000 $, 40 000 $ à vie', () => {
    expect(planCeliapp([20_000])).toEqual([8_000]);
    // rien la 1re année : 8 000 $ reportés, 16 000 $ la 2e
    expect(planCeliapp([0, 20_000])).toEqual([0, 16_000]);
    // 3 000 $ la 1re année : 5 000 $ reportés
    expect(planCeliapp([3_000, 20_000])).toEqual([3_000, 13_000]);
    // deux années sans cotiser : le report reste plafonné à 8 000 $
    expect(planCeliapp([0, 0, 20_000])).toEqual([0, 0, 16_000]);
    // plafond à vie atteint après cinq années pleines
    expect(planCeliapp(Array(6).fill(20_000))).toEqual([8_000, 8_000, 8_000, 8_000, 8_000, 0]);
    // le report se consomme : après une année à 16 000 $, on revient à 8 000 $
    expect(planCeliapp([0, 16_000, 16_000, 16_000])).toEqual([0, 16_000, 8_000, 8_000]);
    // et le dernier versement s'arrête au plafond à vie
    expect(planCeliapp([0, 16_000, 8_000, 8_000, 16_000])).toEqual([0, 16_000, 8_000, 8_000, 8_000]);
  });

  it('REER : 18 % du revenu, au plus 33 810 $', () => {
    expect(droitsReerAnnuels(60_000)).toBeCloseTo(10_800, 6);
    expect(droitsReerAnnuels(250_000)).toBe(33_810);
  });

  it('RAP : retrait plafonné à 60 000 $, même avec beaucoup de REER', () => {
    const r = scenarios({ reerActuel: 85_000, epargneAnnuelle: 0, annees: 1 });
    expect(r.scenarios.rap.retraitRap).toBe(60_000);
    expect(r.scenarios.rap.resteReer).toBe(25_000);
    expect(r.scenarios.rap.cotisationsReer).toBe(0);
  });

  it('les cotisations REER s’arrêtent quand le RAP est plein ; le reste demeure disponible', () => {
    // 90 000 $, 55 000 $ en REER, 12 000 $/an sur 2 ans (droits REER : 16 200 $/an)
    // RAP seul : 5 000 $ au REER la 1re année (60 000 − 55 000), puis rien ;
    //   hors régime : 7 000 + 12 000 = 19 000 ; mise de fonds 60 000 + 19 000 = 79 000.
    //   Remboursement : 5 000 $ entièrement dans les deuxièmes paliers →
    //   5 000 × (20,5 % × 0,835 + 19 %) = 5 000 × 0,361175 = 1 805,875
    // Combiné : an 1 → 8 000 CELIAPP + 4 000 REER ; an 2 → 8 000 CELIAPP + 1 000 REER, 3 000 hors régime.
    //   Remboursements : 12 000 × 0,361175 + 9 000 × 0,361175 = 4 334,10 + 3 250,575 = 7 584,675
    const r = scenarios({ revenu: 90_000, reerActuel: 55_000, epargneAnnuelle: 12_000, annees: 2 });
    const { rap, combine } = r.scenarios;
    expect(rap.cotisationsReer).toBe(5_000);
    expect(rap.epargneHorsRegime).toBe(19_000);
    expect(rap.miseDeFonds).toBe(79_000);
    expect(rap.remboursementsImpot).toBeCloseTo(1_805.875, 4);
    expect(combine.retraitCeliapp).toBe(16_000);
    expect(combine.retraitRap).toBe(60_000);
    expect(combine.epargneHorsRegime).toBe(3_000);
    expect(combine.miseDeFonds).toBe(79_000);
    expect(combine.remboursementsImpot).toBeCloseTo(7_584.675, 4);
  });
});

describe('les trois scénarios', () => {
  // 60 000 $, 10 000 $ déjà en REER, 10 000 $/an sur 3 ans (2026 à 2028), achat en 2029.
  // Droits REER : 18 % × 60 000 = 10 800 $/an — les 10 000 $ y entrent.
  //   Impôt à 60 000 $ : 11 200,395375 ; à 50 000 $ : 3 921,7612 + 4 346,72 = 8 268,4812 ;
  //   à 52 000 $ : 4 155,5612 + 4 626,72 = 8 782,2812.
  //   Déduction de 10 000 $ : 11 200,395375 − 8 268,4812 = 2 931,914175 par année.
  //   Déduction de 8 000 $  : 11 200,395375 − 8 782,2812 = 2 418,114175 par année.
  const r = scenarios({});

  it('RAP seul : tout au REER, retrait de 40 000 $ à rembourser sur 15 ans', () => {
    const s = r.scenarios.rap;
    expect(s.cotisationsReer).toBe(30_000);
    expect(s.retraitRap).toBe(40_000);
    expect(s.miseDeFonds).toBe(40_000);
    expect(s.remboursementsImpot).toBeCloseTo(3 * 2_931.914175, 4); // 8 795,742525
    expect(s.aRembourserReer).toBe(40_000);
    expect(s.remboursementAnnuelMin).toBeCloseTo(2_666.67, 2); // 40 000 / 15
    // retrait en 2029, après l'allègement temporaire (2022-2028) : 2e année suivante
    expect(s.premiereAnneeRemboursement).toBe(2031);
  });

  it('CELIAPP seul : 8 000 $/an, le surplus hors régime, les REER actuels n’y servent pas', () => {
    const s = r.scenarios.celiapp;
    expect(s.cotisationsCeliapp).toBe(24_000);
    expect(s.epargneHorsRegime).toBe(6_000);
    expect(s.miseDeFonds).toBe(30_000);
    expect(s.resteReer).toBe(10_000);
    expect(s.remboursementsImpot).toBeCloseTo(3 * 2_418.114175, 4); // 7 254,342525
    expect(s.aRembourserReer).toBe(0);
    expect(s.remboursementAnnuelMin).toBe(0);
    expect(s.premiereAnneeRemboursement).toBeNull();
  });

  it('les deux : le CELIAPP d’abord, le reste au REER, puis le RAP', () => {
    const s = r.scenarios.combine;
    expect(s.cotisationsCeliapp).toBe(24_000);
    expect(s.cotisationsReer).toBe(6_000);
    expect(s.retraitRap).toBe(16_000);
    expect(s.miseDeFonds).toBe(40_000);
    // même déduction annuelle que le RAP seul (10 000 $), donc même remboursement…
    expect(s.remboursementsImpot).toBeCloseTo(r.scenarios.rap.remboursementsImpot, 6);
    // …mais 16 000 $ à remettre dans le REER au lieu de 40 000 $
    expect(s.aRembourserReer).toBe(16_000);
    expect(s.remboursementAnnuelMin).toBeCloseTo(1_066.67, 2);
  });

  it('les remboursements se séparent en fédéral et Québec', () => {
    const s = r.scenarios.rap;
    expect(s.remboursementsFederal + s.remboursementsQuebec).toBeCloseTo(s.remboursementsImpot, 6);
    // Québec : 10 000 $ dans le 2e palier (5 655 à 19 %) puis le 1er (4 345 à 14 %) = 1 682,75 par année
    expect(s.remboursementsQuebec).toBeCloseTo(3 * 1_682.75, 4);
  });

  it('l’année d’achat suit les années d’épargne ; défaut : paramètres de 2026', () => {
    expect(r.anneeAchat).toBe(2029);
    const parDefaut = comparerRapCeliapp({ ...entrees(), anneeDepart: undefined });
    expect(parDefaut.ok && parDefaut.anneeAchat).toBe(ANNEE_PARAMETRES + 3);
  });
});

describe('épargne déjà dans les REER', () => {
  it('ne produit aucun nouveau remboursement : le RAP la rend seulement accessible', () => {
    const r = scenarios({ reerActuel: 30_000, epargneAnnuelle: 0, annees: 2 });
    expect(r.scenarios.rap.retraitRap).toBe(30_000);
    expect(r.scenarios.rap.remboursementsImpot).toBe(0);
    expect(r.scenarios.combine.retraitRap).toBe(30_000);
    expect(r.scenarios.combine.remboursementsImpot).toBe(0);
    // CELIAPP seul : les REER restent dans les REER, rien pour l'achat
    expect(r.scenarios.celiapp.miseDeFonds).toBe(0);
    expect(r.scenarios.celiapp.resteReer).toBe(30_000);
  });
});

describe('remboursement du RAP', () => {
  it('sur 15 ans, au moins 1/15 par année', () => {
    const r = scenarios({ reerActuel: 60_000, epargneAnnuelle: 0, annees: 1 });
    expect(r.scenarios.rap.aRembourserReer).toBe(60_000);
    expect(r.scenarios.rap.remboursementAnnuelMin).toBe(4_000);
  });

  it('commence la 5e année pour un retrait de 2022 à 2028, la 2e sinon', () => {
    expect(debutRemboursementRap(2027)).toBe(2032);
    expect(debutRemboursementRap(2028)).toBe(2033);
    expect(debutRemboursementRap(2029)).toBe(2031);
    expect(debutRemboursementRap(2021)).toBe(2023);
    expect(scenarios({ annees: 1 }).scenarios.rap.premiereAnneeRemboursement).toBe(2032);
  });
});

describe('entrées nulles ou absurdes : un motif, jamais un NaN', () => {
  const motif = (e: Partial<EntreesRapCeliapp>): MotifRapCeliapp | null => {
    const r = comparerRapCeliapp(entrees(e));
    return r.ok ? null : r.motif;
  };

  it('revenu', () => {
    expect(motif({ revenu: 0 })).toBe('revenu_invalide');
    expect(motif({ revenu: -1 })).toBe('revenu_invalide');
    expect(motif({ revenu: NaN })).toBe('revenu_invalide');
    expect(motif({ revenu: Infinity })).toBe('revenu_invalide');
  });

  it('épargne REER et épargne annuelle', () => {
    expect(motif({ reerActuel: -1 })).toBe('reer_invalide');
    expect(motif({ reerActuel: NaN })).toBe('reer_invalide');
    expect(motif({ epargneAnnuelle: -500 })).toBe('epargne_invalide');
    expect(motif({ epargneAnnuelle: Infinity })).toBe('epargne_invalide');
  });

  it('années : un entier de 1 à 15', () => {
    expect(motif({ annees: 0 })).toBe('annees_invalides');
    expect(motif({ annees: 16 })).toBe('annees_invalides');
    expect(motif({ annees: 2.5 })).toBe('annees_invalides');
    expect(motif({ annees: NaN })).toBe('annees_invalides');
    expect(motif({ annees: 15 })).toBeNull();
  });

  it('rien à comparer sans aucune épargne', () => {
    expect(motif({ reerActuel: 0, epargneAnnuelle: 0 })).toBe('rien_a_comparer');
  });

  it('chaque motif a son message', () => {
    for (const m of ['revenu_invalide', 'reer_invalide', 'epargne_invalide', 'annees_invalides', 'rien_a_comparer'] as const) {
      expect(messageMotif(m).length).toBeGreaterThan(20);
    }
  });

  it('aucun champ calculé n’est NaN, même aux extrêmes', () => {
    for (const e of [
      { revenu: 1, reerActuel: 0, epargneAnnuelle: 1_000_000, annees: 15 },
      { revenu: 10_000_000, reerActuel: 1_000_000, epargneAnnuelle: 0, annees: 1 },
    ]) {
      const r = comparerRapCeliapp(e);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (const s of Object.values(r.scenarios)) {
        for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('lecture des champs', () => {
  it('lit les montants au format québécois', () => {
    expect(lireNombre('80 000')).toBe(80_000);
    expect(lireNombre('80 000 $')).toBe(80_000);
    expect(lireNombre('1 250,50')).toBe(1_250.5);
    expect(lireNombre('3')).toBe(3);
  });

  it('vide → null ; illisible → NaN ; négatif lu tel quel (la validation tranche)', () => {
    expect(lireNombre('   ')).toBeNull();
    expect(lireNombre('abc')).toBeNaN();
    expect(lireNombre('12abc')).toBeNaN();
    expect(lireNombre('-5')).toBe(-5);
  });
});
