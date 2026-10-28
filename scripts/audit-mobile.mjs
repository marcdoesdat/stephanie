/**
 * Audit mobile des outils, du hero et du questionnaire de contact, sur un serveur lancé :
 * débordements hors de l'écran,
 * champs sous 16 px (Safari iOS zoome au toucher et ne revient pas), cibles tactiles
 * trop petites. Chaque outil est vérifié à 320, 375 et 390 px de large.
 *
 *   node scripts/audit-mobile.mjs http://localhost:4321 [--captures dossier]
 *
 * Chromium : CHROMIUM_PATH=/chemin/vers/chrome, sinon le Chrome installé.
 * Code de sortie 1 s'il reste un débordement ou un champ qui fait zoomer.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:4321').replace(/\/$/, '');
const iCap = process.argv.indexOf('--captures');
const captures = iCap > 0 ? process.argv[iCap + 1] : null;
if (captures) mkdirSync(captures, { recursive: true });

const LARGEURS = [320, 375, 390];
// [nom, chemin, onglet de /outils à ouvrir, conteneur à examiner]
const CIBLES = [
  ['simulateur', '/outils', 'simulateur', '#panel-simulateur'],
  ['calculateur', '/outils', 'calculateur', '#panel-calculateur'],
  ['comparateur', '/outils', 'comparateur', '#panel-comparateur'],
  ['penalite', '/outils', 'penalite', '#panel-penalite'],
  ['refinancement', '/outils', 'refinancement', '#panel-refinancement'],
  ['droits-mutation', '/outils', 'droits-mutation', '#panel-droits-mutation'],
  ['penalite-page', '/outils/calculateur-penalite-hypothecaire', null, '#penalite-calculator'],
  ['capacite-accueil', '/', null, '#outils-teaser'],
  ['accueil-hero', '/', null, '#hero'],
  ['contact', '/', null, '#contact'],
  ['amortissement', '/amortissement?prix=450000&mise=45000&taux=4.99&amort=25&freq=12', null, 'main'],
  ['refinancement-v1', '/refinancement', null, 'main'],
  ['refinancement-v2', '/refinancement-v2', null, 'main'],
];

function auditer(sel) {
  const racine = document.querySelector(sel);
  if (!racine) return { absent: true };
  const vw = document.documentElement.clientWidth;
  const nom = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}`;
  const deborde = [], zoom = [], petits = [];
  for (const el of racine.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea') && !el.matches('[name="bot-field"]')) {
      const fs = parseFloat(s.fontSize);
      if (fs < 16) zoom.push(`${nom(el)} ${fs}px`);
    }
    if (!r.width || !r.height || s.visibility === 'hidden') continue;
    // Les pièges à robots sont rejetés loin à gauche exprès.
    if (r.right < 0) continue;
    if (r.right > vw + 1 || r.left < -1) deborde.push(`${nom(el)} [${Math.round(r.left)} → ${Math.round(r.right)}]`);
    if (el.matches('button,a,input[type=checkbox],input[type=radio],[role=tab]') && (r.height < 32 || r.width < 32)) {
      // Une zone de toucher agrandie par un ::before absolu compte comme suffisante.
      const avant = getComputedStyle(el, '::before');
      if (!(avant.content !== 'none' && avant.position === 'absolute')) petits.push(`${nom(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  const uniques = (a) => [...new Set(a)].slice(0, 12);
  return { deborde: uniques(deborde), zoom: uniques(zoom), petits: uniques(petits), largeurPage: document.documentElement.scrollWidth, vw };
}

const navigateur = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' });
let erreurs = 0;
for (const largeur of LARGEURS) {
  for (const [nomCible, chemin, onglet, sel] of CIBLES) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: 780 }, isMobile: true, hasTouch: true });
    let r;
    try {
      // « load » attendrait les services tiers (analytique, avis) : le DOM suffit ici.
      await page.goto(base + chemin, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
      if (onglet) { await page.click(`#tab-${onglet}`, { timeout: 10000 }); await page.waitForTimeout(500); }
      await page.evaluate(() => document.querySelectorAll('.fade-up').forEach((e) => e.classList.add('visible')));
      r = await page.evaluate(auditer, sel);
    } catch (e) {
      erreurs++;
      console.log(`✗ ${nomCible} @${largeur}px — ${String(e.message).split('\n')[0]}`);
      await page.close();
      continue;
    }
    const pageDeborde = r.largeurPage > r.vw;
    const ko = r.absent || pageDeborde || r.deborde.length || r.zoom.length;
    if (ko) erreurs++;
    console.log(`${ko ? '✗' : '✓'} ${nomCible} @${largeur}px`);
    if (r.absent) console.log(`    conteneur ${sel} introuvable`);
    if (pageDeborde) console.log(`    la page fait ${r.largeurPage} px pour un écran de ${r.vw}`);
    for (const d of r.deborde ?? []) console.log(`    déborde : ${d}`);
    for (const z of r.zoom ?? []) console.log(`    zoom iOS : ${z}`);
    for (const p of r.petits ?? []) console.log(`    (cible petite) ${p}`);
    if (captures && largeur === 375) {
      await page.evaluate(() => document.querySelectorAll('[class*=consent],[id*=consent]').forEach((e) => e.remove()));
      await page.screenshot({ path: `${captures}/${nomCible}.png`, fullPage: true });
    }
    await page.close();
  }
}
await navigateur.close();
console.log(erreurs ? `\n${erreurs} vérification(s) en échec.` : '\nTout passe.');
process.exit(erreurs ? 1 : 0);
