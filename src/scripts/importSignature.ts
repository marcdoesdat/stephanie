/**
 * Import d'une signature photographiée ou numérisée.
 *
 * Stéphanie signe une feuille blanche, la photographie, et dépose l'image ici. On en tire le
 * même PNG à fond transparent que le bloc de signature au doigt — la suite de la chaîne
 * (validation, stockage, estampage) ne voit aucune différence.
 *
 * Les règles de détourage sont dans src/utils/detourageSignature.ts ; ce module n'est que la
 * glue navigateur : lecture du fichier, canevas, recadrage, export.
 *
 * @module importSignature
 */

import { avecMarge, detourerEncre, facteurReduction } from '../utils/detourageSignature';

/** Plafonds alignés sur la validation serveur (`decoderTraceSignature`). */
const EXPORT_LARGEUR_MAX = 1600;
const EXPORT_HAUTEUR_MAX = 500;

/** Au-delà, on ne charge même pas : une photo de 20 Mo n'apporte rien de plus. */
export const FICHIER_POIDS_MAX = 12 * 1024 * 1024;

/** Ce que les navigateurs savent décoder de façon fiable — HEIC d'iPhone exclu. */
export const TYPES_ACCEPTES = ['image/png', 'image/jpeg', 'image/webp'];

export class ErreurImport extends Error {}

function chargerImage(fichier: File): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resoudre(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(
        new ErreurImport(
          'Image illisible. Les photos HEIC d’iPhone ne sont pas reconnues — enregistrez-la en JPEG ou PNG.',
        ),
      );
    };
    image.src = url;
  });
}

/**
 * Transforme une photo de signature en PNG à fond transparent, recadré sur l'encre.
 *
 * @throws {ErreurImport} si le fichier n'est pas exploitable ou ne contient aucun tracé.
 */
export async function importerSignature(fichier: File): Promise<string> {
  if (!TYPES_ACCEPTES.includes(fichier.type)) {
    throw new ErreurImport('Format non reconnu. Utilisez une image JPEG, PNG ou WebP.');
  }
  if (fichier.size > FICHIER_POIDS_MAX) {
    throw new ErreurImport('Image trop lourde. Reprenez-la en résolution plus basse.');
  }

  const image = await chargerImage(fichier);
  if (image.naturalWidth < 16 || image.naturalHeight < 8) {
    throw new ErreurImport('Image trop petite pour y lire une signature.');
  }

  // On travaille à taille raisonnable : au-delà, le détourage coûte cher pour rien.
  const reduction = facteurReduction(image.naturalWidth, image.naturalHeight, 2400, 1200);
  const largeur = Math.max(1, Math.round(image.naturalWidth * reduction));
  const hauteur = Math.max(1, Math.round(image.naturalHeight * reduction));

  const travail = document.createElement('canvas');
  travail.width = largeur;
  travail.height = hauteur;
  const ctx = travail.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ErreurImport('Le navigateur n’a pas pu traiter l’image.');
  ctx.drawImage(image, 0, 0, largeur, hauteur);

  const donnees = ctx.getImageData(0, 0, largeur, hauteur);
  const boite = detourerEncre(donnees.data, largeur, hauteur);
  if (!boite || boite.largeur < 8 || boite.hauteur < 4) {
    throw new ErreurImport(
      'Aucun tracé détecté. Photographiez la signature sur une feuille bien éclairée, sans ombre.',
    );
  }
  ctx.putImageData(donnees, 0, 0);

  // Recadrage sur l'encre : sans lui, une signature au centre d'une feuille se retrouverait
  // minuscule sur la ligne du contrat, qui ne fait que 185 × 22 pt.
  const cadre = avecMarge(boite, largeur, hauteur, Math.round(boite.hauteur * 0.12) + 4);
  const echelle = facteurReduction(cadre.largeur, cadre.hauteur, EXPORT_LARGEUR_MAX, EXPORT_HAUTEUR_MAX);

  const sortie = document.createElement('canvas');
  sortie.width = Math.max(8, Math.round(cadre.largeur * echelle));
  sortie.height = Math.max(8, Math.round(cadre.hauteur * echelle));
  const ctxSortie = sortie.getContext('2d');
  if (!ctxSortie) throw new ErreurImport('Le navigateur n’a pas pu traiter l’image.');
  ctxSortie.imageSmoothingQuality = 'high';
  ctxSortie.drawImage(
    travail,
    cadre.x,
    cadre.y,
    cadre.largeur,
    cadre.hauteur,
    0,
    0,
    sortie.width,
    sortie.height,
  );

  return sortie.toDataURL('image/png');
}
