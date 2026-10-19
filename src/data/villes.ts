// Les pages villes du site, à un seul exemplaire : le pied de page et le bloc « villes voisines »
// de chaque page les lisent d'ici. Ajouter une ville, c'est l'ajouter ici (et à
// pagesTraduites.json, pour sa version anglaise).
//
// `voisines` : les 2 ou 3 villes **les plus proches par la route**, et seulement elles. Un lien vers
// une ville sans rapport (Sherbrooke depuis Saint-Jean-sur-Richelieu) n'aide ni le visiteur ni le
// référencement ; mieux vaut une seule voisine pertinente que trois au hasard. Choisies à la main :
// la distance à vol d'oiseau ignore les rivières et les ponts (elle rapprochait Repentigny de
// Longueuil plutôt que de Montréal).

export interface Ville {
  slug: string;
  nom: string;
  voisines: string[];
}

export const VILLES: Ville[] = [
  { slug: 'repentigny', nom: 'Repentigny', voisines: ['terrebonne', 'mascouche', 'montreal'] },
  { slug: 'terrebonne', nom: 'Terrebonne', voisines: ['mascouche', 'repentigny', 'laval'] },
  { slug: 'mascouche', nom: 'Mascouche', voisines: ['terrebonne', 'repentigny', 'laval'] },
  { slug: 'montreal', nom: 'Montréal', voisines: ['laval', 'longueuil', 'repentigny'] },
  { slug: 'laval', nom: 'Laval', voisines: ['montreal', 'terrebonne', 'mascouche'] },
  { slug: 'longueuil', nom: 'Longueuil', voisines: ['montreal', 'saint-jean-sur-richelieu'] },
  { slug: 'quebec', nom: 'Québec', voisines: ['levis', 'trois-rivieres'] },
  { slug: 'levis', nom: 'Lévis', voisines: ['quebec', 'trois-rivieres'] },
  { slug: 'gatineau', nom: 'Gatineau', voisines: ['montreal', 'laval'] },
  { slug: 'sherbrooke', nom: 'Sherbrooke', voisines: ['saint-jean-sur-richelieu', 'longueuil'] },
  { slug: 'saguenay', nom: 'Saguenay', voisines: ['quebec', 'levis'] },
  { slug: 'trois-rivieres', nom: 'Trois-Rivières', voisines: ['quebec', 'repentigny'] },
  { slug: 'saint-jean-sur-richelieu', nom: 'Saint-Jean-sur-Richelieu', voisines: ['longueuil', 'montreal'] },
];

export function cheminVille(slug: string): string {
  return `/villes/courtier-hypothecaire-${slug}/`;
}

export function villePar(slug: string): Ville | undefined {
  return VILLES.find((v) => v.slug === slug);
}
