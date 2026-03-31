import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeHypotheca } from '../utils/hypothecaDecoder';

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

/**
 * Static fallback rates used when the scrape fails.
 */
const FALLBACK_ROWS: RateEntry[] = [
  { terme: '5 ans variable', hypotheca: 3.70, affiche: 4.45, type: 'variable', populaire: true },
  { terme: '1 an fixe',      hypotheca: 4.89, affiche: 6.99, type: 'fixe' },
  { terme: '2 ans fixe',     hypotheca: 4.24, affiche: 6.69, type: 'fixe' },
  { terme: '3 ans fixe',     hypotheca: 3.69, affiche: 6.39, type: 'fixe' },
  { terme: '4 ans fixe',     hypotheca: 3.84, affiche: 6.29, type: 'fixe' },
  { terme: '5 ans fixe',     hypotheca: 3.79, affiche: 6.39, type: 'fixe', populaire: true },
  { terme: '6 ans fixe',     hypotheca: 4.59, affiche: 6.69, type: 'fixe' },
  { terme: '7 ans fixe',     hypotheca: 4.59, affiche: 6.69, type: 'fixe' },
  { terme: '10 ans fixe',    hypotheca: 5.04, affiche: 7.14, type: 'fixe' },
];

/* ------------------------------------------------------------------ */
/*  24-hour file-based cache                                          */
/* ------------------------------------------------------------------ */

const CACHE_DIR = path.resolve('.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'hypotheca-rates.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedRates {
  timestamp: number;
  rates: HypothecaRates;
}

/**
 * Reads cached rates from disk.
 * Returns the cached `HypothecaRates` if the file exists and is younger
 * than 24 h, otherwise returns `null`.
 */
function readCache(): HypothecaRates | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;

    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cached: CachedRates = JSON.parse(raw);

    // Basic validation of cached timestamp to avoid treating malformed
    // cache files as fresh data.
    if (
      !cached ||
      typeof cached.timestamp !== 'number' ||
      !Number.isFinite(cached.timestamp)
    ) {
      console.warn('[ratesService] Ignoring cache: invalid or missing timestamp');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (!Number.isFinite(age) || age < 0 || age > CACHE_TTL_MS) {
      console.log('[ratesService] Cache expired or invalid age, will refresh');
      return null;
    }
    console.log(
      `[ratesService] Using cached rates (age: ${Math.round(age / 60_000)} min)`,
    );
    return cached.rates;
  } catch (err) {
    console.warn('[ratesService] Failed to read cache:', err);
    return null;
  }
}

/**
 * Persists rates to disk so subsequent builds within 24 h can skip
 * the network call to hypotheca.ca.
 */
function writeCache(rates: HypothecaRates): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data: CachedRates = { timestamp: Date.now(), rates };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[ratesService] Rates cached successfully');
  } catch (err) {
    console.warn('[ratesService] Failed to write cache:', err);
  }
}

/* ------------------------------------------------------------------ */

function isValidRate(val: number): boolean {
  return val >= 0.5 && val <= 20;
}

/**
 * Parse both occ()-decoded rows and visible plaintext <tr> rows.
 * Returns structured rows with both "hypotheca" and "affiche" rates.
 */
function extractAllRates(html: string): RateEntry[] {
  const rows: RateEntry[] = [];
  const seen = new Set<string>();

  // ---- 1) Parse visible plaintext <tr> rows ----
  const trRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g;
  for (const m of html.matchAll(trRegex)) {
    const terme = m[1].trim();
    const hypothecaStr = m[2].trim();
    const afficheStr = m[3].trim();

    const hypothecaVal = parseFloat(hypothecaStr.replace('%', ''));
    const afficheVal = parseFloat(afficheStr.replace('%', ''));

    if (!isValidRate(hypothecaVal)) continue;

    const key = terme.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const isVariable = key.includes('variable');
    const entry: RateEntry = {
      terme,
      hypotheca: hypothecaVal,
      affiche: isValidRate(afficheVal) ? afficheVal : null,
      type: isVariable ? 'variable' : 'fixe',
    };
    if (key.includes('5 ans')) entry.populaire = true;
    rows.push(entry);
  }

  // ---- 2) Parse occ()-decoded rows as fallback ----
  if (rows.length === 0) {
    for (const match of html.matchAll(/occ\("([^"]+)"\)/g)) {
      const decodedHtml = decodeHypotheca(match[1]);
      const tdMatches = [...decodedHtml.matchAll(/<td[^>]*>(.*?)<\/td>/g)];
      if (tdMatches.length < 2) continue;

      const terme = tdMatches[0][1].trim();
      const hypothecaStr = tdMatches[1]?.[1] ?? '';
      const afficheStr = tdMatches[2]?.[1] ?? '';

      const hypothecaVal = parseFloat(hypothecaStr.replace('%', '').trim());
      const afficheVal = parseFloat(afficheStr.replace('%', '').trim());

      if (!isValidRate(hypothecaVal)) continue;

      const key = terme.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const isVariable = key.includes('variable');
      const entry: RateEntry = {
        terme,
        hypotheca: hypothecaVal,
        affiche: isValidRate(afficheVal) ? afficheVal : null,
        type: isVariable ? 'variable' : 'fixe',
      };
      if (key.includes('5 ans')) entry.populaire = true;
      rows.push(entry);
    }
  }

  return rows;
}

function rowsToFlat(rows: RateEntry[]): Partial<HypothecaRates> {
  const flat: Partial<HypothecaRates> = {};
  for (const row of rows) {
    const t = row.terme.toLowerCase();
    if (t.includes('variable')) {
      flat.variable = row.hypotheca;
      flat.affiche_variable = row.affiche;
    } else if (t.includes('10 an')) {
      flat.fixe_10ans = row.hypotheca;
      flat.affiche_fixe_10ans = row.affiche;
    } else if (t.includes('7 an')) {
      flat.fixe_7ans = row.hypotheca;
      flat.affiche_fixe_7ans = row.affiche;
    } else if (t.includes('6 an')) {
      flat.fixe_6ans = row.hypotheca;
      flat.affiche_fixe_6ans = row.affiche;
    } else if (t.includes('5 an') && t.includes('fixe')) {
      flat.fixe_5ans = row.hypotheca;
      flat.affiche_fixe_5ans = row.affiche;
    } else if (t.includes('4 an')) {
      flat.fixe_4ans = row.hypotheca;
      flat.affiche_fixe_4ans = row.affiche;
    } else if (t.includes('3 an')) {
      flat.fixe_3ans = row.hypotheca;
      flat.affiche_fixe_3ans = row.affiche;
    } else if (t.includes('2 an')) {
      flat.fixe_2ans = row.hypotheca;
      flat.affiche_fixe_2ans = row.affiche;
    } else if (t.includes('1 an')) {
      flat.fixe_1ans = row.hypotheca;
      flat.affiche_fixe_1ans = row.affiche;
    }
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
 * Fetches live mortgage rates from hypotheca.ca, decodes the obfuscated
 * `occ("…")` values, and returns a structured rates object.
 *
 * A 24-hour file-based cache avoids redundant network requests during
 * frequent builds.  Only *live* results are cached – fallback data is
 * never written so the next build retries the remote fetch.
 */
export async function fetchHypothecaRates(): Promise<HypothecaRates> {
  // 1. Return cached rates if still valid (< 24 h old)
  const cached = readCache();
  if (cached) return cached;

  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch('https://hypotheca.ca/taux-hypothecaires', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HypothecaRatesBot/1.0; +https://stephanieweyman.ca)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    const rows = extractAllRates(html);

    if (rows.length === 0) {
      console.warn('[ratesService] No rows parsed from HTML, using fallback');
      const flat = rowsToFlat(FALLBACK_ROWS);
      return buildFull(FALLBACK_ROWS, flat, 'fallback', fetchedAt);
    }

    const flat = rowsToFlat(rows);
    const hasAnyRate = Object.values(flat).some((v) => v !== null);
    if (!hasAnyRate) throw new Error('No valid rates decoded from the page');

    // 2. Cache live results for subsequent builds
    const result = buildFull(rows, flat, 'live', fetchedAt);
    writeCache(result);
    return result;
  } catch (err) {
    console.warn('[ratesService] Failed to fetch Hypotheca rates, using fallback:', err);
    const flat = rowsToFlat(FALLBACK_ROWS);
    return buildFull(FALLBACK_ROWS, flat, 'fallback', fetchedAt);
  }
}
