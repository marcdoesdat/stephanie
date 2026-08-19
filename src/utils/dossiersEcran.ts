/**
 * Ce que l'écran de suivi décide d'afficher, et dans quel ordre.
 *
 * Extrait de `dossiers.astro` : ces deux règles décident de ce que Stéphanie voit en ouvrant
 * l'écran le matin, et elles vivaient jusqu'ici dans le script d'une page — donc sans test.
 * Le module est **pur** : il reçoit des fiches et une heure, il rend des décisions.
 *
 * Le motif d'urgence est rendu **structuré, pas rédigé** : la phrase française appartient à
 * l'écran, la règle appartient ici. C'est ce qui permet de vérifier « un dossier clos ne
 * remonte jamais » sans dépendre d'une tournure de phrase.
 *
 * @module dossiersEcran
 */

import { ETAPES, type CleEtape, type CleEtatDocument } from './dossiersClients';

/** Le strict nécessaire à ces décisions — la vraie fiche en porte bien davantage. */
export interface FicheEcran {
  readonly etape: CleEtape;
  readonly majLe: string;
  readonly relanceLe: string | null;
  readonly documents: ReadonlyArray<{ readonly etat: CleEtatDocument }>;
}

/* ------------------------------------------------------------------ */
/*  Les trois piles                                                    */
/* ------------------------------------------------------------------ */

export type Vue = 'actifs' | 'prospects' | 'clos';

/**
 * Dans quelle pile une fiche se range.
 *
 * Trois piles plutôt qu'un filtre d'étape de plus : un prospect et un dossier ne demandent pas
 * le même geste, et les mêler ferait de la liste des dossiers un flux où le travail réel se
 * noie dans les curieux de passage.
 */
export function vueDe(fiche: FicheEcran): Vue {
  if (fiche.etape === 'prospect') return 'prospects';
  return ETAPES[fiche.etape].clot ? 'clos' : 'actifs';
}

/* ------------------------------------------------------------------ */
/*  Ce qui réclame un geste aujourd'hui                                */
/* ------------------------------------------------------------------ */

/**
 * Pourquoi une fiche remonte dans « À faire aujourd'hui ».
 *
 * Trois motifs seulement, dans l'ordre où ils coûtent cher :
 *
 * - `relance` — elle s'était fixé d'y revenir, et c'est aujourd'hui ou c'était avant ;
 * - `documents_complets` — tout est reçu et le dossier n'a pas bougé : celui-là attend un
 *   geste **d'elle**, pas du client, et c'est le plus coûteux des trois parce qu'il est
 *   invisible autrement ;
 * - `sans_mouvement` — le dossier dort depuis plus d'une semaine.
 */
export type Urgence =
  | { readonly type: 'relance'; readonly joursDeRetard: number }
  | { readonly type: 'documents_complets' }
  | { readonly type: 'sans_mouvement'; readonly jours: number };

export interface OptionsUrgence {
  /** Au-delà, un dossier sans mouvement remonte. */
  readonly delaiSansMouvementJours: number;
  readonly maintenant?: number;
}

function joursDepuis(iso: string | null, maintenant: number): number | null {
  if (!iso) return null;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return null;
  return Math.floor((maintenant - instant) / 86_400_000);
}

/**
 * Le motif qui fait remonter cette fiche, ou `null` si elle peut attendre.
 *
 * **Un dossier clos ne remonte jamais**, quoi qu'il porte par ailleurs : une relance oubliée
 * sur un dossier financé n'est pas un travail à faire, c'est un reliquat.
 */
export function motifUrgence(fiche: FicheEcran, options: OptionsUrgence): Urgence | null {
  const maintenant = options.maintenant ?? Date.now();
  if (ETAPES[fiche.etape].clot) return null;

  const retard = joursDepuis(fiche.relanceLe, maintenant);
  if (retard !== null && retard >= 0) return { type: 'relance', joursDeRetard: retard };

  // « Analyse » est l'étape où le dossier est entre ses mains à elle : y avoir tous les
  // documents est normal, pas un signal.
  const aFournir = fiche.documents.filter((d) => d.etat === 'a_fournir').length;
  if (fiche.documents.length > 0 && aFournir === 0 && fiche.etape !== 'analyse') {
    return { type: 'documents_complets' };
  }

  const immobile = joursDepuis(fiche.majLe, maintenant);
  if (immobile !== null && immobile >= options.delaiSansMouvementJours) {
    return { type: 'sans_mouvement', jours: immobile };
  }
  return null;
}

/** Le poids d'un motif : plus il est grand, plus la carte remonte. */
function poids(urgence: Urgence): number {
  switch (urgence.type) {
    case 'relance':
      return 3;
    case 'documents_complets':
      return 2;
    case 'sans_mouvement':
      return 1;
  }
}

/** À l'intérieur d'un même motif : le plus en retard d'abord. */
function anciennete(urgence: Urgence): number {
  if (urgence.type === 'relance') return urgence.joursDeRetard;
  if (urgence.type === 'sans_mouvement') return urgence.jours;
  return 0;
}

/**
 * Les fiches qui réclament un geste, **triées par urgence et non par date**.
 *
 * L'ordre de la liste sous-jacente n'a rien à voir avec ce qui presse. Une relance due depuis
 * cinq jours doit passer devant un dossier qui dort depuis huit : l'une est un engagement
 * qu'elle a pris, l'autre un constat.
 */
export function urgences<T extends FicheEcran>(
  fiches: readonly T[],
  options: OptionsUrgence,
): Array<{ readonly fiche: T; readonly urgence: Urgence }> {
  return fiches
    .map((fiche) => ({ fiche, urgence: motifUrgence(fiche, options) }))
    .filter((entree): entree is { fiche: T; urgence: Urgence } => entree.urgence !== null)
    .sort((a, b) => {
      const ecart = poids(b.urgence) - poids(a.urgence);
      return ecart !== 0 ? ecart : anciennete(b.urgence) - anciennete(a.urgence);
    });
}
