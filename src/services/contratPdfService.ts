/**
 * Génération du PDF « Contrat de courtage hypothécaire ».
 *
 * Le document officiel n'est jamais reconstruit : on charge le modèle fourni par Hypotheca
 * et on **estampe** par-dessus les valeurs saisies, les coches, les initiales, les tracés de
 * signature et les dates. Le PDF produit est donc identique au modèle au pixel près, ce qui
 * est la contrainte de départ du projet.
 *
 * Toute la géométrie vient de src/utils/contratCourtage.ts — ce module ne connaît aucune
 * coordonnée en propre.
 *
 * @module contratPdfService
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { MODELE_BASE64 } from '../data/contratCourtageModele';
import {
  ADRESSE_PROJET,
  AMORTISSEMENT_ANS,
  AMORTISSEMENT_MOIS,
  ASSURANCE_HYPOTHECAIRE,
  AUTRES_EXIGENCES,
  AUTRES_LOGICIELS,
  AUTRES_PRECISIONS,
  AUTRE_CABINET,
  COLLABORATEUR,
  COLONNES_IDENTITE,
  CONSENTEMENTS_VALIDES_JUSQUAU,
  COURTIER,
  DATE_VERIFICATION,
  DOUBLE_REMUNERATION,
  EMPRUNTEURS,
  FRAIS_ETUDE,
  HONORAIRES_MONTANT,
  HONORAIRES_POURCENTAGE,
  INITIALES_COLLABORATEUR,
  INITIALES_RESILIATION,
  INITIALES_RETRIBUTION,
  LARGEUR_COLONNE_IDENTITE,
  LIGNES_IDENTITE,
  MONTANT_PRET,
  NB_PRETEURS_CABINET,
  NB_PRETEURS_COURTIER,
  PARTAGE_RETRIBUTION,
  PPV_CASES,
  PRETEUR_MAJORITAIRE,
  RAISON_DOUBLE_REMUNERATION,
  RANG,
  RESILIATION_MONTANT,
  RESILIATION_POURCENTAGE,
  RETRIBUTION_AUTRE_ENTITE,
  TAUX_INTERET,
  TERME_ANS,
  TERME_MOIS,
  TOTAL_PRET,
  TRACE_HAUTEUR_MAX,
  TRACE_LARGEUR_MAX,
  TRANSFERT_CABINET_CASES,
  TYPES_FINANCEMENT,
  TYPES_TAUX,
  VERSEMENT,
  ZONES_SIGNATURE_EMPRUNTEURS,
  ZONE_SIGNATURE_COURTIER,
  agregerPpv,
  agregerTransfert,
  initialesDe,
  repartirSurLignes,
  type Case,
  type DonneesContrat,
  type Emplacement,
  type NumeroPage,
  type PointPdf,
  type ReponsesEmprunteur,
  type ZoneSignature,
} from '../utils/contratCourtage';
import { formatDateLong } from '../utils/formatters';
import { loadSiteConfig } from '../config';

/** Une signature prête à être estampée sur le document. */
export interface SignatureEstampee {
  readonly nom: string;
  /** Le tracé, en PNG à fond transparent, déjà validé par `decoderTraceSignature`. */
  readonly trace: Uint8Array;
  /** Moment de la signature — chaque signataire porte sa propre date. */
  readonly signeLe: Date;
}

const ENCRE = rgb(0.05, 0.05, 0.05);
const TAILLE_NORMALE = 9.5;
/** En dessous, le texte devient illisible : mieux vaut tronquer que continuer à réduire. */
const TAILLE_MIN = 6;

/**
 * Les polices standard de pdf-lib encodent en WinAnsi. Tout ce qu'elle ne connaît pas
 * (espaces fines insécables produites par `Intl`, guillemets typographiques exotiques,
 * emoji collés dans un champ) lèverait une exception au moment d'écrire. La courtière
 * saisit du texte libre : on nettoie plutôt que d'espérer.
 */
const REMPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  // Espaces exotiques (fine insécable, insécable, demi-cadratin…) → espace ordinaire.
  [/[\u202f\u00a0\u2007\u2008\u2009\u200a\u2028\u2029]/g, ' '],
  [/[\u2018\u2019\u201b]/g, "'"],
  [/[\u201c\u201d\u201f]/g, '"'],
  [/[\u2013\u2014\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u2022\u25cf]/g, '-'],
];

/**
 * Ce que WinAnsi sait encoder, une fois les substitutions ci-dessus appliquées : le latin-1
 * imprimable, plus les quelques ajouts de CP1252 encore utiles en français (œ, Œ, €, ™…).
 * Le reste — emoji, alphabets non latins — est écarté plutôt que de faire lever pdf-lib.
 */
const WINANSI_AUTORISE =
  /[^\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u017d\u017e\u0178\u0192\u20ac\u2122]/g;

function nettoyerPourWinAnsi(texte: string): string {
  let sortie = texte;
  for (const [motif, remplacement] of REMPLACEMENTS) sortie = sortie.replace(motif, remplacement);
  return sortie.replace(WINANSI_AUTORISE, '');
}

/**
 * Trace une coche vectorielle dans la case dont le glyphe « □ » commence en `[x, y]`.
 * Un chevron dessiné plutôt qu'un caractère : aucune dépendance à une police, et le trait
 * reste net à n'importe quel zoom.
 */
function cocher(page: PDFPage, [x, y]: PointPdf): void {
  const style = { thickness: 1.4, color: ENCRE, lineCap: 1 as const };
  page.drawLine({ start: { x: x + 2.2, y: y + 4.6 }, end: { x: x + 4.0, y: y + 2.2 }, ...style });
  page.drawLine({ start: { x: x + 4.0, y: y + 2.2 }, end: { x: x + 7.8, y: y + 8.4 }, ...style });
}

/**
 * Écrit un texte sur une ligne pointillée du modèle.
 *
 * Le texte est d'abord réduit pour tenir dans la largeur de la ligne, puis tronqué s'il n'y
 * arrive toujours pas à la taille minimale. Déborder écraserait le texte imprimé du contrat.
 */
function ecrire(page: PDFPage, emplacement: Emplacement, valeur: string, font: PDFFont): void {
  const texte = nettoyerPourWinAnsi(valeur).trim();
  if (texte === '') return;

  let taille = TAILLE_NORMALE;
  while (taille > TAILLE_MIN && font.widthOfTextAtSize(texte, taille) > emplacement.largeur) {
    taille -= 0.5;
  }

  let sortie = texte;
  while (sortie.length > 1 && font.widthOfTextAtSize(sortie, taille) > emplacement.largeur) {
    sortie = sortie.slice(0, -1);
  }

  page.drawText(sortie, {
    x: emplacement.point[0],
    // +1.5 pt : la ligne pointillée est sous la ligne de base, le texte doit poser dessus.
    y: emplacement.point[1] + 1.5,
    size: taille,
    font,
    color: ENCRE,
  });
}

/** Estampe un texte libre sur les quelques lignes que le modèle réserve. */
function ecrireSurLignes(
  pages: readonly PDFPage[],
  emplacements: readonly Emplacement[],
  valeur: string,
  font: PDFFont,
): void {
  if (valeur.trim() === '' || emplacements.length === 0) return;
  const gabarit = emplacements[0]!;
  // Largeur moyenne d'un caractère d'Helvetica à la taille normale : ~0.5 em.
  const parLigne = Math.floor(gabarit.largeur / (TAILLE_NORMALE * 0.48));
  const lignes = repartirSurLignes(nettoyerPourWinAnsi(valeur), emplacements.length, parLigne);

  for (const [index, ligne] of lignes.entries()) {
    const emplacement = emplacements[index];
    if (!emplacement) break;
    ecrire(pageDe(pages, emplacement.page), emplacement, ligne, font);
  }
}

function pageDe(pages: readonly PDFPage[], numero: NumeroPage): PDFPage {
  const page = pages[numero - 1];
  if (!page) throw new Error(`Modèle PDF invalide : page ${numero} absente.`);
  return page;
}

function cocherCase(pages: readonly PDFPage[], caseAcocher: Case): void {
  cocher(pageDe(pages, caseAcocher.page), caseAcocher.point);
}

/** Estampe un tracé de signature et sa date sur la ligne prévue. */
async function estamperSignature(
  pdf: PDFDocument,
  pages: readonly PDFPage[],
  zone: ZoneSignature,
  signature: SignatureEstampee,
  font: PDFFont,
): Promise<void> {
  const page = pageDe(pages, zone.page);
  const png = await pdf.embedPng(signature.trace);
  // Le tracé est réduit pour tenir dans le gabarit sans jamais être déformé.
  const echelle = Math.min(TRACE_LARGEUR_MAX / png.width, TRACE_HAUTEUR_MAX / png.height);
  page.drawImage(png, {
    x: zone.trace[0],
    y: zone.trace[1] + 1.5,
    width: png.width * echelle,
    height: png.height * echelle,
  });

  page.drawText(nettoyerPourWinAnsi(formatDateLong(signature.signeLe)), {
    x: zone.date[0],
    y: zone.date[1] + 1.5,
    size: 9.5,
    font,
    color: ENCRE,
  });
}

/**
 * Produit le contrat rempli.
 *
 * @param donnees             Données déjà validées par `parserDonneesContrat`.
 * @param signatures          Une entrée par emprunteur, dans l'ordre des lignes du modèle.
 *                            Les emprunteurs sans signature laissent leur ligne vierge.
 * @param signatureCourtiere  La signature de Stéphanie, apposée à la **finalisation**, une
 *                            fois qu'elle a vu les réponses des emprunteurs.
 * @param reponses            Ce que chaque emprunteur a répondu en signant (PPV, transfert,
 *                            coordonnées corrigées), indexé comme `donnees.emprunteurs`.
 */
export async function genererContratPdf(
  donnees: DonneesContrat,
  signatures: ReadonlyMap<number, SignatureEstampee>,
  signatureCourtiere: SignatureEstampee | null,
  reponses: ReadonlyArray<ReponsesEmprunteur | null | undefined> = [],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(MODELE_BASE64);
  const pages = pdf.getPages();
  if (pages.length < 4) throw new Error('Modèle PDF invalide : 4 pages attendues.');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const config = loadSiteConfig();

  /* ---------- En-tête : le courtier, depuis siteConfig ---------- */

  const p1 = pageDe(pages, 1);
  ecrire(p1, COURTIER.nom, config.nom, font);
  ecrire(p1, COURTIER.amf, config.amf, font);
  ecrire(p1, COURTIER.adresse, config.adresse, font);
  ecrire(p1, COURTIER.telephone, config.telephone, font);

  /* ---------- Identification des emprunteurs ---------- */

  for (const [index, emprunteur] of donnees.emprunteurs.entries()) {
    const lignes = EMPRUNTEURS[index];
    if (!lignes) break;
    ecrire(p1, lignes.prenom, emprunteur.prenom, font);
    ecrire(p1, lignes.nom, emprunteur.nom, font);
    // Ce que l'emprunteur a confirmé prime sur ce que la courtière avait saisi de mémoire.
    const repondu = reponses[index] ?? null;
    ecrire(p1, lignes.telephone, repondu?.telephone || emprunteur.telephone, font);
    ecrire(p1, lignes.adresse, repondu?.adresse || emprunteur.adresse, font);
    ecrire(p1, lignes.courriel, emprunteur.courriel, font);
  }

  /* ---------- Divulgations ---------- */

  ecrireSurLignes(pages, RETRIBUTION_AUTRE_ENTITE, donnees.retributionAutreEntite, font);
  ecrireSurLignes(pages, PARTAGE_RETRIBUTION, donnees.partageRetribution, font);
  ecrire(p1, AUTRE_CABINET, donnees.autreCabinet, font);
  ecrire(p1, NB_PRETEURS_CABINET, donnees.nbPreteursCabinet, font);
  ecrire(p1, NB_PRETEURS_COURTIER, donnees.nbPreteursCourtier, font);
  ecrire(p1, PRETEUR_MAJORITAIRE, donnees.preteurMajoritaire, font);
  ecrire(p1, AUTRES_LOGICIELS, donnees.autresLogiciels, font);

  /* ---------- Collaborateur, initiales et PPV ---------- */

  const p2 = pageDe(pages, 2);
  ecrire(p2, COLLABORATEUR, donnees.collaborateur, font);
  // Une seule case pour tout le monde : un seul « oui » suffit à la cocher. Rien n'est coché
  // tant que personne n'a répondu — voir `agregerPpv`.
  const ppv = agregerPpv(reponses);
  if (ppv) cocherCase(pages, PPV_CASES[ppv]);

  /* ---------- Financement ---------- */

  ecrire(p2, ADRESSE_PROJET, donnees.adresseProjet, font);
  for (const type of TYPES_FINANCEMENT) {
    if (donnees.typesFinancement.includes(type.cle)) cocherCase(pages, type.caseAcocher);
  }
  ecrire(p2, AUTRES_PRECISIONS, donnees.autresPrecisions, font);
  ecrire(p2, MONTANT_PRET, donnees.montantPret, font);
  ecrire(p2, ASSURANCE_HYPOTHECAIRE, donnees.assuranceHypothecaire, font);
  ecrire(p2, TOTAL_PRET, donnees.totalPret, font);
  ecrire(p2, TAUX_INTERET, donnees.tauxInteret, font);
  if (donnees.typeTaux) {
    const option = TYPES_TAUX.find((t) => t.cle === donnees.typeTaux);
    if (option) cocherCase(pages, option.caseAcocher);
  }
  ecrire(p2, AMORTISSEMENT_ANS, donnees.amortissementAns, font);
  ecrire(p2, AMORTISSEMENT_MOIS, donnees.amortissementMois, font);
  ecrire(p2, TERME_ANS, donnees.termeAns, font);
  ecrire(p2, TERME_MOIS, donnees.termeMois, font);
  ecrire(p2, VERSEMENT, donnees.versement, font);
  ecrire(p2, RANG, donnees.rang, font);
  ecrireSurLignes(pages, AUTRES_EXIGENCES, donnees.autresExigences, font);

  /* ---------- Frais, honoraires, résiliation ---------- */

  const p3 = pageDe(pages, 3);
  ecrire(p3, FRAIS_ETUDE, donnees.fraisEtude, font);
  ecrire(p3, HONORAIRES_MONTANT, donnees.honorairesMontant, font);
  ecrire(p3, HONORAIRES_POURCENTAGE, donnees.honorairesPourcentage, font);
  if (donnees.doubleRemuneration) {
    const option = DOUBLE_REMUNERATION.find((o) => o.cle === donnees.doubleRemuneration);
    if (option) cocherCase(pages, option.caseAcocher);
  }
  ecrireSurLignes(pages, RAISON_DOUBLE_REMUNERATION, donnees.raisonDoubleRemuneration, font);
  ecrire(p3, RESILIATION_MONTANT, donnees.resiliationMontant, font);
  ecrire(p3, RESILIATION_POURCENTAGE, donnees.resiliationPourcentage, font);

  /* ---------- Initiales : une colonne par emprunteur qui a signé ---------- */

  // Les trois blocs « ____/____/____ » du contrat sont des initiales. Elles ne sont
  // apposées que pour les emprunteurs ayant effectivement signé : des initiales sans
  // signature correspondante donneraient à croire qu'une clause a été acceptée.
  for (const [index, emprunteur] of donnees.emprunteurs.entries()) {
    if (!signatures.has(index)) continue;
    const initiales = initialesDe(emprunteur);
    for (const bloc of [INITIALES_COLLABORATEUR, INITIALES_RETRIBUTION, INITIALES_RESILIATION]) {
      const emplacement = bloc[index];
      if (emplacement) ecrire(pageDe(pages, emplacement.page), emplacement, initiales, font);
    }
  }

  /* ---------- Confirmation et signatures ---------- */

  const p4 = pageDe(pages, 4);
  const transfert = agregerTransfert(reponses);
  if (transfert) cocherCase(pages, TRANSFERT_CABINET_CASES[transfert]);
  ecrire(p4, CONSENTEMENTS_VALIDES_JUSQUAU, donnees.consentementsValidesJusquau, font);

  if (signatureCourtiere) {
    await estamperSignature(pdf, pages, ZONE_SIGNATURE_COURTIER, signatureCourtiere, font);
  }
  for (const [index, signature] of signatures) {
    const zone = ZONES_SIGNATURE_EMPRUNTEURS[index];
    if (zone) await estamperSignature(pdf, pages, zone, signature, font);
  }

  /* ---------- Vérification de l'identité (réservée à la courtière) ---------- */

  for (const ligne of LIGNES_IDENTITE) {
    const valeurs = donnees.identite[ligne.id];
    for (const [colonne, valeur] of valeurs.entries()) {
      const x = COLONNES_IDENTITE[colonne];
      if (x === undefined || !valeur) continue;
      ecrire(p4, { page: 4, point: [x, ligne.y], largeur: LARGEUR_COLONNE_IDENTITE }, valeur, font);
    }
  }
  ecrire(p4, DATE_VERIFICATION, donnees.dateVerification, font);

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

/** Nom de fichier lisible et sans surprise : contrat-courtage-jonathan-poulin-2026-08-13.pdf */
export function nomFichierContrat(nomPrincipal: string, date: Date): string {
  const glissant = nomPrincipal
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `contrat-courtage-${glissant || 'client'}-${date.toISOString().slice(0, 10)}.pdf`;
}
