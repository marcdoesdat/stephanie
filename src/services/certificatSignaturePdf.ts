/**
 * Certificat de signature — le journal d'audit, en PDF.
 *
 * Le document signé doit rester **identique au modèle d'Hypotheca** : rien n'y est ajouté
 * hors des champs prévus. La trace de preuve (horodatage serveur, IP, navigateur, voie,
 * empreintes) vivait donc dans le seul corps du courriel interne — exacte, mais fragile :
 * un courriel se transfère mal, s'imprime mal, et se range difficilement au dossier à côté
 * du document qu'il atteste.
 *
 * Ce module produit un **second PDF**, distinct, qui porte cette trace : signataire par
 * signataire, puis la chronologie, puis l'empreinte SHA-256 du document signé — ce qui le
 * rattache à ce document-là et à aucun autre. Le modèle n'est pas touché.
 *
 * Il suit la même règle que le document signé : il ne part **qu'à la courtière**. Il contient
 * des adresses IP et l'empreinte de chaque tracé ; les emprunteurs n'en ont pas l'usage.
 *
 * @module certificatSignaturePdf
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { loadSiteConfig } from '../config';
import { formatDateHeureLong } from '../utils/formatters';
import { nettoyerPourWinAnsi } from './contratPdfService';
import { versBase64 } from './profilPdfService';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SignataireCertificat {
  readonly nom: string;
  /** « Emprunteur », « Courtière »… — qui signe à quel titre. */
  readonly role: string;
  readonly courriel: string;
  /** Horodatage serveur, ISO 8601 UTC. */
  readonly signeLe: string;
  readonly voie: 'presence' | 'distance';
  readonly ip: string;
  readonly agent: string;
  readonly empreinteTrace: string;
  /** Le tracé lui-même (PNG déjà validé), reproduit en miniature ; `null` pour l'omettre. */
  readonly trace: Uint8Array | null;
  /** Le texte coché au moment de signer ; `null` quand aucune attestation n'est présentée. */
  readonly attestation: string | null;
  /** Ce que la personne a déclaré en signant (PPV, transfert…), sous son nom. */
  readonly declarations: ReadonlyArray<readonly [string, string]>;
}

export interface EntreeCertificat {
  /** « Contrat de courtage hypothécaire », « Profil des emprunteurs ». */
  readonly titreDocument: string;
  readonly nomFichier: string;
  readonly empreintePdf: string;
  /** `null` quand tout a été signé sur place, sans dossier de signature. */
  readonly dossierId: string | null;
  /** Ouverture du dossier de signature, ISO 8601 ; `null` sans dossier. */
  readonly ouvertLe: string | null;
  readonly signataires: readonly SignataireCertificat[];
  readonly produitLe: Date;
}

/* ------------------------------------------------------------------ */
/*  Mise en page                                                       */
/* ------------------------------------------------------------------ */

/** Format lettre : le certificat se range et s'imprime avec le reste du dossier. */
const LARGEUR = 612;
const HAUTEUR = 792;
const MARGE = 54;
const BAS = 64;
const UTILE = LARGEUR - 2 * MARGE;
const COLONNE_LIBELLE = 150;

const ENCRE = rgb(0.12, 0.118, 0.11);
const GRIS = rgb(0.42, 0.38, 0.33);
const ARGILE = rgb(0.66, 0.37, 0.22);
const FILET = rgb(0.89, 0.85, 0.8);

const TRACE_LARGEUR = 170;
const TRACE_HAUTEUR = 52;
/** Hauteur approximative d'une signature sans déclaration : titre, neuf rangées, tracé. */
const HAUTEUR_BLOC_SIGNATAIRE = 250;

export const LIBELLE_VOIE: Record<SignataireCertificat['voie'], string> = {
  presence: 'En présence (même appareil)',
  distance: 'À distance (lien nominatif à usage unique)',
};

/**
 * Découpe un texte pour qu'il tienne dans `largeur`. Les mots trop longs — une empreinte de
 * 64 caractères, une chaîne de navigateur — sont coupés au caractère plutôt que de déborder.
 */
export function couperEnLignes(texte: string, font: PDFFont, taille: number, largeur: number): string[] {
  const mesure = (s: string) => font.widthOfTextAtSize(s, taille);
  const lignes: string[] = [];
  let courante = '';

  const pousserMot = (mot: string) => {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (mesure(essai) <= largeur) {
      courante = essai;
      return;
    }
    if (courante) lignes.push(courante);
    courante = '';
    let morceau = '';
    for (const caractere of mot) {
      if (mesure(morceau + caractere) > largeur && morceau) {
        lignes.push(morceau);
        morceau = '';
      }
      morceau += caractere;
    }
    courante = morceau;
  };

  for (const mot of texte.split(/\s+/).filter(Boolean)) pousserMot(mot);
  if (courante) lignes.push(courante);
  return lignes.length ? lignes : [''];
}

class Mise {
  page!: PDFPage;
  y = 0;

  constructor(
    private readonly pdf: PDFDocument,
    readonly normale: PDFFont,
    readonly grasse: PDFFont,
    readonly chasseFixe: PDFFont,
  ) {
    this.nouvellePage();
  }

  nouvellePage(): void {
    this.page = this.pdf.addPage([LARGEUR, HAUTEUR]);
    this.y = HAUTEUR - MARGE;
  }

  /** Garantit `hauteur` points disponibles, quitte à changer de page. */
  reserver(hauteur: number): void {
    if (this.y - hauteur < BAS) this.nouvellePage();
  }

  texte(valeur: string, options: { taille?: number; font?: PDFFont; couleur?: ReturnType<typeof rgb>; x?: number; largeur?: number; interligne?: number } = {}): void {
    const taille = options.taille ?? 10;
    const font = options.font ?? this.normale;
    const x = options.x ?? MARGE;
    const largeur = options.largeur ?? UTILE - (x - MARGE);
    const interligne = options.interligne ?? taille * 1.35;
    for (const ligne of couperEnLignes(nettoyerPourWinAnsi(valeur), font, taille, largeur)) {
      this.reserver(interligne);
      this.page.drawText(ligne, { x, y: this.y - taille, size: taille, font, color: options.couleur ?? ENCRE });
      this.y -= interligne;
    }
  }

  /** Une ligne « libellé — valeur », la valeur pouvant courir sur plusieurs lignes. */
  rangee(libelle: string, valeur: string, chasseFixe = false): void {
    const taille = 9;
    const interligne = 12.5;
    const fontValeur = chasseFixe ? this.chasseFixe : this.normale;
    const tailleValeur = chasseFixe ? 8 : taille;
    const lignesValeur = couperEnLignes(nettoyerPourWinAnsi(valeur || '—'), fontValeur, tailleValeur, UTILE - COLONNE_LIBELLE);
    const lignesLibelle = couperEnLignes(nettoyerPourWinAnsi(libelle), this.normale, taille, COLONNE_LIBELLE - 10);
    const nb = Math.max(lignesValeur.length, lignesLibelle.length);
    this.reserver(Math.min(nb, 3) * interligne);
    for (let i = 0; i < nb; i += 1) {
      this.reserver(interligne);
      const l = lignesLibelle[i];
      const v = lignesValeur[i];
      if (l) this.page.drawText(l, { x: MARGE, y: this.y - taille, size: taille, font: this.normale, color: GRIS });
      if (v) this.page.drawText(v, { x: MARGE + COLONNE_LIBELLE, y: this.y - taille, size: tailleValeur, font: fontValeur, color: ENCRE });
      this.y -= interligne;
    }
    this.y -= 2;
  }

  titreSection(valeur: string): void {
    this.reserver(40);
    this.y -= 14;
    this.texte(valeur, { taille: 12, font: this.grasse, couleur: ARGILE });
    this.filet();
  }

  filet(): void {
    this.page.drawLine({
      start: { x: MARGE, y: this.y + 2 },
      end: { x: LARGEUR - MARGE, y: this.y + 2 },
      thickness: 0.6,
      color: FILET,
    });
    this.y -= 6;
  }

  image(png: PDFImage): void {
    const echelle = Math.min(TRACE_LARGEUR / png.width, TRACE_HAUTEUR / png.height, 1);
    const largeur = png.width * echelle;
    const hauteur = png.height * echelle;
    const cadre = hauteur + 12;
    this.reserver(cadre + 4);
    const x = MARGE + COLONNE_LIBELLE;
    this.page.drawRectangle({
      x: x - 6,
      y: this.y - cadre,
      width: largeur + 12,
      height: cadre,
      borderColor: FILET,
      borderWidth: 0.6,
    });
    this.page.drawImage(png, { x, y: this.y - cadre + 6, width: largeur, height: hauteur });
    this.y -= cadre + 6;
  }
}

/* ------------------------------------------------------------------ */
/*  Chronologie                                                        */
/* ------------------------------------------------------------------ */

export interface EvenementCertificat {
  readonly le: string;
  readonly libelle: string;
}

/** Les événements du dossier, dans l'ordre où ils se sont produits. */
export function chronologie(entree: EntreeCertificat): EvenementCertificat[] {
  const evenements: EvenementCertificat[] = [];
  if (entree.ouvertLe) {
    evenements.push({ le: entree.ouvertLe, libelle: 'Dossier de signature ouvert' });
  }
  for (const s of entree.signataires) {
    evenements.push({
      le: s.signeLe,
      libelle: `Signé par ${s.nom} (${s.role.toLowerCase()}) — ${s.voie === 'presence' ? 'en présence' : 'à distance'}, IP ${s.ip}`,
    });
  }
  evenements.push({ le: entree.produitLe.toISOString(), libelle: 'Document signé produit et scellé par son empreinte' });
  // Tri stable : deux signatures à la même milliseconde gardent l'ordre du document.
  return evenements
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(a.e.le) - Date.parse(b.e.le) || a.i - b.i)
    .map(({ e }) => e);
}

/* ------------------------------------------------------------------ */
/*  Production                                                         */
/* ------------------------------------------------------------------ */

/** certificat-signature-contrat-courtage-jonathan-poulin-2026-08-13.pdf */
export function nomFichierCertificat(nomFichierDocument: string): string {
  return `certificat-signature-${nomFichierDocument.replace(/\.pdf$/i, '')}.pdf`;
}

export async function genererCertificatPdf(entree: EntreeCertificat): Promise<Uint8Array> {
  const config = loadSiteConfig();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificat de signature — ${nettoyerPourWinAnsi(entree.titreDocument)}`);
  pdf.setAuthor(nettoyerPourWinAnsi(config.nom));
  pdf.setProducer(nettoyerPourWinAnsi(config.site_url));
  pdf.setCreationDate(entree.produitLe);
  pdf.setModificationDate(entree.produitLe);

  const m = new Mise(
    pdf,
    await pdf.embedFont(StandardFonts.Helvetica),
    await pdf.embedFont(StandardFonts.HelveticaBold),
    await pdf.embedFont(StandardFonts.Courier),
  );

  /* ---------- En-tête ---------- */

  m.texte('Certificat de signature', { taille: 20, font: m.grasse });
  m.y -= 2;
  m.texte(`${entree.titreDocument} · ${config.nom}, ${config.titre.toLowerCase()} — ${config.organisation} (AMF ${config.amf})`, {
    taille: 10,
    couleur: GRIS,
  });
  m.y -= 6;
  m.texte(
    'Ce certificat accompagne le document désigné ci-dessous. Il consigne qui l’a signé, quand, ' +
      'depuis où et par quelle voie. Il ne fait pas partie du document : le modèle signé reste ' +
      'identique à celui d’Hypotheca.',
    { taille: 9, couleur: GRIS },
  );

  /* ---------- Document ---------- */

  m.titreSection('Document');
  m.rangee('Document', entree.titreDocument);
  m.rangee('Nom du fichier', entree.nomFichier);
  m.rangee('Empreinte SHA-256', entree.empreintePdf, true);
  if (entree.dossierId) m.rangee('Identifiant du dossier', entree.dossierId, true);
  m.rangee('Signataires', String(entree.signataires.length));
  m.rangee('Certificat produit le', `${formatDateHeureLong(entree.produitLe)} (${entree.produitLe.toISOString()})`);

  /* ---------- Signataires ---------- */

  for (const [index, s] of entree.signataires.entries()) {
    // Une signature se lit d'un bloc : mieux vaut un bas de page vide qu'un tracé séparé de
    // l'identité qu'il atteste. Au-delà d'une page, le découpage reprend son cours.
    m.reserver(Math.min(HAUTEUR_BLOC_SIGNATAIRE + s.declarations.length * 14, HAUTEUR - MARGE - BAS));
    m.titreSection(`Signature ${index + 1} — ${s.nom}`);
    m.rangee('Rôle', s.role);
    m.rangee('Courriel', s.courriel);
    m.rangee('Signé le', formatDateHeureLong(s.signeLe));
    m.rangee('Horodatage serveur (UTC)', s.signeLe);
    m.rangee('Voie', LIBELLE_VOIE[s.voie]);
    m.rangee('Adresse IP', s.ip);
    m.rangee('Navigateur', s.agent.slice(0, 300));
    if (s.attestation) m.rangee('Attestation cochée', s.attestation);
    for (const [libelle, valeur] of s.declarations) m.rangee(libelle, valeur);
    m.rangee('Empreinte SHA-256 du tracé', s.empreinteTrace, true);
    if (s.trace) {
      try {
        m.image(await pdf.embedPng(s.trace));
      } catch {
        // Un tracé illisible ne doit pas coûter le certificat : l'empreinte suffit à le désigner.
        m.rangee('Tracé', 'non reproductible ici — voir l’empreinte ci-dessus');
      }
    }
  }

  /* ---------- Chronologie ---------- */

  m.titreSection('Chronologie');
  for (const evenement of chronologie(entree)) m.rangee(formatDateHeureLong(evenement.le), evenement.libelle);

  /* ---------- Vérification ---------- */

  m.titreSection('Vérifier le document');
  m.texte(
    'Pour démontrer qu’un fichier présenté est bien celui qui a été signé, calculez son ' +
      'empreinte SHA-256 (par exemple « shasum -a 256 fichier.pdf » sur macOS, ' +
      '« certutil -hashfile fichier.pdf SHA256 » sur Windows) et comparez-la à celle ci-dessus. ' +
      'Le moindre octet modifié change l’empreinte entière. Les horodatages sont ceux du serveur, ' +
      'jamais ceux de l’appareil du signataire.',
    { taille: 9, couleur: GRIS },
  );

  /* ---------- Pied de page ---------- */

  const pages = pdf.getPages();
  for (const [index, page] of pages.entries()) {
    const pied = nettoyerPourWinAnsi(
      `${entree.nomFichier} · SHA-256 ${entree.empreintePdf.slice(0, 16)}… · page ${index + 1} de ${pages.length}`,
    );
    page.drawText(pied, { x: MARGE, y: 34, size: 7.5, font: m.normale, color: GRIS });
  }

  return pdf.save();
}

/** Une pièce jointe prête pour Resend. */
export interface CertificatJoint {
  readonly nomFichier: string;
  readonly pdfBase64: string;
}

/**
 * Produit le certificat, ou `null` s'il n'a pas pu l'être.
 *
 * **Ne lève pas.** Le certificat est un confort ajouté à une trace qui existe déjà dans le
 * courriel interne : qu'il échoue ne doit jamais retenir le document signé, ni rouvrir un
 * dossier dont les signatures sont acquises.
 */
export async function produireCertificat(entree: EntreeCertificat): Promise<CertificatJoint | null> {
  try {
    const octets = await genererCertificatPdf(entree);
    return { nomFichier: nomFichierCertificat(entree.nomFichier), pdfBase64: versBase64(octets) };
  } catch (err) {
    console.error('[certificat] Le certificat de signature n’a pas pu être produit :', err);
    return null;
  }
}
