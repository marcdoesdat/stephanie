// @ts-nocheck — le moteur est un script navigateur sans types (public/js/i18n-core.js)
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const dico: Record<string, string> = JSON.parse(readFileSync('public/js/i18n-en.json', 'utf8'));
let core: any;

beforeAll(async () => {
  await import('../../public/js/i18n-core.js');
  core = (globalThis as any).swI18nCore;
});

const balises = (s: string) => [...s.matchAll(/<\/?(\d+)\/?>/g)].map((m) => m[0]).sort();

describe('dictionnaire anglais', () => {
  it("garde, pour chaque clé, les mêmes balises numérotées que le français", () => {
    const fautes = Object.entries(dico).filter(([fr, en]) => {
      const a = balises(fr), b = balises(en);
      return a.length !== b.length || [...new Set(a.map((x) => x.replace(/[</>]/g, '')))].some(
        (n) => !b.some((x) => x.replace(/[</>]/g, '') === n),
      );
    });
    expect(fautes.map(([k]) => k)).toEqual([]);
  });

  it("ne laisse aucune valeur vide", () => {
    expect(Object.entries(dico).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});

describe('moteur de traduction', () => {
  it('traduit une phrase à balises en réordonnant sans recréer les éléments, puis revient', () => {
    const { document } = parseHTML('<p>Voyez <a href="/x">nos taux</a> ici</p>');
    const p = document.querySelector('p');
    const a = document.querySelector('a');
    const [u] = core.collecter(p);
    expect(u.cle).toBe('Voyez <1>nos taux</1> ici');

    expect(core.appliquer(u.el, u.els, '<1>See our rates</1> here')).toBe(true);
    expect(p.textContent).toBe('See our rates here');
    expect(document.querySelector('a')).toBe(a); // même élément : ses écouteurs survivent

    expect(core.appliquer(u.el, u.els, u.brut)).toBe(true);
    expect(p.innerHTML).toBe('Voyez <a href="/x">nos taux</a> ici');
  });

  it('refuse un gabarit dont les balises ne correspondent pas', () => {
    expect(core.valide('<1>a</1> <2>b</2>', 2)).toBe(true);
    expect(core.valide('<1>a</1>', 2)).toBe(false);
    expect(core.valide('<1>a</2>', 2)).toBe(false);
  });

  it("découpe une mise en page (éléments côte à côte sans texte) en morceaux traduits seuls", () => {
    const { document } = parseHTML('<button><span>🏡</span> <span><b>Premier achat</b> <small>Acheter</small></span></button>');
    const cles = core.collecter(document.querySelector('button')).map((u: any) => u.cle);
    expect(cles).toEqual(['Premier achat', 'Acheter']);
  });
});
