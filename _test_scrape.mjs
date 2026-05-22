const url = 'https://hypotheca.ca/taux-hypothecaires';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8',
  'Referer': 'https://hypotheca.ca/',
};

console.log('Fetching...');
try {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  console.log('Status:', res.status);
  const html = await res.text();
  console.log('Length:', html.length);

  // Test regex 1: plain tr/td rows
  const trRegex = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi;
  const matches1 = [...html.matchAll(trRegex)];
  console.log('Plain TR matches:', matches1.length);
  matches1.slice(0, 3).forEach(m => console.log(' ', m[1], '|', m[2], '|', m[3]));

  // Test regex 2: occ() pattern
  const occMatches = [...html.matchAll(/occ\("([^"]+)"\)/g)];
  console.log('occ() matches:', occMatches.length);

  console.log('\nDone.');
} catch (err) {
  console.error('Error:', err.message);
}
