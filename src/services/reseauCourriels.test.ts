/**
 * Tests du courriel d'approche.
 *
 * Ce que ces tests protègent : la légalité de l'envoi. Un courriel commercial non sollicité
 * doit identifier son expéditeur — nom, organisation, adresse postale, moyen de contact — et
 * porter un mécanisme de retrait qui fonctionne. Ces mentions ne sont pas de la décoration
 * qu'on peut perdre au fil d'un remaniement du gabarit visuel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadSiteConfig } from '../config';
import {
  adresseDediee,
  construireCourrielApproche,
  expediteurReseau,
  piedConformite,
} from './reseauCourriels';
import type { MessageSortant } from '../utils/reseauCourtiers';

const config = loadSiteConfig();
const LIEN = 'https://stephanieweyman.ca/api/reseau-retrait?c=abc&j=xyz';
/** Le lien tel qu'il apparaît dans un attribut HTML — l'esperluette y est échappée. */
const LIEN_HTML = LIEN.replace(/&/g, '&amp;');

const MESSAGE: MessageSortant = {
  gabarit: 'introduction',
  objet: 'Une collaboration ?',
  corps: 'Bonjour Marie,\n\nJe suis Stéphanie Weyman, courtière hypothécaire.',
};

afterEach(() => {
  delete process.env.RESEND_FROM_RESEAU;
});

describe('pied de conformité', () => {
  it('porte l’identité complète, l’adresse postale et le lien de retrait', () => {
    const pied = piedConformite(LIEN);
    expect(pied).toContain(config.nom);
    expect(pied).toContain(config.organisation);
    expect(pied).toContain(config.adresse);
    expect(pied).toContain(config.telephone);
    expect(pied).toContain(LIEN_HTML);
  });
});

describe('construireCourrielApproche', () => {
  it('met le retrait dans les deux versions — HTML et texte', () => {
    const { html, texte } = construireCourrielApproche(MESSAGE, LIEN);
    expect(html).toContain(LIEN_HTML);
    expect(texte).toContain(LIEN);
    expect(texte).toContain(config.adresse);
  });

  it('porte le numéro AMF, comme tout courriel de la courtière', () => {
    const { html, texte } = construireCourrielApproche(MESSAGE, LIEN);
    expect(html).toContain(config.amf);
    expect(texte).toContain(config.amf);
  });

  it('rend les paragraphes du message', () => {
    const { html } = construireCourrielApproche(MESSAGE, LIEN);
    expect(html).toContain('Bonjour Marie,');
    expect(html).toContain('courtière hypothécaire');
  });

  it('neutralise le HTML du texte saisi', () => {
    const { html } = construireCourrielApproche(
      { ...MESSAGE, corps: 'Bonjour <script>alert(1)</script> et <b>gras</b>.' },
      LIEN,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('expediteurReseau', () => {
  const env = { apiKey: 'k', fromEmail: 'site@stephanieweyman.ca', notifyEmail: 'boite@exemple.ca' };

  it('emploie le sous-domaine dédié quand il est configuré', () => {
    process.env.RESEND_FROM_RESEAU = 'reseau@mail.stephanieweyman.ca';
    expect(expediteurReseau(env)).toBe(`${config.nom} <reseau@mail.stephanieweyman.ca>`);
  });

  it('retombe sur l’adresse commune du site plutôt que de bloquer l’outil', () => {
    expect(expediteurReseau(env)).toBe(`${config.nom} <site@stephanieweyman.ca>`);
  });

  it('respecte une variable qui porte déjà un nom d’expéditeur', () => {
    process.env.RESEND_FROM_RESEAU = 'Stéphanie Weyman <stephanie@partenaires.stephanieweyman.ca>';
    expect(expediteurReseau(env)).toBe(
      'Stéphanie Weyman <stephanie@partenaires.stephanieweyman.ca>',
    );
  });

  // Une coquille dans Netlify ne doit pas faire échouer chaque envoi sur un 4xx de Resend :
  // on retombe sur l'adresse commune, et /reseau réaffiche alors son avertissement — la
  // coquille se voit à l'écran au lieu de passer pour une configuration réussie.
  it('retombe sur l’adresse commune quand la variable est mal formée', () => {
    for (const coquille of ['stephanie@partenaires', 'stephanie.partenaires.ca', 'stephanie@', '@partenaires.ca']) {
      process.env.RESEND_FROM_RESEAU = coquille;
      expect(adresseDediee()).toBeNull();
      expect(expediteurReseau(env)).toBe(`${config.nom} <site@stephanieweyman.ca>`);
    }
  });

  it('accepte l’adresse retenue pour la prospection', () => {
    process.env.RESEND_FROM_RESEAU = 'stephanie@partenaires.stephanieweyman.ca';
    expect(adresseDediee()).toBe('stephanie@partenaires.stephanieweyman.ca');
  });
});
