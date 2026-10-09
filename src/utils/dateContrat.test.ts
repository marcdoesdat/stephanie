import { describe, expect, it } from 'vitest';
import { aujourdhuiIso, depuisTexteContrat, versTexteContrat } from './dateContrat';

describe('versTexteContrat', () => {
  it('écrit la date en toutes lettres, comme le contrat la portait', () => {
    expect(versTexteContrat('2027-04-30')).toBe('30 avril 2027');
    expect(versTexteContrat('2026-12-31')).toBe('31 décembre 2026');
    expect(versTexteContrat('2026-08-01')).toBe('1er août 2026');
  });

  it('rend vide une valeur qui n’est pas une date', () => {
    expect(versTexteContrat('')).toBe('');
    expect(versTexteContrat('2026-02-30')).toBe('');
    expect(versTexteContrat('30 avril 2027')).toBe('');
  });
});

describe('depuisTexteContrat', () => {
  it('relit le texte d’un contrat existant', () => {
    expect(depuisTexteContrat('30 avril 2027')).toBe('2027-04-30');
    expect(depuisTexteContrat('1er août 2026')).toBe('2026-08-01');
    expect(depuisTexteContrat('Le 5 Fevrier 2027')).toBe('2027-02-05');
    expect(depuisTexteContrat('14 sept. 2026')).toBe('2026-09-14');
    expect(depuisTexteContrat('2026-05-14')).toBe('2026-05-14');
    expect(depuisTexteContrat('14/05/2026')).toBe('2026-05-14');
  });

  it('ne devine pas : texte ambigu ou date impossible → null', () => {
    expect(depuisTexteContrat('')).toBeNull();
    expect(depuisTexteContrat('fin avril')).toBeNull();
    expect(depuisTexteContrat('31 juin 2026')).toBeNull();
    expect(depuisTexteContrat('5 ma 2026')).toBeNull();
  });

  it('fait l’aller-retour sur toute l’année', () => {
    for (let mois = 1; mois <= 12; mois += 1) {
      const valeur = `2026-${String(mois).padStart(2, '0')}-01`;
      expect(depuisTexteContrat(versTexteContrat(valeur))).toBe(valeur);
    }
  });
});

describe('aujourdhuiIso', () => {
  it('prend le jour local, pas le jour UTC', () => {
    expect(aujourdhuiIso(new Date(2026, 4, 14, 23, 30))).toBe('2026-05-14');
  });
});
