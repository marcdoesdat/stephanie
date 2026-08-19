/**
 * Les gabarits de courriel, tels que Stéphanie les a réécrits.
 *
 * Le catalogue de `reseauCourtiers.ts` reste la source des **modèles d'origine** : il est
 * versionné, relu, et il sert de whitelist de validation. Mais un texte d'approche vieillit
 * — une formule qui ne prend pas, un argument qui a mieux marché au téléphone — et le faire
 * corriger par un déploiement condamne l'outil à ne jamais s'ajuster. Ce module garde donc
 * ses réécritures par-dessus, sans jamais effacer l'original : « revenir au modèle » reste
 * possible tant que la surcharge n'est qu'une couche.
 *
 * **La portée d'une réécriture est le couple (gabarit, profession)**, parce que c'est ce
 * qu'elle a sous les yeux au moment d'écrire : l'introduction *des notaires*, pas
 * l'introduction en général. Un texte retouché pour un notaire n'a aucune raison de partir
 * ensuite à un comptable.
 *
 * @module reseauGabaritsService
 */

import {
  gabaritPour,
  validerModele,
  type CleGabarit,
  type CleProfession,
} from '../utils/reseauCourtiers';
import { creerStockage } from './dossierStockage';

const stockage = creerStockage('reseau-gabarits', 'reseauGabarits');

/** Une seule courtière : un seul enregistrement, comme `reglagesCourtiere`. */
const CLE = 'courants';

export interface Surcharge {
  readonly objet: string;
  readonly corps: string;
  readonly modifieLe: string;
}

/** Clé de rangement : « introduction:notaire ». */
function cle(gabarit: CleGabarit, profession: CleProfession): string {
  return `${gabarit}:${profession}`;
}

type Surcharges = Record<string, Surcharge>;

async function lireToutes(): Promise<Surcharges> {
  const brut = await stockage.lire(CLE);
  if (!brut) return {};
  try {
    const lues = JSON.parse(brut) as Surcharges;
    return typeof lues === 'object' && lues !== null ? lues : {};
  } catch {
    // Un enregistrement illisible ne doit pas priver l'outil de ses modèles d'origine.
    console.error('[reseauGabarits] Enregistrement illisible — retour aux modèles d’origine.');
    return {};
  }
}

export interface GabaritEffectif {
  readonly objet: string;
  readonly corps: string;
  /** Vrai si le texte vient d'une réécriture, faux s'il vient du catalogue. */
  readonly personnalise: boolean;
}

/**
 * Le texte réellement en vigueur : la réécriture si elle existe, sinon le modèle d'origine.
 *
 * C'est la seule fonction que les appelants doivent connaître — `gabaritPour` ne donne que
 * l'original, et l'employer directement ferait envoyer un texte que l'écran ne montre pas.
 */
export async function gabaritEffectif(
  gabarit: CleGabarit,
  profession: CleProfession,
): Promise<GabaritEffectif> {
  const surcharge = (await lireToutes())[cle(gabarit, profession)];
  if (surcharge) return { objet: surcharge.objet, corps: surcharge.corps, personnalise: true };

  const origine = gabaritPour(gabarit, profession);
  return { objet: origine.objet, corps: origine.corps, personnalise: false };
}

/** Le modèle d'origine, pour l'écran d'édition — ce à quoi « revenir au modèle » ramène. */
export function gabaritOrigine(gabarit: CleGabarit, profession: CleProfession): GabaritEffectif {
  const origine = gabaritPour(gabarit, profession);
  return { objet: origine.objet, corps: origine.corps, personnalise: false };
}

export type ResultatEnregistrement = { ok: true } | { ok: false; erreur: string };

/**
 * Enregistre une réécriture. Le modèle est validé **avant** d'être écrit : un gabarit qui
 * ne se rend pas ferait échouer tous les aperçus suivants, et le seul recours serait de
 * repartir de l'original — c'est-à-dire de perdre le texte qu'elle vient d'écrire.
 */
export async function enregistrerSurcharge(
  gabarit: CleGabarit,
  profession: CleProfession,
  objet: string,
  corps: string,
): Promise<ResultatEnregistrement> {
  for (const texte of [objet, corps]) {
    const verdict = validerModele(texte);
    if (!verdict.ok) return { ok: false, erreur: verdict.erreur };
  }

  const surcharges = await lireToutes();
  surcharges[cle(gabarit, profession)] = { objet, corps, modifieLe: new Date().toISOString() };
  await stockage.ecrire(CLE, JSON.stringify(surcharges));
  return { ok: true };
}

/** Oublie la réécriture : le modèle d'origine reprend effet. */
export async function oublierSurcharge(
  gabarit: CleGabarit,
  profession: CleProfession,
): Promise<void> {
  const surcharges = await lireToutes();
  delete surcharges[cle(gabarit, profession)];
  await stockage.ecrire(CLE, JSON.stringify(surcharges));
}

/** Quels couples (gabarit, profession) portent une réécriture — pour le signaler à l'écran. */
export async function couplesPersonnalises(): Promise<string[]> {
  return Object.keys(await lireToutes());
}
