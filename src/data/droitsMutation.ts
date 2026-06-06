/**
 * Barèmes municipaux des droits de mutation (taxe de bienvenue) — Québec 2026.
 *
 * Les deux premières tranches provinciales sont fixes pour toutes les villes :
 *   0 $ – 62 900 $   → 0,5 %
 *   62 900 $ – 315 000 $ → 1,0 %
 *
 * La troisième tranche et les suivantes varient selon la municipalité.
 * Source : calculconversion.com, sites municipaux — mise à jour janvier 2026.
 * Les seuils sont indexés annuellement.
 */

export interface TrancheMunicipale {
  max: number;   // borne supérieure (inclusive) ; Infinity pour la dernière
  taux: number;  // décimal (ex. 0.015 = 1,5 %)
}

export interface VilleDroitsMutation {
  value: string;
  label: string;
  /** Tranches à partir de la 3ᵉ (315 000 $+). Les 2 premières sont communes. */
  tranches: TrancheMunicipale[];
  annee?: number;
  source?: string;
}

/** Tranches provinciales par défaut (communes à toutes les villes). */
export const TRANCHES_PROVINCIALES: TrancheMunicipale[] = [
  { max: 62_900,   taux: 0.005 },
  { max: 315_000,  taux: 0.01  },
];

/** Villes dont les tranches municipales sont connues. */
export const VILLES: VilleDroitsMutation[] = [
  // ---- Défaut provincial (3 tranches seulement, pas de surtaxe municipale) ----
  {
    value: 'autres',
    label: 'Autres (taux provincial)',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: Infinity, taux: 0.02  },
    ],
  },

  // ---- Alma ----
  {
    value: 'alma', label: 'Alma',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026, source: 'https://www.ville.alma.qc.ca/',
  },

  // ---- Beaconsfield ----
  {
    value: 'beaconsfield', label: 'Beaconsfield',
    tranches: [
      { max: 615_700, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Blainville ----
  {
    value: 'blainville', label: 'Blainville',
    tranches: [
      { max: 750_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Boisbriand ----
  {
    value: 'boisbriand', label: 'Boisbriand',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 800_000,  taux: 0.02  },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Boucherville ----
  {
    value: 'boucherville', label: 'Boucherville',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Brossard ----
  {
    value: 'brossard', label: 'Brossard',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Candiac ----
  {
    value: 'candiac', label: 'Candiac',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Chambly ----
  {
    value: 'chambly', label: 'Chambly',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Châteauguay ----
  {
    value: 'chateauguay', label: 'Châteauguay',
    tranches: [
      { max: 615_620, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Côte Saint-Luc ----
  {
    value: 'cote-saint-luc', label: 'Côte Saint-Luc',
    tranches: [
      { max: 800_000,    taux: 0.015 },
      { max: 3_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Dollard-Des-Ormeaux ----
  {
    value: 'dollard-des-ormeaux', label: 'Dollard-Des-Ormeaux',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 750_000,  taux: 0.025 },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Drummondville ----
  {
    value: 'drummondville', label: 'Drummondville',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Farnham ----
  {
    value: 'farnham', label: 'Farnham',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 750_000,  taux: 0.025 },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Gatineau ----
  {
    value: 'gatineau', label: 'Gatineau',
    tranches: [
      { max: 750_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Granby ----
  {
    value: 'granby', label: 'Granby',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Hampstead ----
  {
    value: 'hampstead', label: 'Hampstead',
    tranches: [
      { max: 552_300, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Kirkland ----
  {
    value: 'kirkland', label: 'Kirkland',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.02  },
      { max: Infinity,   taux: 0.025 },
    ],
    annee: 2026,
  },

  // ---- L'Assomption ----
  {
    value: 'lassomption', label: "L'Assomption",
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Laval ----
  {
    value: 'laval', label: 'Laval',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Lévis ----
  {
    value: 'levis', label: 'Lévis',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Longueuil (et arrondissements) ----
  {
    value: 'longueuil', label: 'Longueuil',
    tranches: [
      { max: 630_100, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },
  {
    value: 'saint-hubert', label: 'Saint-Hubert',
    tranches: [
      { max: 630_100, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },
  {
    value: 'lemoyne', label: 'Lemoyne',
    tranches: [
      { max: 630_100, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },
  {
    value: 'greenfield-park', label: 'Greenfield Park',
    tranches: [
      { max: 630_100, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Lorraine ----
  {
    value: 'lorraine', label: 'Lorraine',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Magog ----
  {
    value: 'magog', label: 'Magog',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 750_000,    taux: 0.02  },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Mascouche ----
  {
    value: 'mascouche', label: 'Mascouche',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- McMasterville ----
  {
    value: 'mcmasterville', label: 'McMasterville',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Mercier ----
  {
    value: 'mercier', label: 'Mercier',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Mirabel ----
  {
    value: 'mirabel', label: 'Mirabel',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Mont-Saint-Hilaire ----
  {
    value: 'mont-saint-hilaire', label: 'Mont-Saint-Hilaire',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Montréal ----
  {
    value: 'montreal', label: 'Montréal',
    tranches: [
      { max: 552_300,     taux: 0.015 },
      { max: 1_104_700,   taux: 0.02  },
      { max: 2_136_500,   taux: 0.025 },
      { max: 3_113_000,   taux: 0.035 },
      { max: Infinity,    taux: 0.04  },
    ],
    annee: 2026,
  },

  // ---- Mont Tremblant ----
  {
    value: 'mont-tremblant', label: 'Mont Tremblant',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 750_000,  taux: 0.02  },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Morin-Heights ----
  {
    value: 'morin-heights', label: 'Morin-Heights',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Otterburn Park ----
  {
    value: 'otterburn-park', label: 'Otterburn Park',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 750_000,    taux: 0.02  },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Pointe-Claire ----
  {
    value: 'pointe-claire', label: 'Pointe-Claire',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.02  },
      { max: Infinity,   taux: 0.025 },
    ],
    annee: 2025,
  },

  // ---- Québec ----
  {
    value: 'quebec', label: 'Québec',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 750_000,  taux: 0.025 },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Repentigny ----
  {
    value: 'repentigny', label: 'Repentigny',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Rimouski ----
  {
    value: 'rimouski', label: 'Rimouski',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Ripon ----
  {
    value: 'ripon', label: 'Ripon',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.02  },
      { max: 2_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2025,
  },

  // ---- Rosemère ----
  {
    value: 'rosemere', label: 'Rosemère',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Rouyn-Noranda ----
  {
    value: 'rouyn-noranda', label: 'Rouyn-Noranda',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saguenay ----
  {
    value: 'saguenay', label: 'Saguenay',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Sainte-Agathe-des-Monts ----
  {
    value: 'sainte-agathe-des-monts', label: 'Sainte-Agathe-des-Monts',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Bruno ----
  {
    value: 'saint-bruno', label: 'Saint-Bruno',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Colomban ----
  {
    value: 'saint-colomban', label: 'Saint-Colomban',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Sainte-Catherine ----
  {
    value: 'sainte-catherine', label: 'Sainte-Catherine',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Saint-Catherine-De-La-Jacques-Cartier ----
  {
    value: 'saint-catherine-jc', label: 'Saint-Catherine-de-la-Jacques-Cartier',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Constant ----
  {
    value: 'saint-constant', label: 'Saint-Constant',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Saint-Eustache ----
  {
    value: 'saint-eustache', label: 'Saint-Eustache',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Georges ----
  {
    value: 'saint-georges', label: 'Saint-Georges',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Saint-Hyacinthe ----
  {
    value: 'saint-hyacinthe', label: 'Saint-Hyacinthe',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Jean-sur-Richelieu ----
  {
    value: 'saint-jean-sur-richelieu', label: 'Saint-Jean-sur-Richelieu',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Jean-Baptiste ----
  {
    value: 'saint-jean-baptiste', label: 'Saint-Jean-Baptiste',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2025,
  },

  // ---- Saint-Jérôme ----
  {
    value: 'saint-jerome', label: 'Saint-Jérôme',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Lambert ----
  {
    value: 'saint-lambert', label: 'Saint-Lambert',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Lambert-de-Lauzon ----
  {
    value: 'saint-lambert-lauzon', label: 'Saint-Lambert-de-Lauzon',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Saint-Sauveur ----
  {
    value: 'saint-sauveur', label: 'Saint-Sauveur',
    tranches: [
      { max: 500_000,  taux: 0.015 },
      { max: 750_000,  taux: 0.02  },
      { max: Infinity, taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Sainte-Julie ----
  {
    value: 'sainte-julie', label: 'Sainte-Julie',
    tranches: [
      { max: 500_000,    taux: 0.015 },
      { max: 1_000_000,  taux: 0.025 },
      { max: Infinity,   taux: 0.03  },
    ],
    annee: 2026,
  },

  // ---- Sainte-Thérèse ----
  {
    value: 'sainte-therese', label: 'Sainte-Thérèse',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Salaberry-de-Valleyfield ----
  {
    value: 'salaberry-valleyfield', label: 'Salaberry-de-Valleyfield',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Shawinigan ----
  {
    value: 'shawinigan', label: 'Shawinigan',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Sherbrooke ----
  {
    value: 'sherbrooke', label: 'Sherbrooke',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Sorel-Tracy ----
  {
    value: 'sorel-tracy', label: 'Sorel-Tracy',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Terrebonne ----
  {
    value: 'terrebonne', label: 'Terrebonne',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Trois-Rivières ----
  {
    value: 'trois-rivieres', label: 'Trois-Rivières',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Val-David ----
  {
    value: 'val-david', label: 'Val-David',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Val-d'Or ----
  {
    value: 'val-dor', label: "Val-d'Or",
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.02 },  // seulement 2 % (pas 3 %)
    ],
    annee: 2026,
  },

  // ---- Vaudreuil-Dorion ----
  {
    value: 'vaudreuil-dorion', label: 'Vaudreuil-Dorion',
    tranches: [
      { max: 619_300, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Victoriaville ----
  {
    value: 'victoriaville', label: 'Victoriaville',
    tranches: [
      { max: 500_000, taux: 0.015 },
      { max: Infinity, taux: 0.03 },
    ],
    annee: 2026,
  },

  // ---- Moyenne ----
  {
    value: 'moyenne', label: 'Moyenne des municipalités',
    tranches: [
      { max: 525_366,     taux: 0.015  },
      { max: 1_009_100,   taux: 0.028  },
      { max: 1_534_125,   taux: 0.0282 },
      { max: 3_113_000,   taux: 0.0313 },
      { max: Infinity,    taux: 0.04   },
    ],
    annee: 2026,
  },
];

/** Trouve une ville par sa valeur (value). */
export function trouverVille(value: string): VilleDroitsMutation | undefined {
  return VILLES.find(v => v.value === value);
}
