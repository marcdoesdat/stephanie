/**
 * Validation des tracés de signature (PNG) — partagée par le « Profil des emprunteurs » et
 * le « Contrat de courtage ».
 *
 * Les deux parcours recueillent une signature dessinée au doigt dans un canevas, l'envoient
 * en `data:image/png;base64,…` et la font estamper par pdf-lib. Le tracé est donc du binaire
 * fourni par le navigateur : il n'est jamais pris au mot.
 *
 * Placé dans src/utils/ parce que netlify.toml inclut déjà `src/utils/**` dans les
 * included_files des fonctions SSR.
 *
 * @module traceSignature
 */

export const SIGNATURE_POIDS_MAX = 500 * 1024;
export const SIGNATURE_LARGEUR_MAX_PX = 2000;
export const SIGNATURE_HAUTEUR_MAX_PX = 800;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decoderBase64(base64: string): Uint8Array | null {
  try {
    // atob existe dans le runtime des fonctions Netlify (Node ≥ 16) comme dans le navigateur.
    const binaire = atob(base64);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
    return octets;
  } catch {
    return null;
  }
}

/**
 * Décode et valide un tracé de signature reçu en `data:image/png;base64,…`.
 *
 * Le PNG n'est jamais pris au mot : nombre magique, poids et dimensions (lues dans le
 * chunk IHDR) sont vérifiés avant que pdf-lib ne touche aux octets. Retourne `null` si
 * quoi que ce soit cloche.
 */
export function decoderTraceSignature(dataUrl: unknown): Uint8Array | null {
  const valeur = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  const prefixe = 'data:image/png;base64,';
  if (!valeur.startsWith(prefixe)) return null;

  const base64 = valeur.slice(prefixe.length);
  // 4/3 : facteur d'expansion du base64. Écarte les charges trop lourdes avant de décoder.
  if (base64.length > SIGNATURE_POIDS_MAX * 1.4) return null;

  const octets = decoderBase64(base64);
  if (!octets || octets.length < 24 || octets.length > SIGNATURE_POIDS_MAX) return null;

  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (octets[i] !== PNG_MAGIC[i]) return null;
  }

  // IHDR : largeur et hauteur en entiers 32 bits big-endian aux offsets 16 et 20.
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const largeur = vue.getUint32(16);
  const hauteur = vue.getUint32(20);
  if (largeur < 8 || hauteur < 8) return null;
  if (largeur > SIGNATURE_LARGEUR_MAX_PX || hauteur > SIGNATURE_HAUTEUR_MAX_PX) return null;

  return octets;
}
