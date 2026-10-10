/**
 * Extrait les textes à traduire des pages publiques et les compare au dictionnaire anglais.
 *
 *   node scripts/i18n-extraire.mjs http://localhost:4321 [sortie.json]
 *
 * Rend (et écrit dans `sortie.json`) les clés absentes de public/js/i18n-en.json, avec les
 * pages où elles apparaissent. Code retour 1 s'il en manque : à brancher en CI si voulu.
 * Les clés sont calculées par le même moteur que le navigateur (public/js/i18n-core.js).
 */
import { parseHTML } from 'linkedom';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const PAGES_TRADUITES = [...JSON.parse(readFileSync('src/data/pagesTraduites.json', 'utf8')), '/404'];

await import('../public/js/i18n-core.js');
const core = globalThis.swI18nCore;

const base = process.argv[2] ?? 'http://localhost:4321';
const sortie = process.argv[3];
const dico = existsSync('public/js/i18n-en.json')
  ? JSON.parse(readFileSync('public/js/i18n-en.json', 'utf8'))
  : {};

const manquantes = new Map();
const invalides = [];
for (const chemin of PAGES_TRADUITES) {
  const rep = await fetch(base + chemin);
  if (!rep.ok && chemin !== '/404') { console.error(`${chemin}: HTTP ${rep.status}`); continue; }
  const { document } = parseHTML(await rep.text());
  const unites = [...core.entete(document), ...core.collecter(document.body)];
  for (const u of unites) {
    if (u.type === 'nombre') continue;
    const trad = dico[u.cle];
    if (trad === undefined) {
      if (!manquantes.has(u.cle)) manquantes.set(u.cle, { pages: [], type: u.type, n: u.els ? u.els.length : 0 });
      const p = manquantes.get(u.cle).pages;
      if (!p.includes(chemin)) p.push(chemin);
    } else if (u.els && !core.valide(trad, u.els.length)) {
      invalides.push(u.cle);
    }
  }
}
const liste = [...manquantes].map(([cle, v]) => ({ cle, ...v }));
if (sortie) writeFileSync(sortie, JSON.stringify(liste, null, 1));
console.log(`${liste.length} clés manquantes, ${invalides.length} traductions invalides`);
for (const k of invalides) console.log('  invalide:', k);
process.exit(liste.length || invalides.length ? 1 : 0);
