/**
 * Le carnet de contacts du réseau — les professionnels que Stéphanie approche.
 *
 * Un contact par blob, dans le store `reseau-contacts`. Le socle (Netlify Blobs, repli
 * mémoire en dev, listage) est celui des dossiers de signature — voir `dossierStockage.ts`
 * — **mais sans la purge** : un dossier de signature est un passage, un carnet de contacts
 * est un actif. Rien n'expire ici, et rien n'est supprimé sans que Stéphanie le demande.
 *
 * Ce qui distingue ce module d'un simple stockage :
 *
 * - **L'historique ne se réécrit pas.** Chaque envoi, chaque note, chaque changement d'état
 *   s'y ajoute avec son horodatage. C'est ce qui permet de dire, un an plus tard, ce qui a
 *   été écrit à qui — et c'est aussi ce qui la couvre.
 * - **Un contact retiré ne reçoit plus rien.** `peutRecevoir` est vérifié au moment de
 *   l'envoi, pas seulement à l'affichage.
 *
 * @module reseauContactService
 */

import {
  etatApresEnvoi,
  peutRecevoir,
  type CleEtat,
  type CleGabarit,
  type CleProfession,
  type DonneesContact,
  type MessageSortant,
} from '../utils/reseauCourtiers';
import { creerStockage, egaliteConstante, nouveauJeton, nouvelIdentifiant } from './dossierStockage';

const stockage = creerStockage('reseau-contacts', 'reseauContact');

/* ------------------------------------------------------------------ */
/*  Forme d'un contact                                                 */
/* ------------------------------------------------------------------ */

export type TypeEvenement = 'creation' | 'courriel' | 'note' | 'etat' | 'retrait';

export interface Evenement {
  readonly le: string;
  readonly type: TypeEvenement;
  /** Une ligne lisible dans le journal de la fiche. */
  readonly resume: string;
  /** Pour un envoi : le texte réellement expédié, pas le gabarit. */
  readonly objet?: string;
  readonly corps?: string;
  readonly gabarit?: CleGabarit;
}

export interface Contact {
  readonly id: string;
  readonly creeLe: string;
  majLe: string;
  nom: string;
  courriel: string;
  telephone: string;
  agence: string;
  secteur: string;
  profession: CleProfession;
  notes: string;
  etat: CleEtat;
  consentement: { base: string; source: string; le: string };
  /** La date à laquelle elle veut y revenir. `null` tant qu'elle n'en a pas fixé. */
  relanceLe: string | null;
  dernierEnvoiLe: string | null;
  /**
   * Le jeton du lien de retrait, **en clair**.
   *
   * Les jetons de signature sont stockés hachés parce qu'ils autorisent un acte lourd et
   * qu'ils ne servent qu'une fois. Celui-ci est l'inverse : il n'autorise qu'à cesser de
   * recevoir des courriels, et il doit rester **valide et reproductible** — la loi exige
   * qu'un lien de retrait fonctionne au moins soixante jours après l'envoi, et chaque
   * courriel doit pouvoir le porter à nouveau. Un jeton haché ne pourrait pas être réécrit
   * dans le message suivant ; en régénérer un à chaque envoi tuerait les liens des messages
   * déjà partis, c'est-à-dire exactement ce que la loi interdit.
   */
  jetonRetrait: string;
  historique: Evenement[];
}

/** Ce qui redescend au navigateur. Aujourd'hui : tout — rien ici n'est plus sensible que la fiche elle-même. */
export type FicheContact = Omit<Contact, 'jetonRetrait'>;

/** Retire le jeton de retrait avant de transmettre une fiche à l'écran. */
export function versFiche(contact: Contact): FicheContact {
  const { jetonRetrait: _jeton, ...fiche } = contact;
  return fiche;
}

/* ------------------------------------------------------------------ */
/*  Lecture                                                            */
/* ------------------------------------------------------------------ */

function relire(contenu: string): Contact | null {
  try {
    const lu = JSON.parse(contenu) as Partial<Contact>;
    if (!lu.id || !lu.courriel) return null;
    return {
      ...(lu as Contact),
      // Tolérance aux fiches écrites par une version antérieure : un carnet qui refuse de
      // s'ouvrir parce qu'un champ a été ajouté serait pire que le champ manquant.
      historique: Array.isArray(lu.historique) ? lu.historique : [],
      relanceLe: lu.relanceLe ?? null,
      dernierEnvoiLe: lu.dernierEnvoiLe ?? null,
    };
  } catch {
    return null;
  }
}

export async function lireContact(id: string): Promise<Contact | null> {
  const brut = await stockage.lire(id);
  return brut ? relire(brut) : null;
}

/** Tout le carnet, trié par nom — l'ordre d'urgence est calculé à l'écran, pas ici. */
export async function listerContacts(): Promise<Contact[]> {
  const entrees = await stockage.lister();
  const contacts: Contact[] = [];
  for (const { contenu } of entrees) {
    const contact = relire(contenu);
    if (contact) contacts.push(contact);
  }
  return contacts.sort((a, b) => a.nom.localeCompare(b.nom, 'fr-CA'));
}

/** Combien de courriels sont partis aujourd'hui, tous contacts confondus. Sert au plafond. */
export function envoisDuJour(contacts: Contact[], maintenant = Date.now()): number {
  const debut = new Date(maintenant);
  debut.setHours(0, 0, 0, 0);
  const seuil = debut.getTime();

  let total = 0;
  for (const contact of contacts) {
    for (const evenement of contact.historique) {
      if (evenement.type !== 'courriel') continue;
      const instant = Date.parse(evenement.le);
      if (!Number.isNaN(instant) && instant >= seuil) total += 1;
    }
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Écriture                                                           */
/* ------------------------------------------------------------------ */

async function ecrire(contact: Contact): Promise<Contact> {
  contact.majLe = new Date().toISOString();
  await stockage.ecrire(contact.id, JSON.stringify(contact));
  return contact;
}

function evenement(type: TypeEvenement, resume: string, extra: Partial<Evenement> = {}): Evenement {
  return { le: new Date().toISOString(), type, resume, ...extra };
}

/**
 * Crée une fiche. Refuse une adresse déjà présente : deux fiches pour la même personne,
 * c'est une relance envoyée deux fois et un historique coupé en deux.
 */
export async function creerContact(donnees: DonneesContact): Promise<Contact | { doublon: Contact }> {
  const existants = await listerContacts();
  const doublon = existants.find((c) => c.courriel === donnees.courriel);
  if (doublon) return { doublon };

  const maintenant = new Date().toISOString();
  const contact: Contact = {
    id: nouvelIdentifiant(),
    creeLe: maintenant,
    majLe: maintenant,
    nom: donnees.nom,
    courriel: donnees.courriel,
    telephone: donnees.telephone,
    agence: donnees.agence,
    secteur: donnees.secteur,
    profession: donnees.profession,
    notes: donnees.notes,
    etat: 'a_contacter',
    consentement: { ...donnees.consentement, le: maintenant },
    relanceLe: null,
    dernierEnvoiLe: null,
    jetonRetrait: nouveauJeton(),
    historique: [evenement('creation', 'Fiche créée')],
  };

  return ecrire(contact);
}

/** Met à jour les coordonnées. L'état, lui, ne se change que par `changerEtat`. */
export async function modifierContact(id: string, donnees: DonneesContact): Promise<Contact | null> {
  const contact = await lireContact(id);
  if (!contact) return null;

  contact.nom = donnees.nom;
  contact.courriel = donnees.courriel;
  contact.telephone = donnees.telephone;
  contact.agence = donnees.agence;
  contact.secteur = donnees.secteur;
  contact.profession = donnees.profession;
  contact.notes = donnees.notes;
  // La base du consentement peut évoluer (une relation d'affaires s'est nouée) ; sa date
  // d'origine, non — c'est la date qui date la preuve.
  contact.consentement = { ...donnees.consentement, le: contact.consentement.le };

  return ecrire(contact);
}

export async function supprimerContact(id: string): Promise<void> {
  await stockage.supprimer(id);
}

/**
 * Change l'état à la main (« il m'a rappelée », « il a dit non »).
 *
 * Repasser un contact retiré à un état actif est **refusé** : un retrait est une volonté
 * exprimée par la personne, pas une case que l'on décoche. Seule la suppression de la
 * fiche, ou une nouvelle fiche avec un consentement exprès, la fait sortir de là.
 */
export async function changerEtat(
  id: string,
  etat: CleEtat,
  note = '',
): Promise<Contact | null | { verrouille: true }> {
  const contact = await lireContact(id);
  if (!contact) return null;
  if (contact.etat === 'refuse' && etat !== 'refuse') return { verrouille: true };

  const ancien = contact.etat;
  contact.etat = etat;
  contact.historique.push(
    evenement('etat', note ? `${ancien} → ${etat} · ${note}` : `${ancien} → ${etat}`),
  );
  return ecrire(contact);
}

export async function ajouterNote(id: string, texte: string): Promise<Contact | null> {
  const contact = await lireContact(id);
  if (!contact) return null;
  contact.historique.push(evenement('note', texte));
  return ecrire(contact);
}

/** Fixe (ou efface, avec `null`) la date à laquelle elle veut revenir sur ce contact. */
export async function fixerRelance(id: string, date: string | null): Promise<Contact | null> {
  const contact = await lireContact(id);
  if (!contact) return null;
  contact.relanceLe = date;
  return ecrire(contact);
}

/**
 * Journalise un envoi et fait avancer l'état.
 *
 * Appelée **après** que Resend a accepté le message : journaliser d'abord ferait croire à
 * un envoi qui n'a pas eu lieu, et la relance suivante serait calculée sur du vide.
 */
export async function journaliserEnvoi(
  id: string,
  message: MessageSortant,
  options: { simule?: boolean } = {},
): Promise<Contact | null> {
  const contact = await lireContact(id);
  if (!contact) return null;

  const maintenant = new Date().toISOString();
  contact.dernierEnvoiLe = maintenant;
  contact.etat = etatApresEnvoi(contact.etat);
  // Une relance accomplie n'a plus de raison de rester dans les urgences.
  contact.relanceLe = null;
  // En développement sans Resend, rien n'est parti : le journal doit le dire, sinon il
  // affirmerait un envoi qui n'a jamais eu lieu.
  const entete = options.simule ? 'Courriel simulé (Resend absent) —' : 'Courriel envoyé —';
  contact.historique.push(
    evenement('courriel', `${entete} ${message.objet}`, {
      objet: message.objet,
      corps: message.corps,
      gabarit: message.gabarit,
    }),
  );

  return ecrire(contact);
}

/* ------------------------------------------------------------------ */
/*  Retrait (désabonnement)                                            */
/* ------------------------------------------------------------------ */

/** Le lien porté par chaque courriel. Le jeton n'est pas un secret d'accès : voir `jetonRetrait`. */
export function lienRetrait(contact: Contact, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '');
  return `${base}/api/reseau-retrait?c=${encodeURIComponent(contact.id)}&j=${encodeURIComponent(contact.jetonRetrait)}`;
}

export type ResultatRetrait = 'retire' | 'deja_retire' | 'inconnu';

/**
 * Traite une demande de retrait. **Idempotent** : un lien cliqué deux fois donne deux fois
 * la même réponse rassurante, jamais une erreur — recevoir « lien invalide » après avoir
 * demandé qu'on cesse de vous écrire est la pire réponse possible.
 */
export async function retirerParJeton(id: unknown, jeton: unknown): Promise<ResultatRetrait> {
  if (typeof id !== 'string' || typeof jeton !== 'string') return 'inconnu';
  if (id.length > 64 || jeton.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return 'inconnu';

  const contact = await lireContact(id);
  if (!contact || !egaliteConstante(contact.jetonRetrait, jeton)) return 'inconnu';
  if (!peutRecevoir(contact.etat)) return 'deja_retire';

  contact.etat = 'refuse';
  contact.relanceLe = null;
  contact.historique.push(evenement('retrait', 'Retrait demandé par le lien de désabonnement'));
  await ecrire(contact);
  return 'retire';
}
