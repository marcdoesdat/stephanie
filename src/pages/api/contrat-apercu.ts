// Aperçu du contrat pour celui qui doit le signer — /api/contrat-apercu?d=<dossier>&j=<jeton>.
//
// Personne ne doit signer un document qu'il n'a pas pu lire. Cet endpoint sert donc à
// l'emprunteur **le contrat intégral**, tel qu'il sera signé : le modèle d'Hypotheca estampé
// des valeurs saisies, avec la signature de la courtière et celles déjà recueillies. Ce
// n'est pas un résumé — c'est le document.
//
// Le jeton n'est **pas consommé** : `ouvrirParJeton` se contente de le vérifier. L'emprunteur
// peut donc relire autant de fois qu'il veut avant de se décider, et le lien meurt de la même
// façon qu'avant, au moment de la signature.
//
// Ce que cet endpoint ne fait pas : servir le contrat **une fois signé**. Le lien est mort dès
// la signature, et le document final ne part que vers la courtière, qui en remet copie.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { checkRateLimit, clientIpFromRequest } from '../../services/emailService';
import { ouvrirParJeton } from '../../services/contratDossierService';
import { genererContratPdf, type SignatureEstampee } from '../../services/contratPdfService';
import { nomComplet } from '../../utils/contratCourtage';

export const prerender = false;

function depuisBase64(base64: string): Uint8Array {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** Réponse d'erreur en texte brut : la cible est un cadre PDF, pas un appel JSON. */
function refus(message: string, statut: number): Response {
  return new Response(message, {
    status: statut,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const clientIp = clientIpFromRequest(request);
  if (!(await checkRateLimit(clientIp, 'contrat-apercu'))) {
    return refus('Trop de demandes. Réessayez dans une heure.', 429);
  }

  const ouvert = await ouvrirParJeton(url.searchParams.get('d'), url.searchParams.get('j'));
  if (!ouvert) return refus('Ce lien n’est plus valide.', 410);

  const { dossier } = ouvert;

  let pdf: Uint8Array;
  try {
    // On montre le document tel qu'il est à cet instant : la signature de la courtière et
    // celles des emprunteurs déjà passés. Celui qui lit voit donc exactement ce qu'il
    // s'apprête à contresigner, y compris qui l'a précédé.
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
      dossier.signatureCourtiere
        ? {
            nom: loadSiteConfig().nom,
            trace: depuisBase64(dossier.signatureCourtiere.tracePngBase64),
            signeLe: new Date(dossier.signatureCourtiere.signeLe),
          }
        : null,
    );
  } catch (err) {
    console.error('[contrat-apercu] Le contrat n’a pas pu être produit :', err);
    return refus('Le contrat n’a pas pu être affiché. Écrivez à votre courtière.', 502);
  }

  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` : le document s'affiche dans le cadre de la page de signature plutôt que
      // de déclencher un téléchargement.
      'Content-Disposition': 'inline; filename="contrat-de-courtage.pdf"',
      // Un contrat nominatif ne doit jamais être mis en cache par un intermédiaire.
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow',
      // Le site interdit globalement l'encadrement (X-Frame-Options: DENY). Ici il faut
      // l'autoriser depuis notre propre page de signature — et depuis elle seule.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
};
