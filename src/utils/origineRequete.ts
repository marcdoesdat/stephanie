/**
 * La règle de vérification d'origine (CSRF), isolée de son middleware.
 *
 * `security.checkOrigin` d'Astro est désactivé dans `astro.config.mjs` et la règle réécrite
 * dans `src/middleware.ts` — voir l'entête de ce module pour le pourquoi. Réécrire une
 * protection n'est acceptable qu'à une condition : qu'on puisse vérifier qu'elle est
 * identique à celle qu'elle remplace. D'où ce module pur, sans `astro:middleware`, que les
 * tests peuvent charger.
 *
 * @module origineRequete
 */

/**
 * Les routes appelées depuis l'extérieur du site, pour lesquelles l'absence d'`Origin` est
 * normale. Volontairement une liste explicite : une route s'y ajoute par décision, jamais
 * par inadvertance.
 *
 * `/api/reseau-retrait` y est seule, et doit l'être : c'est le lien de désabonnement, appelé
 * par le client de messagerie de la personne — voire, pour un retrait en un clic (RFC 8058),
 * par les serveurs de son fournisseur, sans navigateur et donc sans `Origin`.
 */
const SANS_VERIFICATION_ORIGINE = new Set(['/api/reseau-retrait']);

/** Les méthodes qui ne modifient rien — jamais concernées. */
const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Les `content-type` qu'un formulaire HTML peut émettre sans requête préalable (CORS ne les
 * retient pas), donc les seuls par lesquels une CSRF passe.
 */
const TYPES_DE_FORMULAIRE = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

function typeDeFormulaire(contentType: string): boolean {
  const valeur = contentType.toLowerCase();
  return TYPES_DE_FORMULAIRE.some((type) => valeur.includes(type));
}

/** Le verdict d'Astro, cas pour cas. */
export function origineRefusee(
  methode: string,
  origine: string | null,
  origineAttendue: string,
  contentType: string | null,
): boolean {
  if (METHODES_SURES.has(methode)) return false;
  const memeOrigine = origine === origineAttendue;
  if (contentType !== null) return typeDeFormulaire(contentType) && !memeOrigine;
  return !memeOrigine;
}

/** Vrai si la route est dispensée de la vérification. */
export function origineNonVerifiee(pathname: string): boolean {
  return SANS_VERIFICATION_ORIGINE.has(pathname.replace(/\/+$/, '') || '/');
}
