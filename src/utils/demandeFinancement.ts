/**
 * Les étapes du formulaire `/demande`, à un seul exemplaire.
 *
 * La page les parcourt une à une ; le serveur s'en sert pour dire à Stéphanie ce qui manque
 * quand le client choisit d'envoyer avant la fin. Les deux lisent le même catalogue : une
 * étape ajoutée à la page sans l'être ici passerait inaperçue dans le bilan du courriel
 * interne — et Stéphanie croirait complet un dossier qui ne l'est pas.
 *
 * **Envoyer avant la fin est un droit, pas une panne.** Le formulaire est long (une dizaine
 * d'étapes) ; le client qui s'arrête à la cinquième a quand même donné de quoi le rappeler.
 * La seule exigence est de pouvoir le joindre : l'étape « Votre projet » (type de demande,
 * nom, téléphone, courriel) vient donc en premier, et l'envoi anticipé ne s'offre qu'une
 * fois celle-ci franchie. Le reste se complète avec Stéphanie.
 *
 * Module pur : aucune dépendance au DOM ni au serveur. Chacun fournit sa `Lecture`.
 */

/** Lit la valeur d'un champ : chaîne nettoyée, `''` si absent. Un groupe de cases rend ses valeurs jointes. */
export type Lecture = (champ: string) => string;

export type CleEtape =
  | 'projet'
  | 'pret_actuel'
  | 'identite'
  | 'co_emprunteur'
  | 'situation'
  | 'emploi'
  | 'credit'
  | 'mise_de_fonds'
  | 'dettes'
  | 'preferences'
  | 'propriete'
  | 'dernieres';

export interface ChampRequis {
  readonly champ: string;
  /** Le libellé que lit Stéphanie dans le bilan — celui de la page, en plus court. */
  readonly libelle: string;
  /** Exigence au-delà de « non vide ». */
  readonly format?: 'courriel' | 'telephone';
  /** Requis seulement dans ce cas (ex. : le nom du co-emprunteur, s'il y en a un). */
  readonly si?: (lire: Lecture) => boolean;
}

export interface EtapeDemande {
  readonly cle: CleEtape;
  readonly titre: string;
  /** Tous les champs de l'étape — pour reconnaître une étape restée entièrement vide. */
  readonly champs: readonly string[];
  readonly requis: readonly ChampRequis[];
  /** L'étape ne s'applique que dans ce cas (ex. : la mise de fonds, à l'achat seulement). */
  readonly si?: (lire: Lecture) => boolean;
}

const estRefinancement = (lire: Lecture): boolean => lire('type_demande') === 'refinancement';
const estAchat = (lire: Lecture): boolean => !estRefinancement(lire);

export const COURRIEL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/i;

/** Dix chiffres au moins : un numéro sans indicatif régional ne permet pas de rappeler. */
export function telephoneValide(valeur: string): boolean {
  return valeur.replace(/\D/g, '').length >= 10;
}

export const ETAPES: readonly EtapeDemande[] = [
  {
    cle: 'projet',
    titre: 'Votre projet',
    champs: ['type_demande', 'nom', 'telephone', 'courriel'],
    requis: [
      { champ: 'type_demande', libelle: 'Type de demande' },
      { champ: 'nom', libelle: 'Nom complet' },
      { champ: 'telephone', libelle: 'Téléphone', format: 'telephone' },
      { champ: 'courriel', libelle: 'Courriel', format: 'courriel' },
    ],
  },
  {
    cle: 'pret_actuel',
    titre: 'Votre prêt actuel',
    si: estRefinancement,
    champs: ['refi_solde', 'refi_valeur', 'refi_preteur', 'refi_echeance', 'refi_but'],
    requis: [
      { champ: 'refi_solde', libelle: 'Solde hypothécaire actuel' },
      { champ: 'refi_valeur', libelle: 'Valeur estimée de la propriété' },
    ],
  },
  {
    cle: 'identite',
    titre: 'Identité et situation personnelle',
    champs: [
      'naissance', 'adresse', 'ville', 'code_postal', 'adresse_3ans', 'adresse_precedente',
      'statut_residence', 'etat_civil',
    ],
    requis: [
      { champ: 'naissance', libelle: 'Date de naissance' },
      { champ: 'adresse', libelle: 'Adresse actuelle' },
      { champ: 'ville', libelle: 'Ville' },
      { champ: 'code_postal', libelle: 'Code postal' },
      { champ: 'adresse_3ans', libelle: 'À cette adresse depuis plus de 3 ans' },
      { champ: 'statut_residence', libelle: 'Statut de résidence' },
      { champ: 'etat_civil', libelle: 'État civil' },
    ],
  },
  {
    cle: 'co_emprunteur',
    titre: 'Co-emprunteur',
    champs: ['co_emprunteur', 'co_nom', 'co_naissance', 'co_statut_emploi', 'co_revenu'],
    requis: [
      { champ: 'co_emprunteur', libelle: 'Seul·e ou à deux' },
      { champ: 'co_nom', libelle: 'Nom du co-emprunteur', si: (lire) => lire('co_emprunteur') === 'deux' },
      { champ: 'co_naissance', libelle: 'Date de naissance du co-emprunteur', si: (lire) => lire('co_emprunteur') === 'deux' },
    ],
  },
  {
    cle: 'situation',
    titre: 'Situation actuelle',
    champs: ['situation_logement', 'paiement_actuel', 'vente_propriete', 'premier_acheteur'],
    requis: [{ champ: 'situation_logement', libelle: 'Situation de logement' }],
  },
  {
    cle: 'emploi',
    titre: 'Emploi et revenus',
    champs: [
      'employeur', 'titre_poste', 'statut_emploi', 'anciennete', 'revenu_base', 'revenu_extra',
      'autres_revenus', 'docs_disponibles',
    ],
    requis: [
      { champ: 'employeur', libelle: 'Employeur' },
      { champ: 'titre_poste', libelle: 'Titre du poste' },
      { champ: 'statut_emploi', libelle: "Statut d'emploi" },
      { champ: 'anciennete', libelle: 'Ancienneté' },
      { champ: 'revenu_base', libelle: 'Revenu annuel brut de base' },
    ],
  },
  {
    cle: 'credit',
    titre: 'Votre crédit',
    champs: ['auto_evaluation_credit', 'faillite_passee'],
    requis: [{ champ: 'auto_evaluation_credit', libelle: 'Auto-évaluation du crédit' }],
  },
  {
    cle: 'mise_de_fonds',
    titre: 'Mise de fonds',
    si: estAchat,
    champs: ['mise_montant', 'prix_vise', 'source_fonds', 'fonds_90jours', 'mise_precisions'],
    requis: [
      { champ: 'mise_montant', libelle: 'Montant disponible' },
      { champ: 'source_fonds', libelle: 'Source des fonds' },
      { champ: 'fonds_90jours', libelle: 'Fonds depuis plus de 90 jours' },
    ],
  },
  {
    cle: 'dettes',
    titre: 'Dettes et obligations',
    champs: ['paiement_dettes', 'types_dettes', 'personnes_charge', 'consentement_credit'],
    requis: [],
  },
  {
    cle: 'preferences',
    titre: 'Préférences de financement',
    champs: ['pref_taux', 'duree_terme', 'paiements_anticipes', 'vente_court_terme'],
    requis: [{ champ: 'pref_taux', libelle: 'Taux fixe ou variable' }],
  },
  {
    cle: 'propriete',
    titre: 'La propriété visée',
    champs: [
      'promesse_achat', 'adresse_propriete', 'date_possession', 'type_propriete',
      'usage_propriete', 'frais_condo', 'revenus_locatifs',
    ],
    // La promesse d'achat ne se pose qu'à l'achat : la demander à qui refinance sa propre
    // maison l'obligeait à répondre « Non — je magasine » pour pouvoir continuer.
    requis: [{ champ: 'promesse_achat', libelle: "Promesse d'achat acceptée", si: estAchat }],
  },
  {
    cle: 'dernieres',
    titre: 'Dernières questions',
    champs: ['pref_contact', 'moment_contact', 'source', 'message'],
    requis: [],
  },
];

/** La clé, si c'en est une du catalogue — pour lire sans la croire une valeur venue du client. */
export function etapeParCle(cle: string): EtapeDemande | null {
  return ETAPES.find((e) => e.cle === cle) ?? null;
}

/** Les étapes qui s'appliquent à cette demande, dans l'ordre (l'achat et le refinancement diffèrent). */
export function etapesApplicables(lire: Lecture): EtapeDemande[] {
  return ETAPES.filter((e) => !e.si || e.si(lire));
}

function satisfait(requis: ChampRequis, lire: Lecture): boolean {
  const valeur = lire(requis.champ);
  if (!valeur) return false;
  if (requis.format === 'courriel') return COURRIEL_RE.test(valeur);
  if (requis.format === 'telephone') return telephoneValide(valeur);
  return true;
}

/** Les champs requis de l'étape qui manquent ou sont mal formés — ceux qui s'appliquent seulement. */
export function requisManquants(etape: EtapeDemande, lire: Lecture): ChampRequis[] {
  return etape.requis.filter((r) => (!r.si || r.si(lire)) && !satisfait(r, lire));
}

/** Aucun champ de l'étape n'a reçu de réponse. */
export function etapeVide(etape: EtapeDemande, lire: Lecture): boolean {
  return etape.champs.every((champ) => !lire(champ));
}

export interface EtapeACompleter {
  readonly cle: CleEtape;
  readonly titre: string;
  /** Rien n'a été rempli : l'étape n'a sans doute pas été vue. */
  readonly vide: boolean;
  /** Libellés des réponses requises qui manquent. */
  readonly manquants: readonly string[];
}

export interface BilanDemande {
  /** Toutes les réponses requises des étapes applicables sont là. */
  readonly complete: boolean;
  /** Les étapes à reprendre avec le client : un requis manque, ou rien n'a été rempli. */
  readonly aCompleter: readonly EtapeACompleter[];
}

/**
 * Ce qui reste à compléter, étape par étape.
 *
 * Une étape sans réponse requise (dettes, dernières questions) n'empêche pas une demande
 * d'être complète ; restée vide, elle figure quand même dans `aCompleter` — c'est utile à
 * Stéphanie quand le client s'est arrêté avant, et sans effet quand il est allé au bout,
 * puisque seul un envoi incomplet affiche la liste.
 */
export function bilanDemande(lire: Lecture): BilanDemande {
  const aCompleter: EtapeACompleter[] = [];
  let complete = true;
  for (const etape of etapesApplicables(lire)) {
    const manquants = requisManquants(etape, lire).map((r) => r.libelle);
    if (manquants.length > 0) complete = false;
    const vide = etapeVide(etape, lire);
    if (manquants.length > 0 || vide) aCompleter.push({ cle: etape.cle, titre: etape.titre, vide, manquants });
  }
  return { complete, aCompleter };
}

/**
 * La place d'une étape dans le parcours. Une étape sortie du parcours (le type de demande a
 * changé entre-temps) cède la place à la plus proche avant elle.
 */
export function indexDansParcours(cle: CleEtape, parcours: readonly EtapeDemande[]): number {
  const exact = parcours.findIndex((e) => e.cle === cle);
  if (exact >= 0) return exact;
  const rang = ETAPES.findIndex((e) => e.cle === cle);
  let meilleur = 0;
  parcours.forEach((e, i) => {
    if (ETAPES.indexOf(e) <= rang) meilleur = i;
  });
  return meilleur;
}

/* ------------------------------------------------------------------ */
/*  Reprise après un rechargement                                      */
/* ------------------------------------------------------------------ */

/**
 * Les réponses en cours vivent en `sessionStorage` — jamais en `localStorage` : elles meurent
 * avec l'onglet, et un appareil partagé ne les garde pas au-delà de la visite. Elles sont
 * effacées dès l'envoi, et ne sont pas reprises au-delà de `DUREE_REPRISE_MS` (un onglet
 * oublié ouvert plusieurs jours ne doit pas rouvrir une demande sur la date de naissance de
 * quelqu'un d'autre).
 */
export const CLE_REPRISE = 'sw_demande_v1';
export const DUREE_REPRISE_MS = 24 * 60 * 60 * 1000;

/**
 * Jamais gardés. Le consentement se donne au moment d'envoyer : repris d'un rechargement, il
 * serait coché sans avoir été relu. Le piège à robots et la province fixe n'ont rien à reprendre.
 */
export const CHAMPS_NON_REPRIS: readonly string[] = ['consentement', 'company', 'province'];

const NOM_CHAMP_RE = /^[a-z][a-z0-9_]{0,40}$/;
const VALEURS_MAX = 20;
const LONGUEUR_MAX = 2000;

export interface Reprise {
  readonly etape: CleEtape;
  readonly champs: Readonly<Record<string, readonly string[]>>;
}

/** Ce que la page écrit en `sessionStorage`. Les valeurs vides et les champs exclus sont écartés. */
export function encoderReprise(etape: CleEtape, champs: Record<string, string[]>, maintenant: number): string {
  const gardes: Record<string, string[]> = {};
  for (const [nom, valeurs] of Object.entries(champs)) {
    if (CHAMPS_NON_REPRIS.includes(nom)) continue;
    const pleines = valeurs.filter((v) => v.trim() !== '');
    if (pleines.length > 0) gardes[nom] = pleines;
  }
  return JSON.stringify({ v: 1, ts: maintenant, etape, champs: gardes });
}

/**
 * Relit ce que la page avait écrit — défensivement, champ par champ : une valeur d'une autre
 * forme est écartée plutôt que posée dans le formulaire. `null` si rien n'est à reprendre.
 */
export function decoderReprise(brut: string | null, maintenant: number): Reprise | null {
  if (!brut) return null;
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof donnees !== 'object' || donnees === null) return null;
  const { v, ts, etape, champs } = donnees as Record<string, unknown>;
  if (v !== 1 || typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  // Trop vieux, ou daté du futur (horloge changée) : on ne reprend pas.
  if (maintenant - ts > DUREE_REPRISE_MS || ts - maintenant > 60_000) return null;
  if (typeof champs !== 'object' || champs === null || Array.isArray(champs)) return null;

  const gardes: Record<string, string[]> = {};
  for (const [nom, valeurs] of Object.entries(champs as Record<string, unknown>)) {
    if (!NOM_CHAMP_RE.test(nom) || CHAMPS_NON_REPRIS.includes(nom) || !Array.isArray(valeurs)) continue;
    const propres = valeurs
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '' && x.length <= LONGUEUR_MAX)
      .slice(0, VALEURS_MAX);
    if (propres.length > 0) gardes[nom] = propres;
  }
  if (Object.keys(gardes).length === 0) return null;

  const cle = typeof etape === 'string' ? etapeParCle(etape)?.cle : undefined;
  return { etape: cle ?? ETAPES[0]!.cle, champs: gardes };
}

/**
 * L'étape où reprendre : celle demandée, sauf si une étape avant elle n'est plus complète —
 * le client reprend alors là où il manque une réponse, plutôt qu'au-delà d'un trou.
 */
export function etapeReprise(lire: Lecture, cible: CleEtape): CleEtape {
  const parcours = etapesApplicables(lire);
  const index = indexDansParcours(cible, parcours);
  for (let i = 0; i < index; i++) {
    const etape = parcours[i]!;
    if (requisManquants(etape, lire).length > 0) return etape.cle;
  }
  return parcours[index]!.cle;
}

/** Une `Lecture` sur la charge utile JSON reçue par l'API. */
export function lectureCharge(charge: Record<string, unknown>): Lecture {
  return (champ) => {
    const valeur = charge[champ];
    if (typeof valeur === 'string') return valeur.trim();
    if (Array.isArray(valeur)) {
      return valeur.filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(', ');
    }
    if (valeur === true) return 'oui';
    return '';
  };
}
