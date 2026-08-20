/**
 * Tests du lien de désabonnement — `/api/reseau-retrait`.
 *
 * Ce que ces tests protègent : la seule promesse du site qu'une loi rend obligatoire. Un
 * courriel commercial doit porter un mécanisme de retrait qui **fonctionne**, et la page dit
 * « c'est fait » — il faut donc que ce soit vrai, quel que soit celui des trois émetteurs
 * possibles qui appelle la route :
 *
 *   1. le bouton de la page de confirmation (formulaire, corps renseigné) ;
 *   2. le retrait en un clic d'un fournisseur de messagerie (RFC 8058 : corps
 *      `List-Unsubscribe=One-Click`, paramètres restés dans l'URL) ;
 *   3. un client qui poste le lien à vide (paramètres dans l'URL, corps sans rien).
 *
 * Les trois passaient jadis par une lecture du seul corps du formulaire : deux d'entre eux
 * perdaient l'identifiant en route, et la page les rassurait quand même.
 *
 * Placés ici et non à côté de la route : tout fichier `.ts` sous src/pages/ devient un
 * endpoint Astro — un test posé là serait publié comme route.
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

vi.mock('@netlify/blobs', () => ({ getStore: () => fauxStore() as unknown }));

const envoyer =
  vi.fn<(cle: string, courriel: import('./emailService').ResendEmail) => Promise<void>>();
vi.mock('./emailService', async (original) => ({
  ...(await original<typeof import('./emailService')>()),
  sendEmail: envoyer,
}));

const CONTACT = {
  nom: 'Jean Bernard',
  courriel: 'jean.bernard@exemple.ca',
  telephone: '',
  agence: 'Agence du Nord',
  secteur: '',
  profession: 'courtier-immobilier',
  notes: '',
  consentement: { base: 'tacite_publie', source: 'site de l’agence' },
} as const;

type Handler = (contexte: { request: Request; clientAddress?: string }) => Promise<Response>;

async function poser() {
  const service = await import('./reseauContactService');
  const resultat = await service.creerContact(CONTACT as never);
  const contact = 'doublon' in resultat ? resultat.doublon : resultat;
  return {
    service,
    contact,
    lien: service.lienRetrait(contact, 'https://stephanieweyman.ca'),
    route: await import('../pages/api/reseau-retrait'),
  };
}

/** L'état de la fiche après coup — la seule chose qui dise si le retrait a eu lieu. */
async function etat(service: typeof import('./reseauContactService'), id: string) {
  return (await service.lireContact(id))?.etat;
}

beforeEach(() => {
  blobs.clear();
  envoyer.mockClear();
  process.env.RESEND_API_KEY = 'cle';
  process.env.RESEND_FROM_EMAIL = 'site@stephanieweyman.ca';
  process.env.RESEND_NOTIFY_EMAIL = 'boite@stephanieweyman.ca';
});

describe('les trois façons dont un retrait arrive', () => {
  it('le bouton de la page de confirmation retire la personne', async () => {
    const { service, contact, lien, route } = await poser();

    // La page rend le formulaire ; on poste exactement ce qu'elle contient.
    const page = await (route.GET as unknown as Handler)({ request: new Request(lien) });
    const html = await page.text();
    const corps = new URLSearchParams();
    for (const [, nom, valeur] of html.matchAll(/name="([cj])" value="([^"]*)"/g)) {
      corps.set(nom as string, valeur as string);
    }
    expect([...corps.keys()].sort()).toEqual(['c', 'j']);

    const reponse = await (route.POST as unknown as Handler)({
      request: new Request('https://stephanieweyman.ca/api/reseau-retrait', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: corps.toString(),
      }),
    });

    expect(reponse.status).toBe(200);
    expect(await etat(service, contact.id)).toBe('refuse');
  });

  // RFC 8058 : le fournisseur poste l'URL du courriel, corps `List-Unsubscribe=One-Click`.
  // L'identifiant n'est **que** dans la chaîne de requête — le lire dans le corps seul, comme
  // avant, revenait à ne retirer personne tout en répondant « c'est fait ».
  it('le retrait en un clic d’un fournisseur de messagerie retire la personne', async () => {
    const { service, contact, lien, route } = await poser();

    const reponse = await (route.POST as unknown as Handler)({
      request: new Request(lien, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    });

    expect(await etat(service, contact.id)).toBe('refuse');
    // Personne n'est devant l'écran : une réponse courte, pas une page.
    expect(reponse.headers.get('content-type')).toContain('text/plain');
    expect(await reponse.text()).toBe('OK');
  });

  it('un client qui poste le lien à vide retire quand même la personne', async () => {
    const { service, contact, lien, route } = await poser();

    const reponse = await (route.POST as unknown as Handler)({
      request: new Request(lien, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
    });

    expect(await etat(service, contact.id)).toBe('refuse');
    expect(await reponse.text()).toContain('C’est fait');
  });
});

describe('ce que la page ne fait jamais', () => {
  // Les antivirus et les aperçus de messagerie visitent les liens des courriels. Un GET qui
  // retirerait produirait des désabonnements que personne n'a demandés.
  it('un simple GET ne retire personne', async () => {
    const { service, contact, lien, route } = await poser();

    await (route.GET as unknown as Handler)({ request: new Request(lien) });

    expect(await etat(service, contact.id)).toBe('a_contacter');
    expect(envoyer).not.toHaveBeenCalled();
  });

  // Distinguer les cas ferait du lien un moyen de tester des identifiants — et « lien
  // invalide » est la pire réponse à qui vient de demander qu'on cesse de lui écrire.
  it('ne dit jamais qu’un jeton est faux', async () => {
    const { route } = await poser();

    const reponse = await (route.POST as unknown as Handler)({
      request: new Request('https://stephanieweyman.ca/api/reseau-retrait?c=inexistant&j=faux', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
    });

    const html = await reponse.text();
    expect(reponse.status).toBe(200);
    expect(html).toContain('C’est fait');
    expect(html).not.toMatch(/invalide|introuvable|erreur/i);
  });
});

describe('la dette que « c’est fait » crée', () => {
  // La page rassure toujours ; quelqu'un doit donc tenir la promesse quand la machine ne
  // l'a pas tenue. Sans cette alerte, un retrait perdu ne laissait aucune trace nulle part.
  it('prévient la courtière quand le retrait n’a pas été enregistré', async () => {
    const { route } = await poser();

    await (route.POST as unknown as Handler)({
      request: new Request('https://stephanieweyman.ca/api/reseau-retrait?c=inexistant&j=faux', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
      clientAddress: '203.0.113.7',
    });

    expect(envoyer).toHaveBeenCalledOnce();
    const courriel = envoyer.mock.calls[0]?.[1];
    expect(courriel?.to).toBe('boite@stephanieweyman.ca');
    expect(courriel?.subject).toContain('Désabonnement non enregistré');
    expect(courriel?.html).toContain('inexistant');
    // Le jeton lui-même n'a pas à voyager : savoir s'il était là suffit à trancher la cause.
    expect(courriel?.text).not.toContain('faux');
    expect(courriel?.html).not.toContain('faux');
  });

  // La route est publique : un courriel que n'importe qui déclenche est un moyen d'inonder
  // une boîte. Un lien réellement cliqué porte toujours les deux paramètres ; ce qui n'en
  // porte qu'un est un robot qui balaie, et il n'y a rien à rattraper pour lui.
  it('ne prévient personne pour un balayage sans couple complet', async () => {
    const { route } = await poser();

    for (const requete of [
      'https://stephanieweyman.ca/api/reseau-retrait',
      'https://stephanieweyman.ca/api/reseau-retrait?c=seulement-un-id',
      'https://stephanieweyman.ca/api/reseau-retrait?j=seulement-un-jeton',
    ]) {
      const reponse = await (route.POST as unknown as Handler)({
        request: new Request(requete, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: '',
        }),
      });
      // La page reste la même : un robot n'apprend rien de plus qu'une personne.
      expect(await reponse.text()).toContain('C’est fait');
    }

    expect(envoyer).not.toHaveBeenCalled();
  });

  it('ne prévient personne quand le retrait a bien eu lieu', async () => {
    const { service, contact, lien, route } = await poser();

    await (route.POST as unknown as Handler)({
      request: new Request(lien, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    });

    expect(await etat(service, contact.id)).toBe('refuse');
    expect(envoyer).not.toHaveBeenCalled();
  });

  // Un lien cliqué deux fois donne deux fois la même réponse rassurante — et n'alerte pas
  // une seconde fois : la fiche est déjà retirée, il n'y a rien à rattraper.
  it('reste idempotent, sans fausse alerte au deuxième clic', async () => {
    const { service, contact, lien, route } = await poser();

    for (let i = 0; i < 2; i += 1) {
      await (route.POST as unknown as Handler)({
        request: new Request(lien, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: '',
        }),
      });
    }

    expect(await etat(service, contact.id)).toBe('refuse');
    expect(envoyer).not.toHaveBeenCalled();
  });
});
