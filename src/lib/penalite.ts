/**
 * Calculateur de pénalité de remboursement anticipé hypothécaire (IRD)
 *
 * Logique métier pure — aucune dépendance UI.
 * Implémente les formules de pénalité de 3 mois d'intérêts et d'IRD
 * (Interest Rate Differential) selon les standards canadiens.
 *
 * @module penalite
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Catégorie de prêteur hypothécaire */
export type CategoriePreteur =
  | 'grande_banque'
  | 'banque_secondaire'
  | 'caisse'
  | 'virtuel'
  | 'virtuelle';

/** Méthode de calcul de l'IRD utilisée par un prêteur */
export type MethodeIRD = 'taux_affiche' | 'taux_reel' | 'taux_obligataire';

/** Type de taux hypothécaire */
export type TypeTaux = 'fixe' | 'variable';

/** Données descriptives d'un prêteur */
export interface Preteur {
  id: string;
  nom: string;
  categorie: CategoriePreteur;
  methode_ird: MethodeIRD;
  notes?: string;
}

/** Termes d'emprunt disponibles pour le calcul du taux le plus proche */
export type Terme = 6 | 12 | 24 | 36 | 48 | 60;

const TERMES_DISPONIBLES: readonly Terme[] = [6, 12, 24, 36, 48, 60] as const;

// ---------------------------------------------------------------------------
// Entrées / Sorties
// ---------------------------------------------------------------------------

/** Données saisies par l'utilisateur dans le formulaire */
export interface PenaliteInput {
  /** Solde hypothécaire restant ($) */
  solde: number;
  /** Taux d'intérêt contractuel annuel (%) */
  tauxContractuel: number;
  /** Date de début du terme courant */
  dateDebutTerme: string; // ISO 8601 (YYYY-MM-DD)
  /** Durée du terme en mois */
  dureeTermeMois: number;
  /** Type de taux : fixe ou variable */
  typeTaux: TypeTaux;
  /** Méthode IRD du prêteur sélectionné */
  methodeIRD: MethodeIRD;
  /** Taux affiché à l'origine pour le terme original (%, optionnel) */
  tauxAfficheOrigine?: number;
  /** Taux actuels du marché par terme (%, clé = durée en mois) */
  tauxMarche: Record<number, number>;
}

/** Résultat complet du calcul de pénalité */
export interface PenaliteResult {
  /** Estimation de la pénalité totale ($) */
  penaliteTotale: number;
  /** Pénalité de 3 mois d'intérêts ($) */
  penalite3Mois: number;
  /** Pénalité IRD ($), 0 si non applicable */
  penaliteIRD: number;
  /** Mois restants au terme */
  moisRestants: number;
  /** Date de fin du terme (YYYY-MM-DD) */
  dateFinTerme: string;
  /** Méthode IRD retenue */
  methodeRetenue: MethodeIRD | 'trois_mois' | 'non_applicable';
  /** Taux de référence utilisé pour l'IRD (%) */
  tauxReference: number | null;
  /** Taux de comparaison utilisé pour l'IRD (%) */
  tauxComparaison: number | null;
  /** Écart de taux (positif) utilisé pour l'IRD (%) */
  ecartTaux: number;
  /** Terme de comparaison retenu (mois) */
  termeComparaison: number | null;
  /** Détail du calcul (texte lisible par l'humain) */
  detailCalcul: string;
  /** Avertissements éventuels */
  avertissements: string[];
}

// ---------------------------------------------------------------------------
// Constantes de validation
// ---------------------------------------------------------------------------

const SOLDE_MIN = 0;
const SOLDE_MAX = 5_000_000;
const TAUX_MIN = 0;
const TAUX_MAX = 20;

// ---------------------------------------------------------------------------
// Fonctions utilitaires pures
// ---------------------------------------------------------------------------

/**
 * Calcule le nombre de mois entiers restants au terme.
 * Retourne 0 si le terme est déjà écoulé.
 */
export function calculerMoisRestants(
  dateDebut: string,
  dureeMois: number,
  dateReference?: Date
): number {
  const debut = new Date(dateDebut + 'T00:00:00');
  const fin = new Date(debut);
  fin.setMonth(fin.getMonth() + dureeMois);

  const ref = dateReference ?? new Date();
  // Normaliser à minuit pour éviter les décalages d'heure
  const refNormalisee = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());

  if (refNormalisee >= fin) return 0;

  const anneesRestantes = fin.getFullYear() - refNormalisee.getFullYear();
  const moisRestants = fin.getMonth() - refNormalisee.getMonth();
  const totalMois = anneesRestantes * 12 + moisRestants;

  // Ajustement pour le jour du mois
  const jourFin = fin.getDate();
  const jourRef = refNormalisee.getDate();
  return jourRef > jourFin ? Math.max(0, totalMois - 1) : Math.max(0, totalMois);
}

/**
 * Retourne le terme disponible le plus proche du nombre de mois restants.
 * Si moisRestants > 60, retourne 60 (5 ans).
 */
export function termeLePlusProche(moisRestants: number): Terme {
  if (moisRestants <= 0) return 6;
  if (moisRestants >= 60) return 60;

  let meilleur: Terme = 6;
  let ecartMin = Infinity;

  for (const terme of TERMES_DISPONIBLES) {
    const ecart = Math.abs(terme - moisRestants);
    // En cas d'égalité, préférer le terme le plus long (plus conservateur)
    if (ecart < ecartMin || (ecart === ecartMin && terme > meilleur)) {
      ecartMin = ecart;
      meilleur = terme;
    }
  }
  return meilleur;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Erreurs de validation retournées par `validerInputs` */
export interface ErreursValidation {
  solde?: string;
  tauxContractuel?: string;
  dateDebutTerme?: string;
  dureeTermeMois?: string;
  tauxAfficheOrigine?: string;
  tauxMarche?: string;
}

/**
 * Valide les entrées utilisateur.
 * Retourne un objet d'erreurs (vide = valide).
 */
export function validerInputs(input: PenaliteInput): ErreursValidation {
  const erreurs: ErreursValidation = {};

  if (isNaN(input.solde) || input.solde < SOLDE_MIN) {
    erreurs.solde = 'Le solde doit être supérieur ou égal à 0 $.';
  } else if (input.solde > SOLDE_MAX) {
    erreurs.solde = 'Le solde ne peut pas dépasser 5 000 000 $.';
  }

  if (isNaN(input.tauxContractuel) || input.tauxContractuel <= TAUX_MIN) {
    erreurs.tauxContractuel = 'Le taux contractuel doit être supérieur à 0 %.';
  } else if (input.tauxContractuel > TAUX_MAX) {
    erreurs.tauxContractuel = 'Le taux contractuel ne peut pas dépasser 20 %.';
  }

  if (!input.dateDebutTerme || isNaN(new Date(input.dateDebutTerme + 'T00:00:00').getTime())) {
    erreurs.dateDebutTerme = 'La date de début du terme est invalide.';
  } else {
    const debut = new Date(input.dateDebutTerme + 'T00:00:00');
    if (debut > new Date()) {
      erreurs.dateDebutTerme = 'La date de début doit être antérieure à aujourd\'hui.';
    }
  }

  if (
    isNaN(input.dureeTermeMois) ||
    input.dureeTermeMois < 12 ||
    input.dureeTermeMois > 120
  ) {
    erreurs.dureeTermeMois = 'La durée du terme doit être entre 1 et 10 ans.';
  }

  if (
    input.methodeIRD === 'taux_affiche' &&
    input.tauxAfficheOrigine !== undefined &&
    (isNaN(input.tauxAfficheOrigine) || input.tauxAfficheOrigine < 0 || input.tauxAfficheOrigine > TAUX_MAX)
  ) {
    erreurs.tauxAfficheOrigine = 'Le taux affiché à l\'origine doit être entre 0 % et 20 %.';
  }

  // Validation des taux du marché
  const tauxKeys = Object.keys(input.tauxMarche);
  if (tauxKeys.length === 0) {
    erreurs.tauxMarche = 'Les taux du marché sont requis.';
  } else {
    for (const [terme, taux] of Object.entries(input.tauxMarche)) {
      if (isNaN(taux) || taux < 0 || taux > TAUX_MAX) {
        erreurs.tauxMarche = `Le taux du marché pour le terme ${terme} mois est invalide.`;
        break;
      }
    }
  }

  return erreurs;
}

// ---------------------------------------------------------------------------
// Calculs de pénalité
// ---------------------------------------------------------------------------

/**
 * Calcule la pénalité de 3 mois d'intérêts.
 * P_3mois = Solde × Taux_contractuel × (3 / 12)
 */
export function calculerPenalite3Mois(solde: number, tauxContractuel: number): number {
  return solde * (tauxContractuel / 100) * (3 / 12);
}

/**
 * Calcule la pénalité IRD.
 *
 * @param solde - Solde hypothécaire restant
 * @param tauxReference - Taux de référence (contractuel ou affiché selon méthode)
 * @param tauxComparaison - Taux de comparaison actuel pour le terme le plus proche
 * @param moisRestants - Mois restants au terme
 * @returns Pénalité IRD ($) ou 0 si écart ≤ 0
 */
export function calculerIRD(
  solde: number,
  tauxReference: number,
  tauxComparaison: number,
  moisRestants: number
): number {
  const ecart = Math.max(0, tauxReference - tauxComparaison);
  if (ecart <= 0 || moisRestants <= 0) return 0;
  return solde * (ecart / 100) * (moisRestants / 12);
}

// ---------------------------------------------------------------------------
// Calcul principal
// ---------------------------------------------------------------------------

/**
 * Calcule la pénalité de remboursement anticipé complète.
 *
 * Règles :
 * - Taux variable → 3 mois d'intérêts seulement
 * - Taux fixe → MAX(3 mois, IRD selon méthode du prêteur)
 * - Si terme écoulé → pénalité = 0
 *
 * @param input - Données saisies par l'utilisateur
 * @param dateReference - Date de référence pour le calcul (par défaut : aujourd'hui)
 * @returns Résultat complet de l'estimation
 */
export function calculerPenalite(
  input: PenaliteInput,
  dateReference?: Date
): PenaliteResult {
  const ref = dateReference ?? new Date();
  const avertissements: string[] = [];

  // 1. Mois restants
  const moisRestants = calculerMoisRestants(input.dateDebutTerme, input.dureeTermeMois, ref);
  const fin = new Date(input.dateDebutTerme + 'T00:00:00');
  fin.setMonth(fin.getMonth() + input.dureeTermeMois);
  const dateFinTerme = fin.toISOString().slice(0, 10);

  // Si le terme est écoulé
  if (moisRestants <= 0) {
    avertissements.push('Le terme est déjà écoulé. Aucune pénalité n\'est applicable.');
    return {
      penaliteTotale: 0,
      penalite3Mois: 0,
      penaliteIRD: 0,
      moisRestants: 0,
      dateFinTerme,
      methodeRetenue: 'non_applicable',
      tauxReference: null,
      tauxComparaison: null,
      ecartTaux: 0,
      termeComparaison: null,
      detailCalcul: 'Terme hypothécaire écoulé — aucune pénalité applicable.',
      avertissements,
    };
  }

  // 2. Pénalité de 3 mois d'intérêts (toujours calculée)
  const penalite3Mois = calculerPenalite3Mois(input.solde, input.tauxContractuel);

  // 3. Si taux variable → 3 mois seulement
  if (input.typeTaux === 'variable') {
    return {
      penaliteTotale: penalite3Mois,
      penalite3Mois,
      penaliteIRD: 0,
      moisRestants,
      dateFinTerme,
      methodeRetenue: 'trois_mois',
      tauxReference: null,
      tauxComparaison: null,
      ecartTaux: 0,
      termeComparaison: null,
      detailCalcul: `Taux variable — seule la pénalité de 3 mois d'intérêts s'applique.\n` +
        `Pénalité = ${formatNombre(input.solde)} $ × ${input.tauxContractuel.toFixed(2)} % × (3 / 12) = ${formatNombre(Math.round(penalite3Mois))} $`,
      avertissements: [
        'Les prêts à taux variable sont généralement assortis d\'une pénalité de 3 mois d\'intérêts seulement. Vérifiez votre contrat pour confirmation.',
      ],
    };
  }

  // 4. Taux fixe → calculer l'IRD
  const termeComparaison = termeLePlusProche(moisRestants);
  const tauxComparaison = input.tauxMarche[termeComparaison] ?? input.tauxMarche[60] ?? 0;

  let tauxReference: number;
  let methodeRetenue: MethodeIRD;
  let descriptionMethode: string;

  switch (input.methodeIRD) {
    case 'taux_affiche':
      // Utilise le taux affiché à l'origine s'il est fourni, sinon fallback au taux contractuel
      tauxReference = input.tauxAfficheOrigine ?? input.tauxContractuel;
      methodeRetenue = 'taux_affiche';
      descriptionMethode = 'Méthode des taux affichés (grandes banques)';
      if (input.tauxAfficheOrigine === undefined) {
        avertissements.push(
          'Le taux affiché à l\'origine n\'a pas été fourni. ' +
          'Le taux contractuel a été utilisé comme référence par défaut, ' +
          'ce qui peut sous-estimer la pénalité réelle.'
        );
      }
      break;

    case 'taux_obligataire':
      // Méthode basée sur le rendement obligataire — approximation par le taux du marché
      tauxReference = input.tauxContractuel;
      methodeRetenue = 'taux_obligataire';
      descriptionMethode = 'Méthode du taux obligataire';
      avertissements.push(
        'La méthode obligataire varie selon l\'institution. ' +
        'Cette estimation utilise le taux contractuel comme référence. ' +
        'La pénalité réelle peut différer.'
      );
      break;

    case 'taux_reel':
    default:
      tauxReference = input.tauxContractuel;
      methodeRetenue = 'taux_reel';
      descriptionMethode = 'Méthode des taux réels/contractuels (prêteurs virtuels)';
      break;
  }

  const penaliteIRD = calculerIRD(input.solde, tauxReference, tauxComparaison, moisRestants);
  const ecartTaux = Math.max(0, tauxReference - tauxComparaison);

  // 5. Pénalité finale = MAX(3 mois, IRD)
  const penaliteTotale = Math.max(penalite3Mois, penaliteIRD);

  // 6. Détail du calcul
  const detailParts: string[] = [];
  detailParts.push(`**Méthode retenue :** ${descriptionMethode}`);
  detailParts.push(`**Mois restants au terme :** ${moisRestants} mois (fin : ${formaterDate(dateFinTerme)})`);
  detailParts.push(`**Terme de comparaison :** ${termeComparaison} mois (${termeComparaison / 12} an${termeComparaison > 12 ? 's' : ''})`);
  detailParts.push('');
  detailParts.push(`**Pénalité de 3 mois d'intérêts :**`);
  detailParts.push(`${formatNombre(input.solde)} $ × ${input.tauxContractuel.toFixed(2)} % × (3/12) = **${formatNombre(Math.round(penalite3Mois))} $**`);
  detailParts.push('');
  detailParts.push(`**Pénalité IRD :**`);
  detailParts.push(`Taux de référence : ${tauxReference.toFixed(2)} %`);
  detailParts.push(`Taux de comparaison (${termeComparaison} mois) : ${tauxComparaison.toFixed(2)} %`);
  detailParts.push(`Écart : ${ecartTaux.toFixed(2)} %`);

  if (ecartTaux <= 0) {
    detailParts.push('Écart ≤ 0 → IRD = 0 $');
  } else {
    detailParts.push(
      `${formatNombre(input.solde)} $ × ${ecartTaux.toFixed(2)} % × (${moisRestants}/12) = **${formatNombre(Math.round(penaliteIRD))} $**`
    );
  }
  detailParts.push('');
  detailParts.push(`**Pénalité estimée : MAX(3 mois, IRD) = ${formatNombre(Math.round(penaliteTotale))} $**`);

  if (ecartTaux <= 0 && penaliteIRD === 0) {
    avertissements.push(
      'Le taux de comparaison actuel est supérieur ou égal au taux de référence. ' +
      'L\'IRD est donc de 0 $ et seule la pénalité de 3 mois d\'intérêts s\'applique.'
    );
  }

  return {
    penaliteTotale,
    penalite3Mois,
    penaliteIRD,
    moisRestants,
    dateFinTerme,
    methodeRetenue,
    tauxReference,
    tauxComparaison,
    ecartTaux,
    termeComparaison,
    detailCalcul: detailParts.join('\n'),
    avertissements,
  };
}

// ---------------------------------------------------------------------------
// Comparaison hypothétique entre deux méthodes IRD
// ---------------------------------------------------------------------------

/** Résultat de la comparaison de pénalité entre deux méthodes */
export interface ComparaisonResult {
  penaliteTauxAffiche: number;
  penaliteTauxReel: number;
  ecart: number;
  ecartPourcentage: number;
  message: string;
}

/**
 * Compare la pénalité entre la méthode des taux affichés (grandes banques)
 * et la méthode des taux réels (prêteurs virtuels), toutes choses égales par ailleurs.
 */
export function comparerMethodes(
  input: PenaliteInput,
  tauxAfficheOrigine: number
): ComparaisonResult | null {
  if (input.typeTaux === 'variable') return null;

  // Méthode taux affichés
  const inputAffiche: PenaliteInput = {
    ...input,
    methodeIRD: 'taux_affiche',
    tauxAfficheOrigine,
  };
  const resultAffiche = calculerPenalite(inputAffiche);

  // Méthode taux réel
  const inputReel: PenaliteInput = {
    ...input,
    methodeIRD: 'taux_reel',
  };
  const resultReel = calculerPenalite(inputReel);

  const ecart = resultAffiche.penaliteTotale - resultReel.penaliteTotale;
  const ecartPct = resultAffiche.penaliteTotale > 0
    ? (ecart / resultAffiche.penaliteTotale) * 100
    : 0;

  let message: string;
  if (ecart > 0) {
    message =
      `Avec un prêteur à taux réel (ex. First National, MCAP), ` +
      `votre pénalité serait approximativement de **${formatNombre(Math.round(resultReel.penaliteTotale))} $** ` +
      `au lieu de **${formatNombre(Math.round(resultAffiche.penaliteTotale))} $**. ` +
      `Écart : **${formatNombre(Math.round(ecart))} $** (${ecartPct.toFixed(0)} % de moins).`;
  } else if (ecart < 0) {
    message =
      `La pénalité avec la méthode des taux réels est supérieure dans ce scénario ` +
      `(${formatNombre(Math.round(resultReel.penaliteTotale))} $ vs ${formatNombre(Math.round(resultAffiche.penaliteTotale))} $). ` +
      `Ceci est inhabituel — vérifiez les taux affichés saisis.`;
  } else {
    message = 'Les deux méthodes donnent une pénalité identique dans ce scénario.';
  }

  return {
    penaliteTauxAffiche: resultAffiche.penaliteTotale,
    penaliteTauxReel: resultReel.penaliteTotale,
    ecart,
    ecartPourcentage: ecartPct,
    message,
  };
}

// ---------------------------------------------------------------------------
// Utilitaires de formatage (sans dépendance DOM)
// ---------------------------------------------------------------------------

/** Formate un nombre en dollars canadiens (sans décimale) */
export function formatNombre(montant: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(montant);
}

/** Formate un montant en dollars canadiens avec symbole */
export function formatArgent(montant: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(montant);
}

/** Formate une date en format lisible (fr-CA) */
export function formaterDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
