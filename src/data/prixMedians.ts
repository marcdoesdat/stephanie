// Prix médian des maisons unifamiliales, par page ville — le point de départ du calculateur
// « Combien coûte un achat à … ». **Chaque chiffre vient de l'APCIQ, avec sa période et son
// lien** ; une ville sans chiffre vérifié reste à `null`, et le calculateur s'ouvre alors sur
// un champ vide plutôt que sur un prix deviné. Le secteur est nommé tel que l'APCIQ le publie :
// le chiffre d'une RMR n'est pas celui de la ville, et la page le dit.
//
// À mettre à jour à chaque publication trimestrielle de l'APCIQ.

export interface PrixMedian {
  /** Prix médian, en dollars */
  prix: number;
  /** Secteur tel que publié par l'APCIQ (ville, RMR ou agglomération) */
  secteur: string;
  /** Période couverte, ex. « 3e trimestre 2026 » */
  periode: string;
  /** Lien vers la publication */
  url: string;
}

export const PRIX_MEDIANS: Record<string, PrixMedian | null> = {
  repentigny: null,
  terrebonne: null,
  mascouche: null,
  montreal: null,
  laval: null,
  longueuil: null,
  quebec: null,
  levis: null,
  gatineau: null,
  sherbrooke: null,
  saguenay: null,
  'trois-rivieres': null,
  'saint-jean-sur-richelieu': null,
};
