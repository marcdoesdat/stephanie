/**
 * Tests du détourage d'une signature photographiée.
 *
 * Ce que ces tests protègent : une photo mal détourée pose un rectangle opaque par-dessus la
 * ligne du contrat, ou pire, ne retient rien et laisse une signature vide. Les cas couverts
 * sont ceux d'une vraie photo — papier gris, papier jauni, éclairage inégal — et non ceux
 * d'un scan idéal en noir sur blanc pur.
 */
import { describe, expect, it } from 'vitest';
import { avecMarge, detourerEncre, facteurReduction, niveauPapier } from './detourageSignature';

/** Fabrique une image RGBA unie, puis laisse le test y peindre de l'encre. */
function image(largeur: number, hauteur: number, papier: [number, number, number]) {
  const pixels = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = papier[0];
    pixels[i + 1] = papier[1];
    pixels[i + 2] = papier[2];
    pixels[i + 3] = 255;
  }
  const encre = (x: number, y: number, ton: number = 20): void => {
    const i = (y * largeur + x) * 4;
    pixels[i] = ton;
    pixels[i + 1] = ton;
    pixels[i + 2] = ton;
  };
  return { pixels, encre };
}

function alphaEn(pixels: Uint8ClampedArray, largeur: number, x: number, y: number): number {
  return pixels[(y * largeur + x) * 4 + 3]!;
}

describe('niveauPapier', () => {
  it('reconnaît le blanc franc d’un scan', () => {
    const { pixels } = image(10, 10, [255, 255, 255]);
    expect(niveauPapier(pixels)).toBeGreaterThan(240);
  });

  it('reconnaît un papier gris photographié en pénombre', () => {
    const { pixels } = image(10, 10, [150, 150, 150]);
    expect(niveauPapier(pixels)).toBeGreaterThan(130);
    expect(niveauPapier(pixels)).toBeLessThan(170);
  });

  it('ne se laisse pas fausser par un reflet isolé', () => {
    // Un seul pixel brûlé ne doit pas faire passer tout le papier pour sombre.
    const { pixels } = image(20, 20, [140, 140, 140]);
    pixels[0] = 255;
    pixels[1] = 255;
    pixels[2] = 255;
    expect(niveauPapier(pixels)).toBeLessThan(170);
  });
});

describe('detourerEncre', () => {
  it('rend le papier transparent et l’encre opaque', () => {
    const { pixels, encre } = image(20, 20, [255, 255, 255]);
    for (let x = 5; x < 15; x += 1) encre(x, 10);

    const boite = detourerEncre(pixels, 20, 20);
    expect(boite).not.toBeNull();
    expect(alphaEn(pixels, 20, 0, 0)).toBe(0); // papier
    expect(alphaEn(pixels, 20, 10, 10)).toBeGreaterThan(200); // encre
  });

  it('fonctionne sur un papier gris, pas seulement sur du blanc pur', () => {
    // C'est le cas d'une photo prise à l'intérieur : sans mesure du papier, un seuil fixe
    // sur le blanc ne retiendrait rien du tout.
    const { pixels, encre } = image(20, 20, [150, 150, 150]);
    for (let x = 5; x < 15; x += 1) encre(x, 10, 15);

    const boite = detourerEncre(pixels, 20, 20);
    expect(boite).not.toBeNull();
    expect(alphaEn(pixels, 20, 10, 10)).toBeGreaterThan(200);
    expect(alphaEn(pixels, 20, 0, 0)).toBe(0);
  });

  it('uniformise la couleur de l’encre — une photo jaunie ne donne pas une signature brune', () => {
    const { pixels, encre } = image(20, 20, [235, 225, 200]);
    encre(10, 10, 60);
    detourerEncre(pixels, 20, 20);
    const i = (10 * 20 + 10) * 4;
    expect(pixels[i]).toBeLessThan(60);
    expect(pixels[i + 2]).toBeLessThan(80);
  });

  it('recadre sur l’encre et rien d’autre', () => {
    const { pixels, encre } = image(40, 30, [250, 250, 250]);
    for (let x = 12; x <= 20; x += 1) encre(x, 8);
    for (let y = 8; y <= 14; y += 1) encre(12, y);

    const boite = detourerEncre(pixels, 40, 30)!;
    expect(boite.x).toBe(12);
    expect(boite.y).toBe(8);
    expect(boite.largeur).toBe(9);
    expect(boite.hauteur).toBe(7);
  });

  it('retourne null sur une feuille vierge', () => {
    // Sans ça, on enregistrerait une signature entièrement transparente.
    const { pixels } = image(20, 20, [252, 252, 252]);
    expect(detourerEncre(pixels, 20, 20)).toBeNull();
  });

  it('ignore le grain du papier', () => {
    const { pixels } = image(30, 30, [250, 250, 250]);
    // Quelques pixels à peine plus sombres : du bruit de capteur, pas un trait.
    for (let k = 0; k < 30; k += 1) {
      const i = k * 4 * 7;
      pixels[i] = 242;
      pixels[i + 1] = 242;
      pixels[i + 2] = 242;
    }
    expect(detourerEncre(pixels, 30, 30)).toBeNull();
  });
});

describe('avecMarge', () => {
  it('élargit la boîte sans sortir de l’image', () => {
    const elargie = avecMarge({ x: 5, y: 5, largeur: 10, hauteur: 10 }, 40, 40, 3);
    expect(elargie).toEqual({ x: 2, y: 2, largeur: 16, hauteur: 16 });
  });

  it('se limite aux bords quand le tracé les touche', () => {
    const elargie = avecMarge({ x: 0, y: 0, largeur: 20, hauteur: 20 }, 20, 20, 5);
    expect(elargie).toEqual({ x: 0, y: 0, largeur: 20, hauteur: 20 });
  });
});

describe('facteurReduction', () => {
  it('réduit ce qui dépasse, en conservant le ratio', () => {
    expect(facteurReduction(3200, 800, 1600, 500)).toBeCloseTo(0.5);
    expect(facteurReduction(800, 2000, 1600, 500)).toBeCloseTo(0.25);
  });

  it('n’agrandit jamais — on ne fabrique pas du détail', () => {
    expect(facteurReduction(200, 60, 1600, 500)).toBe(1);
  });
});
