/**
 * Tests du branchement des neuf formulaires sur le carnet.
 *
 * Deux garanties, pour chaque porte d'entrée :
 *
 * 1. **Une soumission valide ouvre une fiche**, avec la bonne origine et la bonne base de
 *    consentement. C'est tout l'intérêt du branchement : sans lui, le formulaire reste un
 *    courriel qui se perd dans une boîte de réception.
 * 2. **La fiche ne coûte jamais la soumission.** Le courriel est la garantie ; une panne de
 *    Netlify Blobs doit passer inaperçue du visiteur.
 *
 * Placés ici et non à côté des routes : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleOrigine } from '../utils/dossiersClients';

const blobs = new Map<string, string>();
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

/* ------------------------------------------------------------------ */
/*  Les neuf portes, avec une charge utile que leur validation accepte */
/* ------------------------------------------------------------------ */

interface Porte {
  readonly nom: string;
  readonly route: string;
  readonly origine: CleOrigine;
  readonly consentement: string;
  readonly payload: Record<string, unknown>;
  /** Le nom que la fiche doit porter — vérifie au passage le mappage des champs. */
  readonly attenduNom: string;
}

const PORTES: Porte[] = [
  {
    nom: '/rappel',
    route: '../pages/api/rappel-submit',
    origine: 'rappel',
    consentement: 'expresse',
    attenduNom: 'Marie Tremblay',
    payload: {
      nom: 'Marie Tremblay', courriel: 'marie.t@ex.ca', telephone: '450 555-1001',
      type: 'Renouvellement', echeance: 'mars 2027', institution: 'Desjardins',
      details: 'Terme bientôt fini.', consentement: true, company: '',
    },
  },
  {
    nom: '/ (contact)',
    route: '../pages/api/contact-submit',
    origine: 'contact',
    consentement: 'expresse',
    attenduNom: 'Luc Roy',
    payload: {
      prenom: 'Luc', nom: 'Roy', email: 'luc.r@ex.ca', telephone: '450 555-1002',
      parcours: 'Premier achat', delai: '3 à 6 mois', prefcontact: 'Texto',
      message: 'On magasine.', lcap_consent: true,
    },
  },
  {
    nom: '/outils (calculateur)',
    route: '../pages/api/calculateur-submit',
    origine: 'calculateur',
    consentement: 'service_demande',
    attenduNom: 'Ana Côté',
    payload: {
      nom: 'Ana Côté', email: 'ana.c@ex.ca', telephone: '514 555-1003',
      montant: '400000', versement: '2100', amortissement: '25', label: 'x',
      cout: '187000', prime: '12000',
    },
  },
  {
    nom: '/outils (pénalité)',
    route: '../pages/api/penalite-submit',
    origine: 'penalite',
    consentement: 'expresse',
    attenduNom: 'Bo Gagné',
    payload: {
      prenom: 'Bo Gagné', email: 'bo.g@ex.ca', telephone: '514 555-1004',
      penalite: '8400', scenario: 'x', consentement: true,
    },
  },
  {
    nom: '/outils (contact)',
    route: '../pages/api/outils-submit',
    origine: 'outils',
    consentement: 'expresse',
    attenduNom: 'Zoé Roy',
    payload: {
      prenom: 'Zoé Roy', email: 'zoe.r@ex.ca', telephone: '514 555-1005',
      message: 'Question sur la SCHL.', consentement: true,
    },
  },
  {
    nom: '/refinancement',
    route: '../pages/api/refinancement-submit',
    origine: 'refinancement',
    consentement: 'expresse',
    attenduNom: 'Inès Bergeron',
    payload: {
      prenom: 'Inès', nom: 'Bergeron', courriel: 'ines.b@ex.ca', cellulaire: '514 555-1006',
      but_refinancement: 'consolider_dettes', preteur_actuel: 'rbc', fin_terme: 'septembre 2027',
      type_propriete: 'maison', proprietaire: 'oui', type_revenu: 'salarie',
      cote_credit: 'moins_650', faillite: 'non',
      revenu_brut: '112000', dettes_a_refinancer: '45000',
      solde_pret: '310000', valeur_marchande: '525000',
      consentement: true, company: '',
    },
  },
  {
    nom: '/refinancement-v2',
    route: '../pages/api/refinancement-v2-submit',
    origine: 'refinancement_v2',
    consentement: 'expresse',
    attenduNom: 'Noé',
    payload: {
      prenom: 'Noé', courriel: 'noe@ex.ca', cellulaire: '514 555-1007',
      intention: 'effacer_dettes', ville: 'Repentigny',
      solde_tranche: '200_350', valeur_tranche: '400_500',
      consentement: true, company: '',
    },
  },
  {
    nom: '/partenaires',
    route: '../pages/api/partenaires-submit',
    origine: 'partenaire',
    consentement: 'tiers',
    attenduNom: 'Camille Fortin',
    payload: {
      'nom-partenaire': 'Me Gagnon', profession: 'notaire',
      'contact-partenaire': 'gagnon@etude.ca',
      'client-nom': 'Camille Fortin', 'client-telephone': '450 555-7777',
      'type-projet': 'Premier achat', notes: 'Promesse acceptée.',
      'consentement-client': true,
    },
  },
];

async function soumettre(porte: Porte): Promise<Response> {
  const module = (await import(porte.route)) as { POST: (ctx: unknown) => Promise<Response> };
  const requete = new Request(`https://exemple.ca/api${porte.route.split('/api')[1]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(porte.payload),
  });
  return module.POST({ request: requete });
}

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

async function fiches() {
  const service = await import('./dossierClientService');
  return service.listerDossiers();
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

describe.each(PORTES)('$nom', (porte) => {
  it('ouvre un prospect avec son origine et sa base de consentement', async () => {
    installerFauxResend();
    const reponse = await soumettre(porte);
    expect(reponse.status, await reponse.clone().text()).toBe(200);

    const toutes = await fiches();
    const fiche = toutes.find((f) => f.origine === porte.origine);
    expect(fiche, `aucune fiche d'origine ${porte.origine}`).toBeDefined();
    expect(fiche!.nom).toBe(porte.attenduNom);
    expect(fiche!.consentement).toBe(porte.consentement);
    // Un prospect n'a pas de checklist : elle se sème à la qualification.
    expect(fiche!.etape).toBe('prospect');
    expect(fiche!.documents).toHaveLength(0);
  });

  it('répond quand même 200 si le stockage est en panne', async () => {
    installerFauxResend();
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    ecritureRompue = true;

    const reponse = await soumettre(porte);
    expect(reponse.status).toBe(200);
    expect(erreurs).toHaveBeenCalled();
    erreurs.mockRestore();
  });
});

describe('/refinancement — la porte la plus indiscrète du site', () => {
  it('ne laisse entrer au carnet ni revenus, ni crédit, ni dettes, ni solde, ni valeur', async () => {
    installerFauxResend();
    const porte = PORTES.find((p) => p.origine === 'refinancement')!;
    await soumettre(porte);

    const fiche = (await fiches()).find((f) => f.origine === 'refinancement');
    const serialise = JSON.stringify(fiche);
    for (const interdit of ['112000', 'moins_650', '45000', '310000', '525000']) {
      expect(serialise, interdit).not.toContain(interdit);
    }
  });
});

describe('/partenaires — les deux carnets', () => {
  it('inscrit le professionnel au réseau et lie le client référé à sa fiche', async () => {
    installerFauxResend();
    await soumettre(PORTES.find((p) => p.origine === 'partenaire')!);

    const reseau = await import('./reseauContactService');
    const contacts = await reseau.listerContacts();
    const referent = contacts.find((c) => c.courriel === 'gagnon@etude.ca');
    expect(referent, 'le référent devrait être au carnet du réseau').toBeDefined();
    expect(referent!.profession).toBe('notaire');

    const client = (await fiches()).find((f) => f.origine === 'partenaire');
    expect(client!.refereParId).toBe(referent!.id);
    // Le formulaire ne demande pas l'adresse du client : sa fiche n'en a pas, et le dit.
    expect(client!.courriel).toBe('');
    expect(client!.notes).toContain('Me Gagnon');
  });

  it('n’inscrit pas au réseau un professionnel qui n’a laissé qu’un numéro', async () => {
    installerFauxResend();
    const porte = PORTES.find((p) => p.origine === 'partenaire')!;
    await soumettre({
      ...porte,
      payload: { ...porte.payload, 'contact-partenaire': '514 555-9999' },
    });

    const reseau = await import('./reseauContactService');
    // Le carnet du réseau sert à écrire des courriels : une fiche sans adresse y serait morte.
    expect(await reseau.listerContacts()).toHaveLength(0);
    // Le client référé, lui, entre quand même.
    expect((await fiches()).find((f) => f.origine === 'partenaire')).toBeDefined();
  });
});
