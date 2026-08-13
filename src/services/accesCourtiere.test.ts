/**
 * Tests de la porte d'entrée du générateur de contrats.
 *
 * Ce que ces tests protègent : le générateur produit des documents à en-tête Hypotheca au
 * nom de Stéphanie et portant son numéro AMF. Une régression qui ouvrirait la porte en
 * production — variable oubliée traitée comme « pas de mot de passe requis », jeton non
 * vérifié, expiration ignorée — laisserait n'importe qui émettre un contrat en son nom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COOKIE_ACCES,
  DUREE_ACCES_MS,
  accesConfigure,
  creerJetonAcces,
  enteteCookieAcces,
  jetonAccesValide,
  jetonDepuisCookies,
  requeteAutorisee,
  verifierMotDePasse,
} from './accesCourtiere';

const SECRET = 'un-mot-de-passe-assez-long';

function avecSecret(valeur: string | undefined): void {
  if (valeur === undefined) delete process.env.CONTRAT_MOT_DE_PASSE;
  else process.env.CONTRAT_MOT_DE_PASSE = valeur;
}

function requete(cookie?: string): Request {
  return new Request('https://exemple.ca/contrat', {
    headers: cookie ? { cookie } : {},
  });
}

afterEach(() => {
  avecSecret(undefined);
  vi.unstubAllEnvs();
});

describe('accesConfigure', () => {
  it('exige un mot de passe d’au moins 12 caractères', () => {
    avecSecret(undefined);
    expect(accesConfigure()).toBe(false);
    avecSecret('court');
    expect(accesConfigure()).toBe(false);
    avecSecret(SECRET);
    expect(accesConfigure()).toBe(true);
  });
});

describe('verifierMotDePasse', () => {
  it('accepte le bon mot de passe et refuse tout le reste', () => {
    avecSecret(SECRET);
    expect(verifierMotDePasse(SECRET)).toBe(true);
    expect(verifierMotDePasse(`${SECRET} `)).toBe(false);
    expect(verifierMotDePasse(SECRET.toUpperCase())).toBe(false);
    expect(verifierMotDePasse('')).toBe(false);
    expect(verifierMotDePasse(null)).toBe(false);
    expect(verifierMotDePasse(123)).toBe(false);
  });

  it('refuse tout quand aucun mot de passe n’est configuré', () => {
    avecSecret(undefined);
    expect(verifierMotDePasse('')).toBe(false);
    expect(verifierMotDePasse('n’importe quoi')).toBe(false);
  });

  it('refuse un mot de passe configuré trop court, même s’il correspond', () => {
    // Sinon une variable posée à « test » ferait office de secret.
    avecSecret('court');
    expect(verifierMotDePasse('court')).toBe(false);
  });
});

describe('jetons d’accès', () => {
  it('accepte un jeton fraîchement émis', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonAcces();
    expect(jeton).not.toBeNull();
    expect(await jetonAccesValide(jeton)).toBe(true);
  });

  it('refuse un jeton expiré', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonAcces(Date.now() - DUREE_ACCES_MS - 1000);
    expect(await jetonAccesValide(jeton)).toBe(false);
  });

  it('refuse un jeton signé avec un autre mot de passe', async () => {
    // C'est ce qui fait qu'une rotation de secret invalide les sessions en cours.
    avecSecret(SECRET);
    const jeton = await creerJetonAcces();
    avecSecret('un-autre-mot-de-passe-long');
    expect(await jetonAccesValide(jeton)).toBe(false);
  });

  it('refuse un jeton dont l’expiration a été retouchée', async () => {
    avecSecret(SECRET);
    const jeton = (await creerJetonAcces())!;
    const signature = jeton.slice(jeton.indexOf('.') + 1);
    const trafique = `${Date.now() + 10 * DUREE_ACCES_MS}.${signature}`;
    expect(await jetonAccesValide(trafique)).toBe(false);
  });

  it('refuse les jetons malformés', async () => {
    avecSecret(SECRET);
    for (const mauvais of ['', '.', 'abc', 'abc.def', `${Date.now() + 1000}.zz`, null, 42]) {
      expect(await jetonAccesValide(mauvais)).toBe(false);
    }
  });

  it('n’émet ni ne valide rien sans mot de passe configuré', async () => {
    avecSecret(undefined);
    expect(await creerJetonAcces()).toBeNull();
    expect(await jetonAccesValide('peu importe')).toBe(false);
  });
});

describe('jetonDepuisCookies', () => {
  it('retrouve le jeton parmi d’autres cookies', () => {
    expect(jetonDepuisCookies(requete(`autre=1; ${COOKIE_ACCES}=abc; encore=2`))).toBe('abc');
  });

  it('décode la valeur et gère les « = » internes', () => {
    expect(jetonDepuisCookies(requete(`${COOKIE_ACCES}=123.abc%3Ddef`))).toBe('123.abc=def');
  });

  it('retourne null quand le cookie est absent', () => {
    expect(jetonDepuisCookies(requete('autre=1'))).toBeNull();
    expect(jetonDepuisCookies(requete())).toBeNull();
  });
});

describe('requeteAutorisee', () => {
  it('autorise une requête munie d’un cookie valide', async () => {
    avecSecret(SECRET);
    const jeton = await creerJetonAcces();
    expect(await requeteAutorisee(requete(`${COOKIE_ACCES}=${encodeURIComponent(jeton!)}`))).toBe(true);
  });

  it('refuse une requête sans cookie', async () => {
    avecSecret(SECRET);
    expect(await requeteAutorisee(requete())).toBe(false);
  });

  it('refuse en production quand la variable d’environnement manque', async () => {
    // Le point le plus important du module : sans secret, on ferme, on n'ouvre pas.
    avecSecret(undefined);
    vi.stubEnv('DEV', false);
    expect(await requeteAutorisee(requete())).toBe(false);
  });

  it('laisse passer en développement quand la variable manque', async () => {
    avecSecret(undefined);
    vi.stubEnv('DEV', true);
    expect(await requeteAutorisee(requete())).toBe(true);
  });

  it('exige quand même le cookie en développement si un secret est configuré', async () => {
    avecSecret(SECRET);
    vi.stubEnv('DEV', true);
    expect(await requeteAutorisee(requete())).toBe(false);
  });
});

describe('enteteCookieAcces', () => {
  it('pose un cookie HttpOnly, SameSite=Strict et limité dans le temps', () => {
    const entete = enteteCookieAcces('jeton', true);
    expect(entete).toContain(`${COOKIE_ACCES}=jeton`);
    expect(entete).toContain('HttpOnly');
    expect(entete).toContain('SameSite=Strict');
    expect(entete).toContain('Secure');
    expect(entete).toContain(`Max-Age=${Math.floor(DUREE_ACCES_MS / 1000)}`);
  });

  it('omet Secure hors HTTPS — sinon le cookie ne serait jamais posé en local', () => {
    expect(enteteCookieAcces('jeton', false)).not.toContain('Secure');
  });
});
