// Demande d'un lien d'accès au portail — /api/dossier-acces.
//
// **La seule route publique du CRM**, et elle doit l'être : un client qui veut consulter son
// suivi ne peut pas passer par le mot de passe de la courtière.
//
// Trois règles, reprises de /api/reseau-retrait :
//
//   1. **La réponse ne dit jamais si l'adresse existe.** Même corps, même code, dans tous les
//      cas. Autrement, la route devient un oracle qui confirme qui est client de Stéphanie —
//      une information que personne n'a le droit de lui soutirer, et qu'un simple formulaire
//      livrerait adresse par adresse.
//   2. **POST seulement.** Un GET qui émettrait un lien serait déclenché par les aperçus
//      automatiques des messageries et les préchargements des navigateurs.
//   3. **Limité en débit**, par adresse IP *et* par adresse courriel : sans la seconde, la
//      route serait un moyen commode de remplir la boîte d'un client depuis n'importe où.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import {
  checkRateLimit,
  clientIpFromRequest,
  jsonResponse,
  loadResendEnv,
} from '../../services/emailService';
import { DUREE_LIEN_MS, emettreLienMagique, trouverParCourriel } from '../../services/dossierClientService';
import { envoyerLienAcces, lienPortail } from '../../services/dossierCourriels';
import { courrielValide, normaliserCourriel } from '../../utils/dossiersClients';

export const prerender = false;

/**
 * La réponse unique. Volontairement au passé indéfini (« si un dossier existe ») : elle doit
 * être vraie dans les deux cas, sans quoi la formulation elle-même trahirait la réponse.
 */
function reponseUniforme(): Response {
  return jsonResponse(
    {
      ok: true,
      message:
        'Si un dossier est associé à cette adresse, le lien vient d’y être envoyé. Vérifiez vos courriels — et vos indésirables.',
    },
    200,
  );
}

export const POST: APIRoute = async ({ request }) => {
  let source: Record<string, unknown>;
  try {
    source = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  // Une adresse malformée est une faute de saisie, pas une tentative : la signaler n'apprend
  // rien sur les clients de Stéphanie et évite au visiteur d'attendre un courriel en vain.
  if (!courrielValide(source.courriel)) {
    return jsonResponse({ error: 'Cette adresse courriel semble incomplète.' }, 400);
  }
  const courriel = normaliserCourriel(source.courriel);

  const ip = clientIpFromRequest(request);
  if (!(await checkRateLimit(ip, 'dossier-acces')) || !(await checkRateLimit(courriel, 'dossier-acces-adresse'))) {
    // Même réponse qu'un succès : distinguer « trop de tentatives » de « adresse inconnue »
    // rendrait le plafond lui-même bavard.
    return reponseUniforme();
  }

  try {
    const dossier = await trouverParCourriel(courriel);
    if (!dossier) return reponseUniforme();

    const lien = await emettreLienMagique(dossier.id);
    if (!lien) return reponseUniforme();

    const url = lienPortail(lien.dossierId, lien.jeton, loadSiteConfig().site_url);
    const env = loadResendEnv();

    if (!env) {
      if (import.meta.env.DEV) {
        console.log(`[dossier-acces] ⚠️  Resend non configuré — lien simulé pour ${courriel}\n${url}`);
        return reponseUniforme();
      }
      console.error('[dossier-acces] Variables Resend absentes — envoi impossible.');
      return reponseUniforme();
    }

    await envoyerLienAcces(env, courriel, url, Math.round(DUREE_LIEN_MS / 60000));
  } catch (err) {
    // Un échec ne doit pas davantage se distinguer : il serait, lui aussi, un signal.
    console.error('[dossier-acces] Émission du lien impossible :', err);
  }

  return reponseUniforme();
};
