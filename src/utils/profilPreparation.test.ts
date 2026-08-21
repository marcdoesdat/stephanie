import { describe, expect, it } from 'vitest';
import { MAX_SIGNATAIRES } from './profilEmprunteurs';
import {
  PARAM_LONGUEUR_MAX,
  PARAM_PREREMPLISSAGE,
  decoderPreremplissage,
  encoderPreremplissage,
  lienProfilPrerempli,
  normaliserEmprunteurs,
} from './profilPreparation';

describe('aller-retour', () => {
  it('retrouve les emprunteurs préparés, accents compris', () => {
    const entrees = [
      { nom: 'Frédérique Côté', courriel: 'frederique@exemple.ca' },
      { nom: 'Jean-Sébastien Ouellet', courriel: 'js@exemple.ca' },
    ];
    const encode = encoderPreremplissage(entrees);
    expect(encode).not.toBeNull();
    expect(decoderPreremplissage(encode)).toEqual(entrees);
  });

  it('ne produit que des caractères sûrs dans une URL', () => {
    const encode = encoderPreremplissage([{ nom: 'Émilie Lévesque', courriel: 'e@exemple.ca' }]);
    expect(encode).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('conserve un nom sans adresse — le client la complétera', () => {
    const encode = encoderPreremplissage([
      { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
      { nom: 'Julie Roy', courriel: '' },
    ]);
    expect(decoderPreremplissage(encode)).toEqual([
      { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
      { nom: 'Julie Roy', courriel: '' },
    ]);
  });
});

describe('normalisation', () => {
  it('met les adresses en minuscules et resserre les espaces des noms', () => {
    expect(normaliserEmprunteurs([{ nom: '  Marc   Tremblay ', courriel: ' Marc@Exemple.CA ' }])).toEqual([
      { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
    ]);
  });

  it('écarte une adresse mal formée sans perdre le nom', () => {
    expect(normaliserEmprunteurs([{ nom: 'Marc Tremblay', courriel: 'marc@' }])).toEqual([
      { nom: 'Marc Tremblay', courriel: '' },
    ]);
  });

  it('écarte un nom trop court sans perdre l’adresse', () => {
    expect(normaliserEmprunteurs([{ nom: 'M', courriel: 'marc@exemple.ca' }])).toEqual([
      { nom: '', courriel: 'marc@exemple.ca' },
    ]);
  });

  it('laisse tomber les entrées entièrement vides', () => {
    expect(
      normaliserEmprunteurs([
        { nom: '', courriel: '' },
        { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
        null,
        'nimporte quoi',
      ]),
    ).toEqual([{ nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' }]);
  });

  it('ne préremplit pas deux fois la même adresse — le serveur la refuserait', () => {
    expect(
      normaliserEmprunteurs([
        { nom: 'Marc Tremblay', courriel: 'foyer@exemple.ca' },
        { nom: 'Julie Roy', courriel: 'FOYER@exemple.ca' },
      ]),
    ).toEqual([
      { nom: 'Marc Tremblay', courriel: 'foyer@exemple.ca' },
      { nom: 'Julie Roy', courriel: '' },
    ]);
  });

  it('plafonne la liste au nombre de signataires que le formulaire accepte', () => {
    const entrees = Array.from({ length: MAX_SIGNATAIRES + 2 }, (_, index) => ({
      nom: `Emprunteur ${index + 1}`,
      courriel: `e${index + 1}@exemple.ca`,
    }));
    expect(normaliserEmprunteurs(entrees)).toHaveLength(MAX_SIGNATAIRES);
  });

  it('tronque un nom trop long plutôt que de le laisser passer', () => {
    const [emprunteur] = normaliserEmprunteurs([{ nom: 'a'.repeat(200), courriel: '' }]);
    expect(emprunteur?.nom).toHaveLength(60);
  });
});

describe('décodage défensif', () => {
  it('rend null sur une valeur absente, vide ou illisible', () => {
    expect(decoderPreremplissage(undefined)).toBeNull();
    expect(decoderPreremplissage('')).toBeNull();
    expect(decoderPreremplissage('pas-du-base64!!')).toBeNull();
    expect(decoderPreremplissage(encoderBase64('{"pas":"un tableau"}'))).toBeNull();
    expect(decoderPreremplissage(encoderBase64('[]'))).toBeNull();
  });

  it('rend null quand plus rien n’est exploitable après nettoyage', () => {
    expect(decoderPreremplissage(encoderBase64('[["","x"],["a",""]]'))).toBeNull();
  });

  it('refuse un paramètre démesuré sans même le décoder', () => {
    expect(decoderPreremplissage('A'.repeat(PARAM_LONGUEUR_MAX + 1))).toBeNull();
  });

  it('accepte aussi la forme objet, au cas où le lien serait écrit à la main', () => {
    expect(decoderPreremplissage(encoderBase64('[{"nom":"Marc Roy","courriel":"m@exemple.ca"}]'))).toEqual([
      { nom: 'Marc Roy', courriel: 'm@exemple.ca' },
    ]);
  });
});

describe('lien', () => {
  it('porte le paramètre de préremplissage', () => {
    const lien = lienProfilPrerempli('https://exemple.ca/', [
      { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
    ]);
    const url = new URL(lien);
    expect(url.pathname).toBe('/profil-emprunteur');
    expect(decoderPreremplissage(url.searchParams.get(PARAM_PREREMPLISSAGE))).toEqual([
      { nom: 'Marc Tremblay', courriel: 'marc@exemple.ca' },
    ]);
  });

  it('rend le lien vierge quand il n’y a rien à préremplir', () => {
    expect(lienProfilPrerempli('https://exemple.ca', [{ nom: '', courriel: '' }])).toBe(
      'https://exemple.ca/profil-emprunteur',
    );
  });
});

/** Encode un JSON brut en base64url, pour fabriquer des paramètres de test à la main. */
function encoderBase64(texte: string): string {
  return Buffer.from(texte, 'utf8').toString('base64url');
}
