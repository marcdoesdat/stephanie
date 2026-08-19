/**
 * Tests de ce que l'écran de suivi montre le matin.
 *
 * Ce que ces tests protègent : « À faire aujourd'hui » est la première chose que Stéphanie
 * lit, et la seule qu'elle lira si sa journée est chargée. Ce qui n'y figure pas n'existe
 * pas ; ce qui y figure à tort la détourne du reste.
 *
 * Trois règles valent d'être verrouillées :
 *
 * 1. **Un dossier clos ne remonte jamais.** Une relance oubliée sur un dossier financé n'est
 *    pas un travail à faire, c'est un reliquat.
 * 2. **Le tri se fait par urgence, pas par date.** Une relance qu'elle s'était fixée passe
 *    devant un dossier qui dort — l'une est un engagement pris, l'autre un constat.
 * 3. **« Tous les documents reçus » ne se déclenche pas à l'étape d'analyse**, où le dossier
 *    est entre ses mains à elle : c'est normal, donc ce n'est pas un signal.
 */
import { describe, expect, it } from 'vitest';
import { motifUrgence, urgences, vueDe, type FicheEcran } from './dossiersEcran';
import type { CleEtape, CleEtatDocument } from './dossiersClients';

const MAINTENANT = Date.parse('2026-05-14T12:00:00.000Z');
const JOUR = 86_400_000;
const OPTIONS = { delaiSansMouvementJours: 7, maintenant: MAINTENANT };

function iso(joursAvant: number): string {
  return new Date(MAINTENANT - joursAvant * JOUR).toISOString();
}

function fiche(options: Partial<{
  etape: CleEtape;
  majIlYA: number;
  relanceIlYA: number | null;
  documents: CleEtatDocument[];
}> = {}): FicheEcran {
  const { etape = 'nouveau', majIlYA = 0, relanceIlYA = null, documents = [] } = options;
  return {
    etape,
    majLe: iso(majIlYA),
    relanceLe: relanceIlYA === null ? null : iso(relanceIlYA),
    documents: documents.map((etat) => ({ etat })),
  };
}

describe('vueDe', () => {
  it('range chaque fiche dans sa pile', () => {
    expect(vueDe(fiche({ etape: 'prospect' }))).toBe('prospects');
    expect(vueDe(fiche({ etape: 'analyse' }))).toBe('actifs');
    expect(vueDe(fiche({ etape: 'finance' }))).toBe('clos');
    expect(vueDe(fiche({ etape: 'perdu' }))).toBe('clos');
  });
});

describe('motifUrgence', () => {
  it('remonte une relance due aujourd’hui comme une relance en retard', () => {
    expect(motifUrgence(fiche({ relanceIlYA: 0 }), OPTIONS)).toEqual({ type: 'relance', joursDeRetard: 0 });
    expect(motifUrgence(fiche({ relanceIlYA: 5 }), OPTIONS)).toEqual({ type: 'relance', joursDeRetard: 5 });
  });

  it('laisse tranquille une relance encore à venir', () => {
    expect(motifUrgence(fiche({ relanceIlYA: -3 }), OPTIONS)).toBeNull();
  });

  it('signale un dossier dont tout est reçu mais qui n’a pas bougé', () => {
    const complet = fiche({ etape: 'documents', documents: ['recu', 'recu'] });
    expect(motifUrgence(complet, OPTIONS)).toEqual({ type: 'documents_complets' });
  });

  it('ne le signale pas à l’étape d’analyse — le dossier y est entre ses mains', () => {
    const enAnalyse = fiche({ etape: 'analyse', documents: ['recu', 'recu'] });
    expect(motifUrgence(enAnalyse, OPTIONS)).toBeNull();
  });

  it('ne confond pas une pièce écartée avec une pièce reçue', () => {
    // « Non requis » compte comme réglé : rien ne reste à fournir.
    const ecartee = fiche({ etape: 'documents', documents: ['recu', 'non_requis'] });
    expect(motifUrgence(ecartee, OPTIONS)).toEqual({ type: 'documents_complets' });

    const incomplete = fiche({ etape: 'documents', documents: ['recu', 'a_fournir'] });
    expect(motifUrgence(incomplete, OPTIONS)).toBeNull();
  });

  it('ne signale pas une checklist vide comme « tout est reçu »', () => {
    expect(motifUrgence(fiche({ etape: 'documents' }), OPTIONS)).toBeNull();
  });

  it('remonte un dossier immobile au-delà du délai, et pas avant', () => {
    expect(motifUrgence(fiche({ majIlYA: 6 }), OPTIONS)).toBeNull();
    expect(motifUrgence(fiche({ majIlYA: 7 }), OPTIONS)).toEqual({ type: 'sans_mouvement', jours: 7 });
  });

  it('ne remonte jamais un dossier clos, quoi qu’il porte', () => {
    for (const etape of ['finance', 'perdu'] as CleEtape[]) {
      const oublie = fiche({ etape, relanceIlYA: 30, majIlYA: 90, documents: ['recu'] });
      expect(motifUrgence(oublie, OPTIONS), etape).toBeNull();
    }
  });

  it('ignore une date illisible plutôt que de la traiter comme urgente', () => {
    const cassee: FicheEcran = { etape: 'nouveau', majLe: 'pas-une-date', relanceLe: 'non plus', documents: [] };
    expect(motifUrgence(cassee, OPTIONS)).toBeNull();
  });
});

describe('urgences', () => {
  it('trie par motif, puis par ancienneté — pas par ordre de liste', () => {
    const dort = fiche({ majIlYA: 20 });
    const relanceLegere = fiche({ relanceIlYA: 1 });
    const complet = fiche({ etape: 'documents', documents: ['recu'] });
    const relanceLourde = fiche({ relanceIlYA: 12 });

    const ordre = urgences([dort, relanceLegere, complet, relanceLourde], OPTIONS);
    expect(ordre.map((e) => e.urgence.type)).toEqual([
      'relance',
      'relance',
      'documents_complets',
      'sans_mouvement',
    ]);
    // Entre deux relances, la plus en retard passe devant.
    expect(ordre[0]!.fiche).toBe(relanceLourde);
  });

  it('écarte ce qui peut attendre', () => {
    const calmes = [fiche({ majIlYA: 1 }), fiche({ etape: 'finance', relanceIlYA: 10 })];
    expect(urgences(calmes, OPTIONS)).toHaveLength(0);
  });
});
