// Données structurées des pages villes, à un seul exemplaire pour les treize pages.
//
// Trois nœuds, et une seule entreprise :
// - `FinancialService` porte le **même `@id` que la fiche déclarée par SEO.astro** (`#business`) :
//   Google fusionne les deux, et la page ajoute seulement la ville à la zone desservie. Un second
//   `@id` (ou aucun) déclarerait une deuxième entreprise — la faute corrigée à l'audit d'octobre 2026.
//   L'adresse est celle d'Hypotheca, la vraie : jamais une adresse inventée dans la ville visée.
// - `Person` : la courtière, avec son permis de l'AMF comme titre professionnel vérifiable.
// - `BreadcrumbList` : Accueil › la page, comme le fil d'Ariane affiché en haut du héro.

import type { SiteConfig } from '../config';

/** L'adresse d'affaires (Hypotheca) — la même que celle de la fiche `#business` de SEO.astro. */
export const ADRESSE_ENTREPRISE = {
  '@type': 'PostalAddress',
  streetAddress: '3344 Fleury Est',
  addressLocality: 'Montréal',
  addressRegion: 'QC',
  postalCode: 'H1H 2R5',
  addressCountry: 'CA',
} as const;

interface EntreesSchemaVille {
  config: SiteConfig;
  /** Nom affiché de la ville, ex. « Saint-Jean-sur-Richelieu » */
  ville: string;
  /** Adresse complète de la page, barre finale comprise */
  pageUrl: string;
  /** Secteurs ou villes voisines desservis en plus de la ville elle-même */
  secteurs: string[];
  /** Adresse absolue de la photo de la courtière */
  image: string;
}

export function schemasVille({ config, ville, pageUrl, secteurs, image }: EntreesSchemaVille) {
  const site = config.site_url.replace(/\/$/, '');
  const financialService = {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    '@id': `${site}#business`,
    name: `${config.nom} — ${config.titre}`,
    url: site,
    address: ADRESSE_ENTREPRISE,
    areaServed: [
      { '@type': 'City', name: ville },
      ...secteurs.map((name) => ({ '@type': 'Place', name })),
    ],
  };

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${site}#stephanie`,
    name: config.nom,
    jobTitle: config.titre,
    worksFor: { '@id': `${site}#business` },
    image,
    url: site,
    hasCredential: {
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: "Permis d'exercice",
      name: 'Courtière hypothécaire — permis de l\'Autorité des marchés financiers',
      identifier: config.amf,
      recognizedBy: {
        '@type': 'Organization',
        name: 'Autorité des marchés financiers',
        url: 'https://lautorite.qc.ca/',
      },
    },
  };

  const fil = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${site}/` },
      { '@type': 'ListItem', position: 2, name: `Courtier hypothécaire ${ville}`, item: pageUrl },
    ],
  };

  return [financialService, person, fil];
}
