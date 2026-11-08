import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CSP, EN_TETES_SECURITE, avecEnTetesSecurite } from './enTetesSecurite';

/** Les valeurs du bloc `[[headers]] for = "/*"` de netlify.toml. */
function enTetesNetlify(): Record<string, string> {
  const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf-8');
  const debut = toml.indexOf('for = "/*"');
  expect(debut, 'bloc for = "/*" introuvable').toBeGreaterThan(-1);
  const fin = toml.indexOf('[[', debut);
  const bloc = toml.slice(debut, fin === -1 ? undefined : fin);
  const valeurs: Record<string, string> = {};
  for (const ligne of bloc.split('\n')) {
    const m = /^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/.exec(ligne);
    if (m && m[1] !== 'for') valeurs[m[1]!] = m[2]!;
  }
  return valeurs;
}

describe('en-têtes de sécurité', () => {
  // Les pages statiques reçoivent ceux de netlify.toml, les pages du serveur ceux du
  // middleware : deux copies qui ne doivent jamais diverger.
  it('sont identiques à ceux de netlify.toml, au caractère près', () => {
    expect(enTetesNetlify()).toEqual(EN_TETES_SECURITE);
  });

  it('interdisent l’encadrement et gardent les sources nécessaires au site', () => {
    expect(EN_TETES_SECURITE['X-Frame-Options']).toBe('DENY');
    expect(CSP).toContain("frame-ancestors 'none'");
    // aperçu du contrat (cadre blob:) et signature importée en photo (image blob:)
    expect(CSP).toMatch(/frame-src [^;]*blob:/);
    expect(CSP).toMatch(/img-src [^;]*blob:/);
  });

  it('sont posés sur une réponse du serveur', () => {
    const r = avecEnTetesSecurite(new Response('<p>ok</p>', { headers: { 'content-type': 'text/html' } }));
    for (const [nom, valeur] of Object.entries(EN_TETES_SECURITE)) {
      expect(r.headers.get(nom), nom).toBe(valeur);
    }
    expect(r.headers.get('content-type')).toBe('text/html');
  });

  it('ne remplacent pas ceux qu’une route a choisis (aperçu du contrat dans un cadre)', () => {
    const r = avecEnTetesSecurite(
      new Response('pdf', {
        headers: { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" },
      }),
    );
    expect(r.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(r.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
    expect(r.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('survivent à une réponse aux en-têtes figés, sans perdre statut ni destination', async () => {
    const figee = Response.redirect('https://stephanieweyman.ca/outils/', 301);
    const r = avecEnTetesSecurite(figee);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://stephanieweyman.ca/outils/');
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
