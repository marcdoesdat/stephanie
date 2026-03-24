import { decodeHypotheca } from '../utils/hypothecaDecoder';

export interface HypothecaRates {
  fixe_5ans: number | null;
  fixe_3ans: number | null;
  fixe_2ans: number | null;
  fixe_1ans: number | null;
  variable: number | null;
  source: 'live' | 'fallback';
  fetchedAt: string;
}

/**
 * Static fallback rates used when the scrape fails.
 * Last reviewed: 2026-03 — refresh if the market changes significantly.
 * Source: hypotheca.ca observed rates at that date.
 */
const FALLBACK_RATES: Omit<HypothecaRates, 'fetchedAt'> = {
  fixe_5ans: 4.79,
  fixe_3ans: 5.09,
  fixe_2ans: 5.29,
  fixe_1ans: 5.79,
  variable: 5.15,
  source: 'fallback',
};

const RATE_RE = /^\d+\.\d+$/;

function isValidRate(val: number): boolean {
  return val >= 0.5 && val <= 20;
}

/**
 * For each `occ("…")` call in the HTML, look at the 300 characters
 * that precede it to find a term label (e.g. "5 ans", "variable").
 */
function extractRatesByContext(
  html: string
): Pick<HypothecaRates, 'fixe_5ans' | 'fixe_3ans' | 'fixe_2ans' | 'fixe_1ans' | 'variable'> {
  const result: Pick<
    HypothecaRates,
    'fixe_5ans' | 'fixe_3ans' | 'fixe_2ans' | 'fixe_1ans' | 'variable'
  > = {
    fixe_5ans: null,
    fixe_3ans: null,
    fixe_2ans: null,
    fixe_1ans: null,
    variable: null,
  };

  // Ordered list: first matching label wins for each key.
  const termLabels: Array<[keyof typeof result, string[]]> = [
    ['fixe_5ans', ['5 ans', '5ans', '60 mois', '60mois']],
    ['fixe_3ans', ['3 ans', '3ans', '36 mois', '36mois']],
    ['fixe_2ans', ['2 ans', '2ans', '24 mois', '24mois']],
    ['fixe_1ans', ['1 an', '1an', '12 mois', '12mois']],
    ['variable', ['variable', 'var.']],
  ];

  const positionalKeys: Array<keyof typeof result> = [
    'fixe_5ans',
    'fixe_3ans',
    'fixe_2ans',
    'fixe_1ans',
    'variable',
  ];

  // Collect all valid decoded rates, tracking which sequential index each comes from.
  const allRates: Array<{ val: number; seqIdx: number }> = [];
  const usedSeqIndices = new Set<number>();
  let seqIdx = 0;

  for (const match of html.matchAll(/occ\("([^"]+)"\)/g)) {
    const decoded = decodeHypotheca(match[1]);
    if (!RATE_RE.test(decoded)) continue;
    const val = parseFloat(decoded);
    if (!isValidRate(val)) continue;

    const currentSeq = seqIdx++;
    allRates.push({ val, seqIdx: currentSeq });

    // Look at the 300 characters before this occ() call for a term label.
    const startIdx = Math.max(0, (match.index ?? 0) - 300);
    const context = html.slice(startIdx, match.index).toLowerCase();

    for (const [key, labels] of termLabels) {
      if (result[key] !== null) continue; // already found
      if (labels.some((l) => context.includes(l))) {
        result[key] = val;
        usedSeqIndices.add(currentSeq);
        break;
      }
    }
  }

  // Positional fallback: fill remaining null keys from rates not already
  // assigned by context matching, in document order.
  let posIdx = 0;
  for (const key of positionalKeys) {
    if (result[key] !== null) continue;
    // Skip rates that were already claimed by context matching.
    while (posIdx < allRates.length && usedSeqIndices.has(allRates[posIdx].seqIdx)) {
      posIdx++;
    }
    if (posIdx < allRates.length) {
      result[key] = allRates[posIdx++].val;
    }
  }

  return result;
}

/**
 * Fetches live mortgage rates from hypotheca.ca, decodes the obfuscated
 * `occ("…")` values, and returns a structured rates object.
 * Falls back to static rates if the fetch or parse fails.
 */
export async function fetchHypothecaRates(): Promise<HypothecaRates> {
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

    // Quick sanity check: ensure there are occ() calls in the page.
    if (!html.includes('occ(')) throw new Error('occ() not found — page structure changed');

    const rates = extractRatesByContext(html);
    const hasAnyRate = Object.values(rates).some((v) => v !== null);
    if (!hasAnyRate) throw new Error('No valid rates decoded from the page');

    return { ...rates, source: 'live', fetchedAt };
  } catch (err) {
    console.warn('[ratesService] Failed to fetch Hypotheca rates, using fallback:', err);
    return { ...FALLBACK_RATES, fetchedAt };
  }
}
