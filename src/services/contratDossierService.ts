/**
 * Dossiers « Contrat de courtage » en attente de signature.
 *
 * **Un seul contrat, signé en séquence.** Le document ne se dédouble jamais : il passe d'un
 * signataire au suivant, chacun ajoutant sa signature à celles déjà apposées, comme une
 * feuille qu'on se passe. Un seul jeton est vivant à la fois — celui de la personne dont
 * c'est le tour. Le suivant n'est émis qu'une fois le précédent consommé.
 *
 * Stéphanie prépare le contrat ; chaque emprunteur le lit, répond aux questions qui lui
 * reviennent (PPV, transfert de cabinet, coordonnées) et signe ; puis la courtière signe en
 * dernier, une fois ces réponses connues. Le dossier vit dans Netlify Blobs le temps de
 * cette chaîne, puis **il est supprimé dès que le PDF est produit**.
 *
 * Le socle (stockage, jetons, purge) est partagé avec le « Profil des emprunteurs » :
 * voir dossierStockage.ts. Ce module ne porte que ce qui est propre au contrat.
 *
 * @module contratDossierService
 */

import { decrireCorrectionIdentite, estCourrielValide } from '../utils/contratCourtage';
import type { DonneesContrat, Emprunteur, ReponsesEmprunteur } from '../utils/contratCourtage';
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
  /** Remplacé par ce que l'emprunteur confirme ou corrige en signant (nom, courriel). */
  emprunteur: Emprunteur;
  /** SHA-256 du jeton d'invitation ; `null` une fois le jeton consommé. */
  jetonHash: string | null;
  signature: SignatureEnregistree | null;
  /** PPV, transfert et coordonnées — recueillis au moment où il signe. */
  reponses: ReponsesEmprunteur | null;
}

/**
 * `a_finaliser` : tous les emprunteurs ont signé, il ne manque que la signature de la
 * courtière. C'est le seul état où le dossier attend une action de sa part.
 *
 * `annule` : la courtière a elle-même annulé le dossier (erreur dans le contrat, conditions
 * qui ont bougé, emprunteur qui renonce) — les liens meurent sans qu'aucun PDF soit produit.
 */
export type StatutDossier = 'en_attente' | 'a_finaliser' | 'gele' | 'annule';

/**
 * Comment les emprunteurs signent — cela ne change pas l'ordre, seulement l'acheminement du
 * lien : par courriel à distance, remis à l'écran de la courtière en présentiel.
 */
export type ModeSignature = 'distance' | 'presence';

export interface DossierContrat {
  readonly id: string;
  readonly creeLe: string;
  expireLe: string;
  statut: StatutDossier;
  readonly mode: ModeSignature;
  /** Réécrit seulement pour y reporter une correction d'identité faite par un emprunteur. */
  donnees: DonneesContrat;
  /**
   * La courtière signe **en dernier**, une fois les réponses des emprunteurs connues :
   * `null` jusque-là. Signer d'abord reviendrait à couvrir de sa signature des réponses
   * qu'elle n'a pas vues.
   */
  signatureCourtiere: SignatureEnregistree | null;
  emprunteurs: EntreeEmprunteur[];
  refus?: {
    readonly nom: string;
    readonly courriel: string;
    readonly motif: string;
    readonly le: string;
  };
  /** Posé quand la courtière annule elle-même le dossier — les liens meurent. */
  annuleLe?: string;
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
 * Crée un dossier en attente. Aucune signature n'existe encore : ni celle des emprunteurs,
 * ni celle de la courtière.
 *
 * @returns Le dossier et la liste des invitations à envoyer — une par emprunteur.
 */
export async function creerDossier(
  donnees: DonneesContrat,
  mode: ModeSignature = 'distance',
): Promise<{ dossier: DossierContrat; invitation: Invitation }> {
  await stockage.purgerExpires();

  const id = nouvelIdentifiant();
  const maintenant = Date.now();

  const entrees: EntreeEmprunteur[] = donnees.emprunteurs.map((emprunteur) => ({
    emprunteur,
    jetonHash: null,
    signature: null,
    reponses: null,
  }));

  const dossier: DossierContrat = {
    id,
    creeLe: new Date(maintenant).toISOString(),
    expireLe: new Date(maintenant + DUREE_VIE_MS).toISOString(),
    statut: 'en_attente',
    mode,
    donnees,
    signatureCourtiere: null,
    emprunteurs: entrees,
  };

  // Seul le premier reçoit un jeton : les suivants n'existent pas encore, et c'est ce qui
  // garantit qu'on ne peut pas signer avant son tour.
  const invitation = await emettreJeton(dossier, 0);

  await stockage.ecrire(id, JSON.stringify(dossier));

  // Un dossier écrit mais illisible, c'est une invitation partie vers un lien mort.
  // On relit avant de laisser /api/contrat-creer envoyer quoi que ce soit.
  if (!(await stockage.lire(id))) throw stockage.erreur('dossier introuvable juste après écriture');

  return { dossier, invitation };
}

/**
 * Fabrique le jeton d'un signataire et le pose, haché, dans le dossier **en mémoire** —
 * l'appelant écrit. Le jeton en clair n'existe que dans la valeur retournée.
 *
 * Émettre un nouveau jeton pour quelqu'un invalide le précédent : c'est ce qui permet à la
 * courtière de renvoyer un lien perdu sans laisser vivre l'ancien.
 */
async function emettreJeton(dossier: DossierContrat, index: number): Promise<Invitation> {
  const entree = dossier.emprunteurs[index];
  if (!entree) throw new Error('Emprunteur introuvable dans le dossier.');

  const jeton = nouveauJeton();
  entree.jetonHash = await hacher(jeton);
  return {
    nom: `${entree.emprunteur.prenom} ${entree.emprunteur.nom}`.trim(),
    courriel: entree.emprunteur.courriel,
    dossierId: dossier.id,
    jeton,
  };
}

/** Position de celui dont c'est le tour — le premier qui n'a pas signé. */
export function indexCourant(dossier: DossierContrat): number {
  return dossier.emprunteurs.findIndex((e) => e.signature === null);
}

/**
 * Réémet le lien du signataire courant, à la demande de la courtière : lien perdu, adresse
 * mal saisie, ou remise de l'appareil en présentiel. L'ancien jeton cesse aussitôt de valoir.
 *
 * Prend un **identifiant**, pas un dossier : l'état est relu du stockage. Se fier à un objet
 * que l'appelant garde en mémoire laisserait réémettre un lien sur un dossier gelé entre-temps
 * par un refus — exactement le cas où plus aucun lien ne doit vivre.
 */
export async function reemettreLienCourant(id: unknown): Promise<Invitation | null> {
  if (!identifiantPlausible(id, '')) return null;

  const brut = await stockage.lire(id as string);
  if (!brut) return null;

  let dossier: DossierContrat;
  try {
    dossier = JSON.parse(brut) as DossierContrat;
  } catch {
    return null;
  }

  if (dossier.statut !== 'en_attente') return null;
  if (Date.parse(dossier.expireLe) < Date.now()) return null;

  const index = indexCourant(dossier);
  if (index === -1) return null;

  const invitation = await emettreJeton(dossier, index);
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return invitation;
}

/** Résultat d'une correction de courriel par la courtière. */
export type CorrectionCourriel =
  | { readonly ok: true; readonly invitation: Invitation }
  | { readonly ok: false; readonly raison: 'introuvable' | 'invalide' | 'doublon' };

/**
 * Corrige le courriel du signataire courant, puis réémet son lien vers la nouvelle adresse.
 *
 * C'est le rattrapage du scénario où la courtière a fait une faute de frappe : le lien part
 * dans le vide, et « renvoyer » ne ferait qu'expédier un nouveau lien vers la même adresse
 * fausse. Le contrat (`donnees`) et l'entrée sont mis d'accord, comme pour une correction
 * faite par l'emprunteur lui-même. L'ancien jeton cesse aussitôt de valoir.
 */
export async function corrigerCourrielCourant(id: unknown, courriel: unknown): Promise<CorrectionCourriel> {
  const normalise = typeof courriel === 'string' ? courriel.trim().toLowerCase() : '';
  if (!estCourrielValide(normalise)) return { ok: false, raison: 'invalide' };
  if (!identifiantPlausible(id, '')) return { ok: false, raison: 'introuvable' };

  const brut = await stockage.lire(id as string);
  if (!brut) return { ok: false, raison: 'introuvable' };

  let dossier: DossierContrat;
  try {
    dossier = JSON.parse(brut) as DossierContrat;
  } catch {
    return { ok: false, raison: 'introuvable' };
  }

  if (dossier.statut !== 'en_attente') return { ok: false, raison: 'introuvable' };
  if (Date.parse(dossier.expireLe) < Date.now()) return { ok: false, raison: 'introuvable' };

  const index = indexCourant(dossier);
  if (index === -1) return { ok: false, raison: 'introuvable' };

  // Deux emprunteurs sur une même boîte ruineraient la preuve d'une signature distincte.
  const doublon = dossier.emprunteurs.some((e, i) => i !== index && e.emprunteur.courriel === normalise);
  if (doublon) return { ok: false, raison: 'doublon' };

  const entree = dossier.emprunteurs[index]!;
  entree.emprunteur = { ...entree.emprunteur, courriel: normalise };
  dossier.donnees = {
    ...dossier.donnees,
    emprunteurs: dossier.donnees.emprunteurs.map((e, i) => (i === index ? entree.emprunteur : e)),
  };

  const invitation = await emettreJeton(dossier, index);
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return { ok: true, invitation };
}

/**
 * Annule un dossier en cours, à la demande de la courtière : erreur dans le contrat,
 * conditions qui ont bougé, emprunteur qui renonce. Tous les liens cessent de valoir, aucun
 * PDF ne sera produit. L'écran de suivi le garde comme « annulé » jusqu'à son expiration.
 *
 * Comme `reemettreLienCourant`, l'état est relu du stockage — annuler un dossier gelé ou
 * déjà complet entre-temps ne doit rien produire.
 */
export async function annulerDossier(id: unknown): Promise<DossierContrat | null> {
  if (!identifiantPlausible(id, '')) return null;

  const brut = await stockage.lire(id as string);
  if (!brut) return null;

  let dossier: DossierContrat;
  try {
    dossier = JSON.parse(brut) as DossierContrat;
  } catch {
    return null;
  }

  if (dossier.statut !== 'en_attente' && dossier.statut !== 'a_finaliser') return null;
  if (Date.parse(dossier.expireLe) < Date.now()) return null;

  dossier.statut = 'annule';
  dossier.annuleLe = new Date().toISOString();
  // Aucun lien ne doit survivre, même si un seul était vivant.
  for (const entree of dossier.emprunteurs) entree.jetonHash = null;

  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return dossier;
}

/**
 * Qui doit apprendre l'annulation : ceux qui ont déjà signé, et — à distance — celui dont
 * c'était le tour, puisqu'un lien l'attend dans sa boîte. Les suivants n'ont jamais rien
 * reçu : leur écrire « votre lien ne fonctionne plus » annoncerait un contrat qu'ils n'ont
 * pas vu. En présentiel, le signataire courant n'a reçu aucun courriel : rien à démentir.
 */
export function destinatairesAnnulation(
  dossier: DossierContrat,
): Array<{ nom: string; courriel: string; aSigne: boolean }> {
  const courant = indexCourant(dossier);
  return dossier.emprunteurs
    .map((entree, i) => ({ entree, i }))
    .filter(({ entree, i }) => entree.signature !== null || (dossier.mode === 'distance' && i === courant))
    .map(({ entree }) => ({
      nom: `${entree.emprunteur.prenom} ${entree.emprunteur.nom}`.trim(),
      courriel: entree.emprunteur.courriel,
      aSigne: entree.signature !== null,
    }));
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
  reponses: ReponsesEmprunteur,
  identite?: Pick<Emprunteur, 'prenom' | 'nom' | 'courriel'>,
): Promise<{ dossier: DossierContrat; complet: boolean; suivante: Invitation | null }> {
  const entree = dossier.emprunteurs[index];
  if (!entree) throw new Error('Emprunteur introuvable dans le dossier.');

  // Une erreur de saisie de la courtière se corrige ici, par celui qui la voit. Le contrat
  // (`donnees`) et l'entrée doivent rester d'accord : le PDF lit l'un, la suite l'autre.
  if (identite) {
    const corrige: Emprunteur = { ...entree.emprunteur, ...identite };
    const correction = decrireCorrectionIdentite(entree.emprunteur, corrige);
    if (correction) {
      entree.emprunteur = corrige;
      dossier.donnees = {
        ...dossier.donnees,
        emprunteurs: dossier.donnees.emprunteurs.map((e, i) => (i === index ? corrige : e)),
      };
      reponses = { ...reponses, identiteCorrigee: correction };
    }
  }

  entree.signature = signature;
  entree.reponses = reponses;
  entree.jetonHash = null; // usage unique : le lien ne rouvrira plus

  const complet = dossier.emprunteurs.every((e) => e.signature !== null);

  // Le tour passe au suivant : son jeton n'est émis que maintenant, ce qui rend l'ordre
  // structurel plutôt que conventionnel — nul ne peut signer avant que le précédent ait fini.
  let suivante: Invitation | null = null;
  if (complet) {
    dossier.statut = 'a_finaliser';
    // Le compte à rebours repart : le dossier attend désormais la courtière, et il serait
    // absurde de perdre les signatures déjà recueillies parce que le délai initial expire.
    dossier.expireLe = new Date(Date.now() + DUREE_VIE_MS).toISOString();
  } else {
    suivante = await emettreJeton(dossier, indexCourant(dossier));
  }

  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return { dossier, complet, suivante };
}

/**
 * Ouvre un dossier prêt à être finalisé, **sans jeton** : l'appelant doit avoir déjà
 * vérifié l'accès de la courtière (`requeteAutorisee`). Un jeton de plus n'ajouterait rien —
 * la porte de /contrat est la même, et un lien nominatif pour elle serait un secret de plus
 * à faire circuler par courriel.
 */
export async function ouvrirPourFinalisation(id: unknown): Promise<DossierContrat | null> {
  if (!identifiantPlausible(id, '')) return null;
  const brut = await stockage.lire(id as string);
  if (!brut) return null;

  let dossier: DossierContrat;
  try {
    dossier = JSON.parse(brut) as DossierContrat;
  } catch {
    return null;
  }

  if (Date.parse(dossier.expireLe) < Date.now()) {
    await supprimerDossier(dossier.id);
    return null;
  }
  return dossier.statut === 'a_finaliser' ? dossier : null;
}

/** Appose la signature de la courtière — dernier geste avant la production du PDF. */
export async function signerParLaCourtiere(
  dossier: DossierContrat,
  signature: SignatureEnregistree,
): Promise<DossierContrat> {
  dossier.signatureCourtiere = signature;
  await stockage.ecrire(dossier.id, JSON.stringify(dossier));
  return dossier;
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

/* ------------------------------------------------------------------ */
/*  Suivi — ce que la courtière voit de ses dossiers en cours          */
/* ------------------------------------------------------------------ */

/**
 * Vue d'un dossier destinée à l'écran de suivi.
 *
 * ⚠️ Ne porte **ni jeton, ni tracé de signature** : c'est ce qui la rend transmissible au
 * navigateur. Un résumé qui embarquerait les tracés ferait redescendre au client la donnée
 * la plus sensible du système, pour afficher une liste.
 */
export interface ResumeDossier {
  readonly id: string;
  readonly creeLe: string;
  readonly expireLe: string;
  readonly statut: StatutDossier;
  readonly mode: ModeSignature;
  readonly emprunteurs: ReadonlyArray<{ nom: string; courriel: string; signeLe: string | null }>;
  /** Celui dont c'est le tour, `null` si le dossier n'attend plus personne. */
  readonly courant: { nom: string; courriel: string } | null;
  readonly refusePar: string | null;
  /** Date d'annulation par la courtière, `null` si le dossier n'a pas été annulé. */
  readonly annuleLe: string | null;
}

function resumer(dossier: DossierContrat): ResumeDossier {
  const index = indexCourant(dossier);
  const courant = dossier.statut === 'en_attente' && index !== -1 ? dossier.emprunteurs[index] : null;

  return {
    id: dossier.id,
    creeLe: dossier.creeLe,
    expireLe: dossier.expireLe,
    statut: dossier.statut,
    mode: dossier.mode,
    emprunteurs: dossier.emprunteurs.map((e) => ({
      nom: `${e.emprunteur.prenom} ${e.emprunteur.nom}`.trim(),
      courriel: e.emprunteur.courriel,
      signeLe: e.signature?.signeLe ?? null,
    })),
    courant: courant
      ? {
          nom: `${courant.emprunteur.prenom} ${courant.emprunteur.nom}`.trim(),
          courriel: courant.emprunteur.courriel,
        }
      : null,
    refusePar: dossier.refus?.nom ?? null,
    annuleLe: dossier.annuleLe ?? null,
  };
}

/** Les dossiers vivants, du plus récent au plus ancien. Les périmés sont ignorés. */
export async function listerDossiers(): Promise<ResumeDossier[]> {
  const maintenant = Date.now();
  const resumes: ResumeDossier[] = [];

  for (const { contenu } of await stockage.lister()) {
    try {
      const dossier = JSON.parse(contenu) as DossierContrat;
      if (Date.parse(dossier.expireLe) < maintenant) continue;
      resumes.push(resumer(dossier));
    } catch {
      // Un dossier illisible n'est pas une raison de vider l'écran de suivi.
    }
  }

  return resumes.sort((a, b) => Date.parse(b.creeLe) - Date.parse(a.creeLe));
}

/** Les emprunteurs qui n'ont pas encore signé. */
export function emprunteursEnAttente(dossier: DossierContrat): EntreeEmprunteur[] {
  return dossier.emprunteurs.filter((e) => e.signature === null);
}
