// Aperçu du contrat pour la courtière — /api/contrat-previsualiser.
//
// Rend le PDF à partir de ce qui est saisi à l'écran, sans rien enregistrer ni envoyer.
// C'est ce qui permet à Stéphanie de vérifier le document avant qu'il ne parte : un champ
// tronqué, une case oubliée ou un montant dans la mauvaise ligne se voient d'un coup d'œil
// sur le document, jamais dans un formulaire.
//
// Aucun dossier n'est créé, aucun courriel n'est envoyé, rien n'est stocké.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { genererContratPdf } from '../../services/contratPdfService';
import { lireReglages, traceEnregistree } from '../../services/reglagesCourtiere';
import { parserDonneesContrat } from '../../utils/contratCourtage';
import { decoderTraceSignature } from '../../utils/traceSignature';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return new Response('Session expirée. Rechargez la page.', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response('Requête invalide', { status: 400 });
  }

  const donnees = parserDonneesContrat(payload.donnees);
  if (!donnees) {
    return new Response('Champs invalides ou manquants', { status: 400 });
  }

  // L'aperçu accepte un contrat sans signature : c'est un brouillon, pas un envoi. On
  // montre quand même celle qui est mémorisée, pour que l'aperçu ressemble au document final.
  const fournie = decoderTraceSignature(payload.signatureCourtiere);
  const trace = fournie ?? traceEnregistree(await lireReglages());

  let pdf: Uint8Array;
  try {
    pdf = await genererContratPdf(
      donnees,
      new Map(),
      trace ? { nom: loadSiteConfig().nom, trace, signeLe: new Date() } : null,
    );
  } catch (err) {
    console.error('[contrat-previsualiser] Génération impossible :', err);
    return new Response('Le contrat n’a pas pu être produit.', { status: 502 });
  }

  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="apercu-contrat.pdf"',
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
