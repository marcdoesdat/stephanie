#!/usr/bin/env node
/**
 * Encode le PDF modèle « Profil des emprunteurs » en module TypeScript.
 *
 *   node scripts/encode-modele.mjs <chemin-vers-le-pdf>
 *
 * Pourquoi un module plutôt qu'un fichier lu sur disque : les fonctions SSR Netlify n'ont
 * pas de répertoire courant fiable, et un binaire importé via Vite l'est encore moins. Un
 * module TypeScript est empaqueté avec la fonction, point. Voir §4 de PLAN-profil-emprunteurs.md.
 *
 * Le PDF source n'est volontairement pas versionné : quand Hypotheca révise le formulaire,
 * c'est un nouveau document qui arrive par courriel, pas une modification de l'ancien. Après
 * régénération, il faut réextraire les coordonnées des cases (voir l'entête de
 * src/utils/profilEmprunteurs.ts).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('Usage : node scripts/encode-modele.mjs <chemin-vers-le-pdf>');
  process.exit(1);
}

const CIBLE = resolve('src/data/profilEmprunteursModele.ts');
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
 * Modèle PDF « Profil des emprunteurs » (Hypotheca) encodé en base64.
 *
 * ⚠️ FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
 * Régénérer avec : node scripts/encode-modele.mjs <chemin-vers-le-pdf>
 *
 * Source     : ${octets.length} octets
 * SHA-256    : ${empreinte}
 * Généré le  : ${new Date().toISOString().slice(0, 10)}
 *
 * Découpé en morceaux pour rester lisible par les outils ; rassemblé au chargement.
 *
 * @module profilEmprunteursModele
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
