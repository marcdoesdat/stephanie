/**
 * Accès réservé à la courtière — porte d'entrée de /contrat.
 *
 * Le générateur de contrats produit des documents à en-tête Hypotheca portant le nom et le
 * numéro AMF de Stéphanie. Une URL non listée ne suffit pas : n'importe qui la recevant
 * pourrait émettre un contrat en son nom. D'où un mot de passe partagé, lu dans
 * `CONTRAT_MOT_DE_PASSE`.
 *
 * Le mot de passe n'est jamais stocké côté client. Après vérification, un jeton d'accès
 * `expiration.signature` est déposé en cookie : c'est un HMAC-SHA256 de l'expiration, avec
 * le mot de passe pour clé. Aucun stockage serveur, et un cookie volé cesse de valoir
 * quelque chose à l'échéance.
 *
 * **Fail closed** : sans variable d'environnement en production, l'accès est refusé plutôt
 * qu'ouvert. En développement, la porte reste ouverte pour pouvoir travailler en local.
 *
 * @module accesCourtiere
 */

/** Nom du cookie d'accès. HttpOnly + SameSite=Strict, posé par /api/contrat-acces. */
export const COOKIE_ACCES = 'contrat_acces';

/** Durée d'une session d'accès. Assez longue pour préparer plusieurs contrats d'affilée. */
export const DUREE_ACCES_MS = 12 * 60 * 60 * 1000;

/** Longueur minimale exigée du mot de passe partagé — un secret court ne protège rien. */
export const MOT_DE_PASSE_MIN = 12;

function motDePasse(): string | null {
  const valeur = process.env.CONTRAT_MOT_DE_PASSE;
  return valeur && valeur.length >= MOT_DE_PASSE_MIN ? valeur : null;
}

/** Vrai si un mot de passe utilisable est configuré. */
export function accesConfigure(): boolean {
  return motDePasse() !== null;
}

/**
 * En développement sans variable d'environnement, la porte reste ouverte : sinon il devient
 * impossible d'ouvrir /contrat en local. Jamais en production.
 */
export function accesLibreEnDev(): boolean {
  return !accesConfigure() && import.meta.env.DEV === true;
}

/** Comparaison à temps constant — évite de distinguer deux secrets par la durée du test. */
function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/** Vérifie le mot de passe saisi. Faux si aucun mot de passe n'est configuré. */
export function verifierMotDePasse(fourni: unknown): boolean {
  const attendu = motDePasse();
  if (!attendu || typeof fourni !== 'string') return false;
  return egaliteConstante(fourni, attendu);
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

/** Fabrique le jeton à déposer en cookie après une authentification réussie. */
export async function creerJetonAcces(maintenant = Date.now()): Promise<string | null> {
  const secret = motDePasse();
  if (!secret) return null;
  const expiration = String(maintenant + DUREE_ACCES_MS);
  return `${expiration}.${await signer(expiration, secret)}`;
}

/**
 * Valide un jeton d'accès présenté en cookie.
 *
 * Retourne faux si le jeton est malformé, expiré, ou signé avec un autre mot de passe —
 * changer `CONTRAT_MOT_DE_PASSE` invalide donc toutes les sessions en cours, ce qui est
 * exactement ce qu'on attend d'une rotation de secret.
 */
export async function jetonAccesValide(jeton: unknown, maintenant = Date.now()): Promise<boolean> {
  const secret = motDePasse();
  if (!secret || typeof jeton !== 'string') return false;

  const separateur = jeton.indexOf('.');
  if (separateur <= 0) return false;

  const expiration = jeton.slice(0, separateur);
  const signature = jeton.slice(separateur + 1);
  if (!/^\d+$/.test(expiration) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Number(expiration) < maintenant) return false;

  return egaliteConstante(signature, await signer(expiration, secret));
}

/** Lit le jeton d'accès dans l'en-tête `Cookie` d'une requête. */
export function jetonDepuisCookies(request: Request): string | null {
  const brut = request.headers.get('cookie');
  if (!brut) return null;
  for (const morceau of brut.split(';')) {
    const [nom, ...reste] = morceau.trim().split('=');
    if (nom === COOKIE_ACCES) return decodeURIComponent(reste.join('='));
  }
  return null;
}

/**
 * Verdict d'accès pour une requête — utilisé par la page /contrat comme par l'endpoint
 * /api/contrat-creer. Les deux doivent trancher pareil : une page protégée devant une API
 * ouverte ne protège rien.
 */
export async function requeteAutorisee(request: Request): Promise<boolean> {
  if (accesLibreEnDev()) return true;
  return jetonAccesValide(jetonDepuisCookies(request));
}

/** En-tête `Set-Cookie` d'ouverture de session. */
export function enteteCookieAcces(jeton: string, securise: boolean): string {
  const attributs = [
    `${COOKIE_ACCES}=${encodeURIComponent(jeton)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(DUREE_ACCES_MS / 1000)}`,
  ];
  if (securise) attributs.push('Secure');
  return attributs.join('; ');
}
