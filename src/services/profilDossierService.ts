/**
 * Dossiers « Profil des emprunteurs » en attente de co-signature.
 *
 * Quand un emprunteur remplit le questionnaire seul, les co-emprunteurs doivent signer de
 * leur côté. Le dossier — réponses + signatures déjà recueillies — vit dans Netlify Blobs
 * le temps que tout le monde signe, puis **il est supprimé dès que le PDF est produit**.
 *
 * Ce que la chaîne de signature prouve réellement : le contrôle d'une boîte courriel
 * distincte, rien de plus (voir §7 de PLAN-profil-emprunteurs.md). Les jetons ne sont donc
 * pas un secret d'authentification fort, mais ils sont traités comme tel : 256 bits
 * d'aléa, stockés **hachés**, à usage unique, avec expiration.
 *
 * ⚠️ Un dossier en attente contient des tracés de signature au repos — la donnée la plus
 * sensible du système. D'où l'expiration courte, la suppression immédiate à la complétion,
 * et la purge opportuniste des dossiers périmés.
 *
 * En développement local (sans Netlify Blobs), le stockage retombe sur une Map en mémoire :
 * suffisant pour dérouler le parcours, perdu au redémarrage.
 *
 * @module profilDossierService
 */

import type { ReponsesProfil, Signataire } from '../utils/profilEmprunteurs';
import {
  creerStockage,
  egaliteConstante,
  hacher,
  identifiantPlausible,
  nouveauJeton,
  nouvelIdentifiant,
  type SignatureEnregistree,
} from './dossierStockage';

// Le stockage, les jetons et la forme d'une signature enregistrée sont communs au profil et
// au contrat de courtage : ils vivent dans dossierStockage.ts. Réexportés ici pour que les
// appelants historiques continuent d'importer depuis ce module.
export type { SignatureEnregistree, VoieSignature } from './dossierStockage';

/** Durée de vie d'un dossier en attente. Au-delà, le lien de signature ne vaut plus rien. */
export const DUREE_VIE_MS = 14 * 24 * 60 * 60 * 1000;

const stockage = creerStockage('profils-emprunteurs', 'profilDossier');

export interface EntreeSignataire {
  readonly nom: string;
  readonly courriel: string;
  /** SHA-256 du jeton d'invitation ; `null` pour un signataire ayant signé en présence. */
  jetonHash: string | null;
  signature: SignatureEnregistree | null;
}

export type StatutDossier = 'en_attente' | 'gele';

export interface Dossier {
  readonly id: string;
  readonly creeLe: string;
  readonly expireLe: string;
  statut: StatutDossier;
  readonly reponses: ReponsesProfil;
  signataires: EntreeSignataire[];
  desaccord?: {
    readonly nom: string;
    readonly courriel: string;
    readonly motif: string;
    readonly le: string;
  };
}

/** Un lien à envoyer par courriel : le jeton en clair n'existe qu'ici, jamais en base. */
export interface Invitation {
  readonly nom: string;
  readonly courriel: string;
  readonly dossierId: string;
  readonly jeton: string;
}

/** Supprime un dossier — appelé dès que le PDF est produit. */
export async function supprimerDossier(id: string): Promise<void> {
  await stockage.supprimer(id);
}

/* ------------------------------------------------------------------ */
/*  Cycle de vie                                                       */
/* ------------------------------------------------------------------ */

/**
 * Crée un dossier en attente.
 *
 * @param signaturesPresentes Signatures déjà recueillies sur place, indexées par la position
 *                            du signataire dans `signataires`.
 * @returns Le dossier et la liste des invitations à envoyer (une par signataire manquant).
 */
export async function creerDossier(
  reponses: ReponsesProfil,
  signataires: readonly Signataire[],
  signaturesPresentes: ReadonlyMap<number, SignatureEnregistree>,
): Promise<{ dossier: Dossier; invitations: Invitation[] }> {
  await stockage.purgerExpires();

  const id = nouvelIdentifiant();
  const maintenant = Date.now();
  const invitations: Invitation[] = [];
  const entrees: EntreeSignataire[] = [];

  for (const [index, signataire] of signataires.entries()) {
    const signature = signaturesPresentes.get(index) ?? null;
    if (signature) {
      entrees.push({ ...signataire, jetonHash: null, signature });
      continue;
    }
    const jeton = nouveauJeton();
    entrees.push({ ...signataire, jetonHash: await hacher(jeton), signature: null });
    invitations.push({ nom: signataire.nom, courriel: signataire.courriel, dossierId: id, jeton });
  }

  const dossier: Dossier = {
    id,
    creeLe: new Date(maintenant).toISOString(),
    expireLe: new Date(maintenant + DUREE_VIE_MS).toISOString(),
    statut: 'en_attente',
    reponses,
    signataires: entrees,
  };

  await stockage.ecrire(id, JSON.stringify(dossier));

  // Un dossier écrit mais illisible, ce sont des invitations parties vers des liens morts.
  // On relit avant de laisser /api/profil-submit envoyer quoi que ce soit.
  if (!(await stockage.lire(id))) throw stockage.erreur('dossier introuvable juste après écriture');

  return { dossier, invitations };
}

export interface DossierOuvert {
  readonly dossier: Dossier;
  /** Position du signataire à qui appartient le jeton présenté. */
  readonly index: number;
}

/**
 * Ouvre un dossier à partir d'un couple (identifiant, jeton).
 *
 * Retourne `null` si le dossier n'existe pas, a expiré, a été gelé par un désaccord, ou si
 * le jeton ne correspond à aucun signataire en attente — le jeton étant à usage unique, un
 * signataire qui a déjà signé ne peut plus rouvrir son lien.
 */
export async function ouvrirParJeton(id: unknown, jeton: unknown): Promise<DossierOuvert | null> {
  if (!identifiantPlausible(id, jeton)) return null;
  const identifiant = id as string;

  const brut = await stockage.lire(identifiant);
  if (!brut) return null;

  let dossier: Dossier;
  try {
    dossier = JSON.parse(brut) as Dossier;
  } catch {
    return null;
  }

  if (Date.parse(dossier.expireLe) < Date.now()) {
    await supprimerDossier(identifiant);
    return null;
  }
  if (dossier.statut !== 'en_attente') return null;

  const empreinte = await hacher(jeton as string);
  const index = dossier.signataires.findIndex(
    (s) => s.signature === null && s.jetonHash !== null && egaliteConstante(s.jetonHash, empreinte),
  );
  if (index === -1) return null;

  return { dossier, index };
}

/**
 * Enregistre la signature d'un co-signataire et consomme son jeton.
 * Retourne le dossier mis à jour et s'il est désormais complet.
 */
export async function enregistrerSignature(
  dossier: Dossier,
  index: number,
  signature: SignatureEnregistree,
): Promise<{ dossier: Dossier; complet: boolean }> {
  const entree = dossier.signataires[index];
  if (!entree) throw new Error('Signataire introuvable dans le dossier.');

  entree.signature = signature;
  entree.jetonHash = null; // usage unique : le lien ne rouvrira plus

  const complet = dossier.signataires.every((s) => s.signature !== null);
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return { dossier, complet };
}

/**
 * Gèle le dossier : un signataire n'est pas d'accord avec les réponses. Aucun PDF ne sera
 * produit, tous les liens restants cessent de fonctionner, et Stéphanie est prévenue par
 * l'appelant. Mieux vaut un dossier gelé qu'une signature arrachée.
 */
export async function marquerDesaccord(dossier: Dossier, index: number, motif: string): Promise<Dossier> {
  const entree = dossier.signataires[index];
  if (!entree) throw new Error('Signataire introuvable dans le dossier.');

  dossier.statut = 'gele';
  dossier.desaccord = {
    nom: entree.nom,
    courriel: entree.courriel,
    motif: motif.slice(0, 500),
    le: new Date().toISOString(),
  };
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return dossier;
}

/** Les signataires qui n'ont pas encore signé. */
export function signatairesEnAttente(dossier: Dossier): EntreeSignataire[] {
  return dossier.signataires.filter((s) => s.signature === null);
}
