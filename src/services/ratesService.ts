import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { decodeHypotheca } from '../utils/hypothecaDecoder';

const DEBUG_RATES = process.env.DEBUG_RATES === '1' || process.env.NODE_ENV === 'development';
const debug = (...args: unknown[]): void => {
  if (DEBUG_RATES) console.log('[ratesService]', ...args);
};

// Netlify Blobs — imported lazily only when the Blob cache path is used
let _getStorePromise: Promise<typeof import('@netlify/blobs').getStore | undefined> | undefined;

async function loadGetStore(): Promise<typeof import('@netlify/blobs').getStore | undefined> {
  if (!_getStorePromise) {
    _getStorePromise = import('@netlify/blobs')
      .then((blobs) => blobs.getStore)
      .catch(() => {
        // @netlify/blobs unavailable (local dev without Netlify CLI)
        return undefined;
      });
  }
  return _getStorePromise;
}

export interface RateEntry {
  terme: string;
  hypotheca: number | null;
  affiche: number | null;
  type: 'fixe' | 'variable';
  populaire?: boolean;
}

export interface HypothecaRates {
  fixe_5ans: number | null;
  fixe_4ans: number | null;
  fixe_3ans: number | null;
  fixe_2ans: number | null;
  fixe_1ans: number | null;
  fixe_6ans: number | null;
  fixe_7ans: number | null;
  fixe_10ans: number | null;
  variable: number | null;

  affiche_fixe_5ans: number | null;
  affiche_fixe_4ans: number | null;
  affiche_fixe_3ans: number | null;
  affiche_fixe_2ans: number | null;
  affiche_fixe_1ans: number | null;
  affiche_fixe_6ans: number | null;
  affiche_fixe_7ans: number | null;
  affiche_fixe_10ans: number | null;
  affiche_variable: number | null;

  /** Structured rows for the table display */
  rows: RateEntry[];

  source: 'live' | 'fallback';
  fetchedAt: string;
}

/* ------------------------------------------------------------------ */
/*  24-hour cache — Netlify Blobs (prod) / file-based (dev)           */
/* ------------------------------------------------------------------ */

const BLOB_STORE = 'rates';
const BLOB_KEY = 'hypotheca-rates';

const CACHE_FILENAME = 'hypotheca-rates.json';
// `.cache` en dev ; en fonction serverless le disque est en lecture seule
// sauf /tmp, d'où le second candidat (survit aux invocations à chaud).
const CACHE_DIRS = [path.resolve('.cache'), path.join(os.tmpdir(), 'hypotheca-rates')];

// 24 h : les taux bougent peu d'un jour à l'autre et hypotheca.ca rate-limite
// agressivement (429) — un TTL court multiplie les fetchs inutiles.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_STALE_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Cooldown après un échec de fetch : on sert le cache périmé (stale) sans
// retenter l'upstream pendant ce délai, pour ne pas marteler hypotheca.ca
// à chaque rendu SSR quand on est rate-limité.
const FETCH_FAILURE_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
let _nextFetchAllowedAt = 0;

interface CachedRates {
  timestamp: number;
  rates: HypothecaRates;
}

interface CacheReadResult {
  rates: HypothecaRates;
  ageMs: number;
}

/** Valide un enregistrement de cache et en calcule l'âge. */
function toCacheResult(raw: string, origine: string): CacheReadResult | null {
  const cached: CachedRates = JSON.parse(raw);

  if (!cached || typeof cached.timestamp !== 'number' || !Number.isFinite(cached.timestamp)) {
    console.warn(`[ratesService] Ignoring ${origine} cache: invalid timestamp`);
    return null;
  }
  if (!cached.rates || !Array.isArray(cached.rates.rows)) {
    console.warn(`[ratesService] Ignoring ${origine} cache: malformed payload`);
    return null;
  }

  const age = Date.now() - cached.timestamp;
  if (!Number.isFinite(age) || age < 0) {
    console.warn(`[ratesService] Ignoring ${origine} cache: invalid age`);
    return null;
  }

  return { rates: cached.rates, ageMs: age };
}

/* ---------- Blob helpers (production) ---------- */

// Netlify Blobs n'est disponible qu'avec un contexte Netlify. Plutôt que de le
// déduire d'une variable d'environnement (`NETLIFY` n'est pas garantie au
// runtime des fonctions), on essaie et on retient le résultat pour l'instance.
let _blobsUnavailable = false;

async function getBlobStore(): Promise<import('@netlify/blobs').Store | null> {
  if (_blobsUnavailable) return null;
  const getStore = await loadGetStore();
  if (!getStore) {
    _blobsUnavailable = true;
    return null;
  }
  try {
    return getStore(BLOB_STORE);
  } catch (err) {
    // Pas de contexte Blobs (astro dev/preview, build local) — cache fichier.
    debug('Netlify Blobs unavailable, falling back to file cache:', err);
    _blobsUnavailable = true;
    return null;
  }
}

async function readBlobCache(): Promise<CacheReadResult | null> {
  const store = await getBlobStore();
  if (!store) return null;
  try {
    const raw = await store.get(BLOB_KEY, { type: 'text' });
    if (!raw) return null;
    return toCacheResult(raw, 'blob');
  } catch (err) {
    console.warn('[ratesService] Failed to read blob cache:', err);
    return null;
  }
}

/** `true` si l'écriture a réussi — sinon l'appelant retombe sur le fichier. */
async function writeBlobCache(rates: HypothecaRates): Promise<boolean> {
  const store = await getBlobStore();
  if (!store) return false;
  try {
    const data: CachedRates = { timestamp: Date.now(), rates };
    await store.set(BLOB_KEY, JSON.stringify(data));
    debug('Rates cached to Netlify Blob');
    return true;
  } catch (err) {
    console.warn('[ratesService] Failed to write blob cache:', err);
    return false;
  }
}

/* ---------- File helpers (dev + repli serverless) ---------- */

async function readFileCache(): Promise<CacheReadResult | null> {
  let freshest: CacheReadResult | null = null;

  for (const dir of CACHE_DIRS) {
    try {
      const raw = await fs.readFile(path.join(dir, CACHE_FILENAME), 'utf-8');
      const result = toCacheResult(raw, 'file');
      if (result && (!freshest || result.ageMs < freshest.ageMs)) freshest = result;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') continue;
      console.warn('[ratesService] Failed to read file cache:', err);
    }
  }

  return freshest;
}

async function writeFileCache(rates: HypothecaRates): Promise<void> {
  const data: CachedRates = { timestamp: Date.now(), rates };
  const payload = JSON.stringify(data, null, 2);

  for (const dir of CACHE_DIRS) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const tempFile = path.join(dir, `.rates-cache.tmp-${process.pid}-${Date.now()}`);
      await fs.writeFile(tempFile, payload, 'utf-8');
      await fs.rename(tempFile, path.join(dir, CACHE_FILENAME));
      debug(`Rates cached to file (${dir})`);
      return;
    } catch {
      // Répertoire non inscriptible (disque en lecture seule) — candidat suivant.
    }
  }

  console.warn('[ratesService] No writable cache directory; rates will be refetched');
}

/* ---------- Unified cache layer ---------- */

async function readCacheAny(): Promise<CacheReadResult | null> {
  return (await readBlobCache()) ?? (await readFileCache());
}

async function readCache(): Promise<HypothecaRates | null> {
  const cached = await readCacheAny();
  if (!cached) return null;

  if (cached.ageMs > CACHE_TTL_MS) {
    debug('Cache expired, will refresh');
    return null;
  }

  debug(`Using cached rates (age: ${Math.round(cached.ageMs / 60_000)} min)`);
  return cached.rates;
}

async function writeCache(rates: HypothecaRates): Promise<void> {
  // Les Blobs sont partagés entre instances : on les privilégie, et le cache
  // fichier prend le relais quand ils ne sont pas disponibles.
  if (await writeBlobCache(rates)) return;
  await writeFileCache(rates);
}

/* ------------------------------------------------------------------ */

function isValidRate(val: number): boolean {
  return Number.isFinite(val) && val >= 0.5 && val <= 20;
}

/** Clés numériques de `HypothecaRates` (tout sauf les métadonnées). */
type RateKey = Exclude<keyof HypothecaRates, 'rows' | 'source' | 'fetchedAt'>;

/** Termes suivis, du plus long au plus court, avec leurs clés plates. */
const TERMES_FIXES: ReadonlyArray<{ annees: number; taux: RateKey; affiche: RateKey }> = [
  { annees: 10, taux: 'fixe_10ans', affiche: 'affiche_fixe_10ans' },
  { annees: 7, taux: 'fixe_7ans', affiche: 'affiche_fixe_7ans' },
  { annees: 6, taux: 'fixe_6ans', affiche: 'affiche_fixe_6ans' },
  { annees: 5, taux: 'fixe_5ans', affiche: 'affiche_fixe_5ans' },
  { annees: 4, taux: 'fixe_4ans', affiche: 'affiche_fixe_4ans' },
  { annees: 3, taux: 'fixe_3ans', affiche: 'affiche_fixe_3ans' },
  { annees: 2, taux: 'fixe_2ans', affiche: 'affiche_fixe_2ans' },
  { annees: 1, taux: 'fixe_1ans', affiche: 'affiche_fixe_1ans' },
];

/**
 * Texte lisible d'une cellule HTML : retire les balises imbriquées
 * (<span>, <strong>, <br>…), décode les entités courantes et normalise
 * les espaces (y compris l'espace insécable qui précède le « % » en fr-CA).
 */
function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retourne la valeur d'une cellule qui *ressemble* à un taux — pourcentage
 * explicite (« 4,19 % ») ou décimal (« 4.19 ») — sans juger de sa plausibilité.
 * Un libellé de terme (« 5 ans ») ne passe pas ce filtre.
 *
 * La validation de plage est faite séparément pour préserver la position des
 * colonnes : une valeur aberrante ne doit jamais faire glisser le « taux
 * affiché » dans la colonne « votre taux ».
 */
function rateShape(text: string): number | null {
  const cleaned = cellText(text);
  const match = cleaned.match(/^(\d{1,2}(?:[.,]\d{1,3})?)\s*%$/) ?? cleaned.match(/^(\d{1,2}[.,]\d{1,3})$/);
  if (!match?.[1]) return null;
  return parseFloat(match[1].replace(',', '.'));
}

/** Valeurs des cellules qui ont une forme de taux, dans l'ordre du tableau. */
function rateCells(cells: string[]): number[] {
  return cells.map(rateShape).filter((v): v is number => v !== null);
}

/**
 * Reconnaît un libellé de terme (« 5 ans fixe », « Variable 5 ans », « 1 an »).
 * Sert à écarter les en-têtes de tableau et les lignes de notes.
 */
function isTermeLabel(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length === 0 || t.length > 40) return false;
  return /\d\s*an/.test(t) || t.includes('variable');
}

/**
 * Associe un libellé de terme à ses clés plates.
 * `null` si le terme n'est pas un de ceux que l'on suit.
 */
function classerTerme(terme: string): { taux: RateKey; affiche: RateKey } | null {
  const t = terme.toLowerCase();
  // « 5 ans variable » est d'abord un variable — le test passe avant les termes fixes.
  if (t.includes('variable')) return { taux: 'variable', affiche: 'affiche_variable' };

  const match = t.match(/(\d{1,2})\s*an/);
  if (!match?.[1]) return null;
  const annees = parseInt(match[1], 10);
  return TERMES_FIXES.find((x) => x.annees === annees) ?? null;
}

/**
 * Construit une ligne à partir d'un libellé et des valeurs de taux de la ligne.
 * `null` si le libellé n'est pas un terme, si aucun taux n'est présent, ou si
 * le premier taux est hors bornes — dans ce dernier cas la ligne est écartée
 * plutôt que décalée, pour ne jamais afficher un taux affiché comme « votre taux ».
 */
function buildRow(terme: string, taux: number[]): RateEntry | null {
  if (!isTermeLabel(terme)) return null;

  const hypotheca = taux[0];
  if (hypotheca === undefined || !isValidRate(hypotheca)) return null;

  const second = taux[1];
  const affiche = second !== undefined && isValidRate(second) ? second : null;

  const t = terme.toLowerCase();
  const entry: RateEntry = {
    terme,
    hypotheca,
    affiche,
    type: t.includes('variable') ? 'variable' : 'fixe',
  };
  // Le 5 ans (fixe comme variable) est le terme phare mis en avant dans le tableau.
  if (/(?<!\d)5\s*an/.test(t)) entry.populaire = true;
  return entry;
}

/**
 * Extrait les lignes d'un tableau HTML sans supposer de structure figée :
 * tolère les balises imbriquées dans les cellules, les colonnes supplémentaires,
 * les `<th scope="row">` et les attributs arbitraires.
 */
function extractRowsFromTable(html: string): RateEntry[] {
  const rows: RateEntry[] = [];

  for (const trMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const inner = trMatch[1] ?? '';
    const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1] ?? ''));
    if (cells.length < 2) continue;

    const terme = cells[0] ?? '';
    if (!isTermeLabel(terme)) continue;

    // Les deux premières cellules qui ressemblent à un taux sont, dans l'ordre
    // du tableau d'Hypotheca : « votre taux » puis « taux affiché ».
    const row = buildRow(terme, rateCells(cells.slice(1)));
    if (row) rows.push(row);
  }

  return rows;
}

/** Lignes cachées derrière l'obfuscation `occ("…")`. */
function extractRowsFromOcc(html: string): RateEntry[] {
  const rows: RateEntry[] = [];

  for (const match of html.matchAll(/occ\("([^"]+)"\)/g)) {
    const encoded = match[1];
    if (!encoded) continue;
    const decoded = decodeHypotheca(encoded);

    // Le fragment décodé peut contenir une ligne complète (<tr>) ou juste des <td>.
    const fromTable = extractRowsFromTable(decoded);
    if (fromTable.length > 0) {
      rows.push(...fromTable);
      continue;
    }

    const cells = [...decoded.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1] ?? ''));
    if (cells.length < 2) continue;

    const row = buildRow(cells[0] ?? '', rateCells(cells.slice(1)));
    if (row) rows.push(row);
  }

  return rows;
}

/** Lignes d'un tableau markdown (format renvoyé par le proxy r.jina.ai). */
function extractRowsFromMarkdown(text: string): RateEntry[] {
  const rows: RateEntry[] = [];

  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((c) => cellText(c))
      .filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
    if (cells.length < 2) continue;

    const terme = cells[0] ?? '';
    if (!isTermeLabel(terme)) continue;

    const row = buildRow(terme, rateCells(cells.slice(1)));
    if (row) rows.push(row);
  }

  return rows;
}

/**
 * Parse les taux depuis le HTML d'hypotheca.ca, en cascade :
 * tableau HTML visible → lignes obfusquées `occ(…)` → tableau markdown (proxy).
 * Les doublons de terme sont écartés en conservant la première occurrence.
 */
export function extractAllRates(html: string): RateEntry[] {
  // Les lignes obfusquées complètent le tableau visible (certaines pages
  // n'exposent qu'une partie des termes en clair).
  const candidates = [...extractRowsFromTable(html), ...extractRowsFromOcc(html)];

  // Le markdown n'est tenté qu'en dernier recours : sur du HTML, un « | »
  // égaré pourrait produire des lignes fantômes.
  if (candidates.length === 0) candidates.push(...extractRowsFromMarkdown(html));

  const rows: RateEntry[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    const key = row.terme.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return rows;
}

export function rowsToFlat(rows: RateEntry[]): Partial<HypothecaRates> {
  const flat: Partial<HypothecaRates> = {};

  for (const row of rows) {
    const classe = classerTerme(row.terme);
    if (!classe) continue;
    // Première ligne trouvée pour un terme donné : ne pas l'écraser ensuite.
    if (flat[classe.taux] != null) continue;

    flat[classe.taux] = row.hypotheca;
    flat[classe.affiche] = row.affiche;
  }

  return flat;
}

function buildFull(rows: RateEntry[], flat: Partial<HypothecaRates>, source: 'live' | 'fallback', fetchedAt: string): HypothecaRates {
  return {
    fixe_5ans: flat.fixe_5ans ?? null,
    fixe_4ans: flat.fixe_4ans ?? null,
    fixe_3ans: flat.fixe_3ans ?? null,
    fixe_2ans: flat.fixe_2ans ?? null,
    fixe_1ans: flat.fixe_1ans ?? null,
    fixe_6ans: flat.fixe_6ans ?? null,
    fixe_7ans: flat.fixe_7ans ?? null,
    fixe_10ans: flat.fixe_10ans ?? null,
    variable: flat.variable ?? null,
    affiche_fixe_5ans: flat.affiche_fixe_5ans ?? null,
    affiche_fixe_4ans: flat.affiche_fixe_4ans ?? null,
    affiche_fixe_3ans: flat.affiche_fixe_3ans ?? null,
    affiche_fixe_2ans: flat.affiche_fixe_2ans ?? null,
    affiche_fixe_1ans: flat.affiche_fixe_1ans ?? null,
    affiche_fixe_6ans: flat.affiche_fixe_6ans ?? null,
    affiche_fixe_7ans: flat.affiche_fixe_7ans ?? null,
    affiche_fixe_10ans: flat.affiche_fixe_10ans ?? null,
    affiche_variable: flat.affiche_variable ?? null,
    rows,
    source,
    fetchedAt,
  };
}

/**
 * En-tête `Cache-Control` à poser sur une page qui affiche des taux.
 *
 * Sans taux, on ne met en cache CDN que quelques minutes : autrement un seul
 * rendu raté fige « taux indisponibles » pendant 6 h pour tous les visiteurs.
 */
export function rateCacheControl(rates: HypothecaRates | null): string {
  return rates
    ? 's-maxage=21600, stale-while-revalidate=3600'
    : 's-maxage=120, stale-while-revalidate=120';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter to avoid thundering-herd on 429.
 * Base delay ~1 s, doubles each attempt, capped at ~30 s, ±25 % jitter.
 */
function backoffDelay(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
  const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25 %
  return Math.round(base + jitter);
}

async function fetchRatesHtml(): Promise<string> {
  const urls = [
    'https://hypotheca.ca/taux-hypothecaires',
    'https://www.hypotheca.ca/taux-hypothecaires',
  ];

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8',
    Referer: 'https://hypotheca.ca/',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };

  let lastError: unknown = null;

  for (const url of urls) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 429) {
          // Respect Retry-After header if present, otherwise use backoff
          const retryAfter = res.headers.get('Retry-After');
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : backoffDelay(attempt);
          lastError = new Error(`HTTP 429 for ${url} (attempt ${attempt})`);
          if (attempt < 4) {
            debug(`Rate-limited (429) on ${url}, waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}`);
            await sleep(delay);
          }
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }

        debug(`Successfully fetched rates from ${url} on attempt ${attempt}`);
        return await res.text();
      } catch (err) {
        lastError = err;
        // Don't retry on DNS / TLS errors — go to next URL immediately
        if (err instanceof Error && (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND'))) {
          debug(`Network error on ${url}: ${err.message}`);
          break; // skip remaining retries for this URL
        }
        if (attempt < 4) {
          const delay = backoffDelay(attempt);
          debug(`Attempt ${attempt} failed for ${url}, retrying in ${Math.round(delay / 1000)}s`);
          await sleep(delay);
        }
      }
    }
  }

  // Optional last-resort proxy (disabled by default — fait fuir l'URL à un tiers).
  // Activez via ENABLE_RATES_PROXY=1 si vous acceptez ce compromis.
  if (process.env.ENABLE_RATES_PROXY === '1') {
    const proxyUrls = [
      'https://r.jina.ai/http://hypotheca.ca/taux-hypothecaires',
      'https://r.jina.ai/http://www.hypotheca.ca/taux-hypothecaires',
    ];
    for (const url of proxyUrls) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': headers['User-Agent'],
              Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
          const text = await res.text();
          if (!text || text.length < 200) throw new Error(`Unexpected proxy payload for ${url}`);
          debug(`Successfully fetched rates via proxy ${url}`);
          return text;
        } catch (err) {
          lastError = err;
          if (attempt < 2) await sleep(backoffDelay(attempt));
        }
      }
    }
  }

  throw lastError ?? new Error('Unable to fetch Hypotheca rates HTML');
}

// In-flight request deduplication: concurrent SSR invocations share
// a single fetch to avoid thundering-herd 429s after cold starts.
let _inflightPromise: Promise<HypothecaRates | null> | null = null;

/**
 * Fetches live mortgage rates from hypotheca.ca, decodes the obfuscated
 * `occ("…")` values, and returns a structured rates object.
 *
 * Uses Netlify Blobs (prod) or file cache (dev) with a 24-hour TTL.
 * Returns `null` when rates are unavailable — no fake fallback data.
 *
 * Concurrent calls are coalesced into a single upstream fetch to avoid
 * triggering rate-limiting (HTTP 429) on hypotheca.ca after cold starts.
 * After a failed refresh, upstream is left alone for 15 min (cooldown) and
 * the stale cache (< 30 days) is served instead.
 */
export async function fetchHypothecaRates(): Promise<HypothecaRates | null> {
  // 1. Return cached rates if still valid (< 24 h old)
  const cached = await readCache();
  if (cached) return cached;

  // 2. If a refresh is already in-flight, piggyback on it
  if (_inflightPromise) {
    debug('Reusing in-flight rates fetch');
    return _inflightPromise;
  }

  const staleCache = await readCacheAny();
  const fetchedAt = new Date().toISOString();

  // 3. Cooldown actif après un échec récent : servir le stale sans toucher l'upstream
  if (Date.now() < _nextFetchAllowedAt) {
    debug('Fetch cooldown actif — cache périmé servi sans requête upstream');
    if (staleCache && staleCache.ageMs <= CACHE_STALE_MAX_MS && staleCache.rates.source === 'live') {
      return staleCache.rates;
    }
    return null;
  }

  const doFetch = async (): Promise<HypothecaRates | null> => {
    try {
      const html = await fetchRatesHtml();

      const rows = extractAllRates(html);

      if (rows.length === 0) {
        // Signature du document reçu : permet de distinguer dans les logs Netlify
        // un changement de balisage d'un blocage (page anti-bot / captcha).
        console.warn(
          '[ratesService] No rows parsed from HTML',
          JSON.stringify({
            length: html.length,
            tables: (html.match(/<table/gi) ?? []).length,
            tr: (html.match(/<tr/gi) ?? []).length,
            occ: (html.match(/occ\("/g) ?? []).length,
            pct: (html.match(/%/g) ?? []).length,
            titre: html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1]?.trim() ?? null,
          }),
        );
        _nextFetchAllowedAt = Date.now() + FETCH_FAILURE_COOLDOWN_MS;
        // Return stale cache if available, otherwise null
        if (staleCache && staleCache.ageMs <= CACHE_STALE_MAX_MS && staleCache.rates.source === 'live') {
          debug(`Using stale cache (age: ${Math.round(staleCache.ageMs / 60_000)} min)`);
          return staleCache.rates;
        }
        return null;
      }

      const flat = rowsToFlat(rows);
      const hasAnyRate = Object.values(flat).some((v) => v !== null);
      if (!hasAnyRate) throw new Error('No valid rates decoded from the page');

      // Cache live results
      const result = buildFull(rows, flat, 'live', fetchedAt);
      await writeCache(result);
      _nextFetchAllowedAt = 0; // succès → plus de cooldown
      return result;
    } catch (err) {
      console.warn('[ratesService] Failed to fetch Hypotheca rates:', err);
      _nextFetchAllowedAt = Date.now() + FETCH_FAILURE_COOLDOWN_MS;

      if (
        staleCache &&
        staleCache.ageMs <= CACHE_STALE_MAX_MS &&
        staleCache.rates.source === 'live'
      ) {
        debug(
          `Using stale live cache as backup (age: ${Math.round(staleCache.ageMs / 60_000)} min)`,
        );
        return staleCache.rates;
      }

      return null;
    } finally {
      // Always clear the in-flight lock so the next request can try again
      _inflightPromise = null;
    }
  };

  _inflightPromise = doFetch();
  return _inflightPromise;
}
