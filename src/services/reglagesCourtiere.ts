/**
 * Réglages persistants de la courtière — sa signature et ses valeurs par défaut.
 *
 * Un contrat de courtage, c'est une dizaine de champs qui changent d'un client à l'autre et
 * une quinzaine qui ne changent jamais : le nombre de prêteurs des douze derniers mois, les
 * logiciels utilisés, le collaborateur en assurances, les frais habituels. Les redemander à
 * chaque fois, c'est de la saisie inutile et autant d'occasions de se tromper.
 *
 * Même raisonnement pour la signature : la redessiner à chaque contrat n'apporte rien — ce
 * qui compte juridiquement, c'est qu'elle ait été apposée par elle, et c'est le mot de passe
 * de /contrat qui l'établit.
 *
 * ⚠️ Le tracé de signature stocké ici est la donnée la plus sensible du site. Il est protégé
 * par la même porte que /contrat : qui a le mot de passe peut émettre un contrat portant la
 * signature de Stéphanie. C'est le prix de la commodité, et c'est pourquoi le mot de passe
 * doit rester long et privé.
 *
 * @module reglagesCourtiere
 */

import { CLES_DEFAUTS, type CleDefaut } from '../utils/contratCourtage';
import { creerStockage } from './dossierStockage';
import { decoderTraceSignature } from '../utils/traceSignature';

const stockage = creerStockage('reglages-courtiere', 'reglagesCourtiere');

/** Une seule courtière : un seul enregistrement. */
const CLE = 'courante';

export interface SignatureCourtiere {
  /** Le tracé PNG en base64 (sans le préfixe `data:`). */
  readonly tracePngBase64: string;
  readonly enregistreeLe: string;
}

export interface Reglages {
  signature: SignatureCourtiere | null;
  defauts: Partial<Record<CleDefaut, string>>;
}

const VIDE: Reglages = { signature: null, defauts: {} };

export async function lireReglages(): Promise<Reglages> {
  const brut = await stockage.lire(CLE);
  if (!brut) return { ...VIDE };
  try {
    const lus = JSON.parse(brut) as Partial<Reglages>;
    return {
      signature: lus.signature ?? null,
      // On refiltre à la lecture : un réglage écrit par une version antérieure du catalogue
      // ne doit pas réapparaître dans un formulaire qui ne le connaît plus.
      defauts: filtrerDefauts(lus.defauts ?? {}),
    };
  } catch {
    console.error('[reglagesCourtiere] Enregistrement illisible — réglages ignorés.');
    return { ...VIDE };
  }
}

/** Ne retient que les clés du catalogue, en plafonnant les valeurs. */
export function filtrerDefauts(brut: Record<string, unknown>): Partial<Record<CleDefaut, string>> {
  const propres: Partial<Record<CleDefaut, string>> = {};
  for (const cle of CLES_DEFAUTS) {
    const valeur = brut[cle];
    if (typeof valeur !== 'string') continue;
    const normalisee = valeur.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (normalisee !== '') propres[cle] = normalisee;
  }
  return propres;
}

/**
 * Enregistre la signature. Le PNG est validé ici aussi : ce tracé finira estampé sur des
 * contrats sans repasser par la validation d'une soumission.
 */
export async function enregistrerSignature(dataUrl: unknown): Promise<boolean> {
  const trace = decoderTraceSignature(dataUrl);
  if (!trace) return false;

  const reglages = await lireReglages();
  let binaire = '';
  const TRANCHE = 0x8000;
  for (let i = 0; i < trace.length; i += TRANCHE) {
    binaire += String.fromCharCode(...trace.subarray(i, i + TRANCHE));
  }

  reglages.signature = { tracePngBase64: btoa(binaire), enregistreeLe: new Date().toISOString() };
  await stockage.ecrire(CLE, JSON.stringify(reglages));
  return true;
}

/** Oublie la signature enregistrée — la prochaine création en redemandera une. */
export async function oublierSignature(): Promise<void> {
  const reglages = await lireReglages();
  reglages.signature = null;
  await stockage.ecrire(CLE, JSON.stringify(reglages));
}

/** Remplace les valeurs par défaut du formulaire. */
export async function enregistrerDefauts(brut: Record<string, unknown>): Promise<void> {
  const reglages = await lireReglages();
  reglages.defauts = filtrerDefauts(brut);
  await stockage.ecrire(CLE, JSON.stringify(reglages));
}

/** Le tracé enregistré, décodé — `null` s'il n'y en a pas ou s'il est devenu illisible. */
export function traceEnregistree(reglages: Reglages): Uint8Array | null {
  if (!reglages.signature) return null;
  return decoderTraceSignature(`data:image/png;base64,${reglages.signature.tracePngBase64}`);
}
