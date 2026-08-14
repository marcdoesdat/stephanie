// Aperçu d'un dossier à finaliser, pour la courtière — /api/contrat-apercu-courtiere?d=<dossier>.
//
// Sert le contrat tel qu'il est au moment de la relecture : signé par les emprunteurs, portant
// leurs réponses, **sans** la signature de Stéphanie — c'est précisément ce qu'elle s'apprête
// à ajouter. Elle voit donc le document qu'elle va signer, pas une approximation.
//
// Endpoint distinct de /api/contrat-apercu, qui sert les signataires par jeton nominatif :
// mêler deux chemins d'authentification dans une seule route est la meilleure façon d'y
// laisser passer le mauvais. Ici, c'est le mot de passe de /contrat et rien d'autre.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { ouvrirPourFinalisation } from '../../services/contratDossierService';
import { genererContratPdf, type SignatureEstampee } from '../../services/contratPdfService';
import { nomComplet } from '../../utils/contratCourtage';

export const prerender = false;

function depuisBase64(base64: string): Uint8Array {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function refus(message: string, statut: number): Response {
  return new Response(message, {
    status: statut,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requeteAutorisee(request))) return refus('Session expirée.', 401);

  const dossier = await ouvrirPourFinalisation(url.searchParams.get('d'));
  if (!dossier) return refus('Ce dossier n’est plus à finaliser.', 410);

  let pdf: Uint8Array;
  try {
    const aEstamper = new Map<number, SignatureEstampee>();
    for (const [position, entree] of dossier.emprunteurs.entries()) {
      if (!entree.signature) continue;
      aEstamper.set(position, {
        nom: nomComplet(entree.emprunteur),
        trace: depuisBase64(entree.signature.tracePngBase64),
        signeLe: new Date(entree.signature.signeLe),
      });
    }
    pdf = await genererContratPdf(
      dossier.donnees,
      aEstamper,
      null, // sa signature viendra à la finalisation, pas avant
      dossier.emprunteurs.map((e) => e.reponses),
    );
  } catch (err) {
    console.error('[contrat-apercu-courtiere] Génération impossible :', err);
    return refus('Le contrat n’a pas pu être affiché.', 502);
  }

  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="contrat-a-finaliser.pdf"',
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
};
