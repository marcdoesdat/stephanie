/**
 * Tests du stockage des dossiers de co-signature.
 *
 * Régression couverte : le service ne conditionnait l'usage de Netlify Blobs qu'à
 * `process.env.NETLIFY`, variable qui n'est pas garantie au runtime des fonctions. En
 * production, le dossier partait donc dans une Map en mémoire propre à l'instance, et le
 * co-emprunteur qui ouvrait son lien tombait sur « Ce lien n'est plus valide ».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReponsesProfil } from '../utils/profilEmprunteurs';
import type { SignatureEnregistree } from './profilDossierService';

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

/** Le service retient la disponibilité des Blobs par instance : on repart à neuf. */
async function chargerService(): Promise<typeof import('./profilDossierService')> {
  vi.resetModules();
  return import('./profilDossierService');
}

const REPONSES: ReponsesProfil = {
  choix: {
    experience: 'moyen',
    connaissances: 'reduites',
    absorption: '250',
    remboursement: 'faibles',
    apports: 'moyennes',
    besoins: 'tres_faibles',
    virtuel: 'bon',
    priorite: 'vite',
  },
  autreMontant: null,
};

const MARC = { nom: 'Marc-André Lacroix', courriel: 'marc@exemple.ca' };
const JULIE = { nom: 'Julie Bergeron', courriel: 'julie@exemple.ca' };
const SAM = { nom: 'Sam Tremblay', courriel: 'sam@exemple.ca' };

function signature(): SignatureEnregistree {
  return {
    tracePngBase64: 'AAAA',
    signeLe: new Date().toISOString(),
    voie: 'presence',
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

describe('profilDossierService', () => {
  it('persiste le dossier dans les Blobs sans dépendre de process.env.NETLIFY', async () => {
    const netlify = process.env.NETLIFY;
    delete process.env.NETLIFY;
    try {
      const service = await chargerService();
      const { invitations } = await service.creerDossier(
        REPONSES,
        [MARC, JULIE],
        new Map([[0, signature()]]),
      );

      expect(invitations).toHaveLength(1);
      expect(blobs.size).toBe(1);

      // Une autre instance de fonction, sans mémoire partagée : le lien doit tenir.
      const autreInstance = await chargerService();
      const ouvert = await autreInstance.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton);

      expect(ouvert?.index).toBe(1);
      expect(ouvert?.dossier.signataires[1]?.nom).toBe('Julie Bergeron');
    } finally {
      if (netlify !== undefined) process.env.NETLIFY = netlify;
    }
  });

  it('demande une consistance forte au store', async () => {
    const service = await chargerService();
    await service.creerDossier(REPONSES, [MARC, JULIE], new Map([[0, signature()]]));

    expect(getStore).toHaveBeenCalledWith({ name: 'profils-emprunteurs', consistency: 'strong' });
  });

  it('garde valides les liens restants après la signature d’un co-emprunteur', async () => {
    const service = await chargerService();
    const { invitations } = await service.creerDossier(
      REPONSES,
      [MARC, JULIE, SAM],
      new Map([[0, signature()]]),
    );
    const [pourJulie, pourSam] = invitations;

    const julie = await service.ouvrirParJeton(pourJulie!.dossierId, pourJulie!.jeton);
    const { complet } = await service.enregistrerSignature(julie!.dossier, julie!.index, signature());
    expect(complet).toBe(false);

    // Le jeton de Julie est consommé…
    expect(await service.ouvrirParJeton(pourJulie!.dossierId, pourJulie!.jeton)).toBeNull();
    // …mais celui de Sam ouvre toujours le dossier, signature de Julie comprise.
    const sam = await service.ouvrirParJeton(pourSam!.dossierId, pourSam!.jeton);
    expect(sam?.index).toBe(2);
    expect(sam?.dossier.signataires[1]?.signature).not.toBeNull();

    const fin = await service.enregistrerSignature(sam!.dossier, sam!.index, signature());
    expect(fin.complet).toBe(true);
  });

  it('échoue franchement en production quand les Blobs sont indisponibles', async () => {
    // Sans store, un dossier écrit en mémoire produirait des invitations vers des liens morts.
    getStore.mockImplementation(() => {
      throw new Error('MissingBlobsEnvironmentError');
    });
    vi.stubEnv('DEV', false);
    try {
      const service = await chargerService();
      await expect(
        service.creerDossier(REPONSES, [MARC, JULIE], new Map([[0, signature()]])),
      ).rejects.toThrow(/Stockage des dossiers indisponible/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('retombe sur la mémoire en développement, pour dérouler le parcours en local', async () => {
    getStore.mockImplementation(() => {
      throw new Error('MissingBlobsEnvironmentError');
    });
    vi.stubEnv('DEV', true);
    try {
      const service = await chargerService();
      const { invitations } = await service.creerDossier(
        REPONSES,
        [MARC, JULIE],
        new Map([[0, signature()]]),
      );
      const ouvert = await service.ouvrirParJeton(invitations[0]!.dossierId, invitations[0]!.jeton);
      expect(ouvert?.index).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
