/**
 * L'accès du client à son propre dossier — la porte de `/mon-dossier`.
 *
 * Rien à voir avec `accesCourtiere` malgré la ressemblance de technique. Là-bas, un mot de
 * passe partagé ouvre les outils de Stéphanie ; ici, une adresse courriel reçoit un lien
 * éphémère qui ouvre **un seul** dossier — le sien.
 *
 * Deux temps, et c'est voulu :
 *
 * 1. **Le lien magique** (30 min, à usage unique) vit dans `dossierClientService` : c'est
 *    du stockage, pas de la cryptographie.
 * 2. **La session** vit ici : un cookie `dossierId.expiration.HMAC-SHA256`, sans aucun
 *    stockage serveur. Un client qui consulte son suivi trois fois par semaine pendant un
 *    mois ne doit pas redemander un lien à chaque fois — mais un jeton à usage unique ne
 *    peut pas, par construction, servir de session. D'où les deux.
 *
 * **La clé est `PORTAIL_SECRET`, jamais `CONTRAT_MOT_DE_PASSE`.** Dériver la session d'un
 * client du mot de passe administratif de Stéphanie ferait tomber tous les portails à chaque
 * rotation de son mot de passe, et ferait d'un secret client la fonction d'un secret à elle.
 * Ce sont deux populations et deux durées de vie : deux secrets.
 *
 * **Fail closed** : sans variable d'environnement en production, aucune session ne peut être
 * signée ni validée, et `/mon-dossier` le dit plutôt que d'échouer en silence.
 *
 * @module portailAcces
 */

/** Nom du cookie de session. HttpOnly + SameSite=Lax, posé par `/mon-dossier`. */
export const COOKIE_SESSION = 'dossier_session';

/**
 * Durée d'une session. Plus longue que celle de la courtière (12 h) : la cueillette des
 * documents s'étale sur des semaines, et redemander un lien à chaque consultation
 * apprendrait surtout au client à ne plus consulter.
 */
export const DUREE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** Longueur minimale exigée du secret — un secret court ne protège rien. */
export const SECRET_MIN = 32;

/**
 * Secret de repli, **en développement uniquement**.
 *
 * Ce n'en est pas un, et il ne doit jamais en être un : il n'est atteignable que si
 * `import.meta.env.DEV` est vrai, c'est-à-dire jamais dans une fonction Netlify. Sans lui,
 * dérouler le parcours en local exigerait de poser une variable d'environnement avant de
 * pouvoir seulement ouvrir la page — et la chaîne complète (lien imprimé en console →
 * session → écran) ne serait pas vérifiable sur une machine de développement.
 */
const SECRET_DEV = 'portail-developpement-local-ceci-nest-pas-un-secret';

function secret(): string | null {
  const valeur = process.env.PORTAIL_SECRET;
  if (valeur && valeur.length >= SECRET_MIN) return valeur;
  if (import.meta.env.DEV === true) return SECRET_DEV;
  return null;
}

/**
 * Vrai si un secret utilisable est configuré. `/mon-dossier` s'en sert pour dire clairement
 * que le portail est fermé, plutôt que d'offrir un formulaire qui n'aboutira jamais.
 */
export function portailConfigure(): boolean {
  const valeur = process.env.PORTAIL_SECRET;
  return typeof valeur === 'string' && valeur.length >= SECRET_MIN;
}

/** Comparaison à temps constant — évite de distinguer deux signatures par la durée du test. */
function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

async function signer(charge: string, cle: string): Promise<string> {
  const clef = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(cle),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', clef, new TextEncoder().encode(charge));
  return Array.from(new Uint8Array(signature))
    .map((octet) => octet.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fabrique le jeton de session d'un dossier donné.
 *
 * L'identifiant **et** l'expiration entrent tous deux dans la signature : signer l'expiration
 * seule laisserait échanger l'identifiant d'un cookie valide contre celui d'un autre dossier,
 * ce qui est précisément l'attaque contre laquelle un portail nominatif doit tenir.
 */
export async function creerJetonSession(
  dossierId: string,
  maintenant = Date.now(),
): Promise<string | null> {
  const cle = secret();
  if (!cle || !/^[A-Za-z0-9_-]+$/.test(dossierId)) return null;

  const expiration = String(maintenant + DUREE_SESSION_MS);
  const charge = `${dossierId}.${expiration}`;
  return `${charge}.${await signer(charge, cle)}`;
}

/**
 * Valide un jeton de session et rend l'identifiant du dossier qu'il ouvre.
 *
 * Retourne `null` si le jeton est malformé, expiré, ou signé avec un autre secret — changer
 * `PORTAIL_SECRET` invalide donc toutes les sessions en cours, ce qui est exactement ce
 * qu'on attend d'une rotation de secret.
 */
export async function dossierDepuisJeton(jeton: unknown, maintenant = Date.now()): Promise<string | null> {
  const cle = secret();
  if (!cle || typeof jeton !== 'string' || jeton.length > 512) return null;

  const morceaux = jeton.split('.');
  if (morceaux.length !== 3) return null;
  const [dossierId, expiration, signature] = morceaux as [string, string, string];

  if (!/^[A-Za-z0-9_-]+$/.test(dossierId) || dossierId.length > 64) return null;
  if (!/^\d+$/.test(expiration) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (Number(expiration) < maintenant) return null;

  const attendue = await signer(`${dossierId}.${expiration}`, cle);
  return egaliteConstante(signature, attendue) ? dossierId : null;
}

/** Lit le jeton de session dans l'en-tête `Cookie` d'une requête. */
export function jetonDepuisCookies(request: Request): string | null {
  const brut = request.headers.get('cookie');
  if (!brut) return null;
  for (const morceau of brut.split(';')) {
    const [nom, ...reste] = morceau.trim().split('=');
    if (nom === COOKIE_SESSION) return decodeURIComponent(reste.join('='));
  }
  return null;
}

/** Quel dossier cette requête a le droit d'ouvrir. `null` si aucune session valide. */
export async function dossierAutorise(request: Request): Promise<string | null> {
  return dossierDepuisJeton(jetonDepuisCookies(request));
}

/**
 * En-tête `Set-Cookie` d'ouverture de session.
 *
 * `SameSite=Lax` et non `Strict` comme pour la courtière : le client **arrive par un lien
 * cliqué dans son courriel**, et un cookie `Strict` posé au bout de cette navigation ne
 * serait pas renvoyé au premier rechargement de la page.
 */
export function enteteCookieSession(jeton: string, securise: boolean): string {
  const attributs = [
    `${COOKIE_SESSION}=${encodeURIComponent(jeton)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DUREE_SESSION_MS / 1000)}`,
  ];
  if (securise) attributs.push('Secure');
  return attributs.join('; ');
}

/** En-tête `Set-Cookie` de fermeture — sert au bouton « me déconnecter ». */
export function enteteCookieFin(securise: boolean): string {
  const attributs = [`${COOKIE_SESSION}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (securise) attributs.push('Secure');
  return attributs.join('; ');
}
