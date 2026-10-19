// Les pages villes du site, à un seul exemplaire : le pied de page et le bloc « villes voisines »
// de chaque page les lisent d'ici. Ajouter une ville, c'est l'ajouter ici (et à
// pagesTraduites.json, pour sa version anglaise).
//
// `voisines` sert le maillage interne : un lien dans le texte d'une page proche pèse plus qu'un
// lien de pied de page, et sans lui Gatineau, Sherbrooke et Saguenay n'étaient atteintes par
// aucune page du site hors du pied. Chaque ville doit figurer dans les voisines d'au moins deux
// autres — un test le verrouille.

export interface Ville {
  slug: string;
  nom: string;
  voisines: string[];
}

export const VILLES: Ville[] = [
  { slug: 'repentigny', nom: 'Repentigny', voisines: ['terrebonne', 'mascouche', 'montreal', 'laval'] },
  { slug: 'terrebonne', nom: 'Terrebonne', voisines: ['mascouche', 'repentigny', 'laval', 'montreal'] },
  { slug: 'mascouche', nom: 'Mascouche', voisines: ['terrebonne', 'repentigny', 'laval'] },
  { slug: 'montreal', nom: 'Montréal', voisines: ['laval', 'longueuil', 'repentigny', 'gatineau', 'trois-rivieres'] },
  { slug: 'laval', nom: 'Laval', voisines: ['montreal', 'terrebonne', 'mascouche', 'gatineau'] },
  { slug: 'longueuil', nom: 'Longueuil', voisines: ['montreal', 'saint-jean-sur-richelieu', 'sherbrooke'] },
  { slug: 'quebec', nom: 'Québec', voisines: ['levis', 'saguenay', 'trois-rivieres'] },
  { slug: 'levis', nom: 'Lévis', voisines: ['quebec', 'sherbrooke', 'trois-rivieres'] },
  { slug: 'gatineau', nom: 'Gatineau', voisines: ['montreal', 'laval'] },
  { slug: 'sherbrooke', nom: 'Sherbrooke', voisines: ['longueuil', 'saint-jean-sur-richelieu', 'trois-rivieres', 'levis'] },
  { slug: 'saguenay', nom: 'Saguenay', voisines: ['quebec', 'levis', 'trois-rivieres'] },
  { slug: 'trois-rivieres', nom: 'Trois-Rivières', voisines: ['quebec', 'montreal', 'sherbrooke', 'saguenay'] },
  { slug: 'saint-jean-sur-richelieu', nom: 'Saint-Jean-sur-Richelieu', voisines: ['longueuil', 'montreal', 'sherbrooke'] },
];

export function cheminVille(slug: string): string {
  return `/villes/courtier-hypothecaire-${slug}/`;
}

export function villePar(slug: string): Ville | undefined {
  return VILLES.find((v) => v.slug === slug);
}
