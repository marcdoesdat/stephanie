/**
 * Tests du carnet du réseau.
 *
 * Ce que ces tests protègent, par ordre d'importance :
 *
 * 1. **Un retrait est définitif.** Le lien de désabonnement doit fonctionner, être
 *    idempotent, et refermer la porte pour de bon — y compris contre un changement d'état
 *    fait à la main depuis l'écran.
 * 2. **L'historique dit la vérité.** Un envoi journalisé, c'est ce qui répond un an plus
 *    tard à « qu'avez-vous écrit à cette personne ».
 * 3. **Le jeton de retrait ne redescend pas au navigateur** avec la fiche.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DonneesContact, MessageSortant } from '../utils/reseauCourtiers';

const blobs = new Map<string, string>();

function fauxStore() {
  return {
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void blobs.set(cle, valeur),
    delete: async (cle: string) => void blobs.delete(cle),
    list: async () => ({ blobs: [...blobs.keys()].map((cle) => ({ key: cle })) }),
  };
}

const getStore = vi.fn(() => fauxStore() as unknown);
vi.mock('@netlify/blobs', () => ({ getStore: (...args: unknown[]) => getStore(...(args as [])) }));

async function chargerService(): Promise<typeof import('./reseauContactService')> {
  vi.resetModules();
  return import('./reseauContactService');
}

function donnees(surcharge: Partial<DonneesContact> = {}): DonneesContact {
  return {
    nom: 'Marie Tremblay',
    courriel: 'marie@agence.ca',
    telephone: '450 555-1234',
    agence: 'RE/MAX Repentigny',
    secteur: 'Repentigny',
    profession: 'courtier-immobilier',
    notes: '',
    consentement: { base: 'tacite_publie', source: 'Site de son agence' },
    ...surcharge,
  };
}

const MESSAGE: MessageSortant = {
  gabarit: 'introduction',
  objet: 'Que vos offres ne tombent plus sur le financement',
  corps: 'Bonjour Marie, je suis Stéphanie Weyman, courtière hypothécaire.',
};

beforeEach(() => {
  blobs.clear();
  getStore.mockClear();
});

describe('création', () => {
  it('crée une fiche à contacter, jamais déjà contactée', async () => {
    const service = await chargerService();
    const resultat = await service.creerContact(donnees());
    expect('doublon' in resultat).toBe(false);
    if ('doublon' in resultat) return;

    expect(resultat.etat).toBe('a_contacter');
    expect(resultat.dernierEnvoiLe).toBeNull();
    expect(resultat.historique).toHaveLength(1);
    expect(resultat.jetonRetrait.length).toBeGreaterThan(20);
  });

  it('refuse un doublon d’adresse — sinon la même personne reçoit deux fois la même relance', async () => {
    const service = await chargerService();
    await service.creerContact(donnees());
    const second = await service.creerContact(donnees({ nom: 'M. Tremblay' }));
    expect('doublon' in second).toBe(true);
  });

  it('date le consentement à la création et garde cette date à la correction', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');
    const origine = cree.consentement.le;

    const modifie = await service.modifierContact(
      cree.id,
      donnees({ consentement: { base: 'relation_existante', source: 'A référé un client' } }),
    );
    expect(modifie?.consentement.base).toBe('relation_existante');
    expect(modifie?.consentement.le).toBe(origine);
  });
});

describe('envois', () => {
  it('journalise le texte réellement envoyé et fait avancer l’état', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    const apres = await service.journaliserEnvoi(cree.id, MESSAGE);
    expect(apres?.etat).toBe('contacte');
    expect(apres?.dernierEnvoiLe).not.toBeNull();

    const dernier = apres?.historique.at(-1);
    expect(dernier?.type).toBe('courriel');
    expect(dernier?.corps).toBe(MESSAGE.corps);
    expect(dernier?.resume).toContain('Courriel envoyé');
  });

  it('dit dans le journal qu’un envoi simulé n’est pas parti', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    const apres = await service.journaliserEnvoi(cree.id, MESSAGE, { simule: true });
    expect(apres?.historique.at(-1)?.resume).toContain('simulé');
  });

  it('efface la relance accomplie', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    await service.fixerRelance(cree.id, '2026-09-01');
    const apres = await service.journaliserEnvoi(cree.id, MESSAGE);
    expect(apres?.relanceLe).toBeNull();
  });

  it('compte les envois du jour, tous contacts confondus', async () => {
    const service = await chargerService();
    const a = await service.creerContact(donnees());
    const b = await service.creerContact(donnees({ courriel: 'jean@etude.ca', nom: 'Jean Roy' }));
    if ('doublon' in a || 'doublon' in b) throw new Error('doublon inattendu');

    await service.journaliserEnvoi(a.id, MESSAGE);
    await service.journaliserEnvoi(b.id, MESSAGE);
    expect(service.envoisDuJour(await service.listerContacts())).toBe(2);

    // Un envoi d'hier ne compte plus dans le plafond d'aujourd'hui.
    const hier = new Date(Date.now() - 26 * 3600000).toISOString();
    const contacts = await service.listerContacts();
    const bricole = contacts.map((contact) => ({
      ...contact,
      historique: contact.historique.map((evenement) => ({ ...evenement, le: hier })),
    }));
    expect(service.envoisDuJour(bricole)).toBe(0);
  });
});

describe('retrait', () => {
  it('retire le contact et gèle son état', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    expect(await service.retirerParJeton(cree.id, cree.jetonRetrait)).toBe('retire');
    const apres = await service.lireContact(cree.id);
    expect(apres?.etat).toBe('refuse');
    expect(apres?.historique.at(-1)?.type).toBe('retrait');
  });

  it('est idempotent — un lien cliqué deux fois ne devient jamais une erreur', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    await service.retirerParJeton(cree.id, cree.jetonRetrait);
    expect(await service.retirerParJeton(cree.id, cree.jetonRetrait)).toBe('deja_retire');
  });

  it('refuse un jeton qui n’est pas le sien', async () => {
    const service = await chargerService();
    const a = await service.creerContact(donnees());
    const b = await service.creerContact(donnees({ courriel: 'jean@etude.ca', nom: 'Jean Roy' }));
    if ('doublon' in a || 'doublon' in b) throw new Error('doublon inattendu');

    expect(await service.retirerParJeton(a.id, b.jetonRetrait)).toBe('inconnu');
    expect(await service.retirerParJeton('../autre', a.jetonRetrait)).toBe('inconnu');
    expect((await service.lireContact(a.id))?.etat).toBe('a_contacter');
  });

  it('ne se laisse pas défaire depuis l’écran : un retrait n’est pas une case à décocher', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    await service.retirerParJeton(cree.id, cree.jetonRetrait);
    const tentative = await service.changerEtat(cree.id, 'a_contacter');
    expect(tentative).toEqual({ verrouille: true });
    expect((await service.lireContact(cree.id))?.etat).toBe('refuse');
  });

  it('produit un lien de retrait absolu, sur le domaine du site', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    const lien = service.lienRetrait(cree, 'https://stephanieweyman.ca/');
    expect(lien.startsWith('https://stephanieweyman.ca/api/reseau-retrait?c=')).toBe(true);
    expect(lien).toContain(encodeURIComponent(cree.jetonRetrait));
  });
});

describe('fiche transmissible', () => {
  it('ne laisse pas le jeton de retrait redescendre au navigateur', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    const fiche = service.versFiche(cree) as Record<string, unknown>;
    expect('jetonRetrait' in fiche).toBe(false);
    expect(JSON.stringify(fiche)).not.toContain(cree.jetonRetrait);
    expect(fiche.nom).toBe('Marie Tremblay');
  });
});

describe('notes et états', () => {
  it('empile les notes sans jamais réécrire l’historique', async () => {
    const service = await chargerService();
    const cree = await service.creerContact(donnees());
    if ('doublon' in cree) throw new Error('doublon inattendu');

    await service.ajouterNote(cree.id, 'Rappelé, veut se voir en septembre.');
    const apres = await service.changerEtat(cree.id, 'en_discussion');
    if (apres === null || 'verrouille' in apres) throw new Error('changement refusé');

    expect(apres.historique.map((evenement) => evenement.type)).toEqual([
      'creation',
      'note',
      'etat',
    ]);
    expect(apres.etat).toBe('en_discussion');
  });
});
