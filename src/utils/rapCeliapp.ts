// RAP ou CELIAPP — trois façons de bâtir une mise de fonds, comparées : le RAP seul, le
// CELIAPP seul, ou les deux. Pour chacune : la mise de fonds disponible à l'achat, les
// remboursements d'impôt obtenus en route, et ce qu'il faudra remettre ensuite dans le REER.
//
// Honnête avant d'être flatteur :
// - Le remboursement d'impôt est une DIFFÉRENCE d'impôt, impôt(revenu) − impôt(revenu −
//   déduction), fédéral + Québec, année par année. Jamais « taux marginal × déduction », qui
//   se trompe dès qu'une déduction fait changer de palier.
// - L'épargne déjà dans les REER ne produit aucun nouveau remboursement : elle a été déduite
//   l'année de la cotisation. Le RAP la rend seulement accessible sans impôt.
// - Aucun rendement de placement n'est supposé : ce serait un chiffre inventé.
// - Le calcul est PAR PERSONNE : à deux, chacun a ses propres plafonds.
// - Ce qui n'a pas pu être confirmé sur une source officielle n'entre pas dans le calcul.
//
// Fonctions pures : aucun accès au DOM, au stockage ni au réseau. Le composant
// RapCeliappSimulator.astro les appelle dans le navigateur ; rien n'est envoyé ni conservé.

// ---------------------------------------------------------------------------------------------
// Paramètres fiscaux — année d'imposition 2026, vérifiés le 8 novembre 2026
// ---------------------------------------------------------------------------------------------

/** Année des paramètres fiscaux ci-dessous. Les années suivantes sont calculées avec eux. */
export const ANNEE_PARAMETRES = 2026;

export interface Palier {
  /** Revenu imposable jusqu'où s'applique le taux (Infinity pour le dernier palier) */
  plafond: number;
  taux: number;
}

/**
 * Impôt fédéral 2026. Source : ARC, « Taux d'impôt et tranches d'imposition – année en cours »
 * (canada.ca, page du 2026-06-25), et T4032-QC, tableau 1 (en vigueur le 1er janvier 2026).
 * Le premier taux passe à 14 % pour 2026 et les années suivantes (projet de loi C-4, sanction
 * royale le 12 mars 2026 — Finances Canada, « Rapport sur l'incidence de la réduction du taux
 * marginal le plus bas… », juin 2026).
 */
export const PALIERS_FEDERAUX: readonly Palier[] = [
  { plafond: 58_523, taux: 0.14 },
  { plafond: 117_045, taux: 0.205 },
  { plafond: 181_440, taux: 0.26 },
  { plafond: 258_482, taux: 0.29 },
  { plafond: Infinity, taux: 0.33 },
];

/**
 * Montant personnel de base fédéral 2026 : 16 452 $ jusqu'à un revenu net de 181 440 $, réduit
 * en ligne droite jusqu'à 14 829 $ à 258 482 $. Source : ARC, « Ajustements des montants
 * d'impôt et de prestations » (page du 2026-03-12).
 */
export const MPB_FEDERAL = { maximum: 16_452, minimum: 14_829, debutReduction: 181_440, finReduction: 258_482 } as const;

/**
 * Taux des crédits d'impôt non remboursables fédéraux 2026 : le taux le plus bas, 14 %
 * (Finances Canada, rapport de juin 2026, cité plus haut). Le « crédit d'impôt complémentaire »
 * (projet de loi C-15) garde 15 % sur la part des crédits qui dépasse 58 523 $ : le seul crédit
 * du calcul, le montant personnel de base, reste en deçà — il ne s'applique donc jamais ici.
 */
export const TAUX_CREDITS_FEDERAL = 0.14;

/**
 * Abattement du Québec : 16,5 % de l'impôt fédéral de base. Source : ARC, T4032-QC
 * (en vigueur le 1er janvier 2026).
 */
export const ABATTEMENT_QUEBEC = 0.165;

/**
 * Impôt du Québec 2026. Seuils : ministère des Finances du Québec, « Paramètres du régime
 * d'imposition des particuliers pour 2026 » (novembre 2025, tableau 3 : 54 345 $, 108 680 $,
 * 132 245 $ ; indexation de 2,05 %). Taux : Revenu Québec, « Taux d'imposition », table de 2026
 * (14 %, 19 %, 24 %, 25,75 %) — inchangés depuis la baisse de 2023 des deux premiers taux.
 */
export const PALIERS_QUEBEC: readonly Palier[] = [
  { plafond: 54_345, taux: 0.14 },
  { plafond: 108_680, taux: 0.19 },
  { plafond: 132_245, taux: 0.24 },
  { plafond: Infinity, taux: 0.2575 },
];

/**
 * Montant personnel de base du Québec 2026, converti au taux de la première tranche (14 % depuis
 * 2023). Source : ministère des Finances du Québec, « Paramètres… pour 2026 » (tableau 3) et
 * « Dépenses fiscales », fiche 130101 « Crédit d'impôt de base ».
 */
export const MPB_QUEBEC = 18_952;
export const TAUX_CREDITS_QUEBEC = 0.14;

/**
 * CELIAPP : 8 000 $ de droits l'année d'ouverture ; ensuite, 8 000 $ plus les droits reportés,
 * sans dépasser 40 000 $ moins les cotisations passées. Le report est au plus de 8 000 $ et ne
 * commence qu'après l'année d'ouverture — au plus 16 000 $ dans une année. Source : ARC,
 * « Cotiser à votre CELIAPP » (page du 2026-09-17).
 *
 * Au Québec, la déduction admise est celle admise au fédéral : ministère des Finances du
 * Québec, Bulletin d'information 2023-1 (30 janvier 2023), section 2.
 *
 * Le compte se ferme au plus tard le 31 décembre de l'année du 15ᵉ anniversaire de son
 * ouverture (ou des 71 ans, ou de l'année qui suit le premier retrait admissible) — ARC,
 * « Fermer votre CELIAPP ». D'où le plafond de 15 années d'épargne de l'outil.
 */
export const CELIAPP = { droitsAnnuels: 8_000, reportMax: 8_000, plafondVie: 40_000 } as const;

/**
 * RAP : retrait d'au plus 60 000 $ par personne, remboursé dans le REER sur au plus 15 ans,
 * au moins 1/15 par année ; un montant non remboursé s'ajoute au revenu de l'année. Source :
 * ARC, « Le Régime d'accession à la propriété » (page du 2026-02-17) et « Comment rembourser
 * les sommes retirées… » (page du 2026-01-20). Le Québec s'harmonise à la hausse de la limite
 * et à l'allègement du remboursement : Bulletin d'information 2024-5 (18 avril 2024).
 */
export const RAP = { plafondRetrait: 60_000, dureeRemboursement: 15 } as const;

/**
 * Début du remboursement du RAP : en règle générale, la 2ᵉ année qui suit celle du premier
 * retrait. Allègement temporaire : la 5ᵉ année pour un premier retrait fait du 1er janvier 2022
 * au 31 décembre 2028 (ARC, pages citées plus haut ; prolongation pour 2026 à 2028 adoptée le
 * 19 juin 2026 — projet de loi C-30, Finances Canada ; harmonisation québécoise annoncée au
 * Bulletin d'information 2026-4).
 */
export const DEBUT_REMBOURSEMENT_RAP = {
  delaiGeneral: 2,
  allegement: { premiereAnnee: 2022, derniereAnnee: 2028, delai: 5 },
} as const;

/**
 * Droits de cotisation REER de l'année : 18 % du revenu gagné de l'année précédente, au plus
 * 33 810 $ pour 2026 (ARC, « Plafonds CD, REER, RPDB, ALDA et CELI, et MGA », page du
 * 2026-10-28). L'outil suppose le même revenu chaque année et garde le plafond de 2026 pour les
 * suivantes (celui de 2027, 35 390 $, est plus élevé : l'estimation reste prudente). Les droits
 * inutilisés des années passées et le facteur d'équivalence d'un régime de retraite ne sont
 * pas connus de l'outil, donc pas comptés.
 */
export const REER = { tauxDroits: 0.18, plafond: 33_810 } as const;

/** Le nombre d'années d'épargne accepté : au moins une, au plus la durée de vie d'un CELIAPP. */
export const ANNEES = { min: 1, max: 15 } as const;

// ---------------------------------------------------------------------------------------------
// Impôt
// ---------------------------------------------------------------------------------------------

/** Impôt progressif brut sur un revenu imposable, avant crédits. */
export function impotSelonPaliers(revenu: number, paliers: readonly Palier[]): number {
  let impot = 0;
  let plancher = 0;
  for (const { plafond, taux } of paliers) {
    if (revenu <= plancher) break;
    impot += (Math.min(revenu, plafond) - plancher) * taux;
    plancher = plafond;
  }
  return impot;
}

/** Montant personnel de base fédéral selon le revenu net (réduit au-delà de 181 440 $). */
export function montantPersonnelFederal(revenuNet: number): number {
  const { maximum, minimum, debutReduction, finReduction } = MPB_FEDERAL;
  if (revenuNet <= debutReduction) return maximum;
  if (revenuNet >= finReduction) return minimum;
  return maximum - ((maximum - minimum) * (revenuNet - debutReduction)) / (finReduction - debutReduction);
}

/**
 * Impôt fédéral à payer par un résident du Québec : impôt progressif, moins le crédit du montant
 * personnel de base (impôt fédéral de base, jamais négatif), moins l'abattement de 16,5 %.
 */
export function impotFederal(revenu: number): number {
  const r = Math.max(0, revenu);
  const base = Math.max(0, impotSelonPaliers(r, PALIERS_FEDERAUX) - TAUX_CREDITS_FEDERAL * montantPersonnelFederal(r));
  return base * (1 - ABATTEMENT_QUEBEC);
}

/** Impôt du Québec : impôt progressif moins le crédit du montant personnel de base. */
export function impotQuebec(revenu: number): number {
  const r = Math.max(0, revenu);
  return Math.max(0, impotSelonPaliers(r, PALIERS_QUEBEC) - TAUX_CREDITS_QUEBEC * MPB_QUEBEC);
}

export interface Impot {
  federal: number;
  quebec: number;
  total: number;
}

/** Impôt fédéral et québécois sur un revenu imposable — paliers et montants personnels seulement. */
export function impotCombine(revenu: number): Impot {
  const federal = impotFederal(revenu);
  const quebec = impotQuebec(revenu);
  return { federal, quebec, total: federal + quebec };
}

/**
 * L'impôt qu'une déduction fait économiser, cette année : impôt(revenu) − impôt(revenu −
 * déduction). Une déduction plus grande que le revenu ne descend pas sous zéro.
 */
export function economieImpot(revenu: number, deduction: number): Impot {
  const avant = impotCombine(revenu);
  const apres = impotCombine(Math.max(0, revenu - Math.max(0, deduction)));
  return {
    federal: avant.federal - apres.federal,
    quebec: avant.quebec - apres.quebec,
    total: avant.total - apres.total,
  };
}

// ---------------------------------------------------------------------------------------------
// Plafonds des régimes
// ---------------------------------------------------------------------------------------------

/** Droits de cotisation REER d'une année, pour un revenu stable. */
export function droitsReerAnnuels(revenu: number): number {
  return Math.min(REER.tauxDroits * Math.max(0, revenu), REER.plafond);
}

/**
 * Cotisations CELIAPP permises, année par année, pour des sommes voulues — compte ouvert la
 * première année. Droits de l'année : 8 000 $ + report, sans dépasser 40 000 $ moins les
 * cotisations passées ; report de l'année suivante : le moindre de 8 000 $ et de
 * 8 000 $ + report − cotisations de l'année (jamais négatif).
 */
export function planCeliapp(voulues: readonly number[]): number[] {
  const { droitsAnnuels, reportMax, plafondVie } = CELIAPP;
  let report = 0;
  let cumul = 0;
  return voulues.map((voulu) => {
    const droits = Math.max(0, Math.min(droitsAnnuels + report, plafondVie - cumul));
    const cotisation = Math.min(Math.max(0, voulu), droits);
    report = Math.min(reportMax, Math.max(0, droitsAnnuels + report - cotisation));
    cumul += cotisation;
    return cotisation;
  });
}

/** L'année où le remboursement du RAP commence, selon l'année du premier retrait. */
export function debutRemboursementRap(anneeRetrait: number): number {
  const { delaiGeneral, allegement } = DEBUT_REMBOURSEMENT_RAP;
  const allege = anneeRetrait >= allegement.premiereAnnee && anneeRetrait <= allegement.derniereAnnee;
  return anneeRetrait + (allege ? allegement.delai : delaiGeneral);
}

// ---------------------------------------------------------------------------------------------
// Les trois scénarios
// ---------------------------------------------------------------------------------------------

export interface EntreesRapCeliapp {
  /** Revenu annuel brut de la personne, traité comme son revenu imposable */
  revenu: number;
  /** Épargne déjà dans ses REER (déjà déduite : aucun nouveau remboursement) */
  reerActuel: number;
  /** Montant mis de côté chaque année pour la mise de fonds */
  epargneAnnuelle: number;
  /** Nombre d'années d'épargne avant l'achat (1 à 15) */
  annees: number;
  /** Année de la première cotisation — l'achat a lieu `annees` plus tard. Défaut : 2026. */
  anneeDepart?: number;
}

export type CleScenario = 'rap' | 'celiapp' | 'combine';
export const SCENARIOS: readonly CleScenario[] = ['rap', 'celiapp', 'combine'];

export interface Scenario {
  cle: CleScenario;
  /** Cotisations versées en route */
  cotisationsReer: number;
  cotisationsCeliapp: number;
  /** À l'achat : ce qui sort de chaque régime, et l'épargne restée hors régime */
  retraitRap: number;
  retraitCeliapp: number;
  epargneHorsRegime: number;
  miseDeFonds: number;
  /** REER qui ne sort pas par le RAP (au-delà de 60 000 $, ou RAP non utilisé) */
  resteReer: number;
  /** Remboursements d'impôt obtenus en route, toutes années confondues */
  remboursementsFederal: number;
  remboursementsQuebec: number;
  remboursementsImpot: number;
  /** Ensuite : ce qu'il faudra remettre dans le REER, et le minimum annuel */
  aRembourserReer: number;
  remboursementAnnuelMin: number;
  /** Année du premier remboursement RAP ; null sans retrait RAP */
  premiereAnneeRemboursement: number | null;
}

export type MotifRapCeliapp =
  | 'revenu_invalide'
  | 'reer_invalide'
  | 'epargne_invalide'
  | 'annees_invalides'
  | 'rien_a_comparer';

export type ResultatRapCeliapp =
  | {
      ok: true;
      anneeAchat: number;
      droitsReerAnnuels: number;
      scenarios: Record<CleScenario, Scenario>;
    }
  | { ok: false; motif: MotifRapCeliapp };

const montantValide = (n: number) => Number.isFinite(n) && n >= 0;

/** Le motif qui empêche le calcul, ou null si les entrées sont utilisables. */
export function validerEntrees(e: EntreesRapCeliapp): MotifRapCeliapp | null {
  if (!Number.isFinite(e.revenu) || e.revenu <= 0) return 'revenu_invalide';
  if (!montantValide(e.reerActuel)) return 'reer_invalide';
  if (!montantValide(e.epargneAnnuelle)) return 'epargne_invalide';
  if (!Number.isInteger(e.annees) || e.annees < ANNEES.min || e.annees > ANNEES.max) return 'annees_invalides';
  if (e.reerActuel === 0 && e.epargneAnnuelle === 0) return 'rien_a_comparer';
  return null;
}

/**
 * Un scénario, année par année. L'épargne de l'année va d'abord au CELIAPP (s'il est du
 * scénario), puis au REER (s'il l'est) — mais seulement tant que le RAP pourra la retirer :
 * au-delà de 60 000 $ en REER, une cotisation resterait dans le REER au lieu de servir à
 * l'achat. Le reste est de l'épargne ordinaire, disponible pour l'achat, sans effet fiscal.
 */
function simulerScenario(cle: CleScenario, e: EntreesRapCeliapp, anneeAchat: number): Scenario {
  const avecCeliapp = cle !== 'rap';
  const avecReer = cle !== 'celiapp';
  const droitsReer = droitsReerAnnuels(e.revenu);

  let soldeReer = e.reerActuel;
  let cotisationsReer = 0;
  let cotisationsCeliapp = 0;
  let horsRegime = 0;
  let remboursementsFederal = 0;
  let remboursementsQuebec = 0;

  // Le CELIAPP voit toute l'épargne de chaque année : il passe en premier.
  const celiapp = avecCeliapp ? planCeliapp(Array.from({ length: e.annees }, () => e.epargneAnnuelle)) : [];

  for (let i = 0; i < e.annees; i++) {
    let reste = e.epargneAnnuelle;

    const versCeliapp = celiapp[i] ?? 0;
    reste -= versCeliapp;

    let versReer = 0;
    if (avecReer) {
      const espaceRap = Math.max(0, RAP.plafondRetrait - soldeReer);
      versReer = Math.min(reste, droitsReer, espaceRap);
      reste -= versReer;
      soldeReer += versReer;
    }

    const eco = economieImpot(e.revenu, versCeliapp + versReer);
    remboursementsFederal += eco.federal;
    remboursementsQuebec += eco.quebec;
    cotisationsCeliapp += versCeliapp;
    cotisationsReer += versReer;
    horsRegime += reste;
  }

  const retraitRap = avecReer ? Math.min(soldeReer, RAP.plafondRetrait) : 0;
  const retraitCeliapp = cotisationsCeliapp;
  const aRembourserReer = retraitRap;

  return {
    cle,
    cotisationsReer,
    cotisationsCeliapp,
    retraitRap,
    retraitCeliapp,
    epargneHorsRegime: horsRegime,
    miseDeFonds: retraitRap + retraitCeliapp + horsRegime,
    resteReer: soldeReer - retraitRap,
    remboursementsFederal,
    remboursementsQuebec,
    remboursementsImpot: remboursementsFederal + remboursementsQuebec,
    aRembourserReer,
    remboursementAnnuelMin: aRembourserReer / RAP.dureeRemboursement,
    premiereAnneeRemboursement: aRembourserReer > 0 ? debutRemboursementRap(anneeAchat) : null,
  };
}

/** Compare les trois scénarios, ou rend le motif qui empêche de le faire — jamais un NaN. */
export function comparerRapCeliapp(e: EntreesRapCeliapp): ResultatRapCeliapp {
  const motif = validerEntrees(e);
  if (motif) return { ok: false, motif };

  const anneeAchat = (e.anneeDepart ?? ANNEE_PARAMETRES) + e.annees;
  return {
    ok: true,
    anneeAchat,
    droitsReerAnnuels: droitsReerAnnuels(e.revenu),
    scenarios: {
      rap: simulerScenario('rap', e, anneeAchat),
      celiapp: simulerScenario('celiapp', e, anneeAchat),
      combine: simulerScenario('combine', e, anneeAchat),
    },
  };
}

/** Le message affiché pour un motif — phrases fixes, traduites par le dictionnaire anglais. */
export function messageMotif(motif: MotifRapCeliapp): string {
  switch (motif) {
    case 'revenu_invalide':
      return 'Entrez votre revenu annuel brut, en dollars.';
    case 'reer_invalide':
      return "L'épargne déjà dans vos REER doit être un montant en dollars (0 si vous n'en avez pas).";
    case 'epargne_invalide':
      return 'Le montant mis de côté chaque année doit être un montant en dollars (0 si vous ne prévoyez rien).';
    case 'annees_invalides':
      return "Indiquez un nombre d'années entier, de 1 à 15.";
    case 'rien_a_comparer':
      return "Entrez votre épargne REER ou un montant à mettre de côté chaque année : sans épargne, il n'y a rien à comparer.";
  }
}

/**
 * Lit un champ : null s'il est vide, NaN s'il est illisible, sinon le nombre écrit (« 80 000 »,
 * « 80000 », « 1 250,50 », « -5 » compris — c'est la validation qui juge, pas la lecture).
 */
export function lireNombre(saisie: string): number | null {
  const s = saisie.replace(/[\s  $]/g, '').replace(',', '.');
  if (s === '') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
