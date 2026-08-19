/**
 * Tests de la porte du portail client.
 *
 * Ce que ces tests protègent : un cookie de session ouvre le dossier d'une personne nommée —
 * son étape, sa liste de documents. Une régression qui accepterait un identifiant échangé
 * dans un cookie par ailleurs valide donnerait à n'importe quel client la vue du dossier de
 * n'importe quel autre. Et sans secret en production, la porte doit se fermer, pas s'ouvrir.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COOKIE_SESSION,
  DUREE_SESSION_MS,
  SECRET_MIN,
  creerJetonSession,
  dossierAutorise,
  dossierDepuisJeton,
  enteteCookieFin,
  enteteCookieSession,
  jetonDepuisCookies,
  portailConfigure,
} from './portailAcces';

const SECRET = 'un-secret-de-portail-assez-long-pour-passer';
const AUTRE_SECRET = 'un-autre-secret-de-portail-tout-aussi-long';
const DOSSIER = 'aBcD1234_-efGH';
const MAINTENANT = Date.parse('2026-05-14T12:00:00.000Z');

function avecSecret(valeur: string | undefined): void {
  if (valeur === undefined) delete process.env.PORTAIL_SECRET;
  else process.env.PORTAIL_SECRET = valeur;
}

function requete(cookie?: string): Request {
  return new Request('https://exemple.ca/mon-dossier', { headers: cookie ? { cookie } : {} });
}

afterEach(() => {
  avecSecret(undefined);
  vi.unstubAllEnvs();
});

describe('portailConfigure', () => {
  it('exige un secret d’au moins 32 caractères', () => {
    avecSecret(undefined);
    expect(portailConfigure()).toBe(false);
    avecSecret('trop-court');
    expect(portailConfigure()).toBe(false);
    avecSecret(SECRET);
    expect(portailConfigure()).toBe(true);
    expect(SECRET.length).toBeGreaterThanOrEqual(SECRET_MIN);
  });
});

describe('session', () => {
  it('ouvre le dossier qu’elle a signé, et lui seul', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    expect(jeton).not.toBeNull();
    expect(await dossierDepuisJeton(jeton, MAINTENANT)).toBe(DOSSIER);
  });

  it('refuse un jeton expiré', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    expect(await dossierDepuisJeton(jeton, MAINTENANT + DUREE_SESSION_MS + 1000)).toBeNull();
  });

  it('refuse un identifiant échangé dans un cookie par ailleurs valide', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    const [, expiration, signature] = jeton!.split('.') as [string, string, string];
    const trafique = `unAutreDossier.${expiration}.${signature}`;
    expect(await dossierDepuisJeton(trafique, MAINTENANT)).toBeNull();
  });

  it('refuse une expiration repoussée à la main', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    const [id, , signature] = jeton!.split('.') as [string, string, string];
    const trafique = `${id}.${MAINTENANT + DUREE_SESSION_MS * 10}.${signature}`;
    expect(await dossierDepuisJeton(trafique, MAINTENANT)).toBeNull();
  });

  it('refuse tout ce qui n’a pas la forme attendue', async () => {
    avecSecret(SECRET);
    for (const mauvais of ['', 'abc', 'a.b', `${DOSSIER}.abc.def`, `${DOSSIER}.${MAINTENANT}.zz`, null, 42]) {
      expect(await dossierDepuisJeton(mauvais, MAINTENANT), String(mauvais)).toBeNull();
    }
  });

  it('invalide toutes les sessions quand le secret tourne', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    avecSecret(AUTRE_SECRET);
    expect(await dossierDepuisJeton(jeton, MAINTENANT)).toBeNull();
  });
});

describe('fail closed', () => {
  it('ne signe ni ne valide rien en production sans secret', async () => {
    vi.stubEnv('DEV', false);
    avecSecret(undefined);
    expect(await creerJetonSession(DOSSIER, MAINTENANT)).toBeNull();
    expect(await dossierDepuisJeton(`${DOSSIER}.${MAINTENANT + 1000}.${'a'.repeat(64)}`, MAINTENANT)).toBeNull();
  });

  it('refuse aussi un secret trop court en production — une variable mal remplie n’ouvre pas', async () => {
    vi.stubEnv('DEV', false);
    avecSecret('trop-court');
    expect(await creerJetonSession(DOSSIER, MAINTENANT)).toBeNull();
  });

  it('reste utilisable en développement, pour pouvoir dérouler la chaîne en local', async () => {
    vi.stubEnv('DEV', true);
    avecSecret(undefined);
    const jeton = await creerJetonSession(DOSSIER, MAINTENANT);
    expect(jeton).not.toBeNull();
    expect(await dossierDepuisJeton(jeton, MAINTENANT)).toBe(DOSSIER);
    // …mais la page doit savoir que ce n'est pas une configuration de production.
    expect(portailConfigure()).toBe(false);
  });
});

describe('cookie', () => {
  it('lit le jeton parmi les autres cookies', async () => {
    avecSecret(SECRET);
    // `dossierAutorise` lit l'horloge réelle : le jeton doit donc être daté d'aujourd'hui.
    const jeton = await creerJetonSession(DOSSIER);
    const entete = `autre=valeur; ${COOKIE_SESSION}=${encodeURIComponent(jeton!)}; encore=1`;
    expect(jetonDepuisCookies(requete(entete))).toBe(jeton);
    expect(jetonDepuisCookies(requete())).toBeNull();
    expect(await dossierAutorise(requete(entete))).toBe(DOSSIER);
    expect(await dossierAutorise(requete())).toBeNull();
  });

  it('pose un cookie HttpOnly, SameSite=Lax, et Secure en HTTPS', () => {
    const entete = enteteCookieSession('jeton', true);
    expect(entete).toContain('HttpOnly');
    // Lax et non Strict : le client arrive par un lien cliqué dans son courriel.
    expect(entete).toContain('SameSite=Lax');
    expect(entete).toContain('Secure');
    expect(enteteCookieSession('jeton', false)).not.toContain('Secure');
  });

  it('sait refermer la session', () => {
    expect(enteteCookieFin(true)).toContain('Max-Age=0');
  });
});
