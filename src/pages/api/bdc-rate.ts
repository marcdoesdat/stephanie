// Server-side proxy to the Bank of Canada Valet API.
// Avoids client-side CORS failures and caches the result for 6 h via Netlify Blobs (prod)
// with an in-memory fallback for dev. Series V39079 = Bank of Canada policy rate.

import type { APIRoute } from 'astro';

export const prerender = false;

const SERIES = 'V39079';
const SOURCE_URL = `https://www.bankofcanada.ca/valet/observations/${SERIES}/json?recent=1`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 d (last-resort fallback)
const BLOB_STORE = 'rates';
const BLOB_KEY = 'bdc-rate';

interface BdcPayload {
  directeur: number;        // taux directeur BdC, %
  preferentiel: number;     // taux préférentiel estimé, %
  date: string;             // YYYY-MM-DD (date d'observation)
  fetchedAt: string;        // ISO timestamp (instant du fetch)
}

interface CachedBdc {
  timestamp: number;
  payload: BdcPayload;
}

let memoryCache: CachedBdc | null = null;

let _getStorePromise: Promise<typeof import('@netlify/blobs').getStore | undefined> | undefined;
async function loadGetStore(): Promise<typeof import('@netlify/blobs').getStore | undefined> {
  if (!_getStorePromise) {
    _getStorePromise = import('@netlify/blobs')
      .then((blobs) => blobs.getStore)
      .catch(() => undefined);
  }
  return _getStorePromise;
}

const useBlobs = Boolean(process.env.NETLIFY);

async function readCache(): Promise<CachedBdc | null> {
  if (!useBlobs) return memoryCache;
  const getStore = await loadGetStore();
  if (!getStore) return memoryCache;
  try {
    const store = getStore(BLOB_STORE);
    const raw = await store.get(BLOB_KEY, { type: 'text' });
    if (!raw) return null;
    const parsed: CachedBdc = JSON.parse(raw);
    if (typeof parsed?.timestamp !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(payload: BdcPayload): Promise<void> {
  const data: CachedBdc = { timestamp: Date.now(), payload };
  if (!useBlobs) {
    memoryCache = data;
    return;
  }
  const getStore = await loadGetStore();
  if (!getStore) {
    memoryCache = data;
    return;
  }
  try {
    const store = getStore(BLOB_STORE);
    await store.set(BLOB_KEY, JSON.stringify(data));
  } catch {
    memoryCache = data;
  }
}

async function fetchFromBdc(): Promise<BdcPayload> {
  const res = await fetch(SOURCE_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`BdC HTTP ${res.status}`);
  const data = await res.json();
  const ob = data?.observations?.[0];
  if (!ob || !ob[SERIES]?.v || !ob.d) throw new Error('Unexpected BdC payload');

  const directeur = parseFloat(ob[SERIES].v);
  if (!Number.isFinite(directeur) || directeur < 0 || directeur > 25) {
    throw new Error('BdC value out of range');
  }
  // Le taux préférentiel des banques est généralement le taux directeur + 2,20 %.
  const preferentiel = +(directeur + 2.20).toFixed(2);

  return {
    directeur,
    preferentiel,
    date: String(ob.d),
    fetchedAt: new Date().toISOString(),
  };
}

export const GET: APIRoute = async () => {
  const cached = await readCache();
  const now = Date.now();

  // Cache encore frais → on retourne directement.
  if (cached && now - cached.timestamp <= CACHE_TTL_MS) {
    return new Response(JSON.stringify({ ...cached.payload, source: 'cache' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=21600, stale-while-revalidate=3600',
      },
    });
  }

  try {
    const fresh = await fetchFromBdc();
    await writeCache(fresh);
    return new Response(JSON.stringify({ ...fresh, source: 'live' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=21600, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    // Fallback : cache stale tant qu'il n'est pas trop vieux.
    if (cached && now - cached.timestamp <= STALE_MAX_MS) {
      return new Response(JSON.stringify({ ...cached.payload, source: 'stale' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response(
      JSON.stringify({ error: 'Unavailable', detail: err instanceof Error ? err.message : 'unknown' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }
};
