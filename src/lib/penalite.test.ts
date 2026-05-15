/**
 * Tests unitaires pour le module penalite.ts
 *
 * Couvre tous les cas exigés :
 * - Taux variable → 3 mois seulement
 * - Taux fixe, taux courants > taux contractuel → IRD = 0
 * - Taux fixe, méthode affichée → IRD domine
 * - Comparaison méthode réelle vs affichée
 * - Edge cases (1 mois restant, solde 0, terme écoulé)
 * - Choix du terme de comparaison
 * - Validation des inputs
 */

import { describe, it, expect } from 'vitest';
import {
  calculerMoisRestants,
  termeLePlusProche,
  calculerPenalite3Mois,
  calculerIRD,
  calculerPenalite,
  validerInputs,
  comparerMethodes,
  type PenaliteInput,
} from './penalite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Crée un input de base valide pour les tests */
function inputBase(overrides?: Partial<PenaliteInput>): PenaliteInput {
  return {
    solde: 300_000,
    tauxContractuel: 5.5,
    dateDebutTerme: '2023-06-01',
    dureeTermeMois: 60, // 5 ans
    typeTaux: 'fixe',
    methodeIRD: 'taux_affiche',
    tauxAfficheOrigine: 7.0,
    tauxMarche: {
      6: 4.8,
      12: 4.5,
      24: 4.2,
      36: 3.9,
      48: 3.7,
      60: 3.5,
    },
    ...overrides,
  };
}

/** Date de référence fixe pour des tests reproductibles : 2026-05-14 */
const DATE_REF = new Date('2026-05-14T00:00:00');

// ---------------------------------------------------------------------------
// calculerMoisRestants
// ---------------------------------------------------------------------------

describe('calculerMoisRestants', () => {
  it('calcule correctement les mois restants pour un terme de 5 ans commencé le 2023-06-01', () => {
    // Date ref = 2026-05-14, terme = 60 mois → fin = 2028-06-01
    // Mai 2026 à Juin 2028 = 24 mois + 1 mois partiel ≈ 24 mois
    const restants = calculerMoisRestants('2023-06-01', 60, DATE_REF);
    expect(restants).toBe(24);
  });

  it('retourne 0 si le terme est déjà écoulé', () => {
    const restants = calculerMoisRestants('2020-01-01', 12, DATE_REF); // Fin = 2021-01-01
    expect(restants).toBe(0);
  });

  it('retourne le bon nombre quand la date actuelle est proche de la fin', () => {
    // Début 2025-07-01, 12 mois → fin 2026-07-01. Ref 2026-05-14 → ~1 mois restant
    const restants = calculerMoisRestants('2025-07-01', 12, DATE_REF);
    expect(restants).toBe(1);
  });

  it('gère un terme de 10 ans correctement', () => {
    // Début 2020-01-01, 120 mois → fin 2030-01-01. Ref 2026-05-14
    const restants = calculerMoisRestants('2020-01-01', 120, DATE_REF);
    expect(restants).toBe(43);
  });
});

// ---------------------------------------------------------------------------
// termeLePlusProche
// ---------------------------------------------------------------------------

describe('termeLePlusProche', () => {
  it('18 mois restants → utilise le taux 2 ans (24 mois)', () => {
    expect(termeLePlusProche(18)).toBe(24);
  });

  it('24 mois restants → utilise 24 mois', () => {
    expect(termeLePlusProche(24)).toBe(24);
  });

  it('25 mois restants → utilise 24 mois (plus proche que 36)', () => {
    expect(termeLePlusProche(25)).toBe(24);
  });

  it('31 mois restants → utilise 36 mois (plus proche que 24)', () => {
    expect(termeLePlusProche(31)).toBe(36);
  });

  it('60 mois ou plus → utilise 60 mois', () => {
    expect(termeLePlusProche(60)).toBe(60);
    expect(termeLePlusProche(72)).toBe(60);
  });

  it('0 mois → utilise 6 mois', () => {
    expect(termeLePlusProche(0)).toBe(6);
  });

  it('6 mois → utilise 6 mois', () => {
    expect(termeLePlusProche(6)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// calculerPenalite3Mois
// ---------------------------------------------------------------------------

describe('calculerPenalite3Mois', () => {
  it('calcule correctement pour 300 000 $ à 5.5 %', () => {
    // 300000 × 0.055 × 0.25 = 4125
    const penalite = calculerPenalite3Mois(300_000, 5.5);
    expect(penalite).toBeCloseTo(4125, 0);
  });

  it('retourne 0 pour un solde de 0', () => {
    expect(calculerPenalite3Mois(0, 5.5)).toBe(0);
  });

  it('retourne 0 pour un taux de 0', () => {
    expect(calculerPenalite3Mois(300_000, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculerIRD
// ---------------------------------------------------------------------------

describe('calculerIRD', () => {
  it('calcule l\'IRD quand le taux de comparaison est inférieur', () => {
    // 300000 × (5.5 - 3.5)/100 × (24/12) = 300000 × 0.02 × 2 = 12000
    const ird = calculerIRD(300_000, 5.5, 3.5, 24);
    expect(ird).toBeCloseTo(12_000, 0);
  });

  it('retourne 0 quand le taux de comparaison est supérieur', () => {
    const ird = calculerIRD(300_000, 3.5, 5.5, 24);
    expect(ird).toBe(0);
  });

  it('retourne 0 quand les taux sont égaux', () => {
    const ird = calculerIRD(300_000, 5.0, 5.0, 24);
    expect(ird).toBe(0);
  });

  it('retourne 0 quand il ne reste aucun mois', () => {
    const ird = calculerIRD(300_000, 5.5, 3.5, 0);
    expect(ird).toBe(0);
  });

  it('proportionnel au nombre de mois restants', () => {
    const ird12 = calculerIRD(300_000, 5.5, 3.5, 12);
    const ird24 = calculerIRD(300_000, 5.5, 3.5, 24);
    // 24 mois = 2× 12 mois
    expect(ird24).toBeCloseTo(ird12 * 2, 0);
  });
});

// ---------------------------------------------------------------------------
// calculerPenalite — Taux variable
// ---------------------------------------------------------------------------

describe('calculerPenalite — Taux variable', () => {
  it('taux variable → pénalité = 3 mois d\'intérêts seulement', () => {
    const input = inputBase({ typeTaux: 'variable' });
    const result = calculerPenalite(input, DATE_REF);

    expect(result.penaliteIRD).toBe(0);
    expect(result.methodeRetenue).toBe('trois_mois');
    expect(result.penaliteTotale).toBe(result.penalite3Mois);
    expect(result.penaliteTotale).toBeGreaterThan(0);
  });

  it('taux variable → pas d\'IRD même si les taux baissent', () => {
    const input = inputBase({
      typeTaux: 'variable',
    });
    const result = calculerPenalite(input, DATE_REF);
    expect(result.penaliteIRD).toBe(0);
    expect(result.tauxReference).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// calculerPenalite — Taux fixe, IRD = 0
// ---------------------------------------------------------------------------

describe('calculerPenalite — IRD = 0 (taux courants > taux référence)', () => {
  it('taux courants supérieurs au taux de référence → IRD = 0, pénalité = 3 mois', () => {
    const input = inputBase({
      tauxContractuel: 3.0,
      tauxAfficheOrigine: 3.0,
      methodeIRD: 'taux_reel',
      tauxMarche: {
        6: 5.0,
        12: 5.2,
        24: 5.5, // > 3.0
        36: 5.8,
        48: 6.0,
        60: 6.2,
      },
    });
    const result = calculerPenalite(input, DATE_REF);

    expect(result.penaliteIRD).toBe(0);
    expect(result.ecartTaux).toBe(0);
    expect(result.penaliteTotale).toBe(result.penalite3Mois);
  });
});

// ---------------------------------------------------------------------------
// calculerPenalite — Méthode taux affichés (IRD domine)
// ---------------------------------------------------------------------------

describe('calculerPenalite — Méthode taux affichés', () => {
  it('IRD domine quand les taux ont beaucoup baissé (cas typique grande banque)', () => {
    const input = inputBase({
      solde: 300_000,
      tauxContractuel: 5.5,
      tauxAfficheOrigine: 7.0,
      methodeIRD: 'taux_affiche',
      dateDebutTerme: '2023-06-01',
      dureeTermeMois: 60,
      tauxMarche: {
        6: 4.0,
        12: 3.8,
        24: 3.5, // terme comparaison pour 24 mois restants
        36: 3.3,
        48: 3.1,
        60: 3.0,
      },
    });
    const result = calculerPenalite(input, DATE_REF);

    // IRD = 300000 × (7.0 - 3.5)/100 × (24/12) = 300000 × 0.035 × 2 = 21000
    expect(result.penaliteIRD).toBeCloseTo(21_000, -2); // ~21k
    // 3 mois = 300000 × 0.055 × 0.25 = 4125
    expect(result.penalite3Mois).toBeCloseTo(4_125, -2);
    // MAX = IRD
    expect(result.penaliteTotale).toBe(result.penaliteIRD);
    expect(result.methodeRetenue).toBe('taux_affiche');
    expect(result.termeComparaison).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// calculerPenalite — Méthode taux réels (IRD plus bas)
// ---------------------------------------------------------------------------

describe('calculerPenalite — Méthode taux réels', () => {
  it('IRD plus bas avec la méthode des taux réels (mêmes conditions)', () => {
    const input = inputBase({
      solde: 300_000,
      tauxContractuel: 5.5,
      methodeIRD: 'taux_reel',
      dateDebutTerme: '2023-06-01',
      dureeTermeMois: 60,
      tauxMarche: {
        6: 4.0,
        12: 3.8,
        24: 3.5,
        36: 3.3,
        48: 3.1,
        60: 3.0,
      },
    });
    const result = calculerPenalite(input, DATE_REF);

    // IRD = 300000 × (5.5 - 3.5)/100 × (24/12) = 300000 × 0.02 × 2 = 12000
    expect(result.penaliteIRD).toBeCloseTo(12_000, -2);
    // Contre ~21k avec la méthode affichée
    expect(result.penaliteTotale).toBe(result.penaliteIRD);
    expect(result.methodeRetenue).toBe('taux_reel');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('calculerPenalite — Edge cases', () => {
  it('solde = 0 → pénalité = 0', () => {
    const input = inputBase({ solde: 0 });
    const result = calculerPenalite(input, DATE_REF);
    expect(result.penaliteTotale).toBe(0);
    expect(result.penalite3Mois).toBe(0);
    expect(result.penaliteIRD).toBe(0);
  });

  it('1 mois restant au terme → pénalité proportionnelle', () => {
    const input = inputBase({
      solde: 300_000,
      tauxContractuel: 5.5,
      tauxAfficheOrigine: 7.0,
      dateDebutTerme: '2025-07-01',
      dureeTermeMois: 12,
    });
    const result = calculerPenalite(input, DATE_REF);

    // 1 mois restant → IRD = 300000 × (7.0 - 4.8)/100 × (1/12)
    // Terme comparaison: 6 mois (plus proche de 1)
    // IRD ≈ 300000 × 0.022 × 0.0833 ≈ 550
    expect(result.moisRestants).toBe(1);
    expect(result.termeComparaison).toBe(6);
    expect(result.penaliteIRD).toBeLessThan(result.penalite3Mois);
    // 3 mois = 300000 × 0.055 × 0.25 = 4125
    expect(result.penaliteTotale).toBe(result.penalite3Mois);
  });

  it('terme entièrement écoulé → pénalité = 0', () => {
    const input = inputBase({
      dateDebutTerme: '2020-01-01',
      dureeTermeMois: 12, // fini en 2021
    });
    const result = calculerPenalite(input, DATE_REF);

    expect(result.penaliteTotale).toBe(0);
    expect(result.moisRestants).toBe(0);
    expect(result.methodeRetenue).toBe('non_applicable');
    expect(result.avertissements.length).toBeGreaterThan(0);
  });

  it('tauxAfficheOrigine non fourni → fallback au taux contractuel', () => {
    const input = inputBase({
      tauxAfficheOrigine: undefined,
      methodeIRD: 'taux_affiche',
    });
    const result = calculerPenalite(input, DATE_REF);

    // Devrait utiliser tauxContractuel comme référence
    expect(result.tauxReference).toBe(5.5);
    expect(result.avertissements.some((a) => a.includes('taux affiché'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// comparerMethodes
// ---------------------------------------------------------------------------

describe('comparerMethodes', () => {
  it('montre l\'écart entre méthode affichée et méthode réelle', () => {
    const input = inputBase({
      solde: 300_000,
      tauxContractuel: 5.5,
      tauxAfficheOrigine: 7.0,
      tauxMarche: {
        6: 4.0,
        12: 3.8,
        24: 3.5,
        36: 3.3,
        48: 3.1,
        60: 3.0,
      },
    });

    const comparaison = comparerMethodes(input, 7.0);
    expect(comparaison).not.toBeNull();
    if (comparaison) {
      // Méthode affichée > méthode réelle
      expect(comparaison.penaliteTauxAffiche).toBeGreaterThan(comparaison.penaliteTauxReel);
      expect(comparaison.ecart).toBeGreaterThan(0);
      expect(comparaison.message).toContain('First National');
    }
  });

  it('retourne null pour un taux variable', () => {
    const input = inputBase({ typeTaux: 'variable' });
    expect(comparerMethodes(input, 7.0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validerInputs
// ---------------------------------------------------------------------------

describe('validerInputs', () => {
  it('retourne un objet vide pour des inputs valides', () => {
    const input = inputBase();
    const erreurs = validerInputs(input);
    expect(Object.keys(erreurs)).toHaveLength(0);
  });

  it('détecte un solde négatif', () => {
    const input = inputBase({ solde: -1000 });
    const erreurs = validerInputs(input);
    expect(erreurs.solde).toBeDefined();
  });

  it('détecte un solde > 5M', () => {
    const input = inputBase({ solde: 6_000_000 });
    const erreurs = validerInputs(input);
    expect(erreurs.solde).toBeDefined();
  });

  it('détecte un taux contractuel à 0', () => {
    const input = inputBase({ tauxContractuel: 0 });
    const erreurs = validerInputs(input);
    expect(erreurs.tauxContractuel).toBeDefined();
  });

  it('détecte un taux contractuel > 20%', () => {
    const input = inputBase({ tauxContractuel: 25 });
    const erreurs = validerInputs(input);
    expect(erreurs.tauxContractuel).toBeDefined();
  });

  it('détecte une date de début future', () => {
    const input = inputBase({ dateDebutTerme: '2027-01-01' });
    const erreurs = validerInputs(input);
    expect(erreurs.dateDebutTerme).toBeDefined();
  });

  it('détecte une date invalide', () => {
    const input = inputBase({ dateDebutTerme: 'pas-une-date' });
    const erreurs = validerInputs(input);
    expect(erreurs.dateDebutTerme).toBeDefined();
  });

  it('détecte une durée de terme hors limites', () => {
    const input = inputBase({ dureeTermeMois: 6 }); // < 12
    const erreurs = validerInputs(input);
    expect(erreurs.dureeTermeMois).toBeDefined();
  });

  it('détecte un taux affiché origine invalide', () => {
    const input = inputBase({ tauxAfficheOrigine: -1 });
    const erreurs = validerInputs(input);
    expect(erreurs.tauxAfficheOrigine).toBeDefined();
  });
});
