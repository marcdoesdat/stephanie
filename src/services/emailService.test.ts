import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, clientIpFromRequest, sendEmail } from './emailService';

// Netlify Blobs en mémoire : le compteur de la limite de débit y vit, comme en production.
const blobs = vi.hoisted(() => new Map<string, string>());
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => void blobs.set(cle, valeur),
  }),
}));

const COURRIEL = { from: 'steph@exemple.ca', to: 'client@exemple.ca', subject: 'Sujet', html: '<p>Bonjour</p>' };

/**
 * Faux Resend qui répond selon un scénario donné, statut par statut. `retryAfter` alimente
 * l'en-tête que Resend renvoie parfois avec un 429.
 */
function installerResend(statuts: readonly number[], retryAfter: string | null = null) {
  const appels: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const statut = statuts[appels.length] ?? 200;
      appels.push(statut);
      return {
        ok: statut < 400,
        status: statut,
        headers: { get: () => retryAfter },
        text: async () => 'détail',
      } as unknown as Response;
    }),
  );
  return appels;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendEmail', () => {
  it('réessaie après un 429 plutôt que de perdre le courriel', async () => {
    const appels = installerResend([429, 200]);

    const envoi = sendEmail('clé', COURRIEL);
    await vi.advanceTimersByTimeAsync(1200);

    await expect(envoi).resolves.toBeUndefined();
    expect(appels).toEqual([429, 200]);
  });

  it('abandonne après deux relances, en nommant le statut', async () => {
    const appels = installerResend([429, 429, 429]);

    const envoi = sendEmail('clé', COURRIEL);
    const verdict = expect(envoi).rejects.toThrow(/Resend HTTP 429/);
    await vi.advanceTimersByTimeAsync(5000);
    await verdict;

    expect(appels).toHaveLength(3);
  });

  it('respecte Retry-After quand Resend l’indique', async () => {
    const appels = installerResend([429, 200], '2');

    const envoi = sendEmail('clé', COURRIEL);
    // Rien ne doit repartir avant les deux secondes demandées.
    await vi.advanceTimersByTimeAsync(1500);
    expect(appels).toEqual([429]);

    await vi.advanceTimersByTimeAsync(700);
    await expect(envoi).resolves.toBeUndefined();
    expect(appels).toEqual([429, 200]);
  });

  it('plafonne l’attente : une fonction SSR n’a pas une minute devant elle', async () => {
    const appels = installerResend([429, 200], '600');

    const envoi = sendEmail('clé', COURRIEL);
    await vi.advanceTimersByTimeAsync(3100);

    await expect(envoi).resolves.toBeUndefined();
    expect(appels).toEqual([429, 200]);
  });

  it('ne réessaie pas une adresse refusée — un 422 ne changera pas d’avis', async () => {
    const appels = installerResend([422, 200]);

    const envoi = sendEmail('clé', COURRIEL);
    const verdict = expect(envoi).rejects.toThrow(/Resend HTTP 422/);
    await vi.advanceTimersByTimeAsync(5000);
    await verdict;

    expect(appels).toEqual([422]);
  });
});

function requete(entetes: Record<string, string>): Request {
  return new Request('https://stephanieweyman.ca/api/contrat-acces', { method: 'POST', headers: entetes });
}

describe('clientIpFromRequest', () => {
  it('prend l’adresse vue par Netlify, pas celle que le client écrit dans X-Forwarded-For', () => {
    vi.stubEnv('DEV', false);
    const ip = clientIpFromRequest(
      requete({ 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('en production, n’accepte jamais un en-tête de proxy à la place de celui de Netlify', () => {
    vi.stubEnv('DEV', false);
    expect(clientIpFromRequest(requete({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' }))).toBe('unknown');
  });

  it('en dev local, se rabat sur les en-têtes de proxy', () => {
    vi.stubEnv('DEV', true);
    expect(clientIpFromRequest(requete({ 'x-forwarded-for': '10.0.0.2, 10.0.0.1' }))).toBe('10.0.0.2');
    expect(clientIpFromRequest(requete({}))).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => blobs.clear());

  it('bloque la sixième tentative de l’heure, même sans la variable NETLIFY', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('NETLIFY', '');
    const verdicts: boolean[] = [];
    for (let i = 0; i < 6; i++) verdicts.push(await checkRateLimit('203.0.113.7', 'contrat-acces'));
    expect(verdicts).toEqual([true, true, true, true, true, false]);
  });

  it('compte chaque adresse et chaque formulaire à part', async () => {
    vi.stubEnv('DEV', false);
    for (let i = 0; i < 5; i++) await checkRateLimit('203.0.113.7', 'contrat-acces');
    expect(await checkRateLimit('203.0.113.8', 'contrat-acces')).toBe(true);
    expect(await checkRateLimit('203.0.113.7', 'rappel')).toBe(true);
  });

  it('reste ouverte en dev local', async () => {
    vi.stubEnv('DEV', true);
    for (let i = 0; i < 10; i++) expect(await checkRateLimit('127.0.0.1', 'contrat-acces')).toBe(true);
  });
});
