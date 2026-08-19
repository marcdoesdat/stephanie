/**
 * Le carnet des dossiers clients — ce que Stéphanie suit, et ce que le client consulte.
 *
 * Un dossier par blob, dans le store `dossiers-clients`. Le socle (Netlify Blobs, repli
 * mémoire en dev, listage, jetons) est celui des dossiers de signature — voir
 * `dossierStockage.ts`.
 *
 * Ce qui distingue ce module des deux carnets qui l'ont précédé :
 *
 * - **Il a deux lecteurs.** `versFiche` sert l'écran de la courtière, `versVueClient` sert le
 *   portail. La seconde ne porte ni notes internes, ni jeton, ni étape interne — et elle ne
 *   rend **rien du tout** pour un dossier `perdu`, ce qui rend la règle structurelle plutôt
 *   que conventionnelle : le portail ne peut pas afficher ce qu'il n'a pas reçu.
 * - **Il se purge.** Le carnet du réseau ne purge rien, parce qu'un contact professionnel est
 *   un actif. Un dossier client, lui, est nominatif et financier : douze mois après sa
 *   clôture, il est supprimé. Le registre officiel est celui d'Hypotheca ; ceci est un outil
 *   de suivi, et un outil de suivi n'a aucune raison de garder trace d'un client d'il y a
 *   cinq ans.
 * - **L'état des documents n'appartient qu'à elle.** Aucune fonction de ce module n'est
 *   appelée depuis une route publique : le client lit sa liste, il ne la coche pas. Un client
 *   qui se déclare à jour ne l'est pas.
 *
 * Comme `reseauContactService`, **l'historique ne se réécrit pas** : étapes, documents, notes
 * et courriels s'y ajoutent avec leur horodatage.
 *
 * @module dossierClientService
 */

import {
  CONSENTEMENT_PAR_ORIGINE,
  DOCUMENTS,
  ETAPES,
  ETAPE_INITIALE,
  ETATS_DOCUMENT,
  ORIGINES,
  cleTelephone,
  documentsRequis,
  etapeClot,
  normaliserCourriel,
  type CleConsentement,
  type CleDestinataire,
  type CleDocument,
  type CleEtape,
  type CleEtatDocument,
  type CleOrigine,
  type DonneesDossier,
  type ProfilDemande,
} from '../utils/dossiersClients';
import {
  creerStockage,
  egaliteConstante,
  hacher,
  identifiantPlausible,
  nouveauJeton,
  nouvelIdentifiant,
} from './dossierStockage';

const stockage = creerStockage('dossiers-clients', 'dossierClient');

/**
 * Durée de vie d'un lien magique. Court : il ne sert qu'à ouvrir une session, et il voyage
 * par courriel — c'est-à-dire qu'il traîne ensuite dans une boîte de réception pour toujours.
 */
export const DUREE_LIEN_MS = 30 * 60 * 1000;

/** Douze mois après la clôture, le dossier est supprimé. Voir l'entête du module. */
export const DUREE_CONSERVATION_CLOS_MS = 365 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Forme d'un dossier                                                 */
/* ------------------------------------------------------------------ */

export type TypeEvenement = 'creation' | 'etape' | 'document' | 'note' | 'courriel' | 'acces';

export interface Evenement {
  readonly le: string;
  readonly type: TypeEvenement;
  /** Une ligne lisible dans le journal de la fiche. */
  readonly resume: string;
  /**
   * Pour un changement d'étape : les clés, en plus de la phrase française.
   *
   * Le `resume` dit « Demande reçue → Premier contact fait » ; l'analyser pour retrouver les
   * clés casserait au premier libellé retouché. Les statistiques lisent donc ces deux champs,
   * et **ignorent** les événements qui n'en ont pas — ceux écrits avant leur existence —
   * plutôt que de deviner.
   */
  readonly de?: CleEtape;
  readonly vers?: CleEtape;
}

export interface LigneDocument {
  readonly cle: CleDocument;
  readonly pourQui: CleDestinataire;
  etat: CleEtatDocument;
  readonly ajouteLe: string;
  majLe: string;
}

export interface DossierClient {
  readonly id: string;
  readonly creeLe: string;
  majLe: string;
  nom: string;
  courriel: string;
  telephone: string;
  /** Le bloc-notes de Stéphanie. **Ne descend jamais au portail client.** */
  notes: string;
  profil: ProfilDemande;
  /** Par quelle porte la fiche est entrée. Ne se modifie jamais — c'est un fait, pas un champ. */
  readonly origine: CleOrigine;
  /** Sur quoi repose le droit de la rappeler. Affiché sur la fiche. */
  consentement: CleConsentement;
  /** Le contact du réseau qui a référé cette personne, s'il y en a un. */
  refereParId: string | null;
  etape: CleEtape;
  documents: LigneDocument[];
  /** La date à laquelle elle veut y revenir. `null` tant qu'elle n'en a pas fixé. */
  relanceLe: string | null;
  /** Posée quand l'étape devient terminale ; sert de point de départ à la purge. */
  clotLe: string | null;
  /** Le lien magique en cours, haché. `null` dès qu'il est consommé. */
  acces: { jetonHash: string; expireLe: string } | null;
  historique: Evenement[];
}

/** Ce qui redescend à l'écran de la courtière : tout, sauf le jeton d'accès du client. */
export type FicheDossier = Omit<DossierClient, 'acces'>;

/** Retire le jeton d'accès avant de transmettre une fiche à l'écran. */
export function versFiche(dossier: DossierClient): FicheDossier {
  const { acces: _acces, ...fiche } = dossier;
  return fiche;
}

/**
 * Ce que le portail client reçoit.
 *
 * ⚠️ Ni notes internes, ni jeton, ni relance, ni historique interne — et **rien du tout**
 * pour un dossier dont l'étape n'est pas destinée au client.
 */
export interface VueClient {
  readonly nom: string;
  readonly etape: CleEtape;
  readonly majLe: string;
  readonly clos: boolean;
  readonly documents: ReadonlyArray<{
    readonly cle: CleDocument;
    readonly pourQui: CleDestinataire;
    readonly etat: CleEtatDocument;
  }>;
}

/**
 * Traduit un dossier en vue client, ou `null` si le client n'a rien à voir.
 *
 * Les lignes `non_requis` sont écartées : une pièce que Stéphanie a jugée inutile n'a aucune
 * raison de figurer dans la liste de celui qui doit la réunir — elle n'y ajouterait que du
 * doute.
 */
export function versVueClient(dossier: DossierClient): VueClient | null {
  if (!ETAPES[dossier.etape].visibleClient) return null;

  return {
    nom: dossier.nom,
    etape: dossier.etape,
    majLe: dossier.majLe,
    clos: etapeClot(dossier.etape),
    documents: dossier.documents
      .filter((ligne) => ligne.etat !== 'non_requis')
      .map((ligne) => ({ cle: ligne.cle, pourQui: ligne.pourQui, etat: ligne.etat })),
  };
}

/* ------------------------------------------------------------------ */
/*  Lecture                                                            */
/* ------------------------------------------------------------------ */

function relire(contenu: string): DossierClient | null {
  try {
    const lu = JSON.parse(contenu) as Partial<DossierClient>;
    // Le nom, et non le courriel : une fiche référée par un partenaire n'arrive qu'avec un
    // téléphone, et la refuser ici la rendrait invisible au listage — donc au dédoublonnage,
    // à l'écran et à la purge. Un dossier fantôme, écrit mais illisible.
    if (!lu.id || !lu.nom) return null;
    return {
      ...(lu as DossierClient),
      // Tolérance aux dossiers écrits par une version antérieure : un carnet qui refuse de
      // s'ouvrir parce qu'un champ a été ajouté serait pire que le champ manquant.
      documents: Array.isArray(lu.documents) ? lu.documents : [],
      historique: Array.isArray(lu.historique) ? lu.historique : [],
      profil: lu.profil ?? {},
      origine: lu.origine ?? 'manuel',
      consentement: lu.consentement ?? 'expresse',
      refereParId: lu.refereParId ?? null,
      etape: lu.etape ?? 'nouveau',
      relanceLe: lu.relanceLe ?? null,
      clotLe: lu.clotLe ?? null,
      acces: lu.acces ?? null,
    };
  } catch {
    return null;
  }
}

export async function lireDossier(id: string): Promise<DossierClient | null> {
  const brut = await stockage.lire(id);
  return brut ? relire(brut) : null;
}

/** Tout le carnet, du plus récemment remué au plus ancien. L'urgence se calcule à l'écran. */
export async function listerDossiers(): Promise<DossierClient[]> {
  const dossiers: DossierClient[] = [];
  for (const { contenu } of await stockage.lister()) {
    const dossier = relire(contenu);
    if (dossier) dossiers.push(dossier);
  }
  return dossiers.sort((a, b) => Date.parse(b.majLe) - Date.parse(a.majLe));
}

/** Le dossier d'une adresse donnée. Sert au portail, qui ne connaît que le courriel. */
export async function trouverParCourriel(courriel: string): Promise<DossierClient | null> {
  const cible = normaliserCourriel(courriel);
  if (!cible) return null;
  const dossiers = await listerDossiers();
  return dossiers.find((d) => d.courriel === cible) ?? null;
}

/**
 * La fiche déjà présente pour cette personne, s'il y en a une.
 *
 * L'adresse d'abord, le téléphone à défaut : une référence de partenaire n'a pas d'adresse,
 * et deux fiches pour la même personne, c'est un suivi coupé en deux et deux rappels au même
 * numéro. Le rapprochement par téléphone ne sert qu'en dernier recours — deux conjoints
 * partagent parfois une ligne, et on préfère rater un doublon qu'en fabriquer un.
 */
export async function trouverExistant(
  courriel: string,
  telephone: string,
): Promise<DossierClient | null> {
  const dossiers = await listerDossiers();

  const parCourriel = normaliserCourriel(courriel);
  if (parCourriel) {
    const trouve = dossiers.find((d) => d.courriel === parCourriel);
    if (trouve) return trouve;
    // Une adresse fournie qui ne correspond à rien tranche : on ne va pas chercher plus loin
    // par téléphone, au risque de rattacher deux personnes d'un même foyer.
    return null;
  }

  const parTelephone = cleTelephone(telephone);
  if (!parTelephone) return null;
  return dossiers.find((d) => cleTelephone(d.telephone) === parTelephone) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Écriture                                                           */
/* ------------------------------------------------------------------ */

async function ecrire(dossier: DossierClient): Promise<DossierClient> {
  dossier.majLe = new Date().toISOString();
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return dossier;
}

function evenement(type: TypeEvenement, resume: string, extra: Partial<Evenement> = {}): Evenement {
  return { le: new Date().toISOString(), type, resume, ...extra };
}

function nommer(cle: CleDocument, pourQui: CleDestinataire): string {
  const libelle = DOCUMENTS[cle].libelle;
  return pourQui === 'dossier' ? libelle : `${libelle} (${pourQui === 'co_emprunteur' ? 'co-emprunteur' : 'emprunteur'})`;
}

/**
 * Supprime les dossiers clos depuis plus de douze mois. Appelée au passage lors d'une
 * création — le volume est trop faible pour justifier une tâche planifiée, et le socle fait
 * de même pour les dossiers de signature.
 */
export async function purgerClosAnciens(maintenant = Date.now()): Promise<void> {
  try {
    for (const { id, contenu } of await stockage.lister()) {
      const dossier = relire(contenu);
      if (!dossier?.clotLe) continue;
      const clot = Date.parse(dossier.clotLe);
      if (!Number.isNaN(clot) && maintenant - clot > DUREE_CONSERVATION_CLOS_MS) {
        await stockage.supprimer(id);
      }
    }
  } catch {
    // Purge best-effort : jamais une raison de faire échouer une création.
  }
}

/** Fabrique les lignes de checklist correspondant à un profil, horodatées. */
function semerChecklist(profil: ProfilDemande, maintenant: string): LigneDocument[] {
  return documentsRequis(profil).map((requis) => ({
    cle: requis.cle,
    pourQui: requis.pourQui,
    etat: 'a_fournir' as const,
    ajouteLe: maintenant,
    majLe: maintenant,
  }));
}

/** Ce que l'appelant sait de l'entrée, et que la fiche ne peut pas déduire d'elle-même. */
export interface ContexteCreation {
  readonly origine: CleOrigine;
  /** Par défaut, la base attachée à l'origine. Ne surcharger qu'en connaissance de cause. */
  readonly consentement?: CleConsentement;
  /** Le contact du réseau à l'origine de la référence, le cas échéant. */
  readonly refereParId?: string;
}

/**
 * Ouvre une fiche. Refuse un doublon : deux fiches pour la même personne, c'est un suivi
 * coupé en deux et un client qui reçoit deux listes de documents différentes.
 *
 * L'étape de départ dépend de la porte d'entrée (`ETAPE_INITIALE`), et **la checklist n'est
 * semée que pour un vrai dossier** : coller douze pièces à réunir sur quelqu'un qui a
 * seulement demandé le calcul de son versement serait absurde, et rendrait l'écran des
 * prospects illisible.
 */
export async function creerDossier(
  donnees: DonneesDossier,
  contexte: ContexteCreation = { origine: 'manuel' },
): Promise<DossierClient | { doublon: DossierClient }> {
  const existant = await trouverExistant(donnees.courriel, donnees.telephone);
  if (existant) return { doublon: existant };

  await purgerClosAnciens();

  const maintenant = new Date().toISOString();
  const etape = ETAPE_INITIALE[contexte.origine];

  const dossier: DossierClient = {
    id: nouvelIdentifiant(),
    creeLe: maintenant,
    majLe: maintenant,
    nom: donnees.nom,
    courriel: donnees.courriel,
    telephone: donnees.telephone,
    notes: donnees.notes,
    profil: donnees.profil,
    origine: contexte.origine,
    consentement: contexte.consentement ?? CONSENTEMENT_PAR_ORIGINE[contexte.origine],
    refereParId: contexte.refereParId ?? null,
    etape,
    documents: etape === 'prospect' ? [] : semerChecklist(donnees.profil, maintenant),
    relanceLe: null,
    clotLe: null,
    acces: null,
    historique: [
      evenement(
        'creation',
        `${etape === 'prospect' ? 'Prospect entré' : 'Dossier ouvert'} — ${ORIGINES[contexte.origine]}`,
        { vers: etape },
      ),
    ],
  };

  return ecrire(dossier);
}

/** Met à jour les coordonnées et le profil. L'étape, elle, ne change que par `changerEtape`. */
export async function modifierDossier(id: string, donnees: DonneesDossier): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;

  dossier.nom = donnees.nom;
  dossier.courriel = donnees.courriel;
  dossier.telephone = donnees.telephone;
  dossier.notes = donnees.notes;
  dossier.profil = donnees.profil;

  return ecrire(dossier);
}

export async function supprimerDossier(id: string): Promise<void> {
  await stockage.supprimer(id);
}

/**
 * Change l'étape.
 *
 * Contrairement au carnet du réseau, où un contact retiré ne se rouvre pas, **un dossier
 * marqué « non abouti » peut revenir en arrière** : là-bas l'état exprime la volonté d'un
 * tiers, ici il n'exprime que le jugement de Stéphanie sur son propre dossier. Le verrouiller
 * ne protégerait personne et lui coûterait un dossier à recréer chaque fois qu'elle se
 * trompe de bouton.
 */
export async function changerEtape(id: string, etape: CleEtape, note = ''): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;

  const ancienne = dossier.etape;
  if (ancienne === etape) return dossier;

  dossier.etape = etape;
  dossier.clotLe = etapeClot(etape) ? (dossier.clotLe ?? new Date().toISOString()) : null;
  // Une étape franchie règle la relance qui l'attendait.
  dossier.relanceLe = null;

  const trace = `${ETAPES[ancienne].libelle} → ${ETAPES[etape].libelle}`;
  dossier.historique.push(
    evenement('etape', note ? `${trace} · ${note}` : trace, { de: ancienne, vers: etape }),
  );

  // La qualification est le moment où la checklist prend son sens : c'est là que la fiche
  // cesse d'être un nom et devient un dossier. On ne sème que si la liste est vide — une
  // liste déjà travaillée à la main ne doit pas être écrasée par un aller-retour d'étape.
  if (ancienne === 'prospect' && etape !== 'prospect' && dossier.documents.length === 0) {
    const seme = semerChecklist(dossier.profil, new Date().toISOString());
    if (seme.length > 0) {
      dossier.documents = seme;
      dossier.historique.push(
        evenement('document', `Liste de documents établie (${seme.length} pièces)`),
      );
    }
  }

  return ecrire(dossier);
}

/** Ajoute une pièce à la checklist, si elle n'y est pas déjà pour la même personne. */
export async function ajouterDocument(
  id: string,
  cle: CleDocument,
  pourQui: CleDestinataire,
): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;
  if (dossier.documents.some((l) => l.cle === cle && l.pourQui === pourQui)) return dossier;

  const maintenant = new Date().toISOString();
  dossier.documents.push({ cle, pourQui, etat: 'a_fournir', ajouteLe: maintenant, majLe: maintenant });
  dossier.historique.push(evenement('document', `Ajouté à la liste : ${nommer(cle, pourQui)}`));
  return ecrire(dossier);
}

export async function retirerDocument(
  id: string,
  cle: CleDocument,
  pourQui: CleDestinataire,
): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;

  const avant = dossier.documents.length;
  dossier.documents = dossier.documents.filter((l) => !(l.cle === cle && l.pourQui === pourQui));
  if (dossier.documents.length === avant) return dossier;

  dossier.historique.push(evenement('document', `Retiré de la liste : ${nommer(cle, pourQui)}`));
  return ecrire(dossier);
}

/** Coche (ou décoche) une pièce. **Seule la courtière passe par ici** — voir l'entête. */
export async function marquerDocument(
  id: string,
  cle: CleDocument,
  pourQui: CleDestinataire,
  etat: CleEtatDocument,
): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;

  const ligne = dossier.documents.find((l) => l.cle === cle && l.pourQui === pourQui);
  if (!ligne) return null;
  if (ligne.etat === etat) return dossier;

  ligne.etat = etat;
  ligne.majLe = new Date().toISOString();
  dossier.historique.push(
    evenement('document', `${nommer(cle, pourQui)} : ${ETATS_DOCUMENT[etat].toLowerCase()}`),
  );
  return ecrire(dossier);
}

export async function ajouterNote(id: string, texte: string): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;
  dossier.historique.push(evenement('note', texte));
  return ecrire(dossier);
}

/** Fixe (ou efface, avec `null`) la date à laquelle elle veut revenir sur ce dossier. */
export async function fixerRelance(id: string, date: string | null): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;
  dossier.relanceLe = date;
  return ecrire(dossier);
}

/**
 * Journalise un courriel envoyé au client. Appelée **après** que Resend a accepté le
 * message : journaliser d'abord ferait croire à un envoi qui n'a pas eu lieu.
 */
export async function journaliserCourriel(id: string, resume: string): Promise<DossierClient | null> {
  const dossier = await lireDossier(id);
  if (!dossier) return null;
  dossier.historique.push(evenement('courriel', resume));
  return ecrire(dossier);
}

/** Combien de pièces manquent encore. Sert au courriel de suivi comme à l'écran. */
export function documentsManquants(dossier: DossierClient | VueClient): number {
  return dossier.documents.filter((l) => l.etat === 'a_fournir').length;
}

/* ------------------------------------------------------------------ */
/*  Lien magique                                                       */
/* ------------------------------------------------------------------ */

/** Ce qu'un lien magique met dans un courriel. Le jeton en clair n'existe qu'ici. */
export interface LienMagique {
  readonly dossierId: string;
  readonly jeton: string;
  readonly expireLe: string;
}

/**
 * Émet un lien magique pour un dossier, en invalidant le précédent.
 *
 * Refuse un dossier dont l'étape n'est pas destinée au client : envoyer un lien vers un
 * écran neutre, c'est promettre des nouvelles pour n'en donner aucune.
 */
export async function emettreLienMagique(id: string): Promise<LienMagique | null> {
  const dossier = await lireDossier(id);
  if (!dossier || !ETAPES[dossier.etape].visibleClient) return null;
  // Sans adresse, il n'y a nulle part où envoyer le lien — le cas des fiches référées par un
  // partenaire, qui n'arrivent qu'avec un téléphone.
  if (!dossier.courriel) return null;

  const jeton = nouveauJeton();
  const expireLe = new Date(Date.now() + DUREE_LIEN_MS).toISOString();
  dossier.acces = { jetonHash: await hacher(jeton), expireLe };
  await ecrire(dossier);

  return { dossierId: dossier.id, jeton, expireLe };
}

/**
 * Consomme un lien magique. À usage unique : le jeton est effacé du dossier dès qu'il a
 * servi, si bien qu'un lien retrouvé dans une vieille boîte de réception n'ouvre plus rien.
 */
export async function consommerLienMagique(id: unknown, jeton: unknown): Promise<DossierClient | null> {
  if (!identifiantPlausible(id, jeton)) return null;

  const dossier = await lireDossier(id as string);
  if (!dossier?.acces) return null;
  if (Date.parse(dossier.acces.expireLe) < Date.now()) return null;

  const empreinte = await hacher(jeton as string);
  if (!egaliteConstante(dossier.acces.jetonHash, empreinte)) return null;

  dossier.acces = null;
  dossier.historique.push(evenement('acces', 'Le client a ouvert son dossier'));
  return ecrire(dossier);
}
