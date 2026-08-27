/**
 * Tests de l'envoi en lot — `/api/reseau-envoi-lot`.
 *
 * Ce que ces tests protègent, c'est la promesse que l'écran affiche : un bilan qui dit la
 * vérité. Un lot où un courriel échoue ne doit pas faire croire que tout est parti, un
 * contact retiré ne doit recevoir rien, et le plafond du jour doit arrêter la demande
 * **avant** le premier octet — sans quoi la protection de la délivrabilité ne protège plus.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 *
 * Le store est simulé par une Map partagée, et chaque test repart de modules frais
 * (`vi.resetModules`) : c'est le patron de `reseauContactService.test.ts`, qui évite qu'une
 * instance de service antérieure garde sa propre mémoire et mente sur l'état du carnet.
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

const envoyer =
  vi.fn<(cle: string, courriel: import('./emailService').ResendEmail) => Promise<void>>();
vi.mock('./emailService', async (original) => ({
  ...(await original<typeof import('./emailService')>()),
  sendEmail: envoyer,
}));

vi.mock('./accesCourtiere', () => ({ requeteAutorisee: async () => true }));

const DONNEES = (nom: string, courriel: string) => ({
  nom,
  courriel,
  telephone: '',
  agence: '',
  secteur: '',
  profession: 'courtier-immobilier',
  notes: '',
  consentement: { base: 'tacite_publie', source: 'site de l’agence' },
}) as const;

type Handler = (contexte: { request: Request; clientAddress?: string }) => Promise<Response>;

type Service = typeof import('./reseauContactService');
type RouteLot = typeof import('../pages/api/reseau-envoi-lot');

async function chargerService(): Promise<Service> {
  vi.resetModules();
  return import('./reseauContactService');
}

async function chargerRoute(): Promise<RouteLot> {
  vi.resetModules();
  return import('../pages/api/reseau-envoi-lot');
}

/** Crée un contact et retourne sa fiche, avec l'état demandé. */
async function creer(
  service: Service,
  nom: string,
  courriel: string,
  etat?: 'contacte' | 'relance' | 'refuse',
) {
  const resultat = await service.creerContact(DONNEES(nom, courriel) as never);
  const contact = 'doublon' in resultat ? resultat.doublon : resultat;
  if (etat) await service.changerEtat(contact.id, etat);
  return (await service.lireContact(contact.id))!;
}

/** Poste un lot et rend la réponse, le corps lu. */
async function poster(lot: string[], gabarit = 'introduction') {
  const route = await chargerRoute();
  const reponse = await (route.POST as unknown as Handler)({
    request: new Request('https://stephanieweyman.ca/api/reseau-envoi-lot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lot, gabarit }),
    }),
  });
  const corps = (await reponse.json()) as {
    error?: string;
    code?: string;
    bilan?: {
      envoyes: Array<{ nom: string; courriel: string }>;
      echoues: Array<{ nom: string; raison: string }>;
      ignores: Array<{ nom: string; courriel: string; raison: string }>;
      simule: boolean;
      envoisDuJour: number;
    };
  };
  return { statut: reponse.status, corps };
}

beforeEach(() => {
  blobs.clear();
  getStore.mockClear();
  envoyer.mockClear();
  process.env.RESEND_API_KEY = 'cle';
  process.env.RESEND_FROM_EMAIL = 'site@stephanieweyman.ca';
  process.env.RESEND_NOTIFY_EMAIL = 'boite@stephanieweyman.ca';
});

describe('le lot part, en entier', () => {
  it('envoie à chacun, avec son propre rendu, et fait avancer les états', async () => {
    const service = await chargerService();
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');
    const jean = await creer(service, 'Jean Bernard', 'jean@cabinet.ca');

    const { statut, corps } = await poster([marie.id, jean.id]);

    expect(statut).toBe(200);
    expect(corps.bilan?.envoyes).toHaveLength(2);
    expect(corps.bilan?.echoues).toHaveLength(0);
    expect(corps.bilan?.ignores).toHaveLength(0);
    expect(corps.bilan?.envoisDuJour).toBe(2);
    expect(envoyer).toHaveBeenCalledTimes(2);

    // Chacun a reçu **son** message : pas de variable orpheline, et les prénoms diffèrent.
    const [premier, second] = envoyer.mock.calls.map(([, courriel]) => courriel);
    expect(premier?.to).toBe('marie@agence.ca');
    expect(second?.to).toBe('jean@cabinet.ca');
    for (const courriel of [premier, second]) {
      expect(courriel?.subject).not.toMatch(/\{\{/);
      expect(courriel?.html).not.toMatch(/\{\{/);
      expect(courriel?.html).toContain('me retirer de la liste');
    }
    expect(JSON.stringify(premier?.html)).not.toBe(JSON.stringify(second?.html));

    // L'état a avancé pour chacun, dans le carnet — pas seulement dans le bilan.
    expect(await service.lireContact(marie.id)).toMatchObject({ etat: 'contacte' });
    expect(await service.lireContact(jean.id)).toMatchObject({ etat: 'contacte' });

    // Le journal dit ce qui est parti.
    const apres = await service.lireContact(marie.id);
    expect(apres?.historique.some((e) => e.type === 'courriel')).toBe(true);
  });

  it('journalise le gabarit employé, comme l’envoi un par un', async () => {
    const service = await chargerService();
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');

    await poster([marie.id], 'relance');

    const apres = await service.lireContact(marie.id);
    const envoi = apres?.historique.find((e) => e.type === 'courriel');
    expect(envoi?.gabarit).toBe('relance');
  });
});

describe('les refus tiennent, même en lot', () => {
  it('un contact retiré est ignoré — nommé au bilan, jamais écrit', async () => {
    const service = await chargerService();
    const retrait = await creer(service, 'Louis Retiré', 'louis@agence.ca', 'refuse');
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence2.ca');

    const { statut, corps } = await poster([retrait.id, marie.id]);

    expect(statut).toBe(200);
    expect(corps.bilan?.envoyes.map((l) => l.nom)).toEqual(['Marie Tremblay']);
    expect(corps.bilan?.ignores).toEqual([
      { nom: 'Louis Retiré', courriel: 'louis@agence.ca', raison: 'retrait' },
    ]);
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer.mock.calls[0]?.[1]?.to).toBe('marie@agence2.ca');
    expect(await service.lireContact(retrait.id)).toMatchObject({ etat: 'refuse' });
  });

  it('une fiche supprimée entre-temps ne fait pas échouer le lot', async () => {
    const service = await chargerService();
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');

    const { statut, corps } = await poster(['fiche-disparue', marie.id]);

    expect(statut).toBe(200);
    expect(corps.bilan?.envoyes).toHaveLength(1);
    expect(corps.bilan?.ignores).toHaveLength(0);
  });

  it('le plafond du jour refuse le lot entier, avant tout envoi', async () => {
    const service = await chargerService();
    // Douze envois déjà journalisés aujourd'hui : le plafond est atteint.
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');
    const message = {
      gabarit: 'introduction' as const,
      objet: 'Financement hypothécaire',
      corps: 'Bonjour, voici mon message assez long pour être valide.',
    };
    for (let index = 0; index < 12; index += 1) {
      await service.journaliserEnvoi(marie.id, message);
    }
    const jean = await creer(service, 'Jean Bernard', 'jean@cabinet.ca');

    const { statut, corps } = await poster([jean.id]);

    expect(statut).toBe(429);
    expect(corps.code).toBe('plafond');
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('un gabarit qui ne se rend pas échoue avant le premier octet', async () => {
    const service = await chargerService();
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');
    const jean = await creer(service, 'Jean Bernard', 'jean@cabinet.ca');

    // La route doit importer le module espionné : modules frais, espion posé **avant**.
    vi.resetModules();
    const gabarits = await import('./reseauGabaritsService');
    const espion = vi
      .spyOn(gabarits, 'rendrePourContact')
      .mockRejectedValue(new Error('Variable de gabarit inconnue : {{prenomm}}'));
    const route = await import('../pages/api/reseau-envoi-lot');

    try {
      const reponse = await (route.POST as unknown as Handler)({
        request: new Request('https://stephanieweyman.ca/api/reseau-envoi-lot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lot: [marie.id, jean.id], gabarit: 'introduction' }),
        }),
      });
      const corps = (await reponse.json()) as { error?: string };

      expect(reponse.status).toBe(500);
      expect(corps.error).toContain('aucun courriel');
      expect(envoyer).not.toHaveBeenCalled();
    } finally {
      espion.mockRestore();
    }
  });
});

describe('en développement, sans Resend', () => {
  it('simule chaque envoi et le journalise comme tel', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_NOTIFY_EMAIL;

    const service = await chargerService();
    const marie = await creer(service, 'Marie Tremblay', 'marie@agence.ca');

    const { statut, corps } = await poster([marie.id]);

    expect(statut).toBe(200);
    expect(corps.bilan?.simule).toBe(true);
    expect(corps.bilan?.envoyes).toHaveLength(1);
    expect(envoyer).not.toHaveBeenCalled();

    const apres = await service.lireContact(marie.id);
    expect(apres?.etat).toBe('contacte');
    expect(apres?.historique.some((e) => e.type === 'courriel' && e.resume.includes('simulé'))).toBe(
      true,
    );
  });
});
