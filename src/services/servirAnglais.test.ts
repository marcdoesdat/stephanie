import { describe, it, expect } from 'vitest';
import { servirAnglais } from './servirAnglais';
import { traduirePage } from './traductionPage';
import { cheminAnglais, cheminFrancais, estTraduite, estAnglais } from '../utils/pagesAnglaises';

const SITE = 'https://stephanieweyman.ca';

const PAGE = `<!doctype html><html lang="fr-CA"><head>
<title>Courtière hypothécaire Repentigny &amp; Rive-Nord | Stéphanie Weyman</title>
<link rel="canonical" href="https://stephanieweyman.ca/outils">
<meta property="og:url" content="https://stephanieweyman.ca/outils">
<meta property="og:locale" content="fr_CA">
</head><body>
<nav><a href="/#services">Services</a> <a href="/outils">Outils</a> <a href="/api/x">API</a> <a href="/images/a.webp">img</a> <a href="/contrat">Privé</a></nav>
<h2>Questions <em>fréquentes</em></h2>
<p><a href="/rendez-vous">Prendre rendez-vous</a></p>
</body></html>`;

describe('chemins anglais', () => {
  it('convertit dans les deux sens, avec une barre finale', () => {
    expect(cheminAnglais('/')).toBe('/en/');
    expect(cheminAnglais('/outils')).toBe('/en/outils/');
    expect(cheminAnglais('/outils/')).toBe('/en/outils/');
    expect(cheminFrancais('/en/')).toBe('/');
    expect(cheminFrancais('/en/services/premier-achat/')).toBe('/services/premier-achat');
  });
  it("ne connaît que les pages publiques : jamais les écrans de la courtière ou les signatures", () => {
    for (const p of ['/contrat', '/dossiers', '/reseau', '/tableau-de-bord', '/signer', '/signer-contrat', '/profil-emprunteur', '/mon-dossier', '/preparer-profil', '/finaliser-contrat', '/api/contrat-creer']) {
      expect(estTraduite(p)).toBe(false);
    }
    expect(estTraduite('/outils/')).toBe(true);
  });
  it('reconnaît une adresse /en', () => {
    expect(estAnglais('/en')).toBe(true);
    expect(estAnglais('/en/outils/')).toBe(true);
    expect(estAnglais('/entreprise')).toBe(false);
  });
});

describe('traduirePage', () => {
  const html = traduirePage(PAGE, '/outils', SITE);

  it('traduit le texte, le titre et la langue', () => {
    expect(html).toContain('lang="en-CA"');
    expect(html).toContain('Mortgage Broker Repentigny');
    expect(html).toContain('<h2>Frequently asked <em>questions</em></h2>');
    expect(html).toContain('<a href="/en/rendez-vous/">Book an appointment</a>');
  });

  it("garde les liens internes dans /en/, et laisse tout le reste", () => {
    expect(html).toContain('href="/en/#services"');
    expect(html).toContain('href="/en/outils/"');
    expect(html).toContain('href="/api/x"');
    expect(html).toContain('href="/images/a.webp"');
    expect(html).toContain('href="/contrat"'); // pas de version anglaise : le lien reste français
  });

  it("donne à la page anglaise sa propre adresse canonique", () => {
    expect(html).toContain('<link rel="canonical" href="https://stephanieweyman.ca/en/outils/">');
    expect(html).toContain('content="https://stephanieweyman.ca/en/outils/"');
    expect(html).toContain('content="en_CA"');
  });
});

describe('servirAnglais', () => {
  const page = (html = PAGE, status = 200) => async () =>
    new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('redirige /en/outils vers /en/outils/ : une page, une adresse', async () => {
    const rep = await servirAnglais(new URL('https://x.ca/en/outils?a=1'), SITE, page());
    expect(rep.status).toBe(301);
    expect(rep.headers.get('location')).toBe('/en/outils/?a=1');
  });

  it('va chercher la page française correspondante et la sert traduite, mise en cache', async () => {
    let demande = '';
    const rep = await servirAnglais(new URL('https://x.ca/en/outils/'), SITE, async (u) => {
      demande = u.pathname;
      return page()();
    });
    expect(demande).toBe('/outils');
    expect(rep.status).toBe(200);
    expect(rep.headers.get('cache-control')).toContain('s-maxage');
    expect(await rep.text()).toContain('lang="en-CA"');
  });

  it("sert une 404 non indexable pour une page sans version anglaise, sans jamais la chercher", async () => {
    let demande = '';
    const rep = await servirAnglais(new URL('https://x.ca/en/contrat/'), SITE, async (u) => {
      demande = u.pathname;
      return page(PAGE, 404)();
    });
    expect(demande).toBe('/404'); // jamais /contrat : l'écran de la courtière n'est pas servi par ce chemin
    expect(rep.status).toBe(404);
    expect(rep.headers.get('x-robots-tag')).toBe('noindex');
  });

  it("ne met pas en cache une page française en erreur", async () => {
    const rep = await servirAnglais(new URL('https://x.ca/en/outils/'), SITE, page(PAGE, 500));
    expect(rep.status).toBe(500);
    expect(rep.headers.get('cache-control')).toBe('no-store');
  });
});
