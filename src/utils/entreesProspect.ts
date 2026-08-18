/**
 * Les portes d'entrée du carnet — un adaptateur par formulaire du site.
 *
 * Neuf formulaires, neuf vocabulaires. `/rappel` dit `courriel` et `telephone`, le quiz de
 * l'accueil dit `email`, les funnels de refinancement disent `cellulaire` ; certains
 * envoient `prenom` et `nom` séparément, d'autres un seul champ. Ce module est l'endroit —
 * le seul — où cette divergence est absorbée. Les endpoints n'ont ensuite qu'à appeler leur
 * fonction et à passer le résultat à `creerDossier`.
 *
 * **Deux règles qu'il fait respecter, et qui justifient son existence :**
 *
 * 1. **Aucun chiffre déclaré ne franchit la porte.** `/refinancement` recueille revenu brut,
 *    cote de crédit, faillite, dettes, solde du prêt et valeur marchande ; `/refinancement-v2`
 *    des tranches des deux derniers. Rien de tout cela n'entre au carnet — ni dans le profil,
 *    que `extraireProfil` filtre déjà, ni dans les notes, qui sont écrites ici. La ligne est
 *    volontairement franche : **pas de montants du tout**. Une frontière qui demande de juger
 *    au cas par cas ce qui est « assez financier » s'érode au troisième formulaire ajouté.
 *    Ces renseignements continuent de vivre dans le courriel interne, où ils sont déjà.
 * 2. **Les notes portent ce que la personne a dit**, pas ce que le système a calculé : son
 *    intention, son échéance, son message. C'est ce qui sert au premier appel.
 *
 * @module entreesProspect
 */

import {
  LONGUEURS,
  normaliser,
  normaliserBloc,
  normaliserTypeDemande,
  parserDonneesDossier,
  type DonneesDossier,
  type Resultat,
} from './dossiersClients';

/* ------------------------------------------------------------------ */
/*  Outils communs                                                     */
/* ------------------------------------------------------------------ */

function champ(source: Record<string, unknown>, ...cles: string[]): string {
  for (const cle of cles) {
    const valeur = normaliser(source[cle], LONGUEURS.nom);
    if (valeur) return valeur;
  }
  return '';
}

/** `prenom` + `nom` quand les deux existent, l'un ou l'autre sinon. */
function composerNom(source: Record<string, unknown>, clePrenom = 'prenom', cleNom = 'nom'): string {
  const prenom = normaliser(source[clePrenom], LONGUEURS.nom);
  const nom = normaliser(source[cleNom], LONGUEURS.nom);
  return normaliser(`${prenom} ${nom}`, LONGUEURS.nom);
}

/** Assemble les lignes de contexte non vides en un bloc-notes lisible. */
function notes(...lignes: Array<[etiquette: string, valeur: string]>): string {
  const utiles = lignes
    .filter(([, valeur]) => valeur.trim().length > 0)
    .map(([etiquette, valeur]) => (etiquette ? `${etiquette} : ${valeur}` : valeur));
  return normaliserBloc(utiles.join('\n'), LONGUEURS.notes);
}

function objet(brut: unknown): Record<string, unknown> | null {
  return typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : null;
}

/** Le dernier maillon commun : validation stricte par le catalogue. */
function assembler(fiche: {
  nom: string;
  courriel: string;
  telephone: string;
  notes: string;
  profil: Record<string, string>;
}): Resultat<DonneesDossier> {
  // Les champs vides sont retirés : `extraireProfil` ne retient de toute façon que les clés
  // du catalogue, mais un profil sans clés mortes se relit mieux dans la fiche.
  const profil = Object.fromEntries(Object.entries(fiche.profil).filter(([, v]) => v));
  return parserDonneesDossier({ ...fiche, profil });
}

/* ------------------------------------------------------------------ */
/*  Les neuf portes                                                    */
/* ------------------------------------------------------------------ */

/** `/rappel` — le formulaire de prise de rappel. `type` vaut « Renouvellement » ou « Refinancement ». */
export function depuisRappel(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: champ(source, 'nom'),
    courriel: normaliser(source.courriel, LONGUEURS.courriel),
    telephone: normaliser(source.telephone, LONGUEURS.telephone),
    notes: notes(
      ['Demande de rappel', normaliser(source.type, LONGUEURS.profil)],
      ['Échéance', normaliser(source.echeance, LONGUEURS.profil)],
      ['Prêteur actuel', normaliser(source.institution, LONGUEURS.profil)],
      ['', normaliserBloc(source.details, 1000)],
    ),
    profil: { typeDemande: normaliserTypeDemande(source.type) },
  });
}

/** Le quiz et le formulaire de contact de l'accueil. `parcours` porte des libellés, pas des clés. */
export function depuisContact(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  const parcours = champ(source, 'parcours', 'situation');

  return assembler({
    nom: composerNom(source),
    courriel: normaliser(source.email, LONGUEURS.courriel),
    telephone: normaliser(source.telephone, LONGUEURS.telephone),
    notes: notes(
      ['Parcours', parcours],
      ['Échéance annoncée', normaliser(source.delai, LONGUEURS.profil)],
      ['', normaliserBloc(source.message, 1000)],
    ),
    profil: {
      typeDemande: normaliserTypeDemande(parcours),
      prefContact: normaliser(source.prefcontact, LONGUEURS.profil),
    },
  });
}

/**
 * `/refinancement` — funnel publicitaire V1.
 *
 * Ce formulaire est le plus indiscret du site : revenu brut, cote de crédit, faillite,
 * dettes à refinancer, solde du prêt, valeur marchande. **Aucun de ces champs n'est lu ici.**
 * Le prêteur actuel et l'échéance du terme le sont : ce sont les deux choses sans lesquelles
 * on ne peut pas même amorcer la conversation, et ni l'une ni l'autre ne dit ce que la
 * personne gagne ou doit.
 */
export function depuisRefinancement(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: composerNom(source),
    courriel: normaliser(source.courriel, LONGUEURS.courriel),
    telephone: normaliser(source.cellulaire, LONGUEURS.telephone),
    notes: notes(
      ['But du refinancement', normaliser(source.but_refinancement, LONGUEURS.profil)],
      ['Prêteur actuel', normaliser(source.preteur_actuel, LONGUEURS.profil)],
      ['Fin du terme', normaliser(source.fin_terme, LONGUEURS.profil)],
    ),
    profil: {
      typeDemande: 'refinancement',
      typePropriete: normaliser(source.type_propriete, LONGUEURS.profil),
      source: 'Publicité — refinancement',
    },
  });
}

/** `/refinancement-v2` — même prudence : les tranches de valeur et de solde restent dehors. */
export function depuisRefinancementV2(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: composerNom(source),
    courriel: normaliser(source.courriel, LONGUEURS.courriel),
    telephone: normaliser(source.cellulaire, LONGUEURS.telephone),
    notes: notes(
      ['Intention', normaliser(source.intention, LONGUEURS.profil)],
      ['Ville', normaliser(source.ville, LONGUEURS.profil)],
    ),
    profil: { typeDemande: 'refinancement', source: 'Publicité — refinancement V2' },
  });
}

/**
 * Capture du calculateur de versement.
 *
 * ⚠️ La fiche qui en naît porte le consentement `service_demande` : **ce formulaire n'a
 * aucune case à cocher.** La personne a demandé qu'on lui envoie son calcul, pas qu'on la
 * rappelle. Les montants simulés restent dans le courriel — ici, seule la démarche est notée.
 */
export function depuisCalculateur(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: champ(source, 'nom', 'prenom'),
    courriel: normaliser(source.email, LONGUEURS.courriel),
    telephone: normaliser(source.telephone, LONGUEURS.telephone),
    notes: notes(['', 'A demandé son calcul de versement par courriel. N’a pas demandé à être rappelé.']),
    profil: { source: 'Calculateur de versement' },
  });
}

/** Capture du calculateur de pénalité. Le montant calculé reste dans le courriel. */
export function depuisPenalite(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: champ(source, 'prenom', 'nom'),
    courriel: normaliser(source.email, LONGUEURS.courriel),
    telephone: normaliser(source.telephone, LONGUEURS.telephone),
    notes: notes(['', 'A demandé son rapport de pénalité de remboursement anticipé.']),
    profil: { typeDemande: 'refinancement', source: 'Calculateur de pénalité' },
  });
}

/** Le formulaire de contact du hub d'outils. */
export function depuisOutils(payload: unknown): Resultat<DonneesDossier> {
  const source = objet(payload);
  if (!source) return { ok: false, erreur: 'Requête invalide.' };

  return assembler({
    nom: champ(source, 'prenom', 'nom'),
    courriel: normaliser(source.email, LONGUEURS.courriel),
    telephone: normaliser(source.telephone, LONGUEURS.telephone),
    notes: notes(['', normaliserBloc(source.message, 1000)]),
    profil: { source: 'Hub d’outils' },
  });
}

/* ------------------------------------------------------------------ */
/*  `/partenaires` — le seul formulaire à deux personnes               */
/* ------------------------------------------------------------------ */

/** Ce que le formulaire de référence apprend du professionnel qui réfère. */
export interface PartenaireReferent {
  readonly nom: string;
  readonly contact: string;
  readonly profession: string;
}

/**
 * Découpe une référence de partenaire en ses deux personnes.
 *
 * C'est le seul endroit du site où les deux carnets se touchent déjà : le formulaire nomme
 * un professionnel *et* un client. Le premier a sa place au réseau, le second au carnet des
 * dossiers, et le lien entre eux est ce qui permet de dire, six mois plus tard, d'où venait
 * ce client.
 *
 * **Le client référé n'a pas d'adresse courriel** — le formulaire n'en demande pas, seulement
 * un téléphone. Sa fiche est donc créée sans, et son portail restera fermé tant que
 * Stéphanie n'aura pas obtenu l'adresse. C'est un manque assumé : perdre la référence
 * vaudrait bien pire.
 */
export function depuisPartenaire(payload: unknown): {
  referent: PartenaireReferent | null;
  client: Resultat<DonneesDossier>;
} {
  const source = objet(payload);
  if (!source) return { referent: null, client: { ok: false, erreur: 'Requête invalide.' } };

  const nomReferent = normaliser(source['nom-partenaire'], LONGUEURS.nom);
  const contactReferent = normaliser(source['contact-partenaire'], LONGUEURS.courriel);
  const profession = normaliser(source.profession, LONGUEURS.profil);

  const referent =
    nomReferent.length >= 2 ? { nom: nomReferent, contact: contactReferent, profession } : null;

  const typeProjet = normaliser(source['type-projet'], LONGUEURS.profil);

  const client = assembler({
    nom: normaliser(source['client-nom'], LONGUEURS.nom),
    courriel: '',
    telephone: normaliser(source['client-telephone'], LONGUEURS.telephone),
    notes: notes(
      ['Référé par', nomReferent ? `${nomReferent}${profession ? ` (${profession})` : ''}` : ''],
      ['Type de projet', typeProjet],
      ['', normaliserBloc(source.notes, 1000)],
      ['', 'Aucune adresse courriel n’a été fournie — le portail restera fermé tant qu’elle manque.'],
    ),
    profil: { typeDemande: normaliserTypeDemande(typeProjet), source: 'Référence d’un partenaire' },
  });

  return { referent, client };
}
