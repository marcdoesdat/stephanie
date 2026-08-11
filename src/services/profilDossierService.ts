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
import { empreinteSha256 } from './profilPdfService';

/** Durée de vie d'un dossier en attente. Au-delà, le lien de signature ne vaut plus rien. */
export const DUREE_VIE_MS = 14 * 24 * 60 * 60 * 1000;

const STORE = 'profils-emprunteurs';

/** Comment une signature a été recueillie — déterminant pour la valeur de la preuve. */
export type VoieSignature = 'presence' | 'distance';

export interface SignatureEnregistree {
  /** Le tracé PNG en base64 (sans le préfixe `data:`). */
  readonly tracePngBase64: string;
  readonly signeLe: string;
  readonly voie: VoieSignature;
  readonly ip: string;
  readonly agent: string;
  readonly empreinteTrace: string;
}

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

/* ------------------------------------------------------------------ */
/*  Stockage                                                           */
/* ------------------------------------------------------------------ */

const memoire = new Map<string, string>();

type BlobStore = {
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(): Promise<{ blobs: Array<{ key: string }> }>;
};

async function chargerStore(): Promise<BlobStore | null> {
  if (!process.env.NETLIFY) return null;
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore(STORE) as unknown as BlobStore;
  } catch {
    return null;
  }
}

async function lireBrut(id: string): Promise<string | null> {
  const store = await chargerStore();
  if (!store) return memoire.get(id) ?? null;
  try {
    return await store.get(id, { type: 'text' });
  } catch {
    return null;
  }
}

async function ecrireBrut(id: string, contenu: string): Promise<void> {
  const store = await chargerStore();
  if (!store) {
    memoire.set(id, contenu);
    return;
  }
  try {
    await store.set(id, contenu);
  } catch (err) {
    // Un dossier qu'on ne peut pas écrire est un dossier perdu : le lien de signature ne
    // mènerait nulle part. On remonte l'erreur en la nommant, plutôt que d'échouer plus loin
    // sans savoir que Netlify Blobs est en cause.
    throw new Error(`Écriture du dossier impossible dans Netlify Blobs (${(err as Error)?.message ?? err})`);
  }
}

export async function supprimerDossier(id: string): Promise<void> {
  const store = await chargerStore();
  if (!store) {
    memoire.delete(id);
    return;
  }
  try {
    await store.delete(id);
  } catch {
    // Un dossier qu'on n'arrive pas à supprimer expirera de toute façon.
  }
}

/**
 * Supprime les dossiers périmés. Appelée au passage lors d'une création — le volume est
 * trop faible (quelques dizaines de dossiers vivants) pour justifier une tâche planifiée.
 */
async function purgerExpires(): Promise<void> {
  const store = await chargerStore();
  const maintenant = Date.now();

  if (!store) {
    for (const [id, contenu] of memoire) {
      try {
        if (Date.parse((JSON.parse(contenu) as Dossier).expireLe) < maintenant) memoire.delete(id);
      } catch {
        memoire.delete(id);
      }
    }
    return;
  }

  try {
    const { blobs } = await store.list();
    for (const { key } of blobs) {
      const contenu = await store.get(key, { type: 'text' });
      if (!contenu) continue;
      try {
        if (Date.parse((JSON.parse(contenu) as Dossier).expireLe) < maintenant) await store.delete(key);
      } catch {
        await store.delete(key);
      }
    }
  } catch {
    // Purge best-effort : jamais une raison de faire échouer une soumission.
  }
}

/* ------------------------------------------------------------------ */
/*  Jetons                                                             */
/* ------------------------------------------------------------------ */

function base64url(octets: Uint8Array): string {
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Identifiant de dossier : 16 octets d'aléa, non devinable. */
function nouvelIdentifiant(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Jeton d'invitation : 32 octets d'aléa. N'existe en clair que dans le courriel envoyé. */
function nouveauJeton(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hacher(valeur: string): Promise<string> {
  return empreinteSha256(new TextEncoder().encode(valeur));
}

/** Comparaison à temps constant — évite de distinguer deux jetons par la durée du test. */
function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
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
  await purgerExpires();

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

  await ecrireBrut(id, JSON.stringify(dossier));
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
  if (typeof id !== 'string' || typeof jeton !== 'string') return null;
  if (id.length > 64 || jeton.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;

  const brut = await lireBrut(id);
  if (!brut) return null;

  let dossier: Dossier;
  try {
    dossier = JSON.parse(brut) as Dossier;
  } catch {
    return null;
  }

  if (Date.parse(dossier.expireLe) < Date.now()) {
    await supprimerDossier(id);
    return null;
  }
  if (dossier.statut !== 'en_attente') return null;

  const empreinte = await hacher(jeton);
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
  await ecrireBrut(dossier.id, JSON.stringify(dossier));
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
  await ecrireBrut(dossier.id, JSON.stringify(dossier));
  return dossier;
}

/** Les signataires qui n'ont pas encore signé. */
export function signatairesEnAttente(dossier: Dossier): EntreeSignataire[] {
  return dossier.signataires.filter((s) => s.signature === null);
}
