/**
 * Tests du carnet des dossiers clients.
 *
 * Ce que ces tests protègent, par ordre d'importance :
 *
 * 1. **La frontière entre les deux lecteurs.** `versVueClient` ne doit jamais laisser passer
 *    une note interne, un jeton, ou l'étape d'un dossier abandonné. C'est la seule chose qui
 *    sépare un portail rassurant d'une fuite.
 * 2. **Le lien magique est à usage unique et périssable** — il voyage par courriel, donc il
 *    survit à sa raison d'être.
 * 3. **L'historique ne se réécrit pas**, et un dossier clos finit par disparaître.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DonneesDossier } from '../utils/dossiersClients';

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

async function chargerService(): Promise<typeof import('./dossierClientService')> {
  vi.resetModules();
  return import('./dossierClientService');
}

const MAINTENANT = Date.parse('2026-05-14T12:00:00.000Z');

function donnees(surcharge: Partial<DonneesDossier> = {}): DonneesDossier {
  return {
    nom: 'Marie Tremblay',
    courriel: 'marie@exemple.ca',
    telephone: '450 555-1234',
    notes: 'Rencontrée par référence de Me Gagnon. Sensible au taux.',
    profil: { typeDemande: 'achat', statutEmploi: 'salarie', promesseAchat: 'oui' },
    ...surcharge,
  };
}

/** Modifie le blob en place — sert à simuler le temps sans figer l'horloge du test. */
function retoucherBlob(id: string, retouche: (dossier: Record<string, unknown>) => void): void {
  const brut = blobs.get(id);
  if (!brut) throw new Error('dossier introuvable');
  const dossier = JSON.parse(brut) as Record<string, unknown>;
  retouche(dossier);
  blobs.set(id, JSON.stringify(dossier));
}

beforeEach(() => {
  blobs.clear();
  getStore.mockClear();
});

describe('création', () => {
  it('sème la checklist à partir du profil de la demande', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    expect('doublon' in dossier).toBe(false);
    if ('doublon' in dossier) return;

    const cles = dossier.documents.map((l) => l.cle);
    expect(cles).toContain('talons_paie');
    expect(cles).toContain('promesse_achat');
    expect(dossier.documents.every((l) => l.etat === 'a_fournir')).toBe(true);
    expect(dossier.etape).toBe('nouveau');
  });

  it('refuse un second dossier pour la même adresse', async () => {
    const service = await chargerService();
    await service.creerDossier(donnees());
    const second = await service.creerDossier(donnees({ nom: 'Marie T.' }));
    expect('doublon' in second).toBe(true);
  });

  it('retrouve un dossier par son courriel, quelle que soit la casse', async () => {
    const service = await chargerService();
    await service.creerDossier(donnees());
    expect(await service.trouverParCourriel('MARIE@Exemple.CA')).not.toBeNull();
    expect(await service.trouverParCourriel('inconnu@exemple.ca')).toBeNull();
  });
});

describe('versVueClient — la frontière', () => {
  it('ne porte ni notes internes, ni relance, ni historique, ni jeton', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.emettreLienMagique(dossier.id);
    await service.fixerRelance(dossier.id, '2026-05-20T12:00:00.000Z');
    const relu = await service.lireDossier(dossier.id);
    const vue = service.versVueClient(relu!);

    const serialise = JSON.stringify(vue);
    expect(serialise).not.toMatch(/Me Gagnon|Sensible au taux/);
    expect(serialise).not.toMatch(/jetonHash|acces/);
    expect(serialise).not.toMatch(/2026-05-20/);
    expect(vue).not.toHaveProperty('historique');
    expect(vue).not.toHaveProperty('notes');
  });

  it('ne rend rien pour un dossier non abouti', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.changerEtape(dossier.id, 'perdu');
    const relu = await service.lireDossier(dossier.id);
    expect(service.versVueClient(relu!)).toBeNull();
  });

  it('écarte les pièces jugées non requises plutôt que de les afficher barrées', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.marquerDocument(dossier.id, 'talons_paie', 'emprunteur', 'non_requis');
    const relu = await service.lireDossier(dossier.id);
    const vue = service.versVueClient(relu!);
    expect(vue!.documents.map((d) => d.cle)).not.toContain('talons_paie');
  });

  it('versFiche laisse tomber le jeton d’accès', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.emettreLienMagique(dossier.id);
    const relu = await service.lireDossier(dossier.id);
    expect(relu!.acces).not.toBeNull();
    expect(service.versFiche(relu!)).not.toHaveProperty('acces');
  });
});

describe('étapes et documents', () => {
  it('journalise chaque geste sans jamais réécrire l’historique', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.changerEtape(dossier.id, 'contact');
    await service.marquerDocument(dossier.id, 'talons_paie', 'emprunteur', 'recu');
    await service.ajouterNote(dossier.id, 'Rappelée : elle magasine encore.');
    await service.journaliserCourriel(dossier.id, 'Suivi envoyé');

    const relu = await service.lireDossier(dossier.id);
    const types = relu!.historique.map((e) => e.type);
    expect(types).toEqual(['creation', 'etape', 'document', 'note', 'courriel']);
    expect(relu!.historique[1]!.resume).toContain('Demande reçue');
    expect(relu!.historique[1]!.resume).toContain('Premier contact fait');
  });

  it('pose la date de clôture sur une étape terminale et l’efface au retour', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.changerEtape(dossier.id, 'perdu');
    expect((await service.lireDossier(dossier.id))!.clotLe).not.toBeNull();

    // Un « non abouti » posé par erreur se reprend : ici l'état n'exprime que son propre
    // jugement, contrairement au retrait d'un contact du réseau.
    await service.changerEtape(dossier.id, 'analyse');
    expect((await service.lireDossier(dossier.id))!.clotLe).toBeNull();
  });

  it('ajoute et retire des lignes sans jamais en dédoubler une', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.ajouterDocument(dossier.id, 'lettre_don', 'dossier');
    await service.ajouterDocument(dossier.id, 'lettre_don', 'dossier');
    let relu = await service.lireDossier(dossier.id);
    expect(relu!.documents.filter((l) => l.cle === 'lettre_don')).toHaveLength(1);

    await service.retirerDocument(dossier.id, 'lettre_don', 'dossier');
    relu = await service.lireDossier(dossier.id);
    expect(relu!.documents.some((l) => l.cle === 'lettre_don')).toBe(false);
  });

  it('compte les pièces encore attendues', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    const total = dossier.documents.length;
    await service.marquerDocument(dossier.id, 'talons_paie', 'emprunteur', 'recu');
    const relu = await service.lireDossier(dossier.id);
    expect(service.documentsManquants(relu!)).toBe(total - 1);
  });
});

describe('lien magique', () => {
  it('s’use au premier usage', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    const lien = await service.emettreLienMagique(dossier.id);
    expect(lien).not.toBeNull();

    expect(await service.consommerLienMagique(lien!.dossierId, lien!.jeton)).not.toBeNull();
    expect(await service.consommerLienMagique(lien!.dossierId, lien!.jeton)).toBeNull();
  });

  it('refuse un jeton périmé', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    const lien = await service.emettreLienMagique(dossier.id);
    retoucherBlob(dossier.id, (d) => {
      (d.acces as Record<string, unknown>).expireLe = '2020-01-01T00:00:00.000Z';
    });
    expect(await service.consommerLienMagique(lien!.dossierId, lien!.jeton)).toBeNull();
  });

  it('refuse un jeton qui n’est pas le bon, et un identifiant malformé', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.emettreLienMagique(dossier.id);
    expect(await service.consommerLienMagique(dossier.id, 'jeton-invente')).toBeNull();
    expect(await service.consommerLienMagique('../../etc/passwd', 'x')).toBeNull();
    expect(await service.consommerLienMagique(dossier.id, null)).toBeNull();
  });

  it('invalide le lien précédent quand elle en réémet un', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    const premier = await service.emettreLienMagique(dossier.id);
    const second = await service.emettreLienMagique(dossier.id);
    expect(await service.consommerLienMagique(dossier.id, premier!.jeton)).toBeNull();
    expect(await service.consommerLienMagique(dossier.id, second!.jeton)).not.toBeNull();
  });

  it('n’émet aucun lien vers un écran neutre', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    await service.changerEtape(dossier.id, 'perdu');
    expect(await service.emettreLienMagique(dossier.id)).toBeNull();
  });
});

describe('purge des dossiers clos', () => {
  it('supprime un dossier clos depuis plus de douze mois, garde les autres', async () => {
    const service = await chargerService();
    const vieux = await service.creerDossier(donnees());
    const recent = await service.creerDossier(donnees({ courriel: 'luc@exemple.ca', nom: 'Luc Roy' }));
    if ('doublon' in vieux || 'doublon' in recent) throw new Error('doublon inattendu');

    await service.changerEtape(vieux.id, 'finance');
    await service.changerEtape(recent.id, 'finance');
    retoucherBlob(vieux.id, (d) => void (d.clotLe = '2024-01-01T00:00:00.000Z'));

    await service.purgerClosAnciens(MAINTENANT);
    expect(await service.lireDossier(vieux.id)).toBeNull();
    expect(await service.lireDossier(recent.id)).not.toBeNull();
  });

  it('ne touche jamais un dossier en cours, si ancien soit-il', async () => {
    const service = await chargerService();
    const dossier = await service.creerDossier(donnees());
    if ('doublon' in dossier) throw new Error('doublon inattendu');

    retoucherBlob(dossier.id, (d) => void (d.creeLe = '2019-01-01T00:00:00.000Z'));
    await service.purgerClosAnciens(MAINTENANT);
    expect(await service.lireDossier(dossier.id)).not.toBeNull();
  });
});
