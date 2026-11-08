import { describe, it, expect } from 'vitest';
import {
  revenuNecessaire,
  AMORTISSEMENT_DEFAUT,
  CLE_TRANSFERT_EXPRESS,
  FRAIS_DEFAUT,
  TRANSFERT_VALIDITE_MS,
  calculerCapacite,
  decoderTransfert,
  dettesEquivalentes,
  formaterSaisie,
  fraisProprietes,
  lireMontant,
  messageEchec,
  tauxQualification,
  type CapaciteCalculee,
  type EntreesCapacite,
} from './capaciteEmprunt';
import { tauxPrimeSCHL } from './mortgageCalc';

const BASE: EntreesCapacite = {
  revenu: 80_000,
  dettes: 500,
  mise: 50_000,
  taux: 3.79,
  amortAns: AMORTISSEMENT_DEFAUT,
  taxes: FRAIS_DEFAUT.taxes,
  chauffage: FRAIS_DEFAUT.chauffage,
  condo: 0,
};

function reussi(e: EntreesCapacite): CapaciteCalculee {
  const r = calculerCapacite(e);
  if (!r.ok) throw new Error(`échec inattendu : ${r.motif}`);
  return r;
}

// Valeurs relevées sur le calcul tel qu'il vivait dans Simulator.astro avant d'en être sorti.
// Elles verrouillent le déplacement : le simulateur doit afficher au dollar près ce qu'il
// affichait, et le calculateur express le même chiffre pour les mêmes entrées.
describe('calculerCapacite — résultats du simulateur conservés', () => {
  const cas: Array<[string, Partial<EntreesCapacite>, Partial<CapaciteCalculee>]> = [
    ['défauts du simulateur', {}, {
      assure: true, prixMax: 372_085.55, pretTotal: 332_070.20, versement: 1_709.16, abd: 36.5, atd: 44,
      // 336 135 $ avant novembre 2026 : une mise d'exactement 5 % perdait parfois sa prime à l'arrondi
      maxAbsolu: { prix: 336_104, miseMin: 16_805, assure: true },
    }],
    ['assuré, mise faible', { revenu: 95_000, dettes: 400, mise: 25_000, taux: 4.19 }, {
      assure: true, prixMax: 428_629.06, pretTotal: 419_774.22, versement: 2_251.55, atd: 44,
    }],
    ['conventionnel, mise de 20 % et plus', { revenu: 120_000, dettes: 0, mise: 150_000, taux: 4.19 }, {
      assure: false, prixMax: 633_764.19, primeSCHL: 0, pretTotal: 483_764.19, versement: 2_594.77, abd: 35,
    }],
    ['condo à 300 $/mois', { revenu: 95_000, dettes: 400, mise: 40_000, taux: 4.19, condo: 300 }, {
      assure: true, prixMax: 421_478.68, pretTotal: 396_737.83, versement: 2_127.99,
    }],
    ['plafonné par la mise de fonds', { revenu: 200_000, dettes: 0, mise: 20_000, taux: 4.19 }, {
      assure: true, prixMax: 400_000, pretTotal: 395_200, versement: 2_119.74, plafonneParMise: true,
    }],
    ['30 ans avec 20 % de mise', { revenu: 120_000, dettes: 0, mise: 150_000, taux: 4.19, amortAns: 30 }, {
      assure: false, prixMax: 669_161.47, pretTotal: 519_161.47, versement: 2_524.84,
    }],
    ['taux bas : plancher de qualification', { taux: 2.5 }, {
      assure: true, prixMax: 389_088.91, pretTotal: 349_600.66, versement: 1_566.09,
    }],
  ];

  it.each(cas)('%s', (_nom, entrees, attendu) => {
    const r = reussi({ ...BASE, ...entrees });
    for (const [cle, valeur] of Object.entries(attendu)) {
      const obtenu = r[cle as keyof CapaciteCalculee];
      if (typeof valeur === 'number') expect(obtenu, cle).toBeCloseTo(valeur, 1);
      else expect(obtenu, cle).toEqual(valeur);
    }
  });

  it('ne plafonne pas quand la mise suffit', () => {
    expect(reussi(BASE).plafonneParMise).toBe(false);
  });
});

describe('calculerCapacite — échecs', () => {
  it('sans revenu, rien à calculer', () => {
    expect(calculerCapacite({ ...BASE, revenu: 0 })).toEqual({ ok: false, motif: 'revenu_absent' });
  });

  it('revenu insuffisant pour les charges', () => {
    expect(calculerCapacite({ ...BASE, revenu: 20_000, dettes: 900 })).toEqual({ ok: false, motif: 'revenu_insuffisant' });
  });

  it('30 ans sans 20 % de mise, hors premier achat et construction neuve', () => {
    expect(calculerCapacite({ ...BASE, amortAns: 30 })).toEqual({ ok: false, motif: 'amortissement_30_ans' });
    expect(calculerCapacite({ ...BASE, amortAns: 30, premierAchatOuNeuf: false })).toEqual({ ok: false, motif: 'amortissement_30_ans' });
  });

  it('sans mise de fonds : un motif, jamais « 0 $ » ni « NaN % »', () => {
    expect(calculerCapacite({ ...BASE, mise: 0 })).toEqual({ ok: false, motif: 'mise_absente' });
  });
});

describe('règles de calcul', () => {
  it('compte la moitié des frais de condo', () => {
    expect(fraisProprietes(250, 100, 300)).toBe(500);
    const avecCondo = reussi({ ...BASE, condo: 300 });
    const memesFrais = reussi({ ...BASE, taxes: 400 });
    expect(avecCondo.prixMax).toBeCloseTo(memesFrais.prixMax, 6);
  });

  it('des frais de condo réduisent la capacité', () => {
    expect(reussi({ ...BASE, condo: 400 }).prixMax).toBeLessThan(reussi(BASE).prixMax);
  });

  it('qualifie au plus élevé de taux + 2 % et 5,25 %', () => {
    expect(tauxQualification(2.5)).toBe(5.25);
    expect(tauxQualification(4.19)).toBeCloseTo(6.19, 10);
    expect(reussi({ ...BASE, taux: 2.5 }).tauxQualification).toBe(5.25);
  });

  it('ne dépasse jamais les plafonds de ratios', () => {
    for (const revenu of [60_000, 95_000, 150_000, 250_000]) {
      const r = reussi({ ...BASE, revenu, mise: 120_000 });
      expect(r.abd).toBeLessThanOrEqual(r.abdLimite + 1e-9);
      expect(r.atd).toBeLessThanOrEqual(r.atdLimite + 1e-9);
    }
  });
});

// Règles fédérales du 15 décembre 2024 : 30 ans assuré pour un premier achat ou une construction
// neuve (surprime de 0,20 %), et prêt assuré jusqu'à 1,5 M$ pour tous les acheteurs.
describe('calculerCapacite — premier achat et plafond de 1,5 M$', () => {
  it('ouvre les 30 ans à un prêt assuré pour un premier achat, surprime comprise', () => {
    const r = reussi({ ...BASE, amortAns: 30, premierAchatOuNeuf: true });
    expect(r.assure).toBe(true);
    expect(r.prixMax).toBeGreaterThan(reussi(BASE).prixMax);
    const ltv = r.pretBase / r.prixMax;
    expect(r.primeSCHL / r.pretBase).toBeCloseTo(tauxPrimeSCHL(ltv) + 0.002, 10);
    expect(r.abd).toBeLessThanOrEqual(r.abdLimite + 1e-9);
    expect(r.atd).toBeLessThanOrEqual(r.atdLimite + 1e-9);
    expect(r.maxAbsolu?.assure).toBe(true);
  });

  it('ne change rien sur 25 ans, ni quand le prêt ne peut pas être assuré', () => {
    expect(reussi({ ...BASE, premierAchatOuNeuf: true })).toEqual(reussi(BASE));
    // Avec 20 % et plus, le prêt reste conventionnel ; seul le scénario de mise minimale change
    const grosseMise = { ...BASE, revenu: 120_000, dettes: 0, mise: 300_000, taux: 4.19, amortAns: 30 };
    const { maxAbsolu: _a, ...avec } = reussi({ ...grosseMise, premierAchatOuNeuf: true });
    const { maxAbsolu: _b, ...sans } = reussi(grosseMise);
    expect(avec).toEqual(sans);
    expect(avec.assure).toBe(false);
  });

  it('30 ans hors premier achat : scénario de mise minimale conventionnel, jamais assuré', () => {
    const r = reussi({ ...BASE, revenu: 120_000, dettes: 0, mise: 150_000, taux: 4.19, amortAns: 30 });
    expect(r.assure).toBe(false);
    expect(r.maxAbsolu?.assure).toBe(false);
    expect(r.maxAbsolu!.miseMin / r.maxAbsolu!.prix).toBeCloseTo(0.2, 3);
  });

  it('assure un prêt entre 1 M$ et 1,5 M$ avec moins de 20 % de mise', () => {
    const r = reussi({ ...BASE, revenu: 230_000, dettes: 0, mise: 120_000, taux: 4.19 });
    expect(r.prixMax).toBeGreaterThan(1_000_000);
    expect(r.prixMax).toBeLessThan(1_500_000);
    expect(r.assure).toBe(true);
    expect(r.primeSCHL).toBeGreaterThan(0);
    expect(r.plafonneParMise).toBe(false);
  });

  it('revenu au-delà du plafond, mise sous 20 % : prêt assuré sous 1,5 M$, jamais conventionnel', () => {
    for (const revenu of [300_000, 400_000]) {
      const r = reussi({ ...BASE, revenu, dettes: 0, mise: 120_000, taux: 4.19 });
      // 120 000 $ = 5 % de 500 000 $ + 10 % de 950 000 $ : 1,45 M$ au plus
      expect(r.prixMax).toBeCloseTo(1_450_000, 0);
      expect(r.plafonneParMise).toBe(true);
      expect(r.assure).toBe(true);
      expect(r.primeSCHL).toBeGreaterThan(0);
      expect(r.abdLimite).toBe(39);
      expect(r.atd).toBeLessThanOrEqual(r.atdLimite + 1e-9);
    }
  });

  it('mise entre 125 000 $ et 20 % : le plus haut du prêt assuré et du conventionnel', () => {
    // 290 000 $ : assuré jusqu'à 1 499 999 $, conventionnel jusqu'à 1 450 000 $ (20 %)
    const r = reussi({ ...BASE, revenu: 400_000, dettes: 0, mise: 290_000, taux: 4.19 });
    expect(r.assure).toBe(true);
    expect(r.prixMax).toBe(1_499_999);
    // 400 000 $ : 20 % d'au moins 1,5 M$, le conventionnel l'emporte
    const c = reussi({ ...BASE, revenu: 400_000, dettes: 0, mise: 400_000, taux: 4.19 });
    expect(c.assure).toBe(false);
    expect(400_000 / c.prixMax).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });

  it('exige 20 % à 1,5 M$ et plus', () => {
    const r = reussi({ ...BASE, revenu: 500_000, dettes: 0, mise: 400_000, taux: 4.19 });
    expect(r.prixMax).toBeGreaterThanOrEqual(1_500_000);
    expect(r.assure).toBe(false);
    expect(r.primeSCHL).toBe(0);
    expect(400_000 / r.prixMax).toBeGreaterThanOrEqual(0.2);
  });
});

describe('messageEchec', () => {
  it('dit que les 30 ans restent possibles pour un premier achat', () => {
    expect(messageEchec('amortissement_30_ans', BASE)).toMatch(/premier achat et à la construction neuve/);
  });

  it('se tait quand il n’y a rien à dire', () => {
    expect(messageEchec('revenu_absent', BASE)).toBeNull();
  });

  it('nomme la cause du revenu insuffisant', () => {
    expect(messageEchec('revenu_insuffisant', BASE)).toMatch(/dettes et frais de propriété/);
    expect(messageEchec('revenu_insuffisant', { dettes: 500, taxes: 0, chauffage: 0, condo: 0 })).toMatch(/^Vos dettes/);
    expect(messageEchec('revenu_insuffisant', { dettes: 0, taxes: 0, chauffage: 0, condo: 0 })).toMatch(/trop faible/);
  });
});

describe('saisie des montants', () => {
  it('lit les formats courants', () => {
    expect(lireMontant('80 000')).toBe(80_000);
    expect(lireMontant('80 000')).toBe(80_000);
    expect(lireMontant('1 250,50')).toBe(1250.5);
  });

  it('une saisie illisible ou négative vaut 0', () => {
    expect(lireMontant('')).toBe(0);
    expect(lireMontant('abc')).toBe(0);
    expect(lireMontant('-500')).toBe(0);
  });

  it('formate avec une espace fine insécable', () => {
    expect(formaterSaisie(95_000)).toBe('95 000');
    expect(lireMontant(formaterSaisie(1_234_567))).toBe(1_234_567);
  });
});

describe('decoderTransfert', () => {
  const MAINTENANT = Date.parse('2026-05-14T12:00:00Z');
  const brut = (o: object) => JSON.stringify({ ts: MAINTENANT - 1000, ...o });

  it('rend les champs valides', () => {
    expect(decoderTransfert(brut({ revenu: 95_000, dettes: 400, mise: 40_000, condo: 300, taux: 4.19 }), MAINTENANT))
      .toEqual({ revenu: 95_000, dettes: 400, mise: 40_000, condo: 300, taux: 4.19 });
  });

  it('écarte un champ hors limites sans jeter les autres', () => {
    expect(decoderTransfert(brut({ revenu: 95_000, mise: -5, taux: 69 }), MAINTENANT)).toEqual({ revenu: 95_000 });
  });

  it('ignore un transfert périmé, illisible ou vide', () => {
    expect(decoderTransfert(JSON.stringify({ ts: MAINTENANT - TRANSFERT_VALIDITE_MS - 1, revenu: 1 }), MAINTENANT)).toBeNull();
    expect(decoderTransfert('{pas du json', MAINTENANT)).toBeNull();
    expect(decoderTransfert(JSON.stringify({ revenu: 95_000 }), MAINTENANT)).toBeNull();
    expect(decoderTransfert(brut({}), MAINTENANT)).toBeNull();
    expect(decoderTransfert(null, MAINTENANT)).toBeNull();
  });

  it('a une clé de stockage stable', () => {
    expect(CLE_TRANSFERT_EXPRESS).toBe('capacite-express');
  });
});

describe('cartes de crédit et crédit rotatif', () => {
  it("comptent pour 3 % du solde, en plus des paiements fixes", () => {
    expect(dettesEquivalentes(500, 0)).toBe(500);
    expect(dettesEquivalentes(0, 10_000)).toBeCloseTo(300, 6);
    expect(dettesEquivalentes(500, 10_000)).toBeCloseTo(800, 6);
  });

  it("réduisent la capacité exactement comme le ferait un paiement équivalent", () => {
    const sans = reussi({ ...BASE, dettes: 500 });
    const avec = reussi({ ...BASE, dettes: dettesEquivalentes(500, 10_000) });
    expect(avec.prixMax).toBeLessThan(sans.prixMax);
  });
});

describe('revenuNecessaire — calcul rapide des pages villes', () => {
  it('rend le revenu le plus bas que le simulateur accepte pour ce prix', () => {
    const revenu = revenuNecessaire(450_000, 22_500, 4.5)!;
    expect(revenu).toBeGreaterThan(0);
    const avec = (r: number) => calculerCapacite({ revenu: r, dettes: 0, mise: 22_500, taux: 4.5, amortAns: AMORTISSEMENT_DEFAUT, taxes: FRAIS_DEFAUT.taxes, chauffage: FRAIS_DEFAUT.chauffage, condo: 0 });
    const ok = avec(revenu);
    expect(ok.ok && ok.prixMax).toBeGreaterThanOrEqual(450_000);
    // 1 000 $ de moins (l'arrondi) et 1 000 $ encore : le prix n'est plus accordé.
    const moins = avec(revenu - 2_000);
    expect(moins.ok && moins.prixMax >= 450_000).toBe(false);
  });

  it('grimpe avec le prix et avec le taux', () => {
    expect(revenuNecessaire(600_000, 35_000, 4.5)!).toBeGreaterThan(revenuNecessaire(450_000, 22_500, 4.5)!);
    expect(revenuNecessaire(450_000, 22_500, 6)!).toBeGreaterThan(revenuNecessaire(450_000, 22_500, 4.5)!);
  });

  it('ne promet rien quand la mise de fonds est sous le minimum ou le prix absent', () => {
    expect(revenuNecessaire(450_000, 5_000, 4.5)).toBeNull();
    expect(revenuNecessaire(0, 20_000, 4.5)).toBeNull();
  });
});
