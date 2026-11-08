import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDES, cheminGuide, guideParSlug, moisRevision } from './guides';

const traduites = JSON.parse(readFileSync('src/data/pagesTraduites.json', 'utf8')) as string[];

describe('les guides', () => {
  it('ont des slugs uniques', () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(GUIDES.map((g) => [g.slug, g] as const))('%s a sa page, sa version anglaise et une date de révision valide', (slug, guide) => {
    expect(existsSync(`src/pages/guides/${slug}.astro`), 'page absente').toBe(true);
    expect(traduites, 'absent de pagesTraduites.json : /en/ le servirait en 404').toContain(`/guides/${slug}`);
    expect(() => moisRevision(guide.revise)).not.toThrow();
    expect(guide.minutes).toBeGreaterThan(0);
  });

  it('ont une page d’index, elle aussi traduite', () => {
    expect(existsSync('src/pages/guides/index.astro')).toBe(true);
    expect(traduites).toContain('/guides');
  });

  it('donnent des chemins à barre finale', () => {
    expect(cheminGuide('premier-achat')).toBe('/guides/premier-achat/');
  });

  it('refusent un slug inconnu plutôt que de rendre une page vide', () => {
    expect(() => guideParSlug('inconnu')).toThrow();
  });
});

describe('moisRevision', () => {
  it('donne le mois en toutes lettres, sans décalage de fuseau', () => {
    expect(moisRevision('2026-11-08')).toBe('novembre 2026');
    expect(moisRevision('2027-01-01')).toBe('janvier 2027');
    expect(moisRevision('2026-08-31')).toBe('août 2026');
  });

  it('refuse une date mal formée', () => {
    expect(() => moisRevision('2026-13-01')).toThrow();
    expect(() => moisRevision('novembre 2026')).toThrow();
  });
});
