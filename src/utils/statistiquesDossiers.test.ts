/**
 * Tests des chiffres du carnet.
 *
 * Ce que ces tests protègent :
 *
 * 1. **Les événements sans clés sont ignorés, pas devinés.** Les fiches antérieures à
 *    l'ajout de `de`/`vers` ne portent qu'une phrase française ; en tirer une durée
 *    fabriquerait des chiffres faux, et des chiffres faux sont pires qu'aucun chiffre.
 * 2. **Une fiche encore à l'étape ne compte pas dans sa durée.** L'inclure raccourcirait la
 *    médiane à mesure que la file s'allonge — l'écran dirait « ça va de plus en plus vite »
 *    précisément quand ça bloque.
 * 3. **Le rendement par origine distingue le volume du résultat.** C'est la seule mesure du
 *    module qui change une décision.
 */
import { describe, expect, it } from 'vitest';
import {
  SEUIL_LISIBILITE,
  donneesSuffisantes,
  entonnoir,
  ouverturesParMois,
  rangAtteint,
  rendementParOrigine,
  type FicheStat,
} from './statistiquesDossiers';
import type { CleEtape, CleOrigine } from './dossiersClients';

const MAINTENANT = Date.parse('2026-05-14T12:00:00.000Z');
const JOUR = 86_400_000;

function iso(joursAvant: number): string {
  return new Date(MAINTENANT - joursAvant * JOUR).toISOString();
}

/** Une fiche dont on décrit le parcours par ses transitions datées. */
function fiche(
  options: {
    origine?: CleOrigine;
    etape?: CleEtape;
    creeIlYA?: number;
    parcours?: Array<[de: CleEtape, vers: CleEtape, joursAvant: number]>;
    /** Une étape franchie sans clés — comme les fiches d'avant `de`/`vers`. */
    parcoursMuet?: number[];
  } = {},
): FicheStat {
  const { origine = 'rappel', etape = 'prospect', creeIlYA = 30, parcours = [], parcoursMuet = [] } = options;
  return {
    creeLe: iso(creeIlYA),
    etape,
    origine,
    historique: [
      { le: iso(creeIlYA), type: 'creation', vers: 'prospect' },
      ...parcours.map(([de, vers, joursAvant]) => ({ le: iso(joursAvant), type: 'etape', de, vers })),
      ...parcoursMuet.map((joursAvant) => ({ le: iso(joursAvant), type: 'etape' })),
    ],
  };
}

describe('rangAtteint', () => {
  it('retient l’étape la plus avancée, même si la fiche est revenue en arrière', () => {
    const abandonnee = fiche({
      etape: 'perdu',
      parcours: [
        ['prospect', 'nouveau', 20],
        ['nouveau', 'soumis', 10],
        ['soumis', 'perdu', 2],
      ],
    });
    // `perdu` est hors progression (rang -1) : sans mémoire du passé, ce dossier compterait
    // comme n'ayant jamais rien atteint.
    expect(rangAtteint(abandonnee)).toBe(rangAtteint(fiche({ etape: 'soumis' })));
  });
});

describe('rendementParOrigine', () => {
  const fiches: FicheStat[] = [
    // Le funnel amène du volume, et rien d'autre.
    ...Array.from({ length: 5 }, () => fiche({ origine: 'refinancement_v2' })),
    // Le rappel en amène moins, mais ça aboutit.
    fiche({ origine: 'rappel', etape: 'finance', parcours: [['prospect', 'nouveau', 20]] }),
    fiche({ origine: 'rappel', etape: 'analyse', parcours: [['prospect', 'nouveau', 15]] }),
    fiche({ origine: 'rappel' }),
  ];

  it('distingue le formulaire qui amène du volume de celui qui amène des clients', () => {
    const lignes = rendementParOrigine(fiches);
    const funnel = lignes.find((l) => l.origine === 'refinancement_v2')!;
    const rappel = lignes.find((l) => l.origine === 'rappel')!;

    expect(funnel.total).toBe(5);
    expect(funnel.qualifies).toBe(0);
    expect(rappel.total).toBe(3);
    expect(rappel.qualifies).toBe(2);
    expect(rappel.finances).toBe(1);
  });

  it('trie par volume et tait les portes qui n’ont rien produit', () => {
    const lignes = rendementParOrigine(fiches);
    expect(lignes[0]!.origine).toBe('refinancement_v2');
    expect(lignes.map((l) => l.origine)).not.toContain('penalite');
  });
});

describe('ouverturesParMois', () => {
  it('garde les mois vides plutôt que de comprimer le temps', () => {
    const mois = ouverturesParMois([fiche({ creeIlYA: 0 })], 4, MAINTENANT);
    expect(mois).toHaveLength(4);
    expect(mois.map((m) => m.mois)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('compte une fiche selon ce qu’elle était à sa naissance, pas ce qu’elle est devenue', () => {
    // Prospect entré ce mois-ci, qualifié depuis : il reste une entrée « prospect ».
    const qualifie = fiche({ creeIlYA: 3, etape: 'analyse', parcours: [['prospect', 'nouveau', 1]] });
    const mois = ouverturesParMois([qualifie], 1, MAINTENANT);
    expect(mois[0]!.prospects).toBe(1);
    expect(mois[0]!.dossiers).toBe(0);
  });

  it('ignore ce qui tombe hors de la fenêtre observée', () => {
    const mois = ouverturesParMois([fiche({ creeIlYA: 400 })], 3, MAINTENANT);
    expect(mois.every((m) => m.prospects === 0 && m.dossiers === 0)).toBe(true);
  });
});

describe('entonnoir', () => {
  it('mesure les jours passés à chaque étape', () => {
    const fiches = [
      fiche({ etape: 'analyse', creeIlYA: 30, parcours: [['prospect', 'nouveau', 20], ['nouveau', 'analyse', 14]] }),
      fiche({ etape: 'analyse', creeIlYA: 30, parcours: [['prospect', 'nouveau', 26], ['nouveau', 'analyse', 20]] }),
    ];
    const etages = entonnoir(fiches);
    // 10 jours et 4 jours en « prospect » → médiane 7.
    expect(etages.find((e) => e.etape === 'prospect')!.joursMedians).toBe(7);
    // 6 jours et 6 jours en « nouveau ».
    expect(etages.find((e) => e.etape === 'nouveau')!.joursMedians).toBe(6);
  });

  it('ne compte pas une fiche encore à l’étape — sa durée n’est pas connue', () => {
    // Entrée en « analyse » et toujours là : aucune sortie, donc aucune durée mesurable.
    const enCours = fiche({ etape: 'analyse', creeIlYA: 30, parcours: [['prospect', 'analyse', 25]] });
    const etages = entonnoir([enCours]);
    expect(etages.find((e) => e.etape === 'analyse')!.joursMedians).toBeNull();
    expect(etages.find((e) => e.etape === 'prospect')!.joursMedians).toBe(5);
  });

  it('ignore les étapes franchies sans clés plutôt que de les deviner', () => {
    // Une fiche d'avant `de`/`vers` : son journal ne porte que des phrases françaises.
    const ancienne = fiche({ etape: 'soumis', creeIlYA: 40, parcoursMuet: [30, 20, 10] });
    const etages = entonnoir([ancienne]);
    expect(etages.every((e) => e.joursMedians === null)).toBe(true);
    // Elle compte tout de même dans les étapes atteintes : son étape actuelle, elle, est sûre.
    expect(etages.find((e) => e.etape === 'soumis')!.atteintes).toBe(1);
  });

  it('compte les fiches ayant atteint chaque étage, passé compris', () => {
    const fiches = [
      fiche({ etape: 'prospect' }),
      fiche({ etape: 'nouveau', parcours: [['prospect', 'nouveau', 10]] }),
      fiche({ etape: 'finance', parcours: [['prospect', 'finance', 5]] }),
    ];
    const etages = entonnoir(fiches);
    expect(etages.find((e) => e.etape === 'prospect')!.atteintes).toBe(3);
    expect(etages.find((e) => e.etape === 'nouveau')!.atteintes).toBe(2);
    expect(etages.find((e) => e.etape === 'finance')!.atteintes).toBe(1);
  });
});

describe('donneesSuffisantes', () => {
  it('dit à l’écran de se taire tant que le carnet est mince', () => {
    expect(donneesSuffisantes(Array.from({ length: SEUIL_LISIBILITE - 1 }, () => fiche()))).toBe(false);
    expect(donneesSuffisantes(Array.from({ length: SEUIL_LISIBILITE }, () => fiche()))).toBe(true);
  });
});
