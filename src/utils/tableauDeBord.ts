/**
 * Ce qui réclame un geste aujourd'hui, **tous carnets confondus**.
 *
 * Trois carnets vivent côte à côte — les dossiers clients, le réseau de partenaires, les
 * contrats en cours de signature — et chacun sait déjà dire ce qui presse chez lui. Le
 * problème n'est pas le calcul, c'est qu'il fallait ouvrir trois écrans pour le lire : un
 * contrat pouvait attendre sa signature trois jours parce que la matinée s'était passée
 * dans `/dossiers`.
 *
 * Ce module est **pur** : il reçoit ce que les trois `GET` ont rendu et une heure, il rend
 * une liste triée. Il existe surtout pour que la règle n'ait qu'un seul exemplaire — celle
 * du réseau vivait en clair dans le script de `reseau.astro`, donc sans test, et celle des
 * contrats dans `contrat.astro`. Les recopier ici aurait laissé deux écrans se contredire.
 *
 * La part « dossiers » n'est pas réécrite : elle appelle `dossiersEcran`.
 *
 * @module tableauDeBord
 */

import {
  phraseUrgence,
  urgences,
  type FicheEcran,
  type OptionsUrgence,
} from './dossiersEcran';
import { DELAI_SANS_REPONSE_JOURS, type CleEtat } from './reseauCourtiers';

/** De quel carnet vient une tâche. Sert à la pastille et au lien. */
export type Carnet = 'dossier' | 'reseau' | 'contrat';

/**
 * Au-delà, un dossier de signature est trop près de son échéance pour qu'on attende
 * encore : le lien du signataire vaut dix jours, et un lien mort se réémet, il ne se
 * rattrape pas.
 */
export const DELAI_ALERTE_EXPIRATION_MS = 2 * 86_400_000;

function joursDepuis(iso: string | null, maintenant: number): number | null {
  if (!iso) return null;
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return null;
  return Math.floor((maintenant - instant) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/*  Réseau                                                             */
/* ------------------------------------------------------------------ */

/** Le strict nécessaire — la fiche du carnet en porte bien davantage. */
export interface ContactEcran {
  readonly id: string;
  readonly nom: string;
  readonly etat: CleEtat;
  readonly relanceLe: string | null;
  readonly dernierEnvoiLe: string | null;
}

export type UrgenceReseau =
  | { readonly type: 'relance'; readonly joursDeRetard: number }
  | { readonly type: 'sans_reponse'; readonly jours: number };

export interface OptionsReseau {
  /** Au-delà, un contact approché et resté muet remonte. */
  readonly delaiSansReponseJours?: number;
  readonly maintenant?: number;
}

/**
 * Pourquoi un contact remonte.
 *
 * **Un partenaire acquis et un contact retiré n'en sont jamais** : le premier n'attend
 * rien, le second a demandé qu'on le laisse. C'est la seule exclusion, et elle est
 * d'emblée — la reléguer à l'affichage la rendrait facile à oublier.
 */
export function motifUrgenceReseau(
  contact: ContactEcran,
  options: OptionsReseau = {},
): UrgenceReseau | null {
  if (contact.etat === 'refuse' || contact.etat === 'partenaire') return null;
  const maintenant = options.maintenant ?? Date.now();
  const delai = options.delaiSansReponseJours ?? DELAI_SANS_REPONSE_JOURS;

  // Une relance fixée à aujourd'hui est due **aujourd'hui** — même règle que les dossiers.
  // `reseau.astro` attendait la fin de la journée (`T23:59:59`) pour la faire remonter, ce
  // qui la reportait d'un jour : sur un écran qui se lit le matin, une relance qui n'y
  // paraît que le lendemain n'est pas une relance, c'est un retard.
  const retard = joursDepuis(contact.relanceLe, maintenant);
  if (retard !== null && retard >= 0) return { type: 'relance', joursDeRetard: retard };

  const attente = joursDepuis(contact.dernierEnvoiLe, maintenant);
  if (
    (contact.etat === 'contacte' || contact.etat === 'relance') &&
    attente !== null &&
    attente >= delai
  ) {
    return { type: 'sans_reponse', jours: attente };
  }

  return null;
}

export function phraseUrgenceReseau(urgence: UrgenceReseau): string {
  if (urgence.type === 'relance') {
    return urgence.joursDeRetard === 0
      ? 'Relance prévue aujourd’hui'
      : `Relance prévue il y a ${urgence.joursDeRetard} jour${urgence.joursDeRetard > 1 ? 's' : ''}`;
  }
  return `Sans réponse depuis ${urgence.jours} jours`;
}

/** Les contacts qui réclament un geste, les plus en retard d'abord. */
export function urgencesReseau<T extends ContactEcran>(
  contacts: readonly T[],
  options: OptionsReseau = {},
): Array<{ readonly contact: T; readonly urgence: UrgenceReseau }> {
  return contacts
    .map((contact) => ({ contact, urgence: motifUrgenceReseau(contact, options) }))
    .filter((e): e is { contact: T; urgence: UrgenceReseau } => e.urgence !== null)
    .sort((a, b) => {
      const ecart = poidsReseau(b.urgence) - poidsReseau(a.urgence);
      return ecart !== 0 ? ecart : ancienneteReseau(b.urgence) - ancienneteReseau(a.urgence);
    });
}

function poidsReseau(urgence: UrgenceReseau): number {
  return urgence.type === 'relance' ? 3 : 1;
}

function ancienneteReseau(urgence: UrgenceReseau): number {
  return urgence.type === 'relance' ? urgence.joursDeRetard : urgence.jours;
}

/* ------------------------------------------------------------------ */
/*  Contrats                                                           */
/* ------------------------------------------------------------------ */

/**
 * Le strict nécessaire du résumé de dossier de signature. Redéclaré plutôt qu'importé de
 * `contratDossierService` : ce module tourne dans le navigateur, et le service traîne
 * Netlify Blobs derrière lui.
 */
export interface ResumeEcran {
  readonly id: string;
  readonly statut: 'en_attente' | 'a_finaliser' | 'gele';
  readonly expireLe: string;
  readonly emprunteurs: ReadonlyArray<{ readonly nom: string }>;
  readonly courant: { readonly nom: string } | null;
  readonly refusePar: string | null;
}

export type UrgenceContrat =
  | { readonly type: 'a_finaliser' }
  | { readonly type: 'refuse'; readonly par: string | null }
  | { readonly type: 'bientot_perime'; readonly heuresRestantes: number };

export interface OptionsContrat {
  readonly maintenant?: number;
}

/**
 * Pourquoi un dossier de signature remonte.
 *
 * Trois motifs, du plus coûteux au moins : un refus gèle tout et se traite en parlant à
 * quelqu'un ; un dossier à finaliser attend **sa** signature à elle, et rien d'autre ne
 * le débloquera ; un lien près d'expirer se réémet avant, pas après.
 */
export function motifUrgenceContrat(
  resume: ResumeEcran,
  options: OptionsContrat = {},
): UrgenceContrat | null {
  const maintenant = options.maintenant ?? Date.now();
  if (resume.statut === 'gele') return { type: 'refuse', par: resume.refusePar };
  if (resume.statut === 'a_finaliser') return { type: 'a_finaliser' };

  const instant = Date.parse(resume.expireLe);
  if (Number.isNaN(instant)) return null;
  const restant = instant - maintenant;
  if (restant < DELAI_ALERTE_EXPIRATION_MS) {
    return { type: 'bientot_perime', heuresRestantes: Math.max(Math.floor(restant / 3_600_000), 0) };
  }
  return null;
}

export function phraseUrgenceContrat(urgence: UrgenceContrat): string {
  switch (urgence.type) {
    case 'a_finaliser':
      return 'Contrat signé par tous — il attend votre signature';
    case 'refuse':
      return urgence.par ? `Contrat refusé par ${urgence.par}` : 'Contrat refusé';
    case 'bientot_perime':
      return urgence.heuresRestantes <= 0
        ? 'Le lien de signature expire aujourd’hui — à réémettre'
        : `Le lien de signature expire dans ${urgence.heuresRestantes} h — à réémettre`;
  }
}

/** Qui nommer sur la carte : celui dont c'est le tour, sinon les emprunteurs. */
function nommerContrat(resume: ResumeEcran, urgence: UrgenceContrat): string {
  if (urgence.type === 'refuse' && resume.refusePar) return resume.refusePar;
  if (urgence.type === 'bientot_perime' && resume.courant) return resume.courant.nom;
  const noms = resume.emprunteurs.map((e) => e.nom).filter(Boolean);
  return noms.length > 0 ? noms.join(', ') : 'Contrat sans nom';
}

export function urgencesContrats<T extends ResumeEcran>(
  resumes: readonly T[],
  options: OptionsContrat = {},
): Array<{ readonly resume: T; readonly urgence: UrgenceContrat }> {
  return resumes
    .map((resume) => ({ resume, urgence: motifUrgenceContrat(resume, options) }))
    .filter((e): e is { resume: T; urgence: UrgenceContrat } => e.urgence !== null)
    .sort((a, b) => poidsContrat(b.urgence) - poidsContrat(a.urgence));
}

function poidsContrat(urgence: UrgenceContrat): number {
  switch (urgence.type) {
    case 'refuse':
      return 4;
    case 'a_finaliser':
      return 3;
    case 'bientot_perime':
      return 2;
  }
}

/* ------------------------------------------------------------------ */
/*  La fusion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Une chose à faire, rédigée.
 *
 * Contrairement aux motifs des trois règles ci-dessus, la tâche porte sa phrase : c'est
 * une liste qu'on lit, pas un modèle qu'on interprète. Elle porte aussi son lien, parce
 * qu'un cockpit qui nomme un dossier sans savoir l'ouvrir oblige à le chercher ensuite.
 */
export interface Tache {
  readonly carnet: Carnet;
  readonly id: string;
  readonly nom: string;
  readonly phrase: string;
  readonly poids: number;
  /** Départage à poids égal : le plus en retard d'abord. */
  readonly anciennete: number;
  readonly lien: string;
}

export interface SourcesTableauDeBord {
  readonly dossiers?: ReadonlyArray<FicheEcran & { readonly id: string; readonly nom: string }>;
  readonly contacts?: readonly ContactEcran[];
  readonly contrats?: readonly ResumeEcran[];
}

export interface OptionsTableauDeBord extends OptionsUrgence {
  readonly delaiSansReponseJours?: number;
}

/**
 * Tout ce qui presse, dans un seul ordre.
 *
 * **Le tri ignore le carnet d'origine** : c'est le sens même de l'écran. Un contrat refusé
 * ce matin passe devant une relance de partenaire due depuis hier, et une relance due
 * depuis hier passe devant un dossier qui dort — la provenance ne dit rien de l'urgence.
 */
export function tachesDuJour(
  sources: SourcesTableauDeBord,
  options: OptionsTableauDeBord,
): Tache[] {
  const taches: Tache[] = [];

  for (const { fiche, urgence } of urgences(sources.dossiers ?? [], options)) {
    taches.push({
      carnet: 'dossier',
      id: fiche.id,
      nom: fiche.nom,
      phrase: phraseUrgence(urgence),
      poids: urgence.type === 'relance' ? 3 : urgence.type === 'documents_complets' ? 2 : 1,
      anciennete:
        urgence.type === 'relance'
          ? urgence.joursDeRetard
          : urgence.type === 'sans_mouvement'
            ? urgence.jours
            : 0,
      lien: `/dossiers#f=${encodeURIComponent(fiche.id)}`,
    });
  }

  for (const { contact, urgence } of urgencesReseau(sources.contacts ?? [], options)) {
    taches.push({
      carnet: 'reseau',
      id: contact.id,
      nom: contact.nom,
      phrase: phraseUrgenceReseau(urgence),
      poids: poidsReseau(urgence),
      anciennete: ancienneteReseau(urgence),
      lien: `/reseau#f=${encodeURIComponent(contact.id)}`,
    });
  }

  for (const { resume, urgence } of urgencesContrats(sources.contrats ?? [], options)) {
    taches.push({
      carnet: 'contrat',
      id: resume.id,
      nom: nommerContrat(resume, urgence),
      phrase: phraseUrgenceContrat(urgence),
      poids: poidsContrat(urgence),
      anciennete: 0,
      lien: '/contrat#ct-suivi',
    });
  }

  return taches.sort((a, b) =>
    b.poids !== a.poids ? b.poids - a.poids : b.anciennete - a.anciennete,
  );
}
