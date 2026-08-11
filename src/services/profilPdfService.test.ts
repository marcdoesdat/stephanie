import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { empreinteSha256, genererProfilPdf, versBase64 } from './profilPdfService';
import { MODELE_BASE64, MODELE_SHA256 } from '../data/profilEmprunteursModele';
import { decoderTraceSignature, parserReponses } from '../utils/profilEmprunteurs';

/** Un vrai PNG transparent de 120 × 40 (un trait), le plus petit tracé embarquable. */
const TRACE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAELElEQVR4nO2ae4hMcRTHr2XFmp07I1q23Zl7r62NZXfu70dS/CXvFPIIobySkIhSSPL6Q5LyTKQklFd5P/JYSVn/IBRCeeSR8livtcv33B3F7J3ZMXMfazuf+nU1zdzfOb/vOed3fr+lKAzDMAzDMAzDMAzDMMx/QYuQblaEdTEnpIkNIV3uCevyYMgQu1VdrAobYmKguLw7fc9vQ5l/AKJGw4ZcBzFf4PmzsRHSxTuIfjhkmFPVSI+w3/anj8xF0C6E/efwPAvbDb8tchdNawPB1kKsb+kIayu2Ib8j409TdisdSvP9dikZIU2OgJ8P/g5UedZvu1wjEBVdIcqdTIW1Hbr8jOzYqxpmf6VplPEWEHUUbLudxN4zfhvoCnBuGJyrthdKfMCiHMK/l6iaGKfq5mh8NlvVzDX47ASV5/TEFs+p7AciZjfPHexYFkDGzoMNd1NUnjf5enmp57a5jarLMfYlWTxDIzVTKZR5jbwiBxnaE+VtJYLkfprZfYsCJqTFYu55VtY6GDWHQNQDGJ9SCFsDPzcHi7q1d88WnwhGY0PtxMVnuyjqM3lnIFJRRmIjsx+nKfZTBNM2iDE+r9gszMYftVh2QYM4Ge/cBxveNtIr1ND3gkWiJJs5myxWqdXll4Qm4wdK7yyn5kDm9KMjVaoMstkHX+J5HL/bCLHmkp2qHhsQNGK91KgU1sCeTpXHOr7he/VbRWpB/+wL8LsdnpZjOlpQuQpqYjA5RE8YUa4UFbV1Yboc7EfLkWF1DcTF3C7Mp5AfEGsSNTE0j6ONXJoD8z5CKV4U6GR2dMXHRKjZwKSb4PQ9LHZtIxF9Ag3O4vyo2Yf2lkznpKDBXFcaOi9q6QzrpH/JoL0OgTQNtpxK3tg5JKohXuG5lSoAps7xwj+Fbn6w55xMzKB/KGHVCIyLGMuQ6YPSiMhWKGcDMd8xuzmxCF8R2WM9cb4BMrfeNrketlRa5TMbUeu3gquoFkuDmuyteCVqnJZYyNVulCgI9wRCnaczJ5zcTgPz7LQWzRAfU0T4azz7erkIqZG5dB6Pd/YrqNmjI5p102SIGxhV8XGBApay0wp0NGj0O8W3s3b7kiDdkqQQqI6OGHhesu56dXGZblninZ5be9LRvKjs7M+CNCdIXERfkoWupMsDpaC8XZJf51BJR0RPD1Prb8iHDuxLVcjw4Z6uQbOlUOZhMa/Z7KMv6AyaySvprIh3TMDYAsFvpnlv/NQq3U2qHDcDKOtsxL2e7YE+gVZ0uWBdWmhyCvb5GTToWEJNWDu9e4GDczG/wbFjgU15vODS2ZbxErq0sCmdt2g/9ts2Jnta0t6Y0CXTX1wifhvGOAAyd36D0hwVI/22i3GI+suFv25X9vttE+MgCQK/5y62mWH9TdL6D2jySPz6jGEYhmEYhmEYhmEY5r/gF1Q1ze1qBaSzAAAAAElFTkSuQmCC';

const REPONSES = parserReponses({
  experience: 'excellent',
  connaissances: 'elevees',
  absorption: 'autre',
  autre_montant: 1250,
  remboursement: 'elevees',
  apports: 'faibles',
  besoins: 'moyennes',
  virtuel: 'nul',
  priorite: 'vite',
})!;

function signature(nom: string, jour: number) {
  return {
    nom,
    trace: decoderTraceSignature(TRACE_PNG)!,
    signeLe: new Date(Date.UTC(2026, 7, jour, 15, 0, 0)),
  };
}

describe('modèle PDF embarqué', () => {
  it('correspond à l’empreinte déclarée par le script d’encodage', async () => {
    const octets = Uint8Array.from(atob(MODELE_BASE64), (c) => c.charCodeAt(0));
    await expect(empreinteSha256(octets)).resolves.toBe(MODELE_SHA256);
  });

  it('est un PDF d’une seule page', async () => {
    const modele = await PDFDocument.load(MODELE_BASE64);
    expect(modele.getPageCount()).toBe(1);
  });
});

describe('genererProfilPdf', () => {
  it('produit un PDF valide d’une page au format du modèle', async () => {
    const octets = await genererProfilPdf(REPONSES, [signature('Marc-André Lacroix', 11)]);

    expect(new TextDecoder().decode(octets.subarray(0, 5))).toBe('%PDF-');

    const genere = await PDFDocument.load(octets);
    expect(genere.getPageCount()).toBe(1);
    const { width, height } = genere.getPages()[0]!.getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
  });

  it('accepte les trois signataires du formulaire', async () => {
    const trois = [signature('Un', 11), signature('Deux', 12), signature('Trois', 13)];
    const octets = await genererProfilPdf(REPONSES, trois);
    expect(octets.length).toBeGreaterThan(0);
  });

  it('ignore un quatrième signataire — le modèle n’a que trois lignes', async () => {
    const quatre = [signature('Un', 11), signature('Deux', 12), signature('Trois', 13), signature('Quatre', 14)];
    await expect(genererProfilPdf(REPONSES, quatre)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('fonctionne sans aucune signature (dossier encore incomplet)', async () => {
    await expect(genererProfilPdf(REPONSES, [])).resolves.toBeInstanceOf(Uint8Array);
  });

  it('grossit avec le nombre de tracés estampés', async () => {
    const [un, deux] = await Promise.all([
      genererProfilPdf(REPONSES, [signature('Un', 11)]),
      genererProfilPdf(REPONSES, [signature('Un', 11), signature('Deux', 12)]),
    ]);
    expect(deux.length).toBeGreaterThan(un.length);
  });

  it('écrit un montant à séparateur d’espace sans faire échouer l’encodage WinAnsi', async () => {
    // Le piège : Intl.NumberFormat fr-CA produit une espace fine insécable que les polices
    // standard de pdf-lib ne savent pas encoder. Un montant à 4 chiffres le déclencherait.
    const gros = parserReponses({
      experience: 'reduit',
      connaissances: 'reduites',
      absorption: 'autre',
      autre_montant: 99_999,
      remboursement: 'tres_faibles',
      apports: 'tres_faibles',
      besoins: 'tres_faibles',
      virtuel: 'correct',
      priorite: 'petit_paiement',
    })!;
    await expect(genererProfilPdf(gros, [signature('Marc', 11)])).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('versBase64', () => {
  it('encode sans dépasser la limite d’arguments sur un gros document', async () => {
    const octets = await genererProfilPdf(REPONSES, [signature('Marc', 11)]);
    const base64 = versBase64(octets);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(base64.slice(0, 8)).slice(0, 5)).toBe('%PDF-');
  });
});
