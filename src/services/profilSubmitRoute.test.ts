/**
 * Tests de la route /api/profil-submit.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro, et `src/**\/*.test.ts` est ramassé par Vitest — un test posé là serait
 * publié comme route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../pages/api/profil-submit';

/** Même tracé que profilPdfService.test.ts : un PNG transparent de 120 × 40. */
const TRACE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAELElEQVR4nO2ae4hMcRTHr2XFmp07I1q23Zl7r62NZXfu70dS/CXvFPIIobySkIhSSPL6Q5LyTKQklFd5P/JYSVn/IBRCeeSR8livtcv33B3F7J3ZMXMfazuf+nU1zdzfOb/vOed3fr+lKAzDMAzDMAzDMAzDMMx/QYuQblaEdTEnpIkNIV3uCevyYMgQu1VdrAobYmKguLw7fc9vQ5l/AKJGw4ZcBzFf4PmzsRHSxTuIfjhkmFPVSI+w3/anj8xF0C6E/efwPAvbDb8tchdNawPB1kKsb+kIayu2Ib8j409TdisdSvP9dikZIU2OgJ8P/g5UedZvu1wjEBVdIcqdTIW1Hbr8jOzYqxpmf6VplPEWEHUUbLudxN4zfhvoCnBuGJyrthdKfMCiHMK/l6iaGKfq5mh8NlvVzDX47ASV5/TEFs+p7AciZjfPHexYFkDGzoMNd1NUnjf5enmp57a5jarLMfYlWTxDIzVTKZR5jbwiBxnaE+VtJYLkfprZfYsCJqTFYu55VtY6GDWHQNQDGJ9SCFsDPzcHi7q1d88WnwhGY0PtxMVnuyjqM3lnIFJRRmIjsx+nKfZTBNM2iDE+r9gszMYftVh2QYM4Ge/cBxveNtIr1ND3gkWiJJs5myxWqdXll4Qm4wdK7yyn5kDm9KMjVaoMstkHX+J5HL/bCLHmkp2qHhsQNGK91KgU1sCeTpXHOr7he/VbRWpB/+wL8LsdnpZjOlpQuQpqYjA5RE8YUa4UFbV1Yboc7EfLkWF1DcTF3C7Mp5AfEGsSNTE0j6ONXJoD8z5CKV4U6GR2dMXHRKjZwKSb4PQ9LHZtIxF9Ag3O4vyo2Yf2lkznpKDBXFcaOi9q6QzrpH/JoL0OgTQNtpxK3tg5JKohXuG5lSoAps7xwj+Fbn6w55xMzKB/KGHVCIyLGMuQ6YPSiMhWKGcDMd8xuzmxCF8R2WM9cb4BMrfeNrketlRa5TMbUeu3gquoFkuDmuyteCVqnJZYyNVulCgI9wRCnaczJ5zcTgPz7LQWzRAfU0T4azz7erkIqZG5dB6Pd/YrqNmjI5p102SIGxhV8XGBApay0wp0NGj0O8W3s3b7kiDdkqQQqI6OGHhesu56dXGZblninZ5be9LRvKjs7M+CNCdIXERfkoWupMsDpaC8XZJf51BJR0RPD1Prb8iHDuxLVcjw4Z6uQbOlUOZhMa/Z7KMv6AyaySvprIh3TMDYAsFvpnlv/NQq3U2qHDcDKOtsxL2e7YE+gVZ0uWBdWmhyCvb5GTToWEJNWDu9e4GDczG/wbFjgU15vODS2ZbxErq0sCmdt2g/9ts2Jnta0t6Y0CXTX1wifhvGOAAyd36D0hwVI/22i3GI+suFv25X9vttE+MgCQK/5y62mWH9TdL6D2jySPz6jGEYhmEYhmEYhmEY5r/gF1Q1ze1qBaSzAAAAAElFTkSuQmCC';

const REPONSES = {
  experience: 'moyen',
  connaissances: 'reduites',
  absorption: '250',
  remboursement: 'faibles',
  apports: 'moyennes',
  besoins: 'tres_faibles',
  virtuel: 'bon',
  priorite: 'vite',
};

const MARC = { nom: 'Marc-André Lacroix', courriel: 'marc@exemple.ca' };
const JULIE = { nom: 'Julie Bergeron', courriel: 'julie@exemple.ca' };

function soumettre(corps: Record<string, unknown>): Promise<Response> {
  const requete = new Request('https://exemple.ca/api/profil-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify({ company: '', reponses: REPONSES, attestation: true, ...corps }),
  });
  // Le contexte Astro n'est pas utilisé par la route au-delà de `request`.
  return POST({ request: requete } as Parameters<typeof POST>[0]) as Promise<Response>;
}

/** Faux Resend : accepte tout et retient les destinataires. */
function installerFauxResend(): Array<Record<string, unknown>> {
  const envois: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      envois.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
      return { ok: true, status: 200, text: async () => '' } as Response;
    }),
  );
  return envois;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = 'clé-de-test';
  process.env.RESEND_FROM_EMAIL = 'steph@exemple.ca';
  process.env.RESEND_NOTIFY_EMAIL = 'interne@exemple.ca';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_NOTIFY_EMAIL;
});

describe('POST /api/profil-submit', () => {
  it('produit le PDF quand l’unique signataire a signé', async () => {
    const envois = installerFauxResend();

    const reponse = await soumettre({
      signataires: [MARC],
      voie: 'presence',
      signatures: { '0': TRACE_PNG },
    });
    const corps = (await reponse.json()) as Record<string, unknown>;

    expect(reponse.status).toBe(200);
    expect(corps.pdf).toEqual(expect.any(String));
    expect(corps.filename).toBe('profil-emprunteurs-marc-andre-lacroix-' + new Date().toISOString().slice(0, 10) + '.pdf');
    // Les adresses annoncées à l'écran sont exactement celles qui reçoivent le PDF.
    expect(corps.copies).toEqual(['marc@exemple.ca']);
    expect(envois.map((e) => e.to)).toEqual(['interne@exemple.ca', 'marc@exemple.ca']);
  });

  it('produit quand même le PDF si le navigateur annonce « à distance » alors que tout est signé', async () => {
    // Régression : l'état local pouvait rester sur « ils signeront de leur côté » après le
    // retrait d'un co-emprunteur. La soumission ouvrait alors un dossier sans personne à
    // inviter — aucun PDF, aucun courriel au client, et un écran affirmant le contraire.
    const envois = installerFauxResend();

    const reponse = await soumettre({
      signataires: [MARC],
      voie: 'distance',
      signatures: { '0': TRACE_PNG },
    });
    const corps = (await reponse.json()) as Record<string, unknown>;

    expect(reponse.status).toBe(200);
    expect(corps.pdf).toEqual(expect.any(String));
    expect(corps.enAttente).toBeUndefined();
    expect(envois.map((e) => e.to)).toEqual(['interne@exemple.ca', 'marc@exemple.ca']);
  });

  it('ouvre un dossier en attente quand une signature manque vraiment', async () => {
    const envois = installerFauxResend();

    const reponse = await soumettre({
      signataires: [MARC, JULIE],
      voie: 'distance',
      signatures: { '0': TRACE_PNG },
    });
    const corps = (await reponse.json()) as Record<string, unknown>;

    expect(reponse.status).toBe(200);
    expect(corps.pdf).toBeUndefined();
    expect(corps.enAttente).toEqual([JULIE]);
    // L'écran de confirmation annonce la copie à venir : il lui faut les adresses.
    expect(corps.copies).toEqual(['marc@exemple.ca', 'julie@exemple.ca']);
    // Une invitation à Julie, un avis à la courtière — rien au demandeur.
    expect(envois.map((e) => e.to)).toEqual(['julie@exemple.ca', 'interne@exemple.ca']);
  });

  it('refuse une voie « en présence » à laquelle il manque un tracé', async () => {
    installerFauxResend();

    const reponse = await soumettre({
      signataires: [MARC, JULIE],
      voie: 'presence',
      signatures: { '0': TRACE_PNG },
    });

    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error).toMatch(/Signature manquante/);
  });

  it('enregistre les signatures recueillies ici comme « en présence », quelle que soit la voie annoncée', async () => {
    const envois = installerFauxResend();

    await soumettre({ signataires: [MARC, JULIE], voie: 'distance', signatures: { '0': TRACE_PNG } });

    const avisInterne = envois.find((e) => e.to === 'interne@exemple.ca');
    expect(String(avisInterne?.html)).toContain('En présence');
  });

  it('reste silencieux sur le honeypot', async () => {
    const envois = installerFauxResend();

    const reponse = await soumettre({
      company: 'robot',
      signataires: [MARC],
      voie: 'presence',
      signatures: { '0': TRACE_PNG },
    });

    expect(reponse.status).toBe(200);
    expect(envois).toHaveLength(0);
  });

  it('refuse une réponse hors catalogue', async () => {
    installerFauxResend();

    const reponse = await soumettre({
      reponses: { ...REPONSES, virtuel: 'parfait' },
      signataires: [MARC],
      voie: 'presence',
      signatures: { '0': TRACE_PNG },
    });

    expect(reponse.status).toBe(400);
  });

  it('refuse une signature illisible', async () => {
    installerFauxResend();

    const reponse = await soumettre({
      signataires: [MARC],
      voie: 'presence',
      signatures: { '0': 'data:image/png;base64,pas-un-png' },
    });

    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error).toMatch(/illisible/);
  });
});
