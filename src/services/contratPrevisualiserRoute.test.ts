/**
 * Tests de l'aperçu du contrat pour la courtière — `/api/contrat-previsualiser`.
 *
 * Ce que ces tests protègent : l'aperçu arrive par deux chemins. Le cadre de l'écran le
 * demande en JSON ; sur téléphone, un formulaire le poste vers un nouvel onglet, seul moyen
 * d'obtenir le lecteur PDF du téléphone avec toutes ses pages. Les deux doivent rendre le
 * même PDF, et un formulaire abîmé doit être refusé comme une requête JSON abîmée.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({ get: async () => null, set: async () => {}, delete: async () => {}, list: async () => ({ blobs: [] }) }),
}));
vi.mock('./accesCourtiere', () => ({ requeteAutorisee: async () => true }));

type Handler = (contexte: { request: Request }) => Promise<Response>;

const DONNEES = {
  emprunteurs: [{ prenom: 'Youssef', nom: 'Limaoui', courriel: 'youssef@exemple.ca' }],
  typesFinancement: [],
  montantPret: '300 000',
};

async function route(): Promise<Handler> {
  const module = await import('../pages/api/contrat-previsualiser');
  return module.POST as unknown as Handler;
}

function requete(corps: BodyInit, type: string): Request {
  return new Request('https://exemple.ca/api/contrat-previsualiser', {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: corps,
  });
}

describe('/api/contrat-previsualiser', () => {
  it('rend le PDF demandé en JSON par le cadre de l’écran', async () => {
    const reponse = await (await route())({
      request: requete(JSON.stringify({ donnees: DONNEES }), 'application/json'),
    });
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('rend le même PDF posté par formulaire vers un nouvel onglet', async () => {
    const formulaire = new URLSearchParams({ donnees: JSON.stringify(DONNEES) });
    const reponse = await (await route())({
      request: requete(formulaire.toString(), 'application/x-www-form-urlencoded'),
    });
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('Content-Type')).toBe('application/pdf');
    expect(reponse.headers.get('Content-Disposition')).toMatch(/^inline/);
  });

  it('refuse un formulaire dont le champ n’est pas du JSON', async () => {
    const formulaire = new URLSearchParams({ donnees: '{pas du json' });
    const reponse = await (await route())({
      request: requete(formulaire.toString(), 'application/x-www-form-urlencoded'),
    });
    expect(reponse.status).toBe(400);
  });

  it('refuse un formulaire sans emprunteur valide, comme le JSON', async () => {
    const formulaire = new URLSearchParams({ donnees: JSON.stringify({ ...DONNEES, emprunteurs: [] }) });
    const reponse = await (await route())({
      request: requete(formulaire.toString(), 'application/x-www-form-urlencoded'),
    });
    expect(reponse.status).toBe(400);
  });
});
