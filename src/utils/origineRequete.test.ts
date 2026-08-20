/**
 * Tests de la vérification d'origine (CSRF) reprise à la main dans `src/middleware.ts`, dont la logique vit dans `src/utils/origineRequete.ts`.
 *
 * Désactiver `security.checkOrigin` et réécrire la règle soi-même n'est acceptable qu'à une
 * condition : que la règle réécrite soit **la même**. Ces tests la comparent au comportement
 * d'Astro, cas par cas, et vérifient que la dispense ne couvre que la route qui la justifie.
 */
import { describe, expect, it } from 'vitest';
import { origineNonVerifiee, origineRefusee } from './origineRequete';

const SITE = 'https://stephanieweyman.ca';
const FORMULAIRE = 'application/x-www-form-urlencoded';

describe('la règle d’Astro, à l’identique', () => {
  it('laisse passer les méthodes qui ne modifient rien', () => {
    for (const methode of ['GET', 'HEAD', 'OPTIONS']) {
      expect(origineRefusee(methode, null, SITE, null)).toBe(false);
      expect(origineRefusee(methode, 'https://ailleurs.example', SITE, FORMULAIRE)).toBe(false);
    }
  });

  it('laisse passer un formulaire de même origine', () => {
    expect(origineRefusee('POST', SITE, SITE, FORMULAIRE)).toBe(false);
    expect(origineRefusee('POST', SITE, SITE, 'multipart/form-data; boundary=x')).toBe(false);
  });

  it('refuse un formulaire venu d’ailleurs', () => {
    for (const type of [FORMULAIRE, 'multipart/form-data', 'text/plain']) {
      expect(origineRefusee('POST', 'https://ailleurs.example', SITE, type)).toBe(true);
      expect(origineRefusee('POST', null, SITE, type)).toBe(true);
    }
    expect(origineRefusee('DELETE', null, SITE, FORMULAIRE)).toBe(true);
  });

  // Les routes JSON du site ne sont pas atteignables par un formulaire HTML — le navigateur
  // exigerait une requête préalable (CORS). Astro les laisse donc passer, et nous aussi.
  it('laisse passer le JSON, comme Astro', () => {
    expect(origineRefusee('POST', 'https://ailleurs.example', SITE, 'application/json')).toBe(false);
  });

  // Un POST sans `content-type` du tout : Astro exige alors la même origine.
  it('exige la même origine quand il n’y a pas de content-type', () => {
    expect(origineRefusee('POST', null, SITE, null)).toBe(true);
    expect(origineRefusee('POST', SITE, SITE, null)).toBe(false);
  });
});

describe('la dispense', () => {
  // C'est tout l'objet du changement : le fournisseur de messagerie qui exécute un retrait
  // en un clic poste depuis ses serveurs, sans navigateur, donc sans en-tête « Origin ».
  it('couvre le lien de désabonnement, que des serveurs tiers appellent', () => {
    expect(origineNonVerifiee('/api/reseau-retrait')).toBe(true);
    expect(origineNonVerifiee('/api/reseau-retrait/')).toBe(true);
  });

  it('ne couvre rien d’autre — surtout pas les routes de la courtière', () => {
    for (const route of [
      '/api/reseau-envoi',
      '/api/reseau-contact',
      '/api/contrat-creer',
      '/api/contrat-signer',
      '/api/crm-dossier',
      '/api/dossier-acces',
      '/api/rappel-submit',
      '/api/reseau-retrait-bis',
      '/',
    ]) {
      expect(origineNonVerifiee(route)).toBe(false);
    }
  });
});
