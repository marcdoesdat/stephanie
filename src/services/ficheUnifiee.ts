/**
 * Ce que les carnets savent d'une même personne.
 *
 * Le site tient quatre magasins : les dossiers clients, le carnet du réseau, les contrats en
 * cours de signature, les profils d'emprunteurs. Jusqu'ici ils s'ignoraient — un notaire du
 * réseau devenu client était deux inconnus, et le client qui signait son contrat n'avait
 * aucun lien avec son propre dossier de suivi.
 *
 * **On unifie à la lecture, pas au stockage**, et c'est un choix, pas un raccourci. La
 * refonte « propre » — une fiche personne, tout le reste en référence — achoppe sur un fait
 * structurel : les dossiers de signature sont **éphémères**. Un contrat vit dix jours, un
 * profil quatorze, et tous deux sont supprimés dès le PDF produit ; c'est la règle qui
 * protège les tracés de signature au repos. En faire les enfants d'une fiche permanente
 * obligerait soit à les garder plus longtemps — on affaiblirait la meilleure garantie du
 * système — soit à vivre avec des références mortes.
 *
 * **Les profils d'emprunteurs en sont exclus** : `profilDossierService` n'expose pas de
 * listage, et en ajouter un ferait relire tous les blobs à chaque ouverture de fiche, pour
 * un objet qui vit deux semaines.
 *
 * ⚠️ Rien de ce que rend ce module ne porte de jeton ni de tracé de signature : il est
 * transmissible au navigateur, et un test le vérifie.
 *
 * @module ficheUnifiee
 */

import { listerDossiers as listerContrats } from './contratDossierService';
import { lireDossier, listerDossiers } from './dossierClientService';
import { lireContact, listerContacts } from './reseauContactService';
import { ETAPES, ORIGINES, normaliserCourriel } from '../utils/dossiersClients';
import { ETATS, PROFESSIONS } from '../utils/reseauCourtiers';

/** Le dossier de suivi de cette personne, s'il en existe un. */
export interface LienDossier {
  readonly id: string;
  readonly nom: string;
  readonly etape: string;
  readonly origine: string;
}

/** Sa fiche au carnet du réseau — c'est aussi un professionnel, ou il l'a été. */
export interface LienReseau {
  readonly id: string;
  readonly nom: string;
  readonly profession: string;
  readonly etat: string;
  readonly dernierEnvoiLe: string | null;
}

/** Un contrat de courtage en cours de signature. Jamais de jeton ici — voir `ResumeDossier`. */
export interface LienContrat {
  readonly id: string;
  readonly statut: string;
  readonly signeLe: string | null;
  /** Vrai si c'est à cette personne de signer maintenant. */
  readonly aSonTour: boolean;
}

export interface LiensPersonne {
  readonly courriel: string;
  readonly dossier: LienDossier | null;
  readonly reseau: LienReseau | null;
  readonly contrat: LienContrat | null;
  /** Le professionnel qui a référé cette personne, quand la fiche le dit. */
  readonly referePar: LienReseau | null;
}

const VIDE = (courriel: string): LiensPersonne => ({
  courriel,
  dossier: null,
  reseau: null,
  contrat: null,
  referePar: null,
});

function resumerReseau(contact: {
  id: string;
  nom: string;
  profession: string;
  etat: string;
  dernierEnvoiLe: string | null;
}): LienReseau {
  return {
    id: contact.id,
    nom: contact.nom,
    profession: PROFESSIONS[contact.profession as keyof typeof PROFESSIONS] ?? contact.profession,
    etat: ETATS[contact.etat as keyof typeof ETATS] ?? contact.etat,
    dernierEnvoiLe: contact.dernierEnvoiLe,
  };
}

/**
 * Rassemble ce que les carnets savent d'une adresse.
 *
 * Appelée **à l'ouverture d'une fiche**, jamais au chargement d'une liste : elle relit trois
 * magasins, et le faire pour chaque ligne d'un écran de suivi coûterait le triple à chaque
 * affichage. La résolution est paresseuse par construction.
 */
export async function resoudreParCourriel(brut: unknown): Promise<LiensPersonne> {
  const courriel = typeof brut === 'string' ? normaliserCourriel(brut) : '';
  if (!courriel) return VIDE('');

  // Lectures séquentielles, et non un `Promise.all`. Chaque service charge Netlify Blobs à
  // la demande et **retient** le résultat de ce chargement pour toute son instance ; trois
  // chargements concurrents suffisent à ce que l'un d'eux échoue et bascule silencieusement
  // ce service sur son repli mémoire — c'est-à-dire vide, définitivement, pour la durée de
  // vie de la fonction. Trois petites lectures en série ne coûtent rien ; un carnet qui se
  // croit vide coûte cher.
  const dossiers = await listerDossiers();
  const contacts = await listerContacts();
  const contrats = await listerContrats();

  const dossier = dossiers.find((d) => d.courriel === courriel) ?? null;
  const contact = contacts.find((c) => c.courriel === courriel) ?? null;

  const contrat = contrats.find((c) => c.emprunteurs.some((e) => normaliserCourriel(e.courriel) === courriel)) ?? null;
  const signataire = contrat?.emprunteurs.find((e) => normaliserCourriel(e.courriel) === courriel) ?? null;

  const referent = dossier?.refereParId ? contacts.find((c) => c.id === dossier.refereParId) : null;

  return {
    courriel,
    dossier: dossier
      ? {
          id: dossier.id,
          nom: dossier.nom,
          etape: ETAPES[dossier.etape].libelle,
          origine: ORIGINES[dossier.origine],
        }
      : null,
    reseau: contact ? resumerReseau(contact) : null,
    contrat: contrat
      ? {
          id: contrat.id,
          statut: contrat.statut,
          signeLe: signataire?.signeLe ?? null,
          aSonTour: normaliserCourriel(contrat.courant?.courriel ?? '') === courriel,
        }
      : null,
    referePar: referent ? resumerReseau(referent) : null,
  };
}

/**
 * Même chose, à partir d'un dossier client.
 *
 * Une fiche sans adresse — une référence de partenaire — n'a rien à recouper par courriel,
 * mais elle peut tout de même nommer celui qui l'a référée : c'est justement le cas où le
 * lien vaut le plus.
 */
export async function resoudreParDossier(id: unknown): Promise<LiensPersonne | null> {
  if (typeof id !== 'string' || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;

  const dossier = await lireDossier(id);
  if (!dossier) return null;

  if (dossier.courriel) return resoudreParCourriel(dossier.courriel);

  const referent = dossier.refereParId ? await lireContact(dossier.refereParId) : null;
  return {
    ...VIDE(''),
    dossier: {
      id: dossier.id,
      nom: dossier.nom,
      etape: ETAPES[dossier.etape].libelle,
      origine: ORIGINES[dossier.origine],
    },
    referePar: referent ? resumerReseau(referent) : null,
  };
}
