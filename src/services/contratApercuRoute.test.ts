/**
 * Tests de l'aperçu du contrat pour le signataire — `/api/contrat-apercu`.
 *
 * Ce que ces tests protègent : l'emprunteur qui corrige ses coordonnées doit voir sa
 * correction **sur le contrat** avant de signer, et seulement sur sa propre ligne. L'aperçu
 * n'enregistre rien et ne consomme pas le jeton : c'est la signature qui inscrit la
 * correction au dossier.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 */
import { describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void blobs.set(cle, valeur),
    delete: async (cle: string) => void blobs.delete(cle),
    list: async () => ({ blobs: [...blobs.keys()].map((key) => ({ key })) }),
  }),
}));
vi.mock('./emailService', () => ({ checkRateLimit: async () => true, clientIpFromRequest: () => '1.2.3.4' }));

const genererContratPdf = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
vi.mock('./contratPdfService', () => ({ genererContratPdf: (...args: unknown[]) => genererContratPdf(...(args as [])) }));

type Handler = (contexte: { request: Request; url: URL }) => Promise<Response>;

async function preparer() {
  const service = await import('./contratDossierService');
  const { parserDonneesContrat } = await import('../utils/contratCourtage');
  const donnees = parserDonneesContrat({
    emprunteurs: [
      { prenom: 'Ana', nom: 'Trembley', courriel: 'ana@exemple.ca', telephone: '514-555-0000', adresse: '1 rue A' },
      { prenom: 'Bo', nom: 'Gagnon', courriel: 'bo@exemple.ca' },
    ],
    typesFinancement: [],
  })!;
  const { invitation } = await service.creerDossier(donnees);
  const module = await import('../pages/api/contrat-apercu');
  return { invitation, service, GET: module.GET as unknown as Handler, POST: module.POST as unknown as Handler };
}

function emprunteursPasses(): Array<{ prenom: string; nom: string; telephone: string; adresse: string; courriel: string }> {
  const appel = genererContratPdf.mock.calls.at(-1) as unknown as [{ emprunteurs: never }];
  return appel[0].emprunteurs;
}

const URL_API = new URL('https://exemple.ca/api/contrat-apercu');

describe('/api/contrat-apercu', () => {
  it('pose sur sa ligne les coordonnées que le signataire corrige, sans rien enregistrer', async () => {
    const { invitation, service, POST } = await preparer();
    const reponse = await POST({
      url: URL_API,
      request: new Request(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          d: invitation.dossierId,
          j: invitation.jeton,
          coordonnees: { prenom: 'Anaïs', nom: 'Tremblay', courriel: 'anais@exemple.ca', telephone: '438-555-0101', adresse: '' },
        }),
      }),
    });

    expect(reponse.status).toBe(200);
    const [ana, bo] = emprunteursPasses();
    expect(ana).toMatchObject({ prenom: 'Anaïs', nom: 'Tremblay', courriel: 'anais@exemple.ca', telephone: '438-555-0101', adresse: '1 rue A' });
    expect(bo).toMatchObject({ prenom: 'Bo', courriel: 'bo@exemple.ca' });

    // Rien d'enregistré, jeton intact.
    const ouvert = await service.ouvrirParJeton(invitation.dossierId, invitation.jeton);
    expect(ouvert?.dossier.donnees.emprunteurs[0]!.prenom).toBe('Ana');
  });

  it('accepte la même correction postée par formulaire vers un nouvel onglet', async () => {
    const { invitation, POST } = await preparer();
    const formulaire = new URLSearchParams({
      d: invitation.dossierId,
      j: invitation.jeton,
      coordonnees: JSON.stringify({ prenom: 'Anaïs', nom: 'Tremblay', courriel: 'anais@exemple.ca' }),
    });
    const reponse = await POST({
      url: URL_API,
      request: new Request(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formulaire.toString(),
      }),
    });
    expect(reponse.status).toBe(200);
    expect(emprunteursPasses()[0]!.prenom).toBe('Anaïs');
  });

  it('refuse une correction invalide plutôt que de montrer l’ancienne version', async () => {
    const { invitation, POST } = await preparer();
    const reponse = await POST({
      url: URL_API,
      request: new Request(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d: invitation.dossierId, j: invitation.jeton, coordonnees: { prenom: 'A', nom: '', courriel: 'x' } }),
      }),
    });
    expect(reponse.status).toBe(400);
  });

  it('refuse un jeton qui ne vaut rien', async () => {
    const { invitation, POST } = await preparer();
    const reponse = await POST({
      url: URL_API,
      request: new Request(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d: invitation.dossierId, j: 'x'.repeat(43), coordonnees: {} }),
      }),
    });
    expect(reponse.status).toBe(410);
  });

  it('sert toujours le document enregistré en GET', async () => {
    const { invitation, GET } = await preparer();
    const url = new URL(`${URL_API}?d=${invitation.dossierId}&j=${invitation.jeton}`);
    const reponse = await GET({ url, request: new Request(url) });
    expect(reponse.status).toBe(200);
    expect(emprunteursPasses()[0]!.prenom).toBe('Ana');
  });
});
