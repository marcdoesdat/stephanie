/**
 * Détourage d'une signature photographiée.
 *
 * Une photo de signature, c'est de l'encre sombre sur du papier clair — mais le papier n'est
 * jamais blanc pur : il est gris, jauni, traversé d'une ombre. Coller cette image telle
 * quelle sur le contrat poserait un rectangle opaque par-dessus la ligne pointillée.
 *
 * On rend donc le papier transparent et l'encre opaque, en mesurant le niveau du papier sur
 * l'image elle-même plutôt qu'en supposant du blanc. Une photo prise en pénombre fonctionne
 * comme un scan.
 *
 * Fonctions pures, sans DOM : la glue navigateur (lecture du fichier, canevas, export PNG)
 * vit dans src/scripts/importSignature.ts, et ces règles-ci restent testables.
 *
 * @module detourageSignature
 */

/** Boîte englobante de l'encre, en pixels. `null` si l'image est vide. */
export interface BoiteEncre {
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

/** Luminance perçue (Rec. 601) — suffisante et rapide pour distinguer encre et papier. */
function luminance(r: number, v: number, b: number): number {
  return 0.299 * r + 0.587 * v + 0.114 * b;
}

/**
 * Estime le niveau du papier : la luminance sous laquelle se trouvent 90 % des pixels les
 * plus clairs. Prendre le maximum absolu suffirait sur un scan, mais un seul reflet blanc
 * sur une photo fausserait tout le reste.
 */
export function niveauPapier(pixels: Uint8ClampedArray): number {
  const histogramme = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    histogramme[Math.round(luminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!))]! += 1;
    total += 1;
  }
  if (total === 0) return 255;

  // Le 90e centile en partant du clair : robuste aux quelques pixels brûlés d'un reflet.
  const cible = total * 0.1;
  let cumul = 0;
  for (let niveau = 255; niveau >= 0; niveau -= 1) {
    cumul += histogramme[niveau]!;
    if (cumul >= cible) return Math.max(niveau, 1);
  }
  return 255;
}

/**
 * Rend le papier transparent et l'encre opaque, **en place**.
 *
 * @param pixels RGBA, modifié sur place.
 * @param seuil  Part du niveau du papier en dessous de laquelle un pixel est franchement de
 *               l'encre. 0.75 laisse passer les traits fins sans ramasser le grain du papier.
 * @returns La boîte englobante de l'encre, ou `null` si rien n'a été retenu.
 */
export function detourerEncre(
  pixels: Uint8ClampedArray,
  largeur: number,
  hauteur: number,
  seuil = 0.75,
): BoiteEncre | null {
  const papier = niveauPapier(pixels);
  const plancher = papier * seuil;

  let minX = largeur;
  let minY = hauteur;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 4;
      const lum = luminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);

      // Opacité proportionnelle à l'écart au papier : les traits fins et les déliés
      // gardent leur nuance au lieu d'être binarisés en escalier.
      let alpha = plancher <= 0 ? 0 : Math.round(((plancher - lum) / plancher) * 255);
      if (alpha < 24) alpha = 0; // sous ce seuil, c'est du grain de papier, pas de l'encre
      else if (alpha > 255) alpha = 255;

      if (alpha > 0) {
        // Encre uniformément sombre : une photo jaunie ne doit pas donner une signature brune.
        pixels[i] = 20;
        pixels[i + 1] = 22;
        pixels[i + 2] = 38;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      pixels[i + 3] = alpha;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, largeur: maxX - minX + 1, hauteur: maxY - minY + 1 };
}

/**
 * Élargit la boîte d'une marge, sans sortir de l'image. Un tracé collé au bord paraîtrait
 * coupé une fois posé sur la ligne du contrat.
 */
export function avecMarge(boite: BoiteEncre, largeur: number, hauteur: number, marge: number): BoiteEncre {
  const x = Math.max(0, boite.x - marge);
  const y = Math.max(0, boite.y - marge);
  return {
    x,
    y,
    largeur: Math.min(largeur - x, boite.largeur + marge * 2),
    hauteur: Math.min(hauteur - y, boite.hauteur + marge * 2),
  };
}

/**
 * Facteur de réduction pour tenir dans les plafonds acceptés par le serveur
 * (`decoderTraceSignature`). Jamais d'agrandissement : on ne fabrique pas du détail.
 */
export function facteurReduction(
  largeur: number,
  hauteur: number,
  largeurMax: number,
  hauteurMax: number,
): number {
  return Math.min(1, largeurMax / largeur, hauteurMax / hauteur);
}
