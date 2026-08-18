/**
 * Tests du recoupement entre les carnets.
 *
 * Ce que ces tests protègent :
 *
 * 1. **Rien de sensible ne franchit.** Le résolveur lit trois magasins, dont celui des
 *    contrats en cours — qui contient les tracés de signature, la donnée la plus sensible du
 *    site. Ce qu'il rend descend au navigateur : ni jeton, ni tracé, jamais.
 * 2. **Un carnet vide ne fait pas échouer la résolution.** L'écran doit s'ouvrir même si la
 *    personne n'existe que d'un seul côté — c'est le cas le plus fréquent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chaque magasin a son propre store : on les sépare par préfixe de clé pour que le carnet
// du réseau et celui des dossiers ne se mélangent pas dans la même Map.
const stores = new Map<string, Map<string, string>>();
function storePour(nom: string) {
  if (!stores.has(nom)) stores.set(nom, new Map());
  const m = stores.get(nom)!;
  return {
    get: async (cle: string) => m.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void m.set(cle, valeur),
    delete: async (cle: string) => void m.delete(cle),
    list: async () => ({ blobs: [...m.keys()].map((cle) => ({ key: cle })) }),
  };
}

vi.mock('@netlify/blobs', () => ({
  getStore: (options: { name: string } | string) =>
    storePour(typeof options === 'string' ? options : options.name) as unknown,
}));

async function charger() {
  vi.resetModules();
  return {
    fiche: await import('./ficheUnifiee'),
    dossiers: await import('./dossierClientService'),
    reseau: await import('./reseauContactService'),
  };
}

beforeEach(() => {
  stores.clear();
});

function contact(courriel: string, nom = 'Me Gagnon') {
  return {
    nom,
    courriel,
    telephone: '',
    agence: '',
    secteur: '',
    profession: 'notaire' as const,
    notes: '',
    consentement: { base: 'expresse' as const, source: 'Formulaire de référence' },
  };
}

function dossier(courriel: string, nom = 'Camille Fortin') {
  return { nom, courriel, telephone: '450 555-7777', notes: 'Note interne à ne pas fuiter.', profil: {} };
}

describe('recoupement', () => {
  it('réunit le dossier client et la fiche du réseau sous la même adresse', async () => {
    const { fiche, dossiers, reseau } = await charger();
    await reseau.creerContact(contact('gagnon@etude.ca'));
    await dossiers.creerDossier(dossier('gagnon@etude.ca', 'Me Gagnon'), { origine: 'manuel' });

    const liens = await fiche.resoudreParCourriel('Gagnon@Etude.CA');
    expect(liens.dossier?.nom).toBe('Me Gagnon');
    expect(liens.reseau?.profession).toBe('Notaire');
  });

  it('nomme le professionnel qui a référé le client', async () => {
    const { fiche, dossiers, reseau } = await charger();
    const referent = await reseau.creerContact(contact('gagnon@etude.ca'));
    if ('doublon' in referent) throw new Error('doublon inattendu');

    const client = await dossiers.creerDossier(dossier('camille@ex.ca'), {
      origine: 'partenaire',
      refereParId: referent.id,
    });
    if ('doublon' in client) throw new Error('doublon inattendu');

    const liens = await fiche.resoudreParCourriel('camille@ex.ca');
    expect(liens.referePar?.nom).toBe('Me Gagnon');
  });

  it('nomme le référent même pour une fiche sans adresse — le cas où le lien vaut le plus', async () => {
    const { fiche, dossiers, reseau } = await charger();
    const referent = await reseau.creerContact(contact('gagnon@etude.ca'));
    if ('doublon' in referent) throw new Error('doublon inattendu');

    const client = await dossiers.creerDossier(
      { ...dossier(''), courriel: '' },
      { origine: 'partenaire', refereParId: referent.id },
    );
    if ('doublon' in client) throw new Error('doublon inattendu');

    const liens = await fiche.resoudreParDossier(client.id);
    expect(liens?.dossier?.nom).toBe('Camille Fortin');
    expect(liens?.referePar?.nom).toBe('Me Gagnon');
  });
});

describe('robustesse et frontière', () => {
  it('rend une réponse vide plutôt que d’échouer quand rien ne correspond', async () => {
    const { fiche } = await charger();
    const liens = await fiche.resoudreParCourriel('inconnu@nulle-part.ca');
    expect(liens.dossier).toBeNull();
    expect(liens.reseau).toBeNull();
    expect(liens.contrat).toBeNull();
  });

  it('refuse une adresse absente ou un identifiant malformé', async () => {
    const { fiche } = await charger();
    expect((await fiche.resoudreParCourriel(null)).courriel).toBe('');
    expect(await fiche.resoudreParDossier('../../etc/passwd')).toBeNull();
    expect(await fiche.resoudreParDossier(42)).toBeNull();
  });

  it('ne laisse redescendre ni note interne, ni jeton, ni tracé', async () => {
    const { fiche, dossiers, reseau } = await charger();
    await reseau.creerContact(contact('gagnon@etude.ca'));
    await dossiers.creerDossier(dossier('gagnon@etude.ca'), { origine: 'manuel' });

    const serialise = JSON.stringify(await fiche.resoudreParCourriel('gagnon@etude.ca'));
    expect(serialise).not.toContain('Note interne');
    expect(serialise).not.toMatch(/jeton|jetonHash|jetonRetrait|tracePng/i);
  });
});
