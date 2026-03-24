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

  // On cherche toutes les chaînes encodées dans la page
  for (const match of html.matchAll(/occ\("([^"]+)"\)/g)) {
    // Le décodage retourne du HTML brut : <tr><td>5 ans variable</td><td>3.70%</td><td>4.40%</td></tr>
    const decodedHtml = decodeHypotheca(match[1]);
    
    // On extrait le contenu texte de toutes les balises <td>
    const tdMatches = [...decodedHtml.matchAll(/<td[^>]*>(.*?)<\/td>/g)];
    
    // S'il n'y a pas au moins 2 colonnes (Terme et Taux), on ignore
    if (tdMatches.length < 2) continue;

    const termLabel = tdMatches[0][1].toLowerCase(); // ex: "5 ans variable"
    const rateString = tdMatches[1][1];              // ex: "3.70%"

    // On nettoie la chaîne (enlever le %) et on convertit en float
    const val = parseFloat(rateString.replace('%', '').trim());

    if (!isValidRate(val)) continue;

    // On assigne la valeur à la bonne clé en se fiant au texte du <td>
    if (termLabel.includes('variable')) {
      result.variable = val;
    } else if (termLabel.includes('5 ans') || termLabel.includes('5ans')) {
      result.fixe_5ans = val;
    } else if (termLabel.includes('3 ans') || termLabel.includes('3ans')) {
      result.fixe_3ans = val;
    } else if (termLabel.includes('2 ans') || termLabel.includes('2ans')) {
      result.fixe_2ans = val;
    } else if (termLabel.includes('1 an') || termLabel.includes('1an')) {
      result.fixe_1ans = val;
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
