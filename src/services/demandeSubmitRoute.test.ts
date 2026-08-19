/**
 * Tests du branchement de /api/demande-submit sur le carnet des dossiers clients.
 *
 * Ce que ces tests protègent :
 *
 * 1. **Une demande ouvre un dossier**, avec la checklist semée selon la situation déclarée.
 *    C'est tout l'intérêt du branchement : sans lui, le formulaire reste un courriel de plus.
 * 2. **Le dossier ne peut pas coûter la soumission.** Le courriel est la garantie, le dossier
 *    est un confort : une panne de stockage doit passer inaperçue du client.
 * 3. **Rien de sensible ne franchit la porte.** Revenus, date de naissance et évaluation de
 *    crédit restent dans le courriel interne, où ils sont déjà.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();
/** Bascule qui fait échouer l'écriture, pour jouer la panne de Netlify Blobs. */
let ecritureRompue = false;

function fauxStore() {
  return {
    get: async (cle: string) => blobs.get(cle) ?? null,
    set: async (cle: string, valeur: string) => {
      if (ecritureRompue) throw new Error('Blobs indisponible');
      blobs.set(cle, valeur);
    },
    delete: async (cle: string) => void blobs.delete(cle),
    list: async () => ({ blobs: [...blobs.keys()].map((cle) => ({ key: cle })) }),
  };
}

vi.mock('@netlify/blobs', () => ({ getStore: () => fauxStore() as unknown }));

const DEMANDE = {
  prenom: 'Luc',
  nom: 'Roy',
  courriel: 'luc.roy@exemple.ca',
  telephone: '450 555-9876',
  type_demande: 'achat',
  consentement: true,
  statut_emploi: 'salarie',
  co_emprunteur: 'deux',
  co_statut_emploi: 'travailleur_autonome',
  type_propriete: 'condo',
  promesse_achat: 'oui',
  // Ce qui ne doit jamais entrer au carnet :
  date_naissance: '1990-07-01',
  revenu_base: '88000',
  auto_evaluation_credit: 'bon',
  faillite_passee: 'oui_liberee',
};

async function soumettre(corps: Record<string, unknown> = {}): Promise<Response> {
  const { POST } = await import('../pages/api/demande-submit');
  const requete = new Request('https://exemple.ca/api/demande-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DEMANDE, ...corps }),
  });
  return (await POST({ request: requete } as Parameters<typeof POST>[0])) as Response;
}

/** Faux Resend : accepte tout et retient les messages partis. */
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
  blobs.clear();
  ecritureRompue = false;
  vi.resetModules();
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

async function dossiers() {
  const service = await import('./dossierClientService');
  return service.listerDossiers();
}

describe('ouverture du dossier', () => {
  it('ouvre un dossier et sème la checklist selon la situation déclarée', async () => {
    installerFauxResend();
    const reponse = await soumettre();
    expect(reponse.status).toBe(200);

    const [dossier] = await dossiers();
    expect(dossier?.nom).toBe('Luc Roy');
    expect(dossier?.etape).toBe('nouveau');

    const signatures = dossier!.documents.map((l) => `${l.pourQui}/${l.cle}`);
    expect(signatures).toContain('emprunteur/talons_paie');
    expect(signatures).toContain('co_emprunteur/avis_cotisation');
    expect(signatures).toContain('dossier/declaration_copropriete');
    expect(signatures).toContain('dossier/promesse_achat');
  });

  it('n’écrit au carnet aucun renseignement financier', async () => {
    installerFauxResend();
    await soumettre();

    const [dossier] = await dossiers();
    expect(JSON.stringify(dossier)).not.toMatch(/88000|1990-07-01|oui_liberee/);
    expect(dossier?.profil.statutEmploi).toBe('salarie');
  });

  it('ne dédouble pas le dossier si le client soumet deux fois', async () => {
    installerFauxResend();
    await soumettre();
    await soumettre();
    expect(await dossiers()).toHaveLength(1);
  });
});

describe('le dossier ne coûte jamais la soumission', () => {
  it('répond quand même 200 si le stockage est en panne', async () => {
    installerFauxResend();
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    ecritureRompue = true;

    const reponse = await soumettre();
    expect(reponse.status).toBe(200);
    // La panne est journalisée plutôt que tue : sans cela, personne ne la découvrirait.
    expect(erreurs).toHaveBeenCalled();
    erreurs.mockRestore();
  });

  it('envoie tout de même les deux courriels', async () => {
    const envois = installerFauxResend();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ecritureRompue = true;

    await soumettre();
    expect(envois).toHaveLength(2);
  });
});

describe('courriel de confirmation', () => {
  it('indique au client où suivre son dossier, sans y glisser de jeton', async () => {
    const envois = installerFauxResend();
    await soumettre();

    const auClient = envois.find((envoi) => envoi.to === DEMANDE.courriel);
    expect(auClient).toBeDefined();
    const html = String(auClient?.html);
    expect(html).toContain('/mon-dossier');
    // Le lien pointe la porte, pas une clé : un jeton posé là serait périmé bien avant
    // que le client ne pense à cliquer.
    expect(html).not.toMatch(/mon-dossier\?[dj]=/);
  });
});
