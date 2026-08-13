/**
 * Utilitaire de formatage — conventions québécoises (fr-CA)
 *
 * @module formatters
 */

/** Formate un montant en dollars canadiens (fr-CA, sans décimales) */
export function formatCAD(n: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Formate un nombre avec espaces comme séparateur de milliers */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 }).format(n);
}

/**
 * Fuseau de référence du site — celui de la courtière et de sa clientèle.
 *
 * ⚠️ Il doit être imposé explicitement partout où une date est **produite côté serveur**.
 * Les fonctions Netlify tournent en UTC : sans ce fuseau, une signature apposée à 21 h 30
 * le 14 janvier serait datée du 15 janvier sur le contrat. Une mauvaise date sur un document
 * signé, et rien pour la signaler.
 *
 * `America/Toronto` plutôt que `America/Montreal` : même fuseau, mais c'est l'identifiant
 * canonique de la base IANA — Montréal n'en est qu'un alias, absent de certains runtimes.
 * Le passage à l'heure avancée est géré par `Intl`, il n'y a rien à maintenir ici.
 */
export const FUSEAU_QUEBEC = 'America/Toronto';

/** Formate une date en français longue (ex. : 1 juin 2028), heure du Québec. */
export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: FUSEAU_QUEBEC,
  }).format(d);
}

/**
 * Date et heure en clair, heure du Québec (ex. : « 14 janvier 2026 à 21 h 30 HNE »).
 *
 * Destinée aux courriels lus par des humains : un horodatage ISO en UTC y est illisible, et
 * pire, trompeur — on le lit spontanément comme une heure locale. La mention du fuseau
 * (HNE l'hiver, HAE l'été) lève l'ambiguïté.
 *
 * Accepte une `Date` ou une chaîne ISO ; retourne la chaîne telle quelle si elle n'est pas
 * une date valide, plutôt que d'afficher « Invalid Date » dans un courriel de preuve.
 */
export function formatDateHeureLong(valeur: Date | string): string {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) return String(valeur);

  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: FUSEAU_QUEBEC,
    timeZoneName: 'short',
  }).format(date);
}
