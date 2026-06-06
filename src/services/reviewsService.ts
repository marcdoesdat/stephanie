/**
 * Service de récupération des avis Google via Places API (New).
 *
 * ATTENTION — Le Place ID doit être vérifié tous les 12 mois.
 * Google peut le modifier lors d'une mise à jour de la fiche business.
 * Voir : https://developers.google.com/maps/documentation/places/web-service/place-id
 *
 * ⚠️  IMPORTANT — La clé API GOOGLE_PLACES_API_KEY NE DOIT PAS avoir de
 *     restriction HTTP referrer. Les appels se font côté serveur (SSR Netlify),
 *     donc la requête ne provient pas d'un navigateur et n'a pas d'en-tête
 *     Referer/Ongin correspondant au domaine. Préférez une restriction IP
 *     (plages Netlify) ou aucune restriction.
 *
 * Architecture inspirée de ratesService.ts :
 *   - Netlify Blobs (prod) / fichier local (dev)
 *   - TTL 24 h, stale max 7 jours
 *   - Fallback gracieux si l'API est down (src/data/fallbackReviews.json)
 *
 * Endpoint : Places API (New) v1 — NE PAS utiliser l'ancienne API (deprecated).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadSiteConfig } from '../config';

const DEBUG = process.env.DEBUG_RATES === '1' || process.env.NODE_ENV === 'development';
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[reviewsService]', ...args);
};

// ── Netlify Blobs (lazy import, comme ratesService.ts) ──
let _getStorePromise: Promise<typeof import('@netlify/blobs').getStore | undefined> | undefined;

async function loadGetStore(): Promise<typeof import('@netlify/blobs').getStore | undefined> {
  if (!_getStorePromise) {
    _getStorePromise = import('@netlify/blobs')
      .then((blobs) => blobs.getStore)
      .catch(() => undefined);
  }
  return _getStorePromise;
}

// ── Types ──

/** Un avis individuel formaté pour l'affichage */
export interface ReviewItem {
  author: string;       // ex: "Marie T." (anonymisation partielle)
  rating: number;       // 1–5
  text: string;         // tronqué à 200 caractères
  relativeTime: string; // ex: "il y a 2 mois"
}

/** Réponse structurée du service */
export interface GoogleReviews {
  rating: number;           // note moyenne, ex: 4.9
  totalReviews: number;     // nombre total d'avis
  reviews: ReviewItem[];    // avis filtrés (rating >= 4)
  source: 'fresh' | 'cache' | 'stale' | 'fallback';
  fetchedAt: string;        // ISO 8601
}

// ── Types bruts de la réponse Places API (New) ──

interface PlacesApiReview {
  authorAttribution?: { displayName?: string };
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  relativePublishTimeDescription?: string;
}

interface PlacesApiResponse {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlacesApiReview[];
}

// ── Cache ──

const BLOB_STORE = 'reviews';
const BLOB_KEY = 'google-reviews';

const CACHE_DIR = path.resolve('.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'google-reviews.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;       // 24 heures
const CACHE_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const useBlobs = Boolean(process.env.NETLIFY);

interface CachedReviews {
  timestamp: number;
  reviews: GoogleReviews;
}

interface CacheReadResult {
  reviews: GoogleReviews;
  ageMs: number;
}

// ── Blob helpers (production) ──

async function readBlobCache(): Promise<CacheReadResult | null> {
  const getStore = await loadGetStore();
  if (!getStore) return null;
  try {
    const store = getStore(BLOB_STORE);
    const raw = await store.get(BLOB_KEY, { type: 'text' });
    if (!raw) return null;

    const cached: CachedReviews = JSON.parse(raw);
    if (!cached || typeof cached.timestamp !== 'number' || !Number.isFinite(cached.timestamp)) {
      console.warn('[reviewsService] Cache blob ignoré : timestamp invalide');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (!Number.isFinite(age) || age < 0) {
      console.warn('[reviewsService] Cache blob ignoré : âge invalide');
      return null;
    }

    return { reviews: cached.reviews, ageMs: age };
  } catch (err) {
    console.warn('[reviewsService] Échec de lecture du cache blob :', err);
    return null;
  }
}

async function writeBlobCache(reviews: GoogleReviews): Promise<void> {
  const getStore = await loadGetStore();
  if (!getStore) return;
  try {
    const store = getStore(BLOB_STORE);
    const data: CachedReviews = { timestamp: Date.now(), reviews };
    await store.set(BLOB_KEY, JSON.stringify(data));
    debug('Avis cachés dans Netlify Blob');
  } catch (err) {
    console.warn('[reviewsService] Échec d\'écriture du cache blob :', err);
  }
}

// ── File helpers (dev) ──

async function readFileCache(): Promise<CacheReadResult | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const cached: CachedReviews = JSON.parse(raw);

    if (!cached || typeof cached.timestamp !== 'number' || !Number.isFinite(cached.timestamp)) {
      console.warn('[reviewsService] Cache fichier ignoré : timestamp invalide');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (!Number.isFinite(age) || age < 0) {
      console.warn('[reviewsService] Cache fichier ignoré : âge invalide');
      return null;
    }

    return { reviews: cached.reviews, ageMs: age };
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    console.warn('[reviewsService] Échec de lecture du cache fichier :', err);
    return null;
  }
}

async function writeFileCache(reviews: GoogleReviews): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const data: CachedReviews = { timestamp: Date.now(), reviews };
    const tempFile = path.join(CACHE_DIR, `.reviews-cache.tmp-${process.pid}-${Date.now()}`);
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempFile, CACHE_FILE);
    debug('Avis cachés dans le fichier local');
  } catch (err) {
    console.warn('[reviewsService] Échec d\'écriture du cache fichier :', err);
  }
}

// ── Cache unifié ──

async function readCacheAny(): Promise<CacheReadResult | null> {
  return useBlobs ? readBlobCache() : readFileCache();
}

async function readCache(): Promise<GoogleReviews | null> {
  const cached = await readCacheAny();
  if (!cached) return null;

  if (cached.ageMs > CACHE_TTL_MS) {
    debug('Cache expiré, rafraîchissement');
    return null;
  }

  debug(`Avis servis depuis le cache (âge : ${Math.round(cached.ageMs / 60_000)} min)`);
  return cached.reviews;
}

async function writeCache(reviews: GoogleReviews): Promise<void> {
  return useBlobs ? writeBlobCache(reviews) : writeFileCache(reviews);
}

// ── Formatage ──

/**
 * Anonymise partiellement un nom complet :
 * "Jean Tremblay" → "Jean T."
 * "Marie" → "Marie"
 */
function anonymizeAuthor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? fullName;
  const first = parts[0] ?? '';
  const lastInitial = (parts[parts.length - 1] ?? '')[0] ?? '';
  return `${first} ${lastInitial}.`;
}

/** Tronque le texte à maxLen caractères, ajoute « … » si coupé. */
function truncateText(text: string, maxLen = 200): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  // Coupe au dernier espace avant la limite
  const cut = cleaned.lastIndexOf(' ', maxLen);
  const end = cut > maxLen - 40 ? cut : maxLen;
  return cleaned.slice(0, end).replace(/[,;.]+$/, '') + '…';
}

/** Traduit les durées relatives de l'API Google en français */
function translateRelativeTime(desc: string | undefined): string {
  if (!desc) return 'récemment';

  const lower = desc.toLowerCase();

  const translations: Array<[RegExp, string]> = [
    [/second/i, 'quelques secondes'],
    [/minute/i, lower.includes('1') ? 'il y a une minute' : 'il y a quelques minutes'],
    [/hour/i, lower.includes('1') ? 'il y a une heure' : `il y a ${lower.match(/\d+/)?.[0] ?? 'quelques'} heures`],
    [/day/i, lower.includes('1') ? 'il y a un jour' : `il y a ${lower.match(/\d+/)?.[0] ?? 'quelques'} jours`],
    [/week/i, lower.includes('1') ? 'il y a une semaine' : `il y a ${lower.match(/\d+/)?.[0] ?? 'quelques'} semaines`],
    [/month/i, lower.includes('1') ? 'il y a un mois' : `il y a ${lower.match(/\d+/)?.[0] ?? 'quelques'} mois`],
    [/year/i, lower.includes('1') ? 'il y a un an' : `il y a ${lower.match(/\d+/)?.[0] ?? 'quelques'} ans`],
  ];

  for (const [pattern, replacement] of translations) {
    if (pattern.test(lower)) return replacement;
  }

  return `il y a ${desc}`;
}

// ── Fallback ──

async function loadFallback(): Promise<GoogleReviews> {
  try {
    const raw = await fs.readFile(
      path.resolve('src/data/fallbackReviews.json'),
      'utf-8'
    );
    const parsed = JSON.parse(raw) as GoogleReviews;
    debug('Fallback chargé depuis fallbackReviews.json');
    return { ...parsed, source: 'fallback', fetchedAt: new Date().toISOString() };
  } catch {
    // Fallback ultime si le fichier JSON est introuvable
    return {
      rating: 5.0,
      totalReviews: 3,
      reviews: [],
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
    };
  }
}

// ── Fetch Places API (New) ──

function buildPlacesUrl(placeId: string): string {
  return `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
}

async function fetchGoogleReviews(
  apiKey: string,
  placeId: string
): Promise<PlacesApiResponse> {
  const url = buildPlacesUrl(placeId);
  // Seuls les champs utilisés : rating, userRatingCount, reviews
  // displayName n'est PAS inclus — il déclenche le SKU « Pro » inutilement
  // reviews déclenche le SKU « Enterprise + Atmosphere »
  const fieldMask = 'rating,userRatingCount,reviews';

  const headers: Record<string, string> = {
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': fieldMask,
    'Accept': 'application/json',
  };

  debug('Appel Places API →', url.replace(placeId, 'PLACE_ID'));

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const detail = body.slice(0, 500);
    console.error(`[reviewsService] Places API HTTP ${res.status} : ${detail}`);
    throw new Error(`Places API HTTP ${res.status} : ${detail}`);
  }

  const data = await res.json() as PlacesApiResponse;
  debug(`Places API OK : rating=${data.rating}, userRatingCount=${data.userRatingCount}, reviews=${data.reviews?.length ?? 0}`);
  return data;
}

function formatApiResponse(
  data: PlacesApiResponse,
  source: 'fresh' | 'stale'
): GoogleReviews {
  const rawReviews = data.reviews ?? [];

  // Filtrer : ne garder que les avis >= 4 étoiles
  const filtered = rawReviews
    .filter((r) => typeof r.rating === 'number' && r.rating >= 4)
    .map(
      (r): ReviewItem => ({
        author: anonymizeAuthor(r.authorAttribution?.displayName ?? 'Client'),
        rating: r.rating ?? 5,
        text: truncateText(r.originalText?.text ?? r.text?.text ?? ''),
        relativeTime: translateRelativeTime(r.relativePublishTimeDescription),
      })
    );

  return {
    rating: typeof data.rating === 'number' ? data.rating : 5.0,
    totalReviews: typeof data.userRatingCount === 'number' ? data.userRatingCount : filtered.length,
    reviews: filtered,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Export principal ──

/**
 * Récupère les avis Google pour la courtière.
 *
 * Stratégie :
 * 1. Cache valide (< 24 h) → retour immédiat
 * 2. Cache expiré → fetch Places API, met à jour le cache
 * 3. Fetch échoué + cache périmé (< 7 jours) → retourne le cache stale
 * 4. Rien de disponible → fallback statique (fallbackReviews.json)
 * 5. Si google_place_id est vide → fallback direct
 *
 * @returns Les avis formatés — ne retourne jamais null.
 */
export async function getReviews(): Promise<GoogleReviews> {
  const config = loadSiteConfig();
  const placeId = config.google_place_id?.trim();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();

  // Sans Place ID ni clé API, on passe directement au fallback
  if (!placeId || !apiKey) {
    const missing: string[] = [];
    if (!placeId) missing.push('google_place_id (siteConfig.json)');
    if (!apiKey) missing.push('GOOGLE_PLACES_API_KEY (env)');
    console.warn(`[reviewsService] ${missing.join(' + ')} manquant(s) → fallback statique`);
    return loadFallback();
  }

  // 1. Cache valide ?
  const cached = await readCache();
  if (cached) return cached;

  const staleCache = await readCacheAny();

  // 2. Fetch live
  try {
    const data = await fetchGoogleReviews(apiKey, placeId);
    const result = formatApiResponse(data, 'fresh');
    await writeCache(result);
    console.log(`[reviewsService] Avis frais : ${result.totalReviews} avis, note ${result.rating}`);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[reviewsService] Échec fetch Places API : ${errMsg}`);

    // 3. Cache stale ?
    if (
      staleCache &&
      staleCache.ageMs <= CACHE_STALE_MAX_MS &&
      staleCache.reviews.source !== 'fallback'
    ) {
      const ageMin = Math.round(staleCache.ageMs / 60_000);
      console.log(`[reviewsService] Cache stale (âge : ${ageMin} min)`);
      return { ...staleCache.reviews, source: 'stale' };
    }

    // 4. Fallback
    console.warn('[reviewsService] Aucun cache → fallbackReviews.json');
    return loadFallback();
  }
}
