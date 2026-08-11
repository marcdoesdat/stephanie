import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  envoyerDossierComplet,
  envoyerInvitations,
  nomFichierProfil,
  type PreuveSignature,
} from './profilCourriels';
import { parserReponses } from '../utils/profilEmprunteurs';

const ENV = { apiKey: 'clé-de-test', fromEmail: 'steph@exemple.ca', notifyEmail: 'interne@exemple.ca' };

const REPONSES = parserReponses({
  experience: 'moyen',
  connaissances: 'reduites',
  absorption: '250',
  remboursement: 'faibles',
  apports: 'moyennes',
  besoins: 'tres_faibles',
  virtuel: 'bon',
  priorite: 'vite',
})!;

function preuve(nom: string, courriel: string): PreuveSignature {
  return {
    nom,
    courriel,
    signeLe: '2026-08-11T18:32:07.000Z',
    voie: 'presence',
    ip: '24.203.118.44',
    agent: 'Mozilla/5.0 (iPhone)',
    empreinteTrace: 'a3f9c2',
  };
}

interface AppelResend {
  corps: Record<string, unknown>;
  simultanes: number;
}

/**
 * Remplace `fetch` par un faux Resend qui mesure la concurrence. C'est le point du test :
 * Resend limite le débit, et ce formulaire est le seul du site à envoyer jusqu'à quatre
 * courriels par soumission.
 */
function installerFauxResend(reponse: { ok: boolean; status?: number; corps?: string } = { ok: true }) {
  const appels: AppelResend[] = [];
  let enVol = 0;

  const faux = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    enVol += 1;
    appels.push({ corps: JSON.parse(String(options?.body)) as Record<string, unknown>, simultanes: enVol });
    await new Promise((resoudre) => setTimeout(resoudre, 20));
    enVol -= 1;
    return {
      ok: reponse.ok,
      status: reponse.status ?? (reponse.ok ? 200 : 429),
      text: async () => reponse.corps ?? '',
    } as Response;
  });

  vi.stubGlobal('fetch', faux);
  return appels;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nomFichierProfil', () => {
  it('translittère les accents et date le fichier', () => {
    expect(nomFichierProfil('Marc-André Lacroix', new Date('2026-08-11T12:00:00Z'))).toBe(
      'profil-emprunteurs-marc-andre-lacroix-2026-08-11.pdf',
    );
  });

  it('reste utilisable quand le nom ne donne aucun caractère latin', () => {
    expect(nomFichierProfil('陳', new Date('2026-08-11T12:00:00Z'))).toBe(
      'profil-emprunteurs-client-2026-08-11.pdf',
    );
  });
});

describe('envoyerDossierComplet', () => {
  it('écrit à la courtière et à chaque signataire, le PDF en pièce jointe', async () => {
    const appels = installerFauxResend();

    await envoyerDossierComplet(ENV, {
      reponses: REPONSES,
      preuves: [preuve('Marc-André Lacroix', 'marc@exemple.ca'), preuve('Julie Bergeron', 'julie@exemple.ca')],
      pdfBase64: 'JVBERi0xLjc=',
      empreintePdf: 'deadbeef',
      nomFichier: 'profil.pdf',
    });

    expect(appels).toHaveLength(3);
    expect(appels.map((a) => a.corps.to)).toEqual(['interne@exemple.ca', 'marc@exemple.ca', 'julie@exemple.ca']);
    for (const appel of appels) {
      expect(appel.corps.attachments).toEqual([{ filename: 'profil.pdf', content: 'JVBERi0xLjc=' }]);
    }
  });

  it('n’envoie jamais deux courriels en même temps', async () => {
    // Le défaut d'origine : quatre requêtes simultanées vers Resend, donc un 429 qui
    // faisait échouer toute la soumission avec un message générique.
    const appels = installerFauxResend();

    await envoyerDossierComplet(ENV, {
      reponses: REPONSES,
      preuves: [
        preuve('Un', 'un@exemple.ca'),
        preuve('Deux', 'deux@exemple.ca'),
        preuve('Trois', 'trois@exemple.ca'),
      ],
      pdfBase64: 'JVBERi0xLjc=',
      empreintePdf: 'deadbeef',
      nomFichier: 'profil.pdf',
    });

    expect(appels).toHaveLength(4);
    expect(Math.max(...appels.map((a) => a.simultanes))).toBe(1);
  });

  it('reprend la réponse de Resend dans l’erreur, pour que l’étape soit diagnosticable', async () => {
    installerFauxResend({ ok: false, status: 403, corps: '{"message":"domaine non vérifié"}' });

    await expect(
      envoyerDossierComplet(ENV, {
        reponses: REPONSES,
        preuves: [preuve('Marc', 'marc@exemple.ca')],
        pdfBase64: 'JVBERi0xLjc=',
        empreintePdf: 'deadbeef',
        nomFichier: 'profil.pdf',
      }),
    ).rejects.toThrow(/Resend HTTP 403.*domaine non vérifié/);
  });

  it('adresse la réponse de la courtière au premier signataire', async () => {
    const appels = installerFauxResend();

    await envoyerDossierComplet(ENV, {
      reponses: REPONSES,
      preuves: [preuve('Marc', 'marc@exemple.ca')],
      pdfBase64: 'JVBERi0xLjc=',
      empreintePdf: 'deadbeef',
      nomFichier: 'profil.pdf',
    });

    expect(appels[0]!.corps.reply_to).toBe('marc@exemple.ca');
    expect(appels[1]!.corps.reply_to).toBe('interne@exemple.ca');
  });

  it('reprend les réponses et la trace de preuve dans le courriel interne', async () => {
    const appels = installerFauxResend();

    await envoyerDossierComplet(ENV, {
      reponses: REPONSES,
      preuves: [preuve('Marc', 'marc@exemple.ca')],
      pdfBase64: 'JVBERi0xLjc=',
      empreintePdf: 'deadbeef',
      nomFichier: 'profil.pdf',
    });

    const interne = String(appels[0]!.corps.html);
    expect(interne).toContain('Rembourser le plus vite possible');
    expect(interne).toContain('24.203.118.44');
    expect(interne).toContain('deadbeef');
    // Aucun secret ne doit transiter par le corps du courriel.
    expect(interne).not.toContain(ENV.apiKey);
  });
});

describe('envoyerInvitations', () => {
  it('écrit à chaque co-signataire avec son lien, un à la fois', async () => {
    const appels = installerFauxResend();

    await envoyerInvitations(
      ENV,
      [
        { nom: 'Julie Bergeron', courriel: 'julie@exemple.ca', lien: 'https://exemple.ca/signer?d=1&j=a' },
        { nom: 'Paul Roy', courriel: 'paul@exemple.ca', lien: 'https://exemple.ca/signer?d=1&j=b' },
      ],
      'Marc-André Lacroix',
    );

    expect(appels).toHaveLength(2);
    expect(Math.max(...appels.map((a) => a.simultanes))).toBe(1);
    expect(String(appels[0]!.corps.html)).toContain('https://exemple.ca/signer?d=1&amp;j=a');
    expect(String(appels[1]!.corps.html)).toContain('Marc-André Lacroix');
  });
});
