#!/usr/bin/env node
/**
 * Encode un PDF modèle Hypotheca en module TypeScript.
 *
 *   node scripts/encode-modele.mjs <chemin-vers-le-pdf> [modele]
 *
 * `modele` vaut « profil » (défaut) ou « contrat » — voir MODELES ci-dessous.
 *
 * Pourquoi un module plutôt qu'un fichier lu sur disque : les fonctions SSR Netlify n'ont
 * pas de répertoire courant fiable, et un binaire importé via Vite l'est encore moins. Un
 * module TypeScript est empaqueté avec la fonction, point. Voir §4 de PLAN-profil-emprunteurs.md.
 *
 * ⚠️ AVANT D'ENCODER : le PDF doit être un modèle **vierge**, annotations comprises.
 * Un contrat rempli porte ses valeurs dans le flux de contenu, mais aussi parfois dans des
 * **annotations** (/Stamp, /Widget, /FreeText) qui survivent à tout nettoyage du contenu et
 * s'impriment quand même. C'est ainsi que la signature de la courtière s'était retrouvée
 * embarquée dans le modèle. Vérifier avec `qpdf --show-object=trailer` ou pypdf que
 * `/Annots` est absent de chaque page. Un test le verrouille désormais côté code.
 *
 * Les PDF sources ne sont volontairement pas versionnés : quand Hypotheca révise un
 * formulaire, c'est un nouveau document qui arrive par courriel, pas une modification de
 * l'ancien. Après régénération, il faut réextraire les coordonnées des champs (voir
 * l'entête de src/utils/profilEmprunteurs.ts ou src/utils/contratCourtage.ts).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Les modèles connus : où écrire, et comment nommer ce qu'on exporte. */
const MODELES = {
  profil: {
    titre: 'Modèle PDF « Profil des emprunteurs » (Hypotheca)',
    cible: 'src/data/profilEmprunteursModele.ts',
    module: 'profilEmprunteursModele',
    coordonnees: 'src/utils/profilEmprunteurs.ts',
  },
  contrat: {
    titre: 'Modèle PDF « Contrat de courtage hypothécaire » (Hypotheca)',
    cible: 'src/data/contratCourtageModele.ts',
    module: 'contratCourtageModele',
    coordonnees: 'src/utils/contratCourtage.ts',
  },
};

const source = process.argv[2];
const cle = process.argv[3] ?? 'profil';

if (!source || !MODELES[cle]) {
  console.error('Usage : node scripts/encode-modele.mjs <chemin-vers-le-pdf> [profil|contrat]');
  process.exit(1);
}

const modele = MODELES[cle];
const CIBLE = resolve(modele.cible);
const TAILLE_MORCEAU = 4096;

const octets = readFileSync(resolve(source));
if (octets.subarray(0, 5).toString('latin1') !== '%PDF-') {
  console.error(`✗ ${source} ne commence pas par « %PDF- » — ce n'est pas un PDF.`);
  process.exit(1);
}

const base64 = octets.toString('base64');
const morceaux = [];
for (let i = 0; i < base64.length; i += TAILLE_MORCEAU) {
  morceaux.push(base64.slice(i, i + TAILLE_MORCEAU));
}

const empreinte = createHash('sha256').update(octets).digest('hex');

const contenu = `/**
 * ${modele.titre} encodé en base64.
 *
 * ⚠️ FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
 * Régénérer avec : node scripts/encode-modele.mjs <chemin-vers-le-pdf> ${cle}
 * Puis réextraire les coordonnées (voir ${modele.coordonnees}).
 *
 * Source     : ${octets.length} octets
 * SHA-256    : ${empreinte}
 * Généré le  : ${new Date().toISOString().slice(0, 10)}
 *
 * Découpé en morceaux pour rester lisible par les outils ; rassemblé au chargement.
 *
 * @module ${modele.module}
 */

/** Empreinte du PDF d'origine — permet de vérifier qu'on estampe bien le modèle attendu. */
export const MODELE_SHA256 = '${empreinte}';

const MORCEAUX: readonly string[] = [
${morceaux.map((m) => `  '${m}',`).join('\n')}
];

/** Le modèle vierge en base64, prêt pour \`PDFDocument.load\`. */
export const MODELE_BASE64: string = MORCEAUX.join('');
`;

writeFileSync(CIBLE, contenu);
console.log(`✓ ${CIBLE}`);
console.log(`  ${octets.length} octets → ${base64.length} caractères base64 (${morceaux.length} morceaux)`);
console.log(`  SHA-256 ${empreinte}`);
