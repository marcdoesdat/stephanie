/**
 * Ce que le carnet dit du travail, une fois qu'il y en a assez pour le dire.
 *
 * Module **pur** : il reçoit un tableau de fiches et rend des nombres. Aucun stockage, donc
 * testable sans rien simuler, et calculable **dans le navigateur** à partir de la liste que
 * `/dossiers` a déjà chargée — zéro requête de plus, zéro charge serveur.
 *
 * Deux précautions valent d'être dites, parce qu'elles décident de ce que l'écran a le droit
 * d'affirmer :
 *
 * 1. **Les clés, jamais les phrases.** Les durées se reconstruisent depuis les champs `de` et
 *    `vers` des événements d'étape. Les fiches antérieures à leur existence n'en ont pas :
 *    elles sont **ignorées**, pas devinées. Analyser « Demande reçue → Premier contact fait »
 *    pour retrouver les clés casserait au premier libellé retouché.
 * 2. **Un taux calculé sur onze dossiers est pire qu'aucun taux.** `donneesSuffisantes` dit
 *    quand l'écran peut se taire plutôt que d'afficher une conversion de 33 % qui n'est que
 *    le hasard de trois fiches.
 *
 * @module statistiquesDossiers
 */

import { ETAPES, ORDRE_ETAPES, ORIGINES, rangEtape, type CleEtape, type CleOrigine } from './dossiersClients';

/** Le strict nécessaire au calcul — la vraie fiche en porte bien davantage. */
export interface FicheStat {
  readonly creeLe: string;
  readonly etape: CleEtape;
  readonly origine: CleOrigine;
  readonly historique: ReadonlyArray<{
    readonly le: string;
    readonly type: string;
    readonly de?: CleEtape;
    readonly vers?: CleEtape;
  }>;
}

/**
 * En deçà, l'écran doit se taire.
 *
 * Le seuil n'a rien de scientifique : il dit seulement qu'un taux tiré de moins d'une
 * quinzaine de fiches raconte le hasard, pas le travail.
 */
export const SEUIL_LISIBILITE = 15;

export function donneesSuffisantes(fiches: readonly FicheStat[]): boolean {
  return fiches.length >= SEUIL_LISIBILITE;
}

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  if (tries.length % 2 === 1) return tries[milieu]!;
  return (tries[milieu - 1]! + tries[milieu]!) / 2;
}

/* ------------------------------------------------------------------ */
/*  Volume                                                             */
/* ------------------------------------------------------------------ */

export interface MoisOuvertures {
  /** `2026-08`, trié du plus ancien au plus récent. */
  readonly mois: string;
  readonly prospects: number;
  readonly dossiers: number;
}

function cleMois(instant: number): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Combien de fiches se sont ouvertes chaque mois, prospects et dossiers distingués.
 *
 * Les mois sans rien y figurent avec des zéros : un graphique dont les mois vides sont
 * absents comprime le temps et fait passer un creux pour une continuité.
 */
export function ouverturesParMois(
  fiches: readonly FicheStat[],
  nbMois = 6,
  maintenant = Date.now(),
): MoisOuvertures[] {
  const comptes = new Map<string, { prospects: number; dossiers: number }>();

  const debut = new Date(maintenant);
  debut.setDate(1);
  debut.setHours(0, 0, 0, 0);
  for (let i = nbMois - 1; i >= 0; i -= 1) {
    const mois = new Date(debut);
    mois.setMonth(debut.getMonth() - i);
    comptes.set(cleMois(mois.getTime()), { prospects: 0, dossiers: 0 });
  }

  for (const fiche of fiches) {
    const instant = Date.parse(fiche.creeLe);
    if (Number.isNaN(instant)) continue;
    const entree = comptes.get(cleMois(instant));
    if (!entree) continue; // hors de la fenêtre observée
    // Une fiche « née prospect » se reconnaît à son premier événement, pas à son étape
    // d'aujourd'hui : un prospect qualifié depuis reste, ce mois-là, un prospect entré.
    const naissance = fiche.historique.find((e) => e.type === 'creation')?.vers ?? fiche.etape;
    if (naissance === 'prospect') entree.prospects += 1;
    else entree.dossiers += 1;
  }

  return [...comptes].map(([mois, compte]) => ({ mois, ...compte }));
}

/* ------------------------------------------------------------------ */
/*  Rendement par porte d'entrée                                       */
/* ------------------------------------------------------------------ */

export interface RendementOrigine {
  readonly origine: CleOrigine;
  readonly libelle: string;
  readonly total: number;
  /** Fiches ayant dépassé l'étape « prospect » — un contact devenu dossier. */
  readonly qualifies: number;
  readonly finances: number;
  readonly perdus: number;
}

/** L'étape la plus avancée qu'une fiche ait atteinte, par son rang dans la progression. */
export function rangAtteint(fiche: FicheStat): number {
  let rang = rangEtape(fiche.etape);
  for (const evenement of fiche.historique) {
    if (evenement.vers) rang = Math.max(rang, rangEtape(evenement.vers));
  }
  return rang;
}

/**
 * Ce que chaque porte d'entrée produit réellement.
 *
 * **La seule mesure de ce module qui change une décision** : elle distingue le formulaire qui
 * amène du volume de celui qui amène des clients. Un funnel publicitaire qui remplit la liste
 * des prospects sans jamais en qualifier un coûte de l'argent ; la même ligne le dit.
 */
export function rendementParOrigine(fiches: readonly FicheStat[]): RendementOrigine[] {
  const rangQualifie = rangEtape('nouveau');

  return (Object.keys(ORIGINES) as CleOrigine[])
    .map((origine) => {
      const siennes = fiches.filter((f) => f.origine === origine);
      return {
        origine,
        libelle: ORIGINES[origine],
        total: siennes.length,
        qualifies: siennes.filter((f) => rangAtteint(f) >= rangQualifie).length,
        finances: siennes.filter((f) => f.etape === 'finance').length,
        perdus: siennes.filter((f) => f.etape === 'perdu').length,
      };
    })
    .filter((ligne) => ligne.total > 0)
    .sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------ */
/*  Entonnoir et durées                                                */
/* ------------------------------------------------------------------ */

export interface EtageEntonnoir {
  readonly etape: CleEtape;
  readonly libelle: string;
  /** Combien de fiches ont atteint cette étape, aujourd'hui ou par le passé. */
  readonly atteintes: number;
  /** Jours médians passés à cette étape, `null` faute d'assez de transitions datées. */
  readonly joursMedians: number | null;
}

/**
 * L'entonnoir, étage par étape, avec le temps qu'on y passe.
 *
 * Les durées se lisent dans les paires d'événements consécutifs : entrer dans une étape, puis
 * la quitter. Une fiche encore à l'étape ne compte pas — on ne sait pas combien de temps elle
 * y sera restée, et l'inclure raccourcirait artificiellement la médiane.
 */
export function entonnoir(fiches: readonly FicheStat[]): EtageEntonnoir[] {
  const durees = new Map<CleEtape, number[]>();

  for (const fiche of fiches) {
    // Les transitions datées, dans l'ordre. Les événements sans `de`/`vers` — écrits avant
    // que ces champs n'existent — sont ignorés plutôt que devinés.
    const transitions = fiche.historique
      .filter((e) => e.type === 'etape' && e.de && e.vers)
      .map((e) => ({ instant: Date.parse(e.le), de: e.de as CleEtape, vers: e.vers as CleEtape }))
      .filter((t) => !Number.isNaN(t.instant))
      .sort((a, b) => a.instant - b.instant);

    const naissance = Date.parse(fiche.creeLe);
    let entreeDansEtape = Number.isNaN(naissance) ? null : naissance;

    for (const transition of transitions) {
      if (entreeDansEtape !== null) {
        const jours = (transition.instant - entreeDansEtape) / 86_400_000;
        if (jours >= 0) {
          const liste = durees.get(transition.de) ?? [];
          liste.push(jours);
          durees.set(transition.de, liste);
        }
      }
      entreeDansEtape = transition.instant;
    }
  }

  return ORDRE_ETAPES.map((etape) => {
    const rang = rangEtape(etape);
    return {
      etape,
      libelle: ETAPES[etape].libelle,
      atteintes: fiches.filter((f) => rangAtteint(f) >= rang).length,
      joursMedians: mediane(durees.get(etape) ?? []),
    };
  });
}
