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

/** Formate une date en français longue (ex. : 1 juin 2028) */
export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}
