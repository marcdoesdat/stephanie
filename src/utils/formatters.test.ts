/**
 * Tests des formatteurs de date.
 *
 * Le bug que ces tests verrouillent : les fonctions Netlify tournent en **UTC**. Sans fuseau
 * imposé, une signature apposée en soirée au Québec est datée du **lendemain** sur le
 * contrat — une mauvaise date sur un document signé, et rien pour la signaler. Les cas
 * ci-dessous couvrent les deux côtés du changement d'heure.
 */
import { describe, expect, it } from 'vitest';
import { FUSEAU_QUEBEC, formatDateHeureLong, formatDateLong } from './formatters';

/** Les espaces fines insécables d'`Intl` rendent les comparaisons illisibles. */
function normaliser(texte: string): string {
  return texte.replace(/[   ]/g, ' ');
}

describe('FUSEAU_QUEBEC', () => {
  it('est l’identifiant IANA canonique', () => {
    // America/Montreal n'est qu'un alias, absent de certains runtimes.
    expect(FUSEAU_QUEBEC).toBe('America/Toronto');
  });
});

describe('formatDateLong', () => {
  it('garde la date du Québec quand UTC est déjà au lendemain (heure normale)', () => {
    // 14 janvier 2026, 21 h 30 HNE = 15 janvier 02 h 30 UTC.
    expect(formatDateLong(new Date('2026-01-15T02:30:00Z'))).toBe('14 janvier 2026');
  });

  it('garde la date du Québec quand UTC est déjà au lendemain (heure avancée)', () => {
    // 13 août 2026, 22 h 00 HAE = 14 août 02 h 00 UTC.
    expect(formatDateLong(new Date('2026-08-14T02:00:00Z'))).toBe('13 août 2026');
  });

  it('formate une date ordinaire en français', () => {
    expect(formatDateLong(new Date('2026-06-01T16:00:00Z'))).toBe('1 juin 2026');
  });
});

describe('formatDateHeureLong', () => {
  it('convertit UTC en heure normale de l’Est, avec la mention du fuseau', () => {
    const sortie = normaliser(formatDateHeureLong('2026-01-15T02:30:00Z'));
    expect(sortie).toContain('14 janvier 2026');
    expect(sortie).toContain('21 h 30');
    expect(sortie).toContain('HNE');
  });

  it('tient compte de l’heure avancée l’été', () => {
    // Même écart UTC, une heure de décalage en moins : c'est tout l'objet du test.
    const sortie = normaliser(formatDateHeureLong('2026-08-13T19:26:24.305Z'));
    expect(sortie).toContain('13 août 2026');
    expect(sortie).toContain('15 h 26');
    expect(sortie).toContain('HAE');
  });

  it('bascule au bon moment le jour du changement d’heure', () => {
    // Le 8 mars 2026 à 2 h, l'Est passe de HNE à HAE.
    expect(normaliser(formatDateHeureLong('2026-03-08T06:30:00Z'))).toContain('HNE');
    expect(normaliser(formatDateHeureLong('2026-03-08T07:30:00Z'))).toContain('HAE');
  });

  it('accepte indifféremment une Date ou une chaîne ISO', () => {
    const iso = '2026-08-13T19:26:24.305Z';
    expect(formatDateHeureLong(iso)).toBe(formatDateHeureLong(new Date(iso)));
  });

  it('rend la valeur telle quelle plutôt que « Invalid Date »', () => {
    // Un courriel de preuve ne doit jamais afficher « Invalid Date » à la place d'un
    // horodatage : mieux vaut montrer la valeur brute, qui reste diagnosticable.
    expect(formatDateHeureLong('pas une date')).toBe('pas une date');
  });
});
