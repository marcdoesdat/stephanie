import { describe, expect, it } from 'vitest';
import { composerFrise, formaterHorodatage, lienCorrectionAdresse } from './friseSignature';

describe('formaterHorodatage', () => {
  it('rend l’instant serveur à l’heure du Québec', () => {
    expect(formaterHorodatage('2026-05-14T15:50:00.000Z')).toBe('14 mai 2026, 11 h 50');
  });

  it('ne devine rien d’un horodatage absent ou illisible', () => {
    expect(formaterHorodatage(null)).toBeNull();
    expect(formaterHorodatage(undefined)).toBeNull();
    expect(formaterHorodatage('pas une date')).toBeNull();
  });
});

describe('composerFrise', () => {
  const base = { prenomCourtiere: 'Stéphanie', signeLe: '2026-05-14T15:50:00.000Z' };

  it('dernier emprunteur : tout le monde a signé, la courtière est l’étape courante', () => {
    const etapes = composerFrise({
      ...base,
      signataires: [
        { nom: 'Marie Tremblay', signe: true },
        { nom: 'Luc Gagnon', signe: false },
      ],
      index: 1,
    });
    expect(etapes.map((e) => [e.etat, e.texte])).toEqual([
      ['fait', 'Marie Tremblay a signé'],
      ['fait', 'Vous avez signé'],
      ['courant', 'Stéphanie relit le contrat et appose sa signature — c’est la dernière'],
      ['avenir', 'Vous recevez le contrat signé par courriel'],
    ]);
    expect(etapes[1]?.detail).toBe('14 mai 2026, 11 h 50');
    expect(etapes[3]?.reception).toBe(true);
  });

  it('premier de trois : le suivant est courant, les autres à venir, la courtière après eux', () => {
    const etapes = composerFrise({
      ...base,
      signataires: [
        { nom: 'Marie Tremblay', signe: false },
        { nom: 'Luc Gagnon', signe: false },
        { nom: 'Léa Roy', signe: false },
      ],
      index: 0,
    });
    expect(etapes.map((e) => e.etat)).toEqual(['fait', 'courant', 'avenir', 'avenir', 'avenir']);
    expect(etapes[1]?.texte).toBe('Luc Gagnon lit le contrat et signe à son tour');
  });

  it('n’invente pas d’heure quand le serveur n’en a pas renvoyé', () => {
    const [moi] = composerFrise({ ...base, signeLe: null, signataires: [{ nom: 'A B', signe: false }], index: 0 });
    expect(moi?.detail).toBeUndefined();
  });

  it('n’annonce aucun accusé immédiat ni aucun délai', () => {
    const textes = composerFrise({ ...base, signataires: [{ nom: 'A B', signe: false }], index: 0 })
      .map((e) => e.texte)
      .join(' ');
    expect(textes).not.toMatch(/accusé|heures?\b|jours?\b|bientôt/i);
  });
});

describe('lienCorrectionAdresse', () => {
  it('adresse le courriel à la courtière, avec le contrat et le signataire nommés', () => {
    const lien = lienCorrectionAdresse({
      courrielCourtiere: 'sweyman@hypotheca.ca',
      prenomCourtiere: 'Stéphanie',
      nom: 'Marie Tremblay',
      courriel: 'marie@exemple.com',
    });
    expect(lien.startsWith('mailto:sweyman@hypotheca.ca?subject=')).toBe(true);
    const corps = decodeURIComponent(lien.split('&body=')[1] ?? '');
    expect(corps).toContain('marie@exemple.com');
    expect(corps).toContain('Marie Tremblay');
    expect(decodeURIComponent(lien)).toContain('Contrat de courtage');
  });
});
