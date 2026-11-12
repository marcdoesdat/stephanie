import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Le cache des avis ne doit JAMAIS dépendre de `process.env.NETLIFY` : absente au runtime de
 * certaines fonctions, elle faisait écrire le cache dans un disque en lecture seule. Rien
 * n'était gardé, chaque page rappelait l'API Google, et le quota de 100 requêtes par jour
 * sautait — le site affichait alors les 3 avis du fichier de repli.
 *
 * Netlify Blobs est simulé en mémoire : aucun fichier ni appel réseau réel.
 */

const magasin = new Map<string, string>();
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: async (cle: string) => magasin.get(cle) ?? null,
    set: async (cle: string, valeur: string) => {
      magasin.set(cle, valeur);
    },
  }),
}));

const REPONSE_API = {
  rating: 5,
  userRatingCount: 12,
  reviews: [
    { authorAttribution: { displayName: 'Marie Tremblay' }, rating: 5, text: { text: 'Super service' }, relativePublishTimeDescription: '2 months ago' },
    { authorAttribution: { displayName: 'Jean Roy' }, rating: 5, text: { text: 'Très professionnelle' }, relativePublishTimeDescription: '3 months ago' },
  ],
};

function reponseOk(): Response {
  return new Response(JSON.stringify(REPONSE_API), { status: 200, headers: { 'content-type': 'application/json' } });
}

function reponseQuota(): Response {
  return new Response('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
}

async function chargerService() {
  vi.resetModules();
  return import('./reviewsService');
}

describe('getReviews — cache et quota', () => {
  beforeEach(() => {
    magasin.clear();
    delete process.env.NETLIFY; // le cas qui cassait la production
    process.env.GOOGLE_PLACES_API_KEY = 'cle-de-test';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it("garde les avis en cache même quand NETLIFY est absente : un seul appel à Google", async () => {
    const fetchMock = vi.fn(async () => reponseOk());
    vi.stubGlobal('fetch', fetchMock);
    const { getReviews } = await chargerService();

    const premier = await getReviews();
    const second = await getReviews();
    const troisieme = await getReviews();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(premier.source).toBe('fresh');
    expect(premier.reviews).toHaveLength(2);
    expect(second.reviews).toHaveLength(2);
    expect(troisieme.reviews).toHaveLength(2);
    expect(magasin.size).toBe(1);
  });

  it('ne fait qu’une requête pour des rendus simultanés', async () => {
    const fetchMock = vi.fn(async () => reponseOk());
    vi.stubGlobal('fetch', fetchMock);
    const { getReviews } = await chargerService();

    const lots = await Promise.all(Array.from({ length: 8 }, () => getReviews()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const l of lots) expect(l.reviews).toHaveLength(2);
  });

  it('après un quota dépassé (429), ne rappelle pas Google avant 30 minutes', async () => {
    const fetchMock = vi.fn(async () => reponseQuota());
    vi.stubGlobal('fetch', fetchMock);
    const { getReviews } = await chargerService();

    const a = await getReviews();
    const b = await getReviews();
    const c = await getReviews();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c]) expect(r.source).toBe('fallback');
  });

  it('retente après le délai, et retrouve les vrais avis une fois le quota rétabli', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fetchMock = vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(reponseQuota())
        .mockResolvedValue(reponseOk());
      vi.stubGlobal('fetch', fetchMock);
      const { getReviews } = await chargerService();

      expect((await getReviews()).source).toBe('fallback');
      vi.setSystemTime(Date.now() + 10 * 60_000);
      expect((await getReviews()).source).toBe('fallback'); // encore dans le délai
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 25 * 60_000); // 35 min après l'échec
      const apres = await getReviews();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(apres.source).toBe('fresh');
      expect(apres.reviews).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sert le dernier relevé connu (moins de 7 jours) quand Google refuse', async () => {
    // Un relevé de 3 jours dans le cache, expiré mais encore utilisable.
    const troisJours = Date.now() - 3 * 24 * 3_600_000;
    magasin.set(
      'google-reviews',
      JSON.stringify({
        timestamp: troisJours,
        reviews: {
          rating: 5,
          totalReviews: 12,
          reviews: [{ author: 'Paul B.', rating: 5, text: 'Excellent', relativeTime: 'il y a 1 mois' }],
          source: 'fresh',
          fetchedAt: new Date(troisJours).toISOString(),
        },
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => reponseQuota()));
    const { getReviews } = await chargerService();

    const r = await getReviews();

    expect(r.source).toBe('stale');
    expect(r.reviews.map((x) => x.author)).toEqual(['Paul B.']);
  });
});
