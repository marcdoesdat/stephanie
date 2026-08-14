/**
 * Tests des réglages mémorisés de la courtière.
 *
 * Le risque que ces tests couvrent : un champ propre au client qui se glisserait dans
 * `CLES_DEFAUTS` serait reporté d'un dossier au suivant. Personne ne remarquerait qu'un
 * contrat porte l'adresse du projet ou le montant du prêt du client précédent — le
 * formulaire s'ouvrirait « déjà rempli », ce qui est justement l'effet recherché pour les
 * champs du cabinet.
 */
import { describe, expect, it } from 'vitest';
import { filtrerDefauts } from './reglagesCourtiere';
import { CLES_DEFAUTS, parserDonneesContrat } from '../utils/contratCourtage';

/** Champs qui décrivent le client ou son projet — jamais mémorisables. */
const PROPRES_AU_CLIENT = [
  'emprunteurs',
  'adresseProjet',
  'montantPret',
  'assuranceHypothecaire',
  'totalPret',
  'tauxInteret',
  'typeTaux',
  'amortissementAns',
  'amortissementMois',
  'termeAns',
  'termeMois',
  'versement',
  'rang',
  'autresExigences',
  'autresPrecisions',
  'typesFinancement',
  'ppv',
  'transfertCabinet',
  'consentementsValidesJusquau',
  'identite',
  'dateVerification',
  'raisonDoubleRemuneration',
];

describe('CLES_DEFAUTS', () => {
  it('ne mémorise aucun champ propre au client', () => {
    for (const cle of CLES_DEFAUTS) {
      expect(PROPRES_AU_CLIENT).not.toContain(cle);
    }
  });

  it('ne référence que des champs qui existent dans un contrat', () => {
    const contrat = parserDonneesContrat({
      emprunteurs: [{ prenom: 'Ana', nom: 'Silva', courriel: 'ana@exemple.ca' }],
      ppv: 'non',
      transfertCabinet: 'non',
      typesFinancement: [],
    })!;
    for (const cle of CLES_DEFAUTS) {
      expect(contrat).toHaveProperty(cle);
    }
  });

  it('ne contient pas de doublon', () => {
    expect(new Set(CLES_DEFAUTS).size).toBe(CLES_DEFAUTS.length);
  });
});

describe('filtrerDefauts', () => {
  it('retient les clés du catalogue', () => {
    const propres = filtrerDefauts({ nbPreteursCabinet: '23', collaborateur: 'N/A' });
    expect(propres).toEqual({ nbPreteursCabinet: '23', collaborateur: 'N/A' });
  });

  it('écarte toute clé hors catalogue', () => {
    // Une clé inconnue viendrait soit d'une version antérieure, soit d'une requête forgée.
    const propres = filtrerDefauts({ montantPret: '325000', adresseProjet: 'chez le client' });
    expect(propres).toEqual({});
  });

  it('écarte les valeurs qui ne sont pas des chaînes', () => {
    expect(filtrerDefauts({ nbPreteursCabinet: 23 })).toEqual({});
    expect(filtrerDefauts({ nbPreteursCabinet: null })).toEqual({});
  });

  it('normalise les espaces et ignore les valeurs vides', () => {
    const propres = filtrerDefauts({ preteurMajoritaire: '  CIBC\n Banque  ', autresLogiciels: '   ' });
    expect(propres.preteurMajoritaire).toBe('CIBC Banque');
    expect(propres).not.toHaveProperty('autresLogiciels');
  });

  it('plafonne les valeurs trop longues', () => {
    const propres = filtrerDefauts({ preteurMajoritaire: 'X'.repeat(500) });
    expect(propres.preteurMajoritaire!.length).toBe(200);
  });
});
