import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { VILLES, cheminVille } from './villes';

const pagesTraduites: string[] = JSON.parse(readFileSync('src/data/pagesTraduites.json', 'utf8'));

describe('pages villes', () => {
  it('chaque ville a sa page et sa version anglaise', () => {
    for (const v of VILLES) {
      expect(existsSync(`src/pages/villes/courtier-hypothecaire-${v.slug}.astro`), v.slug).toBe(true);
      expect(pagesTraduites, v.slug).toContain(cheminVille(v.slug).replace(/\/$/, ''));
    }
  });

  it('les voisines existent, sans doublon ni renvoi à soi-même', () => {
    const slugs = new Set(VILLES.map((v) => v.slug));
    for (const v of VILLES) {
      expect(new Set(v.voisines).size, v.slug).toBe(v.voisines.length);
      expect(v.voisines, v.slug).not.toContain(v.slug);
      for (const s of v.voisines) expect(slugs.has(s), `${v.slug} → ${s}`).toBe(true);
      expect(v.voisines.length, v.slug).toBeGreaterThanOrEqual(2);
    }
  });

  // Hors du pied de page, aucune page ne menait à Gatineau, Sherbrooke ni Saguenay.
  it('chaque ville reçoit un lien d\'au moins deux autres pages villes', () => {
    for (const v of VILLES) {
      const entrants = VILLES.filter((o) => o.voisines.includes(v.slug)).length;
      expect(entrants, v.slug).toBeGreaterThanOrEqual(2);
    }
  });
});
