/**
 * Vérifie les pages /en/ servies par un serveur lancé : langue, texte resté en français
 * (heuristique), liens internes qui échappent à /en/.
 *
 *   node scripts/i18n-verifier-en.mjs http://localhost:4321
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
const pages = JSON.parse(readFileSync('src/data/pagesTraduites.json', 'utf8'));
const FR = /[àâçéèêëîïôûùü]|\b(le|la|les|des|votre|vos|pour|avec|vous|mois|prêt|taux|une|est|dans|sur|pas|ans)\b/i;
const EN = /\b(the|your|you|and|of|to|is|for|with|in)\b/i;
for (const p of pages) {
  const url = base + (p === '/' ? '/en/' : '/en' + p + '/');
  const rep = await fetch(url);
  const { document } = parseHTML(await rep.text());
  const out = new Set();
  const w = document.createTreeWalker(document.body, 4);
  let n;
  while ((n = w.nextNode())) {
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest('[data-no-i18n]')) continue;
    const t = n.data.replace(/\s+/g, ' ').trim();
    if (t && FR.test(t) && !EN.test(t)) out.add(t.slice(0, 90));
  }
  const frLinks = [...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href')).filter(h => !/^\/(en|api|js|images|_astro)(\/|$)|\.[a-z0-9]{2,5}$/i.test(h));
  console.log(rep.status, p, 'lang=' + document.documentElement.getAttribute('lang'), 'FR:', [...out].filter(t => !/Stéphanie|Autorité|Lanaudière|Montréal|Québec/.test(t)).slice(0, 6), 'liens FR:', [...new Set(frLinks)].slice(0, 5));
}
