/**
 * Tests de la correction d'un contrat en cours — `/api/contrat-corriger`.
 *
 * Ce que ces tests protègent : une correction épargne la ressaisie, jamais la relecture. Le
 * premier signataire reçoit un lien neuf qui dit ce qui a changé, ceux déjà atteints
 * apprennent que leur signature ou leur lien ne vaut plus, et l'invitation part avant tout le
 * reste — c'est le seul jeton vivant.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DonneesContrat, ReponsesEmprunteur } from '../utils/contratCourtage';
import { parserDonneesContrat } from '../utils/contratCourtage';

const blobs = new Map<string, string>();

function fauxStore() {
  return {
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void blobs.set(cle, valeur),
    delete: async (cle: string) => void blobs.delete(cle),
    list: async () => ({ blobs: [...blobs.keys()].map((cle) => ({ key: cle })) }),
  };
}

vi.mock('@netlify/blobs', () => ({ getStore: () => fauxStore() }));

const envoyer =
  vi.fn<(cle: string, courriel: import('./emailService').ResendEmail) => Promise<void>>();
vi.mock('./emailService', async (original) => ({
  ...(await original<typeof import('./emailService')>()),
  sendEmail: envoyer,
}));

vi.mock('./accesCourtiere', () => ({ requeteAutorisee: async () => true }));

type Handler = (contexte: { request: Request; url: URL }) => Promise<Response>;

function donnees(montant = '300 000'): DonneesContrat {
  return parserDonneesContrat({
    emprunteurs: [
      { prenom: 'Youssef', nom: 'Limaoui', courriel: 'youssef@exemple.ca' },
      { prenom: 'Asnaa', nom: 'Dalil', courriel: 'asmaa@exemple.ca' },
    ],
    typesFinancement: [],
    montantPret: montant,
  })!;
}

const REPONSES: ReponsesEmprunteur = { ppv: 'non', transfertCabinet: 'oui', telephone: '', adresse: '' };

/** Crée un dossier et fait signer le premier emprunteur — l'état de la capture d'écran. */
async function dossierAvecUneSignature(mode: 'distance' | 'presence' = 'distance'): Promise<string> {
  vi.resetModules();
  const service = await import('./contratDossierService');
  const { invitation } = await service.creerDossier(donnees(), mode);
  const ouvert = (await service.ouvrirParJeton(invitation.dossierId, invitation.jeton))!;
  await service.enregistrerSignature(
    ouvert.dossier,
    ouvert.index,
    {
      tracePngBase64: 'AAAA',
      signeLe: new Date().toISOString(),
      voie: mode,
      ip: '1.2.3.4',
      agent: 'vitest',
      empreinteTrace: 'a'.repeat(64),
    },
    REPONSES,
  );
  return invitation.dossierId;
}

async function poster(d: string, corps: DonneesContrat) {
  vi.resetModules();
  const route = await import('../pages/api/contrat-corriger');
  const url = new URL('https://stephanieweyman.ca/api/contrat-corriger');
  const reponse = await (route.POST as unknown as Handler)({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ d, donnees: corps }),
    }),
    url,
  });
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

beforeEach(() => {
  blobs.clear();
  envoyer.mockClear();
  process.env.RESEND_API_KEY = 'cle';
  process.env.RESEND_FROM_EMAIL = 'site@stephanieweyman.ca';
  process.env.RESEND_NOTIFY_EMAIL = 'boite@stephanieweyman.ca';
});

describe('/api/contrat-corriger', () => {
  it('relance le premier signataire avec ce qui a changé, puis prévient les autres, puis la courtière', async () => {
    const id = await dossierAvecUneSignature();
    const corrige = { ...donnees(), emprunteurs: [donnees().emprunteurs[0]!, { ...donnees().emprunteurs[1]!, prenom: 'Asmaa' }] };

    const { statut, corps } = await poster(id, corrige);
    expect(statut).toBe(200);
    expect(corps.signaturesEcartees).toEqual(['Youssef Limaoui']);

    const courriels = envoyer.mock.calls.map(([, courriel]) => courriel);
    expect(courriels.map((c) => c.to)).toEqual(['youssef@exemple.ca', 'asmaa@exemple.ca', 'boite@stephanieweyman.ca']);

    // Youssef : un lien neuf, et la raison pour laquelle on lui redemande de signer.
    expect(courriels[0]!.subject).toMatch(/corrigé/);
    expect(courriels[0]!.html).toContain('/signer-contrat?d=');
    expect(courriels[0]!.html).toContain('Asmaa Dalil');
    expect(courriels[0]!.html).toContain('signature précédente');

    // Asmaa : son lien ne vaut plus — et aucun nouveau lien, ce n'est pas encore son tour.
    expect(courriels[1]!.html).not.toContain('/signer-contrat?d=');
    expect(courriels[1]!.html).toContain('ne fonctionne plus');

    // L'avis interne ne porte aucun jeton.
    expect(courriels[2]!.html).not.toContain('/signer-contrat?d=');
    expect(courriels[2]!.html).toContain('Youssef Limaoui');
  });

  it('refuse une correction qui ne change rien, sans rien envoyer ni effacer', async () => {
    const id = await dossierAvecUneSignature();
    const { statut, corps } = await poster(id, donnees());
    expect(statut).toBe(400);
    expect(corps.code).toBe('inchange');
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('en présentiel, rend le nouveau lien à l’écran et n’écrit à aucun emprunteur', async () => {
    const id = await dossierAvecUneSignature('presence');
    const { statut, corps } = await poster(id, donnees('310 000'));
    expect(statut).toBe(200);
    expect(String(corps.lien)).toContain('/signer-contrat?d=');
    expect(envoyer.mock.calls.map(([, c]) => c.to)).toEqual(['boite@stephanieweyman.ca']);
  });

  it('ne corrige pas un dossier inconnu', async () => {
    const { statut } = await poster('inconnu', donnees('1'));
    expect(statut).toBe(410);
    expect(envoyer).not.toHaveBeenCalled();
  });
});
