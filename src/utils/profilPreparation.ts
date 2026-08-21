/**
 * Préremplissage du formulaire « Profil des emprunteurs ».
 *
 * Stéphanie connaît déjà le nom et l'adresse de ses emprunteurs quand elle envoie le lien :
 * les leur faire retaper est la première occasion de se tromper — une adresse mal recopiée et
 * l'accusé de signature part dans le vide, ou le lien de co-signature n'arrive jamais.
 * `/preparer-profil` fabrique donc un lien qui porte ces coordonnées, et `/profil-emprunteur`
 * les pose dans les champs.
 *
 * **Ce n'est qu'un préremplissage, jamais une autorité.** Les champs restent modifiables — le
 * client doit pouvoir corriger une faute de frappe qui vient d'elle — et la validation qui
 * compte reste celle de `/api/profil-submit` (`parserSignataires`). Le paramètre n'est pas
 * signé et n'a pas à l'être : il n'ouvre aucun accès et ne fait rien qu'un visiteur ne puisse
 * déjà faire en tapant ces mêmes valeurs dans le formulaire.
 *
 * Le décodage est **tolérant par champ, jamais par confiance** : ce qui ne tient pas la route
 * (adresse mal formée, nom d'une lettre, doublon) est laissé de côté plutôt que d'être posé
 * dans le formulaire ; ce qui reste est normalisé et plafonné exactement comme le fera le
 * serveur. Un lien tronqué par une messagerie ouvre donc un formulaire vierge — pas un
 * formulaire faux.
 *
 * Placé dans src/utils/ parce que netlify.toml inclut déjà `src/utils/**` dans les
 * included_files des fonctions SSR.
 *
 * @module profilPreparation
 */

import { MAX_SIGNATAIRES, NOM_MAX, NOM_MIN, estCourrielValide } from './profilEmprunteurs';

/** Nom du paramètre d'URL qui porte le préremplissage. Court : le lien est parfois texté. */
export const PARAM_PREREMPLISSAGE = 'p';

/** Longueur maximale acceptée pour le paramètre — au-delà, on ne décode même pas. */
export const PARAM_LONGUEUR_MAX = 1024;

const COURRIEL_MAX = 120;

/**
 * Un emprunteur tel que la courtière l'a préparé. Les deux champs peuvent être vides —
 * un nom sans adresse est utile (le client la complétera), une adresse sans nom aussi.
 */
export interface EmprunteurPrerempli {
  readonly nom: string;
  readonly courriel: string;
}

/* ------------------------------------------------------------------ */
/*  Base64url                                                          */
/* ------------------------------------------------------------------ */

// `btoa`/`atob` ne parlent que d'octets : le pont par TextEncoder/TextDecoder est ce qui
// permet aux accents de traverser (« Frédérique » ne survit pas à un btoa direct).

function encoderBase64Url(texte: string): string {
  const octets = new TextEncoder().encode(texte);
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decoderBase64Url(valeur: string): string | null {
  try {
    const base64 = valeur.replace(/-/g, '+').replace(/_/g, '/');
    const binaire = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const octets = Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
    return new TextDecoder().decode(octets);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Normalisation                                                      */
/* ------------------------------------------------------------------ */

/** Espaces normalisées et longueur plafonnée — mêmes bornes que `parserSignataires`. */
function normaliserNom(valeur: unknown): string {
  if (typeof valeur !== 'string') return '';
  const nom = valeur.replace(/\s+/g, ' ').trim();
  return nom.length >= NOM_MIN ? nom.slice(0, NOM_MAX) : '';
}

/** Adresse en minuscules, ou chaîne vide si elle ne passerait pas la validation du serveur. */
function normaliserCourriel(valeur: unknown): string {
  if (typeof valeur !== 'string') return '';
  const courriel = valeur.trim().toLowerCase().slice(0, COURRIEL_MAX);
  return estCourrielValide(courriel) ? courriel : '';
}

/**
 * Nettoie une liste d'emprunteurs : normalise chaque champ, écarte les entrées vides et les
 * adresses en double, et s'arrête à `MAX_SIGNATAIRES`.
 *
 * Deux emprunteurs qui partagent une adresse font échouer la soumission côté serveur — les
 * préremplir tous les deux ne ferait que déplacer l'erreur à la fin du parcours.
 */
export function normaliserEmprunteurs(entrees: readonly unknown[]): EmprunteurPrerempli[] {
  const emprunteurs: EmprunteurPrerempli[] = [];
  const adressesVues = new Set<string>();

  for (const entree of entrees) {
    if (emprunteurs.length >= MAX_SIGNATAIRES) break;
    if (typeof entree !== 'object' || entree === null) continue;

    const brut = entree as Record<string, unknown>;
    const nom = normaliserNom(brut.nom);
    let courriel = normaliserCourriel(brut.courriel);

    if (courriel && adressesVues.has(courriel)) courriel = '';
    if (!nom && !courriel) continue;

    if (courriel) adressesVues.add(courriel);
    emprunteurs.push({ nom, courriel });
  }

  return emprunteurs;
}

/* ------------------------------------------------------------------ */
/*  Encodage du lien                                                   */
/* ------------------------------------------------------------------ */

/**
 * Encode les emprunteurs préparés en une valeur de paramètre d'URL.
 * Retourne `null` s'il ne reste rien d'utilisable — un lien sans préremplissage est le lien
 * vierge, et il vaut mieux le dire que produire un paramètre qui ne remplira rien.
 */
export function encoderPreremplissage(entrees: readonly unknown[]): string | null {
  const emprunteurs = normaliserEmprunteurs(entrees);
  if (emprunteurs.length === 0) return null;
  // Paires plutôt qu'objets : le lien passe parfois par un texto, chaque caractère compte.
  const paires = emprunteurs.map((emprunteur) => [emprunteur.nom, emprunteur.courriel]);
  return encoderBase64Url(JSON.stringify(paires));
}

/**
 * Décode le paramètre reçu. `null` dès que rien d'exploitable n'en sort : le formulaire
 * s'ouvre alors vierge, ce qui est le comportement d'avant le préremplissage.
 */
export function decoderPreremplissage(valeur: unknown): EmprunteurPrerempli[] | null {
  if (typeof valeur !== 'string') return null;
  const brut = valeur.trim();
  if (brut === '' || brut.length > PARAM_LONGUEUR_MAX) return null;

  const texte = decoderBase64Url(brut);
  if (texte === null) return null;

  let analyse: unknown;
  try {
    analyse = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!Array.isArray(analyse)) return null;

  const emprunteurs = normaliserEmprunteurs(
    analyse.map((paire) =>
      Array.isArray(paire) ? { nom: paire[0], courriel: paire[1] } : paire,
    ),
  );
  return emprunteurs.length > 0 ? emprunteurs : null;
}

/**
 * Le lien à envoyer au client. `racine` est l'origine du site, sans barre oblique finale.
 * Sans préremplissage exploitable, c'est le lien vierge qui est rendu — jamais une URL
 * portant un paramètre inerte.
 */
export function lienProfilPrerempli(racine: string, entrees: readonly unknown[]): string {
  const base = `${racine.replace(/\/+$/, '')}/profil-emprunteur`;
  const parametre = encoderPreremplissage(entrees);
  return parametre === null ? base : `${base}?${PARAM_PREREMPLISSAGE}=${parametre}`;
}
