// Prévenir le client de l'état de son dossier — /api/crm-prevenir. Réservé à la courtière.
//
// Rien ne part d'ici de lui-même : c'est Stéphanie qui décide qu'il y a matière à écrire. Un
// courriel déclenché par chaque case cochée serait du bruit, et le bruit finit par être
// filtré — avec, dans le même dossier d'indésirables, le seul message qui comptait.
//
// Le message porte l'étape, ce qui manque, et un lien d'accès neuf. Aucune pièce jointe :
// le portail n'héberge pas de documents.

import type { APIRoute } from 'astro';
import { loadSiteConfig } from '../../config';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse, loadResendEnv } from '../../services/emailService';
import {
  emettreLienMagique,
  journaliserCourriel,
  lireDossier,
  versFiche,
} from '../../services/dossierClientService';
import { envoyerSuivi, lienPortail } from '../../services/dossierCourriels';
import { ETAPES } from '../../utils/dossiersClients';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  let source: Record<string, unknown>;
  try {
    source = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Requête invalide' }, 400);
  }

  const id = source.id;
  if (typeof id !== 'string' || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return jsonResponse({ error: 'Dossier introuvable.' }, 400);
  }

  const dossier = await lireDossier(id);
  if (!dossier) return jsonResponse({ error: 'Dossier introuvable.' }, 404);

  // Un dossier que le portail n'affiche pas ne s'annonce pas non plus par courriel : le
  // client cliquerait pour tomber sur un écran neutre.
  if (!ETAPES[dossier.etape].visibleClient) {
    return jsonResponse(
      { error: 'Ce dossier n’est pas visible du client. Changez d’étape avant de le prévenir.' },
      409,
    );
  }

  try {
    const lien = await emettreLienMagique(dossier.id);
    if (!lien) return jsonResponse({ error: 'Le lien n’a pas pu être émis.' }, 502);

    const url = lienPortail(lien.dossierId, lien.jeton, loadSiteConfig().site_url);
    const env = loadResendEnv();

    // Sans Resend, on ne prétend pas avoir envoyé : le journal doit dire « simulé ».
    if (!env) {
      if (import.meta.env.DEV) {
        console.log(`[crm-prevenir] ⚠️  Resend non configuré — suivi simulé pour ${dossier.courriel}\n${url}`);
        const maj = await journaliserCourriel(dossier.id, 'Suivi simulé (Resend absent) — envoyé au client');
        return jsonResponse({ ok: true, simule: true, dossier: maj ? versFiche(maj) : null }, 200);
      }
      console.error('[crm-prevenir] Variables Resend absentes — envoi impossible.');
      return jsonResponse({ error: 'L’envoi de courriels n’est pas configuré sur ce site.' }, 503);
    }

    await envoyerSuivi(env, dossier, url);

    // Journalisé **après** que Resend a accepté : l'inverse ferait croire à un envoi.
    const maj = await journaliserCourriel(dossier.id, 'Suivi envoyé au client');
    return jsonResponse({ ok: true, envoye: true, dossier: maj ? versFiche(maj) : null }, 200);
  } catch (err) {
    console.error('[crm-prevenir] Envoi impossible :', err);
    return jsonResponse({ error: 'Le courriel n’a pas pu être envoyé.' }, 502);
  }
};
