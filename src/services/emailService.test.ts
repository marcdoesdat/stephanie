import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from './emailService';

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
