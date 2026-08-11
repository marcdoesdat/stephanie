/**
 * Génération du PDF « Profil des emprunteurs ».
 *
 * Le document officiel n'est jamais reconstruit : on charge le modèle fourni par Hypotheca
 * et on **estampe** par-dessus les coches, le montant libre, les tracés de signature et les
 * dates. Le PDF produit est donc identique au modèle au pixel près, ce qui est la contrainte
 * de départ du projet.
 *
 * Toute la géométrie vient de src/utils/profilEmprunteurs.ts — ce module ne connaît aucune
 * coordonnée en propre.
 *
 * @module profilPdfService
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { MODELE_BASE64 } from '../data/profilEmprunteursModele';
import {
  CLE_AUTRE,
  POSITION_AUTRE_MONTANT,
  QUESTIONS,
  TRACE_HAUTEUR_MAX,
  TRACE_LARGEUR_MAX,
  formatMontant,
  ZONES_SIGNATURE,
  type PointPdf,
  type ReponsesProfil,
} from '../utils/profilEmprunteurs';
import { formatDateLong } from '../utils/formatters';

/** Une signature prête à être estampée sur le document. */
export interface SignatureEstampee {
  readonly nom: string;
  /** Le tracé, en PNG à fond transparent, déjà validé par `decoderTraceSignature`. */
  readonly trace: Uint8Array;
  /** Moment de la signature — chaque signataire porte sa propre date. */
  readonly signeLe: Date;
}

const ENCRE = rgb(0.05, 0.05, 0.05);

/**
 * Les polices standard de pdf-lib encodent en WinAnsi, qui ne connaît ni l'espace fine
 * insécable produite par `Intl` en fr-CA, ni l'espace insécable. Les remplacer évite une
 * exception au moment d'écrire le texte.
 */
function nettoyerPourWinAnsi(texte: string): string {
  return texte.replace(/[\u202f\u00a0\u2009]/g, ' ');
}

/**
 * Trace une coche vectorielle dans la case dont le glyphe « □ » commence en `[x, y]`.
 * Un chevron dessiné plutôt qu'un caractère : aucune dépendance à une police, et le trait
 * reste net à n'importe quel zoom.
 */
function cocher(page: ReturnType<PDFDocument['getPages']>[number], [x, y]: PointPdf): void {
  const style = { thickness: 1.4, color: ENCRE, lineCap: 1 as const };
  page.drawLine({ start: { x: x + 2.2, y: y + 4.6 }, end: { x: x + 4.0, y: y + 2.2 }, ...style });
  page.drawLine({ start: { x: x + 4.0, y: y + 2.2 }, end: { x: x + 7.8, y: y + 8.4 }, ...style });
}

/**
 * Produit le PDF rempli.
 *
 * @param reponses   Réponses déjà validées contre le catalogue.
 * @param signatures Une entrée par signataire, dans l'ordre des lignes du formulaire.
 *                   Au-delà de trois, les surnuméraires sont ignorés — le modèle n'a que
 *                   trois lignes, et `parserSignataires` plafonne déjà en amont.
 */
export async function genererProfilPdf(
  reponses: ReponsesProfil,
  signatures: readonly SignatureEstampee[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(MODELE_BASE64);
  const page = pdf.getPages()[0];
  if (!page) throw new Error('Modèle PDF invalide : aucune page.');
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  /* ---------- Les 8 réponses ---------- */

  for (const question of QUESTIONS) {
    const cle = reponses.choix[question.id];
    const option = question.options.find((o) => o.cle === cle);
    if (option) cocher(page, option.caseAcocher);
  }

  /* ---------- Le montant libre de la question « absorption » ---------- */

  if (reponses.choix.absorption === CLE_AUTRE && reponses.autreMontant !== null) {
    page.drawText(formatMontant(reponses.autreMontant), {
      x: POSITION_AUTRE_MONTANT[0],
      y: POSITION_AUTRE_MONTANT[1],
      size: 11,
      font: helvetica,
      color: ENCRE,
    });
  }

  /* ---------- Signatures et dates ---------- */

  for (const [index, signature] of signatures.entries()) {
    const zone = ZONES_SIGNATURE[index];
    if (!zone) break;

    const png = await pdf.embedPng(signature.trace);
    // Le tracé est réduit pour tenir dans le gabarit sans jamais être déformé.
    const echelle = Math.min(TRACE_LARGEUR_MAX / png.width, TRACE_HAUTEUR_MAX / png.height);
    page.drawImage(png, {
      x: zone.trace[0],
      y: zone.trace[1],
      width: png.width * echelle,
      height: png.height * echelle,
    });

    page.drawText(nettoyerPourWinAnsi(formatDateLong(signature.signeLe)), {
      x: zone.date[0],
      y: zone.date[1],
      size: 11,
      font: helvetica,
      color: ENCRE,
    });
  }

  return pdf.save();
}

/* ------------------------------------------------------------------ */
/*  Empreintes                                                         */
/* ------------------------------------------------------------------ */

/**
 * Empreinte SHA-256 en hexadécimal. Consignée dans la notification interne pour chaque
 * tracé et pour le PDF final : c'est ce qui permet, plus tard, de démontrer qu'un document
 * présenté est bien celui qui a été signé.
 */
export async function empreinteSha256(octets: Uint8Array): Promise<string> {
  const buffer = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  const condensat = await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer);
  return Array.from(new Uint8Array(condensat))
    .map((octet) => octet.toString(16).padStart(2, '0'))
    .join('');
}

/** Encode des octets en base64 — format attendu par les pièces jointes Resend. */
export function versBase64(octets: Uint8Array): string {
  let binaire = '';
  const TRANCHE = 0x8000; // évite de dépasser la limite d'arguments de String.fromCharCode
  for (let i = 0; i < octets.length; i += TRANCHE) {
    binaire += String.fromCharCode(...octets.subarray(i, i + TRANCHE));
  }
  return btoa(binaire);
}
