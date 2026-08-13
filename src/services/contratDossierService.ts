/**
 * Dossiers « Contrat de courtage » en attente de signature.
 *
 * Stéphanie prépare le contrat et le signe ; chaque emprunteur signe ensuite de son côté,
 * par lien nominatif. Le dossier — données du contrat, signature de la courtière et
 * signatures déjà recueillies — vit dans Netlify Blobs le temps que tout le monde signe,
 * puis **il est supprimé dès que le PDF est produit**.
 *
 * Le socle (stockage, jetons, purge) est partagé avec le « Profil des emprunteurs » :
 * voir dossierStockage.ts. Ce module ne porte que ce qui est propre au contrat.
 *
 * @module contratDossierService
 */

import type { DonneesContrat, Emprunteur } from '../utils/contratCourtage';
import {
  creerStockage,
  egaliteConstante,
  hacher,
  identifiantPlausible,
  nouveauJeton,
  nouvelIdentifiant,
  type SignatureEnregistree,
} from './dossierStockage';

export type { SignatureEnregistree, VoieSignature } from './dossierStockage';

/**
 * Durée de vie d'un dossier en attente.
 *
 * Plus courte que pour le profil (14 jours) : un contrat de courtage engage l'emprunteur,
 * et un lien de signature qui traîne un mois est une invitation à signer un contrat dont
 * les conditions ont bougé. Passé ce délai, Stéphanie en régénère un.
 */
export const DUREE_VIE_MS = 10 * 24 * 60 * 60 * 1000;

const stockage = creerStockage('contrats-courtage', 'contratDossier');

export interface EntreeEmprunteur {
  readonly emprunteur: Emprunteur;
  /** SHA-256 du jeton d'invitation ; `null` une fois le jeton consommé. */
  jetonHash: string | null;
  signature: SignatureEnregistree | null;
}

export type StatutDossier = 'en_attente' | 'gele';

export interface DossierContrat {
  readonly id: string;
  readonly creeLe: string;
  readonly expireLe: string;
  statut: StatutDossier;
  readonly donnees: DonneesContrat;
  /** La courtière signe à la création : le contrat part déjà signé de son côté. */
  readonly signatureCourtiere: SignatureEnregistree | null;
  emprunteurs: EntreeEmprunteur[];
  refus?: {
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
 * @param signaturesPresentes Signatures recueillies sur place, indexées par la position de
 *                            l'emprunteur. Les autres reçoivent un lien nominatif.
 * @returns Le dossier et la liste des invitations à envoyer.
 */
export async function creerDossier(
  donnees: DonneesContrat,
  signatureCourtiere: SignatureEnregistree | null,
  signaturesPresentes: ReadonlyMap<number, SignatureEnregistree>,
): Promise<{ dossier: DossierContrat; invitations: Invitation[] }> {
  await stockage.purgerExpires();

  const id = nouvelIdentifiant();
  const maintenant = Date.now();
  const invitations: Invitation[] = [];
  const entrees: EntreeEmprunteur[] = [];

  for (const [index, emprunteur] of donnees.emprunteurs.entries()) {
    const signature = signaturesPresentes.get(index) ?? null;
    if (signature) {
      entrees.push({ emprunteur, jetonHash: null, signature });
      continue;
    }
    const jeton = nouveauJeton();
    entrees.push({ emprunteur, jetonHash: await hacher(jeton), signature: null });
    invitations.push({
      nom: `${emprunteur.prenom} ${emprunteur.nom}`.trim(),
      courriel: emprunteur.courriel,
      dossierId: id,
      jeton,
    });
  }

  const dossier: DossierContrat = {
    id,
    creeLe: new Date(maintenant).toISOString(),
    expireLe: new Date(maintenant + DUREE_VIE_MS).toISOString(),
    statut: 'en_attente',
    donnees,
    signatureCourtiere,
    emprunteurs: entrees,
  };

  await stockage.ecrire(id, JSON.stringify(dossier));

  // Un dossier écrit mais illisible, ce sont des invitations parties vers des liens morts.
  // On relit avant de laisser /api/contrat-creer envoyer quoi que ce soit.
  if (!(await stockage.lire(id))) throw stockage.erreur('dossier introuvable juste après écriture');

  return { dossier, invitations };
}

export interface DossierOuvert {
  readonly dossier: DossierContrat;
  /** Position de l'emprunteur à qui appartient le jeton présenté. */
  readonly index: number;
}

/**
 * Ouvre un dossier à partir d'un couple (identifiant, jeton).
 *
 * Retourne `null` si le dossier n'existe pas, a expiré, a été gelé par un refus, ou si le
 * jeton ne correspond à aucun emprunteur en attente — le jeton étant à usage unique, un
 * emprunteur qui a déjà signé ne peut plus rouvrir son lien.
 */
export async function ouvrirParJeton(id: unknown, jeton: unknown): Promise<DossierOuvert | null> {
  if (!identifiantPlausible(id, jeton)) return null;
  const identifiant = id as string;

  const brut = await stockage.lire(identifiant);
  if (!brut) return null;

  let dossier: DossierContrat;
  try {
    dossier = JSON.parse(brut) as DossierContrat;
  } catch {
    return null;
  }

  if (Date.parse(dossier.expireLe) < Date.now()) {
    await supprimerDossier(identifiant);
    return null;
  }
  if (dossier.statut !== 'en_attente') return null;

  const empreinte = await hacher(jeton as string);
  const index = dossier.emprunteurs.findIndex(
    (e) => e.signature === null && e.jetonHash !== null && egaliteConstante(e.jetonHash, empreinte),
  );
  if (index === -1) return null;

  return { dossier, index };
}

/**
 * Enregistre la signature d'un emprunteur et consomme son jeton.
 * Retourne le dossier mis à jour et s'il est désormais complet.
 */
export async function enregistrerSignature(
  dossier: DossierContrat,
  index: number,
  signature: SignatureEnregistree,
): Promise<{ dossier: DossierContrat; complet: boolean }> {
  const entree = dossier.emprunteurs[index];
  if (!entree) throw new Error('Emprunteur introuvable dans le dossier.');

  entree.signature = signature;
  entree.jetonHash = null; // usage unique : le lien ne rouvrira plus

  const complet = dossier.emprunteurs.every((e) => e.signature !== null);
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return { dossier, complet };
}

/**
 * Gèle le dossier : un emprunteur refuse de signer le contrat tel que rédigé. Aucun PDF ne
 * sera produit, tous les liens restants cessent de fonctionner, et Stéphanie est prévenue
 * par l'appelant. Mieux vaut un dossier gelé qu'une signature arrachée.
 */
export async function marquerRefus(
  dossier: DossierContrat,
  index: number,
  motif: string,
): Promise<DossierContrat> {
  const entree = dossier.emprunteurs[index];
  if (!entree) throw new Error('Emprunteur introuvable dans le dossier.');

  dossier.statut = 'gele';
  dossier.refus = {
    nom: `${entree.emprunteur.prenom} ${entree.emprunteur.nom}`.trim(),
    courriel: entree.emprunteur.courriel,
    motif: motif.slice(0, 500),
    le: new Date().toISOString(),
  };
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return dossier;
}

/** Les emprunteurs qui n'ont pas encore signé. */
export function emprunteursEnAttente(dossier: DossierContrat): EntreeEmprunteur[] {
  return dossier.emprunteurs.filter((e) => e.signature === null);
}
