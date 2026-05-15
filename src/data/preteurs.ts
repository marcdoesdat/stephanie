/**
 * Base de données des prêteurs hypothécaires canadiens
 *
 * Chaque prêteur est caractérisé par sa méthode de calcul de l'IRD
 * (Interest Rate Differential), ce qui a un impact majeur sur la
 * pénalité de remboursement anticipé.
 *
 * Sources : documentation publique des prêteurs, contrats types,
 * analyses du marché hypothécaire canadien (avril 2026).
 *
 * @module preteurs
 */

import type { Preteur, CategoriePreteur, MethodeIRD } from '../lib/penalite';

// ---------------------------------------------------------------------------
// Prêteurs — Méthode des taux AFFICHÉS (grandes banques)
// Ces institutions utilisent généralement les taux affichés (posted rates)
// comme référence, ce qui produit des pénalités IRD plus élevées.
// ---------------------------------------------------------------------------

const GRANDES_BANQUES: Preteur[] = [
  {
    id: 'rbc',
    nom: 'RBC — Banque Royale du Canada',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'Utilise le taux affiché RBC au moment de la signature pour le terme original ' +
      'comme taux de référence, et le taux affiché actuel pour le terme le plus proche ' +
      'comme taux de comparaison. La marge entre taux affiché et taux contractuel ' +
      'gonfle la pénalité.',
  },
  {
    id: 'td',
    nom: 'TD — Groupe Banque TD',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'Méthode similaire à RBC. Le taux affiché TD à l\'origine est comparé ' +
      'au taux affiché actuel. Le rabais obtenu à la signature n\'est pas pris ' +
      'en compte dans le calcul.',
  },
  {
    id: 'bmo',
    nom: 'BMO — Banque de Montréal',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'Utilise les taux affichés BMO. Le calcul IRD peut varier légèrement ' +
      'selon le produit hypothécaire (Smart Fixed vs conventionnel).',
  },
  {
    id: 'cibc',
    nom: 'CIBC — Banque Canadienne Impériale de Commerce',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
  },
  {
    id: 'scotia',
    nom: 'Banque Scotia',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'La Banque Scotia peut utiliser une méthode hybride pour certains produits ' +
      '(ex. Scotia Total Equity Plan). Vérifiez votre contrat.',
  },
  {
    id: 'bnc',
    nom: 'Banque Nationale du Canada',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'La Banque Nationale utilise généralement les taux affichés. ' +
      'Certains produits spécifiques peuvent avoir des conditions différentes.',
  },
];

// ---------------------------------------------------------------------------
// Prêteurs — Méthode des taux RÉELS / contractuels (monolignes, virtuelles)
// Ces prêteurs utilisent le taux contractuel (réel) comme référence,
// ce qui produit des pénalités IRD nettement plus basses.
// ---------------------------------------------------------------------------

const MONOLIGNES_TAUX_REEL: Preteur[] = [
  {
    id: 'first-national',
    nom: 'First National',
    categorie: 'monoligne',
    methode_ird: 'taux_reel',
    notes:
      'First National utilise le taux contractuel comme référence et le taux ' +
      'actuel du marché pour un terme équivalent. Pénalité généralement beaucoup ' +
      'plus basse que les grandes banques.',
  },
  {
    id: 'mcap',
    nom: 'MCAP',
    categorie: 'monoligne',
    methode_ird: 'taux_reel',
    notes:
      'MCAP utilise une méthode basée sur le taux contractuel. ' +
      'La pénalité est plafonnée dans certaines juridictions — ' +
      'vérifiez votre contrat pour les détails.',
  },
  {
    id: 'manulife',
    nom: 'Manulife Banque',
    categorie: 'banque_secondaire',
    methode_ird: 'taux_reel',
    notes:
      'Manulife Banque utilise le taux d\'intérêt du contrat comme référence, ' +
      'pas le taux affiché. Pénalité IRD généralement plus avantageuse.',
  },
  {
    id: 'rfa',
    nom: 'RFA — Real Estate Financière Amérique',
    categorie: 'monoligne',
    methode_ird: 'taux_reel',
  },
  {
    id: 'strive',
    nom: 'Strive Capital',
    categorie: 'monoligne',
    methode_ird: 'taux_reel',
    notes: 'Prêteur monoligne émergent. Méthode basée sur le taux contractuel.',
  },
];

// ---------------------------------------------------------------------------
// Prêteurs — Méthode mixte ou spécifique
// ---------------------------------------------------------------------------

const PRETEURS_MIXTES: Preteur[] = [
  {
    id: 'desjardins',
    nom: 'Desjardins',
    categorie: 'caisse',
    methode_ird: 'taux_reel',
    notes:
      'Desjardins utilise généralement le taux contractuel comme référence, ' +
      'ce qui est plus avantageux que les grandes banques. Cependant, chaque ' +
      'caisse peut avoir ses particularités. Vérifiez votre contrat.',
  },
  {
    id: 'hsbc',
    nom: 'HSBC Canada',
    categorie: 'grande_banque',
    methode_ird: 'taux_affiche',
    notes:
      'HSBC Canada a été acquise par RBC en 2024. Les prêts en cours conservent ' +
      'leurs conditions d\'origine. Les nouveaux prêts suivent les politiques de RBC.',
  },
  {
    id: 'tangerine',
    nom: 'Tangerine',
    categorie: 'virtuelle',
    methode_ird: 'taux_affiche',
    notes:
      'Filiale de la Banque Scotia. Utilise généralement une méthode basée ' +
      'sur les taux affichés, mais avec des particularités pour les produits ' +
      'sans frais. Vérifiez votre contrat.',
  },
  {
    id: 'equitable',
    nom: 'Equitable Bank',
    categorie: 'banque_secondaire',
    methode_ird: 'taux_reel',
    notes:
      'Equitable Bank (et sa filiale EQ Bank) utilise le taux contractuel ' +
      'comme référence pour le calcul de l\'IRD.',
  },
];

// ---------------------------------------------------------------------------
// Option "Autre / Je ne sais pas" — fallback conservateur
// ---------------------------------------------------------------------------

const AUTRE_PRETEUR: Preteur = {
  id: 'autre',
  nom: 'Autre / Je ne sais pas',
  categorie: 'grande_banque',
  methode_ird: 'taux_affiche',
  notes:
    'Par défaut, nous utilisons la méthode des taux affichés (la plus conservatrice). ' +
    'Si votre prêteur utilise les taux réels, votre pénalité pourrait être ' +
    'significativement plus basse. Vérifiez votre contrat ou contactez Stéphanie.',
};

// ---------------------------------------------------------------------------
// Liste complète
// ---------------------------------------------------------------------------

/** Tous les prêteurs, groupés par catégorie */
export const tousLesPreteurs: Preteur[] = [
  ...GRANDES_BANQUES,
  ...MONOLIGNES_TAUX_REEL,
  ...PRETEURS_MIXTES,
  AUTRE_PRETEUR,
];

/**
 * Recherche un prêteur par son identifiant unique.
 * Retourne `undefined` si aucun prêteur ne correspond.
 */
export function trouverPreteur(id: string): Preteur | undefined {
  return tousLesPreteurs.find((p) => p.id === id);
}

/**
 * Retourne les prêteurs groupés par catégorie pour affichage
 * dans un menu déroulant organisé.
 */
export function preteursParCategorie(): Record<string, Preteur[]> {
  const groupes: Record<string, Preteur[]> = {
    'Grandes banques (6)': GRANDES_BANQUES,
    'Prêteurs monolignes et virtuels': MONOLIGNES_TAUX_REEL,
    'Caisses et autres': PRETEURS_MIXTES,
    '': [AUTRE_PRETEUR],
  };
  return groupes;
}

/** Libellés des catégories de prêteurs (pour affichage UI) */
export const LABELS_CATEGORIES: Record<CategoriePreteur, string> = {
  grande_banque: 'Grande banque',
  banque_secondaire: 'Banque secondaire',
  caisse: 'Caisse',
  monoligne: 'Prêteur monoligne',
  virtuelle: 'Banque virtuelle',
};

/** Libellés des méthodes IRD (pour affichage UI) */
export const LABELS_METHODE_IRD: Record<MethodeIRD, string> = {
  taux_affiche: 'Taux affichés (grandes banques)',
  taux_reel: 'Taux réels / contractuels (monolignes)',
  taux_obligataire: 'Taux obligataire',
};
