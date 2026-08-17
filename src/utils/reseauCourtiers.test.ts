import { describe, expect, it } from 'vitest';
import {
  BASES_CONSENTEMENT,
  CLES_GABARIT,
  ETATS,
  GABARITS,
  LONGUEURS,
  PROFESSIONS,
  etatApresEnvoi,
  gabaritPour,
  gabaritValide,
  parserContact,
  parserMessage,
  peutRecevoir,
  prenomDe,
  rendreTexte,
  type CleProfession,
  type VariablesGabarit,
} from './reseauCourtiers';

const VARIABLES: VariablesGabarit = {
  prenom: 'Marie',
  nom: 'Marie Tremblay',
  agence: 'RE/MAX Repentigny',
  secteur: 'Lanaudière',
  courtiere: 'Stéphanie Weyman',
  organisation: 'Hypotheca',
  telephone: '514-949-7627',
  courriel: 'sweyman@hypotheca.ca',
  site: 'stephanieweyman.ca',
};

const CONTACT_VALIDE = {
  nom: 'Marie Tremblay',
  courriel: 'Marie.Tremblay@Agence.CA',
  telephone: '450 555-1234',
  agence: 'RE/MAX Repentigny',
  secteur: 'Repentigny',
  profession: 'courtier-immobilier',
  notes: 'Rencontrée au salon de l’habitation.',
  consentement: { base: 'tacite_publie', source: 'Adresse publiée sur le site de son agence' },
};

describe('rendreTexte', () => {
  it('remplace les variables connues', () => {
    expect(rendreTexte('Bonjour {{prenom}}, ici {{courtiere}}.', VARIABLES)).toBe(
      'Bonjour Marie, ici Stéphanie Weyman.',
    );
  });

  it('lève sur une variable inconnue plutôt que de la laisser partir en clair', () => {
    expect(() => rendreTexte('Bonjour {{prenomm}}', VARIABLES)).toThrow(/inconnue/);
  });

  it('rend une section conditionnelle quand la variable est remplie', () => {
    expect(rendreTexte('Merci{{#agence}} chez {{agence}}{{/agence}}.', VARIABLES)).toBe(
      'Merci chez RE/MAX Repentigny.',
    );
  });

  it('efface la section quand la variable est vide — pas de « chez  » orphelin', () => {
    const sansAgence = { ...VARIABLES, agence: '' };
    expect(rendreTexte('Merci{{#agence}} chez {{agence}}{{/agence}}.', sansAgence)).toBe('Merci.');
  });

  it('lève aussi sur une section dont la variable est inconnue', () => {
    expect(() => rendreTexte('{{#inconnue}}x{{/inconnue}}', VARIABLES)).toThrow(/inconnue/);
  });
});

describe('gabarits', () => {
  it('rend chaque gabarit, pour chaque profession, sans variable orpheline', () => {
    for (const cle of CLES_GABARIT) {
      for (const profession of Object.keys(PROFESSIONS) as CleProfession[]) {
        const { objet, corps } = gabaritPour(cle, profession);
        const rendus = [rendreTexte(objet, VARIABLES), rendreTexte(corps, VARIABLES)];
        for (const rendu of rendus) {
          expect(rendu).not.toMatch(/\{\{/);
          expect(rendu.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('reste rendable quand le contact n’a ni agence ni secteur', () => {
    const minimal: VariablesGabarit = { ...VARIABLES, agence: '', secteur: '' };
    for (const cle of CLES_GABARIT) {
      const { corps } = gabaritPour(cle, 'autre');
      const rendu = rendreTexte(corps, minimal);
      expect(rendu).not.toMatch(/\{\{/);
      // Une section vide ne doit pas laisser de double espace au milieu d'une phrase.
      expect(rendu).not.toMatch(/[a-zà-ÿ] {2}[a-zà-ÿ]/);
    }
  });

  it('sert la variante de profession quand elle existe, le fond commun sinon', () => {
    const immobilier = gabaritPour('introduction', 'courtier-immobilier');
    const autre = gabaritPour('introduction', 'autre');
    expect(immobilier.corps).not.toBe(autre.corps);
    expect(autre.corps).toBe(GABARITS.introduction.corps);
  });

  it('tient chaque objet sous la limite du champ', () => {
    for (const cle of CLES_GABARIT) {
      for (const profession of Object.keys(PROFESSIONS) as CleProfession[]) {
        const { objet } = gabaritPour(cle, profession);
        expect(rendreTexte(objet, VARIABLES).length).toBeLessThanOrEqual(LONGUEURS.objet);
      }
    }
  });

  it('refuse une clé hors catalogue', () => {
    expect(gabaritValide('introduction')).toBe(true);
    expect(gabaritValide('promotion_agressive')).toBe(false);
  });
});

describe('prenomDe', () => {
  it('prend le premier mot', () => {
    expect(prenomDe('Marie Tremblay')).toBe('Marie');
    expect(prenomDe('  Jean-Pierre  Roy ')).toBe('Jean-Pierre');
  });
});

describe('parserContact', () => {
  it('accepte une fiche complète et normalise le courriel', () => {
    const parse = parserContact(CONTACT_VALIDE);
    expect(parse.ok).toBe(true);
    if (parse.ok) {
      expect(parse.valeur.courriel).toBe('marie.tremblay@agence.ca');
      expect(parse.valeur.profession).toBe('courtier-immobilier');
    }
  });

  it('refuse une profession hors catalogue', () => {
    const parse = parserContact({ ...CONTACT_VALIDE, profession: 'astrologue' });
    expect(parse).toEqual({ ok: false, erreur: 'Profession inconnue.' });
  });

  it('refuse une base de consentement hors catalogue', () => {
    const parse = parserContact({
      ...CONTACT_VALIDE,
      consentement: { base: 'liste_achetee', source: 'un courtier en données' },
    });
    expect(parse).toEqual({ ok: false, erreur: 'Base de consentement inconnue.' });
  });

  it('exige la source du consentement — c’est elle qui répond « d’où vient mon adresse »', () => {
    const parse = parserContact({
      ...CONTACT_VALIDE,
      consentement: { base: 'tacite_publie', source: '' },
    });
    expect(parse.ok).toBe(false);
    if (!parse.ok) expect(parse.erreur).toMatch(/anti-pourriel/);
  });

  it('refuse une adresse invalide', () => {
    expect(parserContact({ ...CONTACT_VALIDE, courriel: 'marie(at)agence.ca' }).ok).toBe(false);
  });

  it('plafonne les champs libres', () => {
    const parse = parserContact({ ...CONTACT_VALIDE, nom: 'M'.repeat(500) });
    expect(parse.ok).toBe(true);
    if (parse.ok) expect(parse.valeur.nom.length).toBe(LONGUEURS.nom);
  });

  it('garde les retours à la ligne des notes, mais pas ceux des champs simples', () => {
    const parse = parserContact({ ...CONTACT_VALIDE, notes: 'Ligne 1\nLigne 2', agence: 'A\nB' });
    expect(parse.ok).toBe(true);
    if (parse.ok) {
      expect(parse.valeur.notes).toBe('Ligne 1\nLigne 2');
      expect(parse.valeur.agence).toBe('A B');
    }
  });
});

describe('parserMessage', () => {
  const corps = 'Bonjour Marie, voici pourquoi je vous écris aujourd’hui.';

  it('accepte un message dont le gabarit est au catalogue', () => {
    const parse = parserMessage({ gabarit: 'introduction', objet: 'Bonjour', corps });
    expect(parse.ok).toBe(true);
  });

  it('refuse un gabarit inventé — c’est l’étiquette du journal', () => {
    expect(parserMessage({ gabarit: 'autre_chose', objet: 'Bonjour', corps }).ok).toBe(false);
  });

  it('refuse un objet ou un corps vide', () => {
    expect(parserMessage({ gabarit: 'introduction', objet: '', corps }).ok).toBe(false);
    expect(parserMessage({ gabarit: 'introduction', objet: 'Bonjour', corps: 'court' }).ok).toBe(false);
  });

  it('plafonne le corps', () => {
    const parse = parserMessage({
      gabarit: 'introduction',
      objet: 'Bonjour',
      corps: 'a'.repeat(LONGUEURS.corps + 500),
    });
    expect(parse.ok).toBe(true);
    if (parse.ok) expect(parse.valeur.corps.length).toBe(LONGUEURS.corps);
  });
});

describe('états', () => {
  it('fait avancer un contact neuf, puis contacté', () => {
    expect(etatApresEnvoi('a_contacter')).toBe('contacte');
    expect(etatApresEnvoi('contacte')).toBe('relance');
  });

  it('ne fait pas régresser un partenaire ni une discussion en cours', () => {
    expect(etatApresEnvoi('partenaire')).toBe('partenaire');
    expect(etatApresEnvoi('en_discussion')).toBe('en_discussion');
    expect(etatApresEnvoi('relance')).toBe('relance');
  });

  it('interdit d’écrire à qui a demandé son retrait', () => {
    expect(peutRecevoir('refuse')).toBe(false);
    for (const etat of Object.keys(ETATS)) {
      if (etat !== 'refuse') expect(peutRecevoir(etat as keyof typeof ETATS)).toBe(true);
    }
  });
});

describe('catalogues', () => {
  it('emploie les mêmes clés de profession que le formulaire partenaires', () => {
    // /api/partenaires-submit connaît exactement ces clés : les deux bouts du réseau
    // doivent parler le même vocabulaire.
    expect(Object.keys(PROFESSIONS).sort()).toEqual(
      ['autre', 'comptable', 'courtier-immobilier', 'notaire', 'planificateur-financier'].sort(),
    );
  });

  it('n’offre aucune base de consentement qui dispenserait de dire d’où vient l’adresse', () => {
    expect(Object.keys(BASES_CONSENTEMENT)).toEqual([
      'tacite_publie',
      'relation_existante',
      'expresse',
    ]);
  });
});
