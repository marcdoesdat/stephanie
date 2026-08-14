/**
 * Tests du dossier de signature du contrat de courtage.
 *
 * Ce que ces tests protègent : un lien de signature est le seul verrou entre un inconnu et
 * la signature d'un contrat au nom de quelqu'un d'autre. Il doit être nominatif (le jeton de
 * l'un n'ouvre pas la place de l'autre), à usage unique, expirable, et cesser de valoir quoi
 * que ce soit dès qu'un emprunteur refuse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DonneesContrat, ReponsesEmprunteur } from '../utils/contratCourtage';
import type { SignatureEnregistree } from './dossierStockage';

/** Le contenu des Blobs, partagé entre « instances » — c'est tout l'intérêt du store. */
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

/** Le socle retient la disponibilité des Blobs par instance : on repart à neuf. */
async function chargerService(): Promise<typeof import('./contratDossierService')> {
  vi.resetModules();
  return import('./contratDossierService');
}

function emprunteur(prenom: string, courriel: string) {
  return { prenom, nom: 'Tremblay', telephone: '', adresse: '', courriel };
}

function donnees(...courriels: string[]): DonneesContrat {
  return {
    emprunteurs: courriels.map((c, i) => emprunteur(['Ana', 'Bo', 'Cam'][i]!, c)),
    retributionAutreEntite: '',
    partageRetribution: '',
    autreCabinet: '',
    nbPreteursCabinet: '',
    nbPreteursCourtier: '',
    preteurMajoritaire: '',
    autresLogiciels: '',
    collaborateur: '',
    adresseProjet: '',
    typesFinancement: [],
    autresPrecisions: '',
    montantPret: '',
    assuranceHypothecaire: '',
    totalPret: '',
    tauxInteret: '',
    typeTaux: null,
    amortissementAns: '',
    amortissementMois: '',
    termeAns: '',
    termeMois: '',
    versement: '',
    rang: '',
    autresExigences: '',
    fraisEtude: '',
    honorairesMontant: '',
    honorairesPourcentage: '',
    doubleRemuneration: null,
    raisonDoubleRemuneration: '',
    resiliationMontant: '',
    resiliationPourcentage: '',
    consentementsValidesJusquau: '',
    identite: {
      dossier_credit_numero: [],
      dossier_credit_date: [],
      document1: [],
      document1_numero: [],
      document1_delivre_par: [],
      document1_expiration: [],
      document2: [],
      document2_numero: [],
      document2_delivre_par: [],
      document2_expiration: [],
    },
    dateVerification: '',
  };
}

function reponses(ppv: 'oui' | 'non' = 'non', transfert: 'oui' | 'non' = 'oui'): ReponsesEmprunteur {
  return { ppv, transfertCabinet: transfert, telephone: '', adresse: '' };
}

function signature(voie: 'presence' | 'distance' = 'distance'): SignatureEnregistree {
  return {
    tracePngBase64: 'AAAA',
    signeLe: new Date().toISOString(),
    voie,
    ip: '1.2.3.4',
    agent: 'vitest',
    empreinteTrace: 'a'.repeat(64),
  };
}

beforeEach(() => {
  blobs.clear();
  getStore.mockReset();
  getStore.mockImplementation(() => fauxStore() as unknown);
});

describe('creerDossier', () => {
  it('émet une invitation par emprunteur', async () => {
    const service = await chargerService();
    const { dossier, invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));

    expect(invitations).toHaveLength(2);
    expect(invitations.map((i) => i.courriel)).toEqual(['ana@exemple.ca', 'bo@exemple.ca']);
    expect(dossier.statut).toBe('en_attente');
  });

  it('ne porte aucune signature à la création, pas même celle de la courtière', async () => {
    // Elle signe en dernier : signer d'abord reviendrait à couvrir de sa signature des
    // réponses d'emprunteurs qu'elle n'a pas encore vues.
    const service = await chargerService();
    const { dossier } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));
    expect(dossier.signatureCourtiere).toBeNull();
    expect(dossier.emprunteurs.every((e) => e.signature === null)).toBe(true);
    expect(dossier.emprunteurs.every((e) => e.reponses === null)).toBe(true);
  });

  it('ne stocke jamais le jeton en clair', async () => {
    const service = await chargerService();
    const { dossier, invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const brut = blobs.get(dossier.id)!;
    expect(brut).not.toContain(invitations[0]!.jeton);
    expect(dossier.emprunteurs[0]!.jetonHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('donne à chaque dossier un identifiant distinct et non devinable', async () => {
    const service = await chargerService();
    const a = await service.creerDossier(donnees('ana@exemple.ca'));
    const b = await service.creerDossier(donnees('bo@exemple.ca'));
    expect(a.dossier.id).not.toBe(b.dossier.id);
    expect(a.dossier.id.length).toBeGreaterThan(15);
  });
});

describe('ouvrirParJeton', () => {
  it('ouvre le dossier à la bonne place pour le bon jeton', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));

    const second = invitations[1]!;
    const ouvert = await service.ouvrirParJeton(second.dossierId, second.jeton);
    expect(ouvert?.index).toBe(1);
    expect(ouvert?.dossier.emprunteurs[1]!.emprunteur.courriel).toBe('bo@exemple.ca');
  });

  it('refuse un jeton inconnu, un dossier inconnu ou une charge mal formée', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const { dossierId, jeton } = invitations[0]!;

    expect(await service.ouvrirParJeton(dossierId, 'mauvais-jeton')).toBeNull();
    expect(await service.ouvrirParJeton('dossier-inexistant', jeton)).toBeNull();
    expect(await service.ouvrirParJeton(null, jeton)).toBeNull();
    expect(await service.ouvrirParJeton(dossierId, null)).toBeNull();
    // Un identifiant qui sort de l'alphabet attendu ne doit même pas atteindre le store.
    expect(await service.ouvrirParJeton('../../secret', jeton)).toBeNull();
  });

  it('refuse le jeton d’un emprunteur pour signer à la place d’un autre', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));
    // Le jeton d'Ana ouvre l'index 0 et rien d'autre : il n'y a pas de place à choisir.
    const ouvert = await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton);
    expect(ouvert?.index).toBe(0);
  });

  it('n’use pas le jeton à la simple lecture', async () => {
    // /api/contrat-apercu s'appuie là-dessus : l'emprunteur doit pouvoir relire le contrat
    // autant de fois qu'il le souhaite avant de se décider, sans tuer son propre lien.
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const { dossierId, jeton } = invitations[0]!;

    expect(await service.ouvrirParJeton(dossierId, jeton)).not.toBeNull();
    expect(await service.ouvrirParJeton(dossierId, jeton)).not.toBeNull();
    expect(await service.ouvrirParJeton(dossierId, jeton)).not.toBeNull();
  });

  it('refuse un dossier expiré et le supprime au passage', async () => {
    const service = await chargerService();
    const { dossier, invitations } = await service.creerDossier(donnees('ana@exemple.ca'));

    const perime = JSON.parse(blobs.get(dossier.id)!);
    perime.expireLe = new Date(Date.now() - 1000).toISOString();
    blobs.set(dossier.id, JSON.stringify(perime));

    expect(await service.ouvrirParJeton(dossier.id, invitations[0]!.jeton)).toBeNull();
    expect(blobs.has(dossier.id)).toBe(false);
  });
});

describe('enregistrerSignature', () => {
  it('consomme le jeton : le lien ne rouvre plus', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const { dossierId, jeton } = invitations[0]!;

    const ouvert = (await service.ouvrirParJeton(dossierId, jeton))!;
    await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());

    expect(await service.ouvrirParJeton(dossierId, jeton)).toBeNull();
  });

  it('ne déclare le dossier complet qu’à la dernière signature', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));

    const premier = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    const apresUn = await service.enregistrerSignature(premier.dossier, premier.index, signature(), reponses());
    expect(apresUn.complet).toBe(false);

    const second = (await service.ouvrirParJeton(invitations[1]!.dossierId, invitations[1]!.jeton))!;
    const apresDeux = await service.enregistrerSignature(second.dossier, second.index, signature(), reponses());
    expect(apresDeux.complet).toBe(true);
  });

  it('est complet dès la première signature quand il n’y a qu’un emprunteur', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    const { complet } = await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());
    expect(complet).toBe(true);
  });
});

describe('finalisation par la courtière', () => {
  async function toutSigner(service: typeof import('./contratDossierService'), ...courriels: string[]) {
    const { invitations } = await service.creerDossier(donnees(...courriels));
    for (const invitation of invitations) {
      const ouvert = (await service.ouvrirParJeton(invitation.dossierId, invitation.jeton))!;
      await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());
    }
    return invitations[0]!.dossierId;
  }

  it('bascule en « à finaliser » quand le dernier emprunteur a signé', async () => {
    const service = await chargerService();
    const id = await toutSigner(service, 'ana@exemple.ca', 'bo@exemple.ca');
    const dossier = await service.ouvrirPourFinalisation(id);
    expect(dossier?.statut).toBe('a_finaliser');
  });

  it('conserve les réponses de chaque emprunteur', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses('oui', 'non'));

    const dossier = await service.ouvrirPourFinalisation(invitations[0]!.dossierId);
    expect(dossier?.emprunteurs[0]!.reponses).toEqual({
      ppv: 'oui',
      transfertCabinet: 'non',
      telephone: '',
      adresse: '',
    });
  });

  it('repart pour un délai complet quand la balle passe à la courtière', async () => {
    // Sinon les signatures déjà recueillies seraient perdues parce que le délai initial,
    // consommé par l'attente des emprunteurs, expire pendant qu'elle relit.
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const avant = JSON.parse(blobs.get(invitations[0]!.dossierId)!).expireLe as string;

    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());

    const apres = JSON.parse(blobs.get(invitations[0]!.dossierId)!).expireLe as string;
    expect(Date.parse(apres)).toBeGreaterThanOrEqual(Date.parse(avant));
  });

  it('n’ouvre pas un dossier encore en attente de signatures', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));
    // Un seul des deux a signé : rien à finaliser.
    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());
    expect(await service.ouvrirPourFinalisation(invitations[0]!.dossierId)).toBeNull();
  });

  it('refuse un identifiant mal formé sans même lire le stockage', async () => {
    const service = await chargerService();
    expect(await service.ouvrirPourFinalisation('../../secret')).toBeNull();
    expect(await service.ouvrirPourFinalisation(null)).toBeNull();
    expect(await service.ouvrirPourFinalisation(undefined)).toBeNull();
  });

  it('appose la signature de la courtière', async () => {
    const service = await chargerService();
    const id = await toutSigner(service, 'ana@exemple.ca');
    const dossier = (await service.ouvrirPourFinalisation(id))!;
    await service.signerParLaCourtiere(dossier, signature('presence'));

    const relu = JSON.parse(blobs.get(id)!);
    expect(relu.signatureCourtiere).not.toBeNull();
    expect(relu.signatureCourtiere.voie).toBe('presence');
  });

  it('ne se laisse pas finaliser si un emprunteur a refusé', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));
    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    await service.marquerRefus(ouvert.dossier, ouvert.index, 'Le montant ne correspond pas.');
    expect(await service.ouvrirPourFinalisation(invitations[0]!.dossierId)).toBeNull();
  });
});

describe('marquerRefus', () => {
  it('gèle le dossier et invalide les liens restants', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));

    const premier = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    const gele = await service.marquerRefus(premier.dossier, premier.index, 'Le montant ne correspond pas.');

    expect(gele.statut).toBe('gele');
    expect(gele.refus?.motif).toBe('Le montant ne correspond pas.');
    // Le second emprunteur ne doit plus pouvoir signer un contrat contesté.
    expect(await service.ouvrirParJeton(invitations[1]!.dossierId, invitations[1]!.jeton)).toBeNull();
  });

  it('plafonne le motif conservé', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(donnees('ana@exemple.ca'));
    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    const gele = await service.marquerRefus(ouvert.dossier, ouvert.index, 'x'.repeat(2000));
    expect(gele.refus!.motif.length).toBe(500);
  });
});

describe('emprunteursEnAttente et supprimerDossier', () => {
  it('liste ceux qui n’ont pas signé', async () => {
    const service = await chargerService();
    const { dossier, invitations } = await service.creerDossier(donnees('ana@exemple.ca', 'bo@exemple.ca'));
    expect(service.emprunteursEnAttente(dossier)).toHaveLength(2);

    const ouvert = (await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton))!;
    await service.enregistrerSignature(ouvert.dossier, ouvert.index, signature(), reponses());

    const restants = service.emprunteursEnAttente(ouvert.dossier);
    expect(restants).toHaveLength(1);
    expect(restants[0]!.emprunteur.courriel).toBe('bo@exemple.ca');
  });

  it('supprime le dossier — les tracés ne restent pas au repos', async () => {
    const service = await chargerService();
    const { dossier } = await service.creerDossier(donnees('ana@exemple.ca'));
    expect(blobs.has(dossier.id)).toBe(true);
    await service.supprimerDossier(dossier.id);
    expect(blobs.has(dossier.id)).toBe(false);
  });
});
