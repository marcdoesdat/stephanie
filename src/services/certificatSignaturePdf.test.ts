/**
 * Tests du certificat de signature.
 *
 * Ce qui compte : le certificat désigne **un** document (son empreinte), dit qui a signé,
 * quand, d'où et par quelle voie, et ne se perd pas quand un champ sort de l'ordinaire —
 * navigateur interminable, nom en caractères non latins, tracé illisible. Et il ne doit
 * jamais faire échouer la clôture d'un dossier.
 */
import { describe, expect, it, vi } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import {
  chronologie,
  couperEnLignes,
  genererCertificatPdf,
  nomFichierCertificat,
  produireCertificat,
  type EntreeCertificat,
  type SignataireCertificat,
} from './certificatSignaturePdf';

/* ------------------------------------------------------------------ */
/*  Outils                                                             */
/* ------------------------------------------------------------------ */

function crc32(octets: Buffer): number {
  let c = ~0;
  for (const octet of octets) {
    c ^= octet;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, donnees: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'latin1'), donnees]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, somme]);
}

function png(largeur = 240, hauteur = 60): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const brut = Buffer.alloc(hauteur * (1 + largeur * 4));
  for (let y = 0; y < hauteur; y += 1) {
    const debut = y * (1 + largeur * 4);
    for (let x = 0; x < largeur; x += 1) {
      brut[debut + 1 + x * 4 + 3] = Math.abs(x / largeur - y / hauteur) < 0.08 ? 255 : 0;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(brut)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Le texte visible du PDF : pdf-lib écrit chaque ligne en chaîne hexadécimale (`<…> Tj`). */
async function texteDe(octets: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(octets);
  const morceaux: string[] = [];
  for (const [, objet] of pdf.context.enumerateIndirectObjects()) {
    if (!(objet instanceof PDFRawStream)) continue;
    const filtre = objet.dict.get(PDFName.of('Filter'));
    if (objet.dict.get(PDFName.of('Subtype'))) continue; // images
    const contenu = filtre ? inflateSync(Buffer.from(objet.contents)) : Buffer.from(objet.contents);
    for (const [, hex] of contenu.toString('latin1').matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      morceaux.push(Buffer.from(hex!, 'hex').toString('latin1'));
    }
  }
  return morceaux.join('\n');
}

const EMPREINTE_PDF = 'a'.repeat(32) + 'b'.repeat(32);

function signataire(nom: string, autres: Partial<SignataireCertificat> = {}): SignataireCertificat {
  return {
    nom,
    role: 'Emprunteur',
    courriel: `${nom.split(' ')[0]!.toLowerCase()}@exemple.ca`,
    signeLe: '2026-05-14T15:02:11.000Z',
    voie: 'distance',
    ip: '24.203.118.44',
    agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
    empreinteTrace: 'c'.repeat(64),
    trace: png(),
    attestation: 'Je confirme que ces réponses reflètent notre vision commune.',
    declarations: [],
    ...autres,
  };
}

function entree(autres: Partial<EntreeCertificat> = {}): EntreeCertificat {
  return {
    titreDocument: 'Contrat de courtage hypothécaire',
    nomFichier: 'contrat-courtage-jonathan-poulin-2026-05-14.pdf',
    empreintePdf: EMPREINTE_PDF,
    dossierId: 'd0551e7',
    ouvertLe: '2026-05-12T13:00:00.000Z',
    signataires: [
      signataire('Jonathan Poulin', { signeLe: '2026-05-13T10:00:00.000Z' }),
      signataire('Valérie Gignac', {
        signeLe: '2026-05-14T09:30:00.000Z',
        declarations: [['Personne politiquement vulnérable', 'Non']],
      }),
      signataire('Stéphanie Weyman', {
        role: 'Courtière',
        voie: 'presence',
        signeLe: '2026-05-14T15:02:11.000Z',
        attestation: null,
      }),
    ],
    produitLe: new Date('2026-05-14T15:02:12.000Z'),
    ...autres,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('genererCertificatPdf', () => {
  it('produit un PDF au format lettre, titré et sans annotation', async () => {
    const pdf = await PDFDocument.load(await genererCertificatPdf(entree()));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    for (const page of pdf.getPages()) {
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
      expect(page.node.Annots()?.size() ?? 0).toBe(0);
    }
    expect(pdf.getTitle()).toBe('Certificat de signature — Contrat de courtage hypothécaire');
  });

  it('rattache le certificat au document par son empreinte complète', async () => {
    const texte = await texteDe(await genererCertificatPdf(entree()));
    // L'empreinte peut être coupée sur deux lignes : on la cherche texte recollé.
    expect(texte.replace(/\n/g, '')).toContain(EMPREINTE_PDF);
    expect(texte).toContain('contrat-courtage-jonathan-poulin-2026-05-14.pdf');
    expect(texte).toContain('d0551e7');
  });

  it('consigne chaque signataire : rôle, IP, voie, horodatage serveur, déclarations', async () => {
    const texte = await texteDe(await genererCertificatPdf(entree()));
    for (const nom of ['Jonathan Poulin', 'Valérie Gignac', 'Stéphanie Weyman']) expect(texte).toContain(nom);
    expect(texte).toContain('Courtière');
    expect(texte).toContain('24.203.118.44');
    expect(texte).toContain('2026-05-13T10:00:00.000Z');
    expect(texte).toContain('À distance (lien nominatif');
    expect(texte).toContain('En présence (même appareil)');
    expect(texte).toContain('Personne politiquement vulnérable');
  });

  it('reproduit un tracé par signataire', async () => {
    const pdf = await PDFDocument.load(await genererCertificatPdf(entree()));
    const images = [...pdf.context.enumerateIndirectObjects()].filter(
      ([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    );
    // Un PNG avec alpha s'embarque en deux flux (couleur + masque).
    expect(images.length).toBe(6);
  });

  it('ne lève pas sur un tracé illisible : l’empreinte suffit à le désigner', async () => {
    const octets = await genererCertificatPdf(
      entree({ signataires: [signataire('Marc Lacroix', { trace: new Uint8Array([1, 2, 3]) })] }),
    );
    expect(await texteDe(octets)).toContain('non reproductible');
  });

  it('tient un navigateur interminable et des caractères hors WinAnsi', async () => {
    const octets = await genererCertificatPdf(
      entree({ signataires: [signataire('陳 Marc 🌿', { agent: 'X'.repeat(2000) })] }),
    );
    expect((await PDFDocument.load(octets)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('passe à la page suivante plutôt que de déborder', async () => {
    const nombreux = Array.from({ length: 6 }, (_, i) => signataire(`Signataire ${i + 1}`));
    const pdf = await PDFDocument.load(await genererCertificatPdf(entree({ signataires: nombreux })));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(await texteDe(await pdf.save())).toContain(`page ${pdf.getPageCount()} de ${pdf.getPageCount()}`);
  });
});

describe('chronologie', () => {
  it('ordonne les événements dans le temps, de l’ouverture à la production', () => {
    const evenements = chronologie(entree());
    expect(evenements.map((e) => e.le)).toEqual([
      '2026-05-12T13:00:00.000Z',
      '2026-05-13T10:00:00.000Z',
      '2026-05-14T09:30:00.000Z',
      '2026-05-14T15:02:11.000Z',
      '2026-05-14T15:02:12.000Z',
    ]);
    expect(evenements[0]!.libelle).toBe('Dossier de signature ouvert');
    expect(evenements.at(-1)!.libelle).toMatch(/produit/);
  });

  it('n’invente pas d’ouverture de dossier quand tout a été signé sur place', () => {
    const evenements = chronologie(entree({ dossierId: null, ouvertLe: null }));
    expect(evenements.some((e) => e.libelle.includes('ouvert'))).toBe(false);
  });

  it('garde l’ordre du document pour deux signatures simultanées', () => {
    const meme = '2026-05-14T15:00:00.000Z';
    const evenements = chronologie(
      entree({ signataires: [signataire('Premier', { signeLe: meme }), signataire('Second', { signeLe: meme })] }),
    );
    expect(evenements[1]!.libelle).toContain('Premier');
    expect(evenements[2]!.libelle).toContain('Second');
  });
});

describe('couperEnLignes', () => {
  it('coupe au caractère un mot plus large que la colonne', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Courier);
    const lignes = couperEnLignes('f'.repeat(64), font, 8, 100);
    expect(lignes.length).toBeGreaterThan(1);
    expect(lignes.join('')).toBe('f'.repeat(64));
    for (const ligne of lignes) expect(font.widthOfTextAtSize(ligne, 8)).toBeLessThanOrEqual(100);
  });
});

describe('produireCertificat', () => {
  it('nomme le certificat d’après le document', async () => {
    const certificat = await produireCertificat(entree());
    expect(certificat?.nomFichier).toBe('certificat-signature-contrat-courtage-jonathan-poulin-2026-05-14.pdf');
    expect(Buffer.from(certificat!.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(nomFichierCertificat('profil.pdf')).toBe('certificat-signature-profil.pdf');
  });

  it('rend null au lieu de lever : le certificat ne retient jamais le document signé', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const casse = { ...entree(), signataires: null } as unknown as EntreeCertificat;
    expect(await produireCertificat(casse)).toBeNull();
    expect(erreur).toHaveBeenCalled();
    erreur.mockRestore();
  });
});
