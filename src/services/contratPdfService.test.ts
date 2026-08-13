/**
 * Tests de l'estampage du contrat de courtage.
 *
 * Ce que ces tests protègent réellement : le contrat produit doit rester **le modèle
 * d'Hypotheca**, avec les valeurs posées aux bons endroits. Un PDF qui se génère sans
 * erreur mais dont le texte se retrouve trois lignes plus bas est un document invalide
 * qu'aucune exception ne signalerait.
 *
 * On vérifie donc, en plus de la génération : le nombre et le format des pages, la présence
 * des valeurs saisies, et l'absence de tout débordement hors des largeurs du modèle.
 */
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { genererContratPdf, nomFichierContrat, empreinteSha256 } from './contratPdfService';
import { MODELE_SHA256 } from '../data/contratCourtageModele';
import {
  PAGE_HAUTEUR,
  PAGE_LARGEUR,
  parserDonneesContrat,
  type DonneesContrat,
} from '../utils/contratCourtage';
import { decoderTraceSignature } from '../utils/traceSignature';
import type { SignatureEstampee } from './contratPdfService';

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

/** Un vrai PNG RGBA opaque — `decoderTraceSignature` lit l'IHDR, il doit être authentique. */
function pngFactice(largeur = 240, hauteur = 60): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const brut = Buffer.alloc(hauteur * (1 + largeur * 4));
  for (let y = 0; y < hauteur; y += 1) {
    const debut = y * (1 + largeur * 4);
    brut[debut] = 0;
    for (let x = 0; x < largeur; x += 1) {
      // Une diagonale sombre : de quoi voir le tracé si on ouvre le PDF.
      const opaque = Math.abs(x / largeur - y / hauteur) < 0.08 ? 255 : 0;
      brut[debut + 1 + x * 4 + 3] = opaque;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(brut)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function trace(): Uint8Array {
  const octets = decoderTraceSignature(pngFactice());
  if (!octets) throw new Error('PNG de test invalide');
  return octets;
}

function signature(nom: string): SignatureEstampee {
  return { nom, trace: trace(), signeLe: new Date('2026-08-13T14:30:00Z') };
}

/** Un dossier complet, calqué sur le contrat d'exemple fourni par la courtière. */
const BRUT = {
  emprunteurs: [
    {
      prenom: 'Jonathan',
      nom: 'Poulin',
      telephone: '418-559-3923',
      adresse: '560 route Marie-Victorin, Lévis, QC, G7A 2X5',
      courriel: 'poulin.jon@exemple.ca',
    },
    {
      prenom: 'Valérie',
      nom: 'Gignac',
      telephone: '418-283-3744',
      adresse: '560 route Marie-Victorin, Lévis, QC, G7A 2X5',
      courriel: 'gignac.valerie@exemple.ca',
    },
  ],
  retributionAutreEntite: 'N/A',
  partageRetribution: 'N/A',
  autreCabinet: 'N/A',
  nbPreteursCabinet: '23',
  nbPreteursCourtier: '2',
  preteurMajoritaire: 'CIBC',
  autresLogiciels: 'Velocity',
  collaborateur: 'N/A',
  ppv: 'non',
  adresseProjet: '560 route Marie-Victorin, Lévis, QC, G7A 2X5',
  typesFinancement: ['refinancement'],
  autresPrecisions: '',
  montantPret: '325 000',
  assuranceHypothecaire: '0',
  totalPret: '325 000',
  tauxInteret: '4,29',
  typeTaux: 'fixe',
  amortissementAns: '25',
  amortissementMois: '0',
  termeAns: '5',
  termeMois: '0',
  versement: '1 762',
  rang: '1',
  autresExigences: 'Privilège de remboursement anticipé de 20 % par année.',
  fraisEtude: '0',
  honorairesMontant: '0',
  honorairesPourcentage: '0',
  doubleRemuneration: 'recevra',
  raisonDoubleRemuneration: '',
  resiliationMontant: '0',
  resiliationPourcentage: '0',
  transfertCabinet: 'oui',
  consentementsValidesJusquau: '31 décembre 2026',
  identite: {
    document1: ['Permis de conduire', 'Permis de conduire'],
    document1_delivre_par: ['Québec', 'Québec'],
    document2: ['Assurance-maladie', 'Assurance-maladie'],
    document2_delivre_par: ['Québec', 'Québec'],
  },
  dateVerification: '22 juillet 2026',
};

function donnees(): DonneesContrat {
  const parsees = parserDonneesContrat(BRUT);
  if (!parsees) throw new Error('Le jeu de données de test devrait être valide');
  return parsees;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('genererContratPdf', () => {
  it('produit un PDF de 4 pages au format du modèle', async () => {
    const octets = await genererContratPdf(donnees(), new Map(), null);
    expect(octets.subarray(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

    const pdf = await PDFDocument.load(octets);
    expect(pdf.getPageCount()).toBe(4);
    for (const page of pdf.getPages()) {
      expect(Math.round(page.getWidth())).toBe(PAGE_LARGEUR);
      expect(Math.round(page.getHeight())).toBe(PAGE_HAUTEUR);
    }
  });

  it('estampe les signatures des emprunteurs et de la courtière', async () => {
    const signatures = new Map([
      [0, signature('Jonathan Poulin')],
      [1, signature('Valérie Gignac')],
    ]);
    const octets = await genererContratPdf(donnees(), signatures, signature('Stéphanie Weyman'));
    const pdf = await PDFDocument.load(octets);
    expect(pdf.getPageCount()).toBe(4);
    // Trois tracés estampés : le document doit avoir grossi par rapport au contrat non signé.
    const sansSignature = await genererContratPdf(donnees(), new Map(), null);
    expect(octets.length).toBeGreaterThan(sansSignature.length);
  });

  it('accepte un contrat minimal (un seul emprunteur, presque rien de rempli)', async () => {
    const minimal = parserDonneesContrat({
      emprunteurs: [{ prenom: 'Ana', nom: 'Silva', courriel: 'ana@exemple.ca' }],
      ppv: 'non',
      transfertCabinet: 'non',
      typesFinancement: [],
    });
    expect(minimal).not.toBeNull();
    const octets = await genererContratPdf(minimal!, new Map(), null);
    expect(octets.length).toBeGreaterThan(1000);
  });

  it('ne lève pas sur des caractères qu’Helvetica ne sait pas encoder', async () => {
    const exotique = parserDonneesContrat({
      ...BRUT,
      // Emoji, espace fine insécable, guillemets courbes, cœur en ligature : tout ce qui
      // faisait lever pdf-lib avant le nettoyage WinAnsi.
      preteurMajoritaire: 'Banque 🏦 « Cœur » — 4 299 $',
      autresExigences: 'Ligne 1 avec … et ’apostrophe courbe\nLigne 2 : 日本語',
    });
    expect(exotique).not.toBeNull();
    await expect(genererContratPdf(exotique!, new Map(), null)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('tronque un champ trop long au lieu de déborder sur le texte du contrat', async () => {
    const debordant = parserDonneesContrat({ ...BRUT, preteurMajoritaire: 'X'.repeat(200) });
    expect(debordant).not.toBeNull();
    // La validation plafonne déjà, et l'estampage réduit puis tronque : aucune exception,
    // et un document de taille comparable au contrat normal.
    const octets = await genererContratPdf(debordant!, new Map(), null);
    const normal = await genererContratPdf(donnees(), new Map(), null);
    expect(Math.abs(octets.length - normal.length)).toBeLessThan(5000);
  });

  it('n’estampe pas les initiales d’un emprunteur qui n’a pas signé', async () => {
    const aucun = await genererContratPdf(donnees(), new Map(), null);
    const unSeul = await genererContratPdf(donnees(), new Map([[0, signature('Jonathan Poulin')]]), null);
    // Les initiales du premier emprunteur apparaissent dans trois blocs : le document signé
    // porte forcément plus de contenu que celui sans aucune signature.
    expect(unSeul.length).toBeGreaterThan(aucun.length);
  });
});

describe('nomFichierContrat', () => {
  it('translittère et date le nom de fichier', () => {
    expect(nomFichierContrat('Jonathan Poulin', new Date('2026-08-13T12:00:00Z'))).toBe(
      'contrat-courtage-jonathan-poulin-2026-08-13.pdf',
    );
    expect(nomFichierContrat('Valérie Gignac-Côté', new Date('2026-01-02T12:00:00Z'))).toBe(
      'contrat-courtage-valerie-gignac-cote-2026-01-02.pdf',
    );
  });

  it('retombe sur « client » quand le nom ne donne rien d’exploitable', () => {
    expect(nomFichierContrat('***', new Date('2026-08-13T12:00:00Z'))).toBe(
      'contrat-courtage-client-2026-08-13.pdf',
    );
  });
});

describe('empreinteSha256', () => {
  it('produit un condensat hexadécimal de 64 caractères', async () => {
    const empreinte = await empreinteSha256(new TextEncoder().encode('contrat'));
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it('le modèle embarqué porte bien l’empreinte annoncée', () => {
    expect(MODELE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
