/**
 * Tests des gabarits réécrits.
 *
 * Ce que ces tests protègent :
 *
 * 1. **Un modèle qui ne se rend pas ne s'enregistre pas.** Accepter `{{prenon}}` ferait
 *    échouer tous les aperçus suivants, et le seul recours serait de repartir de
 *    l'original — c'est-à-dire de perdre le texte qu'elle vient d'écrire.
 * 2. **Une section mal fermée part dans le courriel** si personne ne la refuse : elle ne
 *    lève pas au rendu, elle survit telle quelle.
 * 3. **La réécriture ne déborde pas de sa profession**, et l'original reste récupérable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();

function fauxStore() {
  return {
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void blobs.set(cle, valeur),
    delete: async (cle: string) => void blobs.delete(cle),
    list: async () => ({ blobs: [...blobs.keys()].map((cle) => ({ key: cle })) }),
  };
}

const getStore = vi.fn(() => fauxStore() as unknown);
vi.mock('@netlify/blobs', () => ({ getStore: (...args: unknown[]) => getStore(...(args as [])) }));

async function chargerService(): Promise<typeof import('./reseauGabaritsService')> {
  vi.resetModules();
  return import('./reseauGabaritsService');
}

const TEXTE = 'Bonjour {{prenom}}, ici {{courtiere}}{{#agence}} — vu que vous êtes chez {{agence}}{{/agence}}.';

beforeEach(() => {
  blobs.clear();
  getStore.mockClear();
});

describe('gabaritEffectif', () => {
  it('sert le modèle d’origine tant que rien n’a été réécrit', async () => {
    const service = await chargerService();
    const effectif = await service.gabaritEffectif('introduction', 'notaire');
    expect(effectif.personnalise).toBe(false);
    expect(effectif.corps).toContain('signature qui dérape');
  });

  it('sert la réécriture une fois enregistrée', async () => {
    const service = await chargerService();
    await service.enregistrerSurcharge('introduction', 'notaire', 'Nouvel objet', TEXTE);

    const effectif = await service.gabaritEffectif('introduction', 'notaire');
    expect(effectif.personnalise).toBe(true);
    expect(effectif.objet).toBe('Nouvel objet');
    expect(effectif.corps).toBe(TEXTE);
  });

  it('ne déborde pas sur les autres professions ni sur les autres gabarits', async () => {
    const service = await chargerService();
    await service.enregistrerSurcharge('introduction', 'notaire', 'Nouvel objet', TEXTE);

    expect((await service.gabaritEffectif('introduction', 'comptable')).personnalise).toBe(false);
    expect((await service.gabaritEffectif('relance', 'notaire')).personnalise).toBe(false);
  });

  it('rend l’original récupérable', async () => {
    const service = await chargerService();
    const origine = service.gabaritOrigine('introduction', 'notaire');

    await service.enregistrerSurcharge('introduction', 'notaire', 'Nouvel objet', TEXTE);
    await service.oublierSurcharge('introduction', 'notaire');

    const effectif = await service.gabaritEffectif('introduction', 'notaire');
    expect(effectif.personnalise).toBe(false);
    expect(effectif.corps).toBe(origine.corps);
  });
});

describe('validation à l’enregistrement', () => {
  it('refuse une variable inconnue', async () => {
    const service = await chargerService();
    const verdict = await service.enregistrerSurcharge(
      'introduction',
      'notaire',
      'Objet',
      'Bonjour {{prenon}}, ravie de vous écrire aujourd’hui.',
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.erreur).toMatch(/inconnue/);
  });

  it('refuse une section mal fermée — elle partirait telle quelle dans le courriel', async () => {
    const service = await chargerService();
    const verdict = await service.enregistrerSurcharge(
      'introduction',
      'notaire',
      'Objet',
      'Bonjour {{prenom}}{{#agence}} chez {{agence}} — ravie de vous écrire aujourd’hui.',
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.erreur).toMatch(/accolades/);
  });

  it('refuse aussi une variable inconnue dans l’objet', async () => {
    const service = await chargerService();
    const verdict = await service.enregistrerSurcharge(
      'introduction',
      'notaire',
      'Bonjour {{ville}}',
      TEXTE,
    );
    expect(verdict.ok).toBe(false);
  });

  it('n’écrit rien quand le modèle est refusé', async () => {
    const service = await chargerService();
    await service.enregistrerSurcharge('introduction', 'notaire', 'Objet', 'Bonjour {{prenon}} — ravie.');
    expect((await service.gabaritEffectif('introduction', 'notaire')).personnalise).toBe(false);
  });
});
