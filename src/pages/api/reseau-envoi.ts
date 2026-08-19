// Envoi d'une approche — /api/reseau-envoi. Réservé à la courtière.
//
// GET  ?id=…&gabarit=…  → l'aperçu rendu (objet + corps), personnalisé pour ce contact.
// POST { id, gabarit, objet, corps } → envoie réellement, puis journalise.
//
// Le rendu est fait **côté serveur** pour que le catalogue de gabarits n'existe qu'à un seul
// endroit. Ce que l'écran affiche est donc exactement ce que le serveur sait produire — et
// ce qu'elle en fait ensuite (retoucher, réécrire) est ce qui part vraiment.
//
// Trois refus, dans cet ordre, avant qu'un octet ne parte :
//   1. le contact a demandé son retrait  → jamais, sans exception ;
//   2. le plafond quotidien est atteint  → protège la délivrabilité du domaine ;
//   3. Resend n'est pas configuré        → en dev, on simule et on journalise comme tel.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse, loadResendEnv } from '../../services/emailService';
import { loadSiteConfig } from '../../config';
import { envoyerApproche } from '../../services/reseauCourriels';
import {
  envoisDuJour,
  journaliserEnvoi,
  lienRetrait,
  lireContact,
  listerContacts,
  versFiche,
} from '../../services/reseauContactService';
import {
  PLAFOND_QUOTIDIEN,
  gabaritValide,
  parserMessage,
  peutRecevoir,
  prenomDe,
  rendreTexte,
  type CleGabarit,
  type VariablesGabarit,
} from '../../utils/reseauCourtiers';
import type { Contact } from '../../services/reseauContactService';
import { gabaritEffectif } from '../../services/reseauGabaritsService';

export const prerender = false;

function variables(contact: Contact): VariablesGabarit {
  const config = loadSiteConfig();
  return {
    prenom: prenomDe(contact.nom),
    nom: contact.nom,
    agence: contact.agence,
    secteur: contact.secteur || config.region,
    courtiere: config.nom,
    organisation: config.organisation,
    telephone: config.telephone,
    courriel: config.courriel,
    site: config.site_url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

/**
 * Le rendu part du gabarit **en vigueur** — la réécriture de Stéphanie si elle en a fait
 * une, le modèle d'origine sinon. Passer par `gabaritPour` enverrait un texte que l'écran
 * d'édition ne montre pas.
 */
async function rendre(
  contact: Contact,
  cle: CleGabarit,
): Promise<{ objet: string; corps: string; personnalise: boolean }> {
  const modele = await gabaritEffectif(cle, contact.profession);
  const table = variables(contact);
  return {
    objet: rendreTexte(modele.objet, table),
    corps: rendreTexte(modele.corps, table),
    personnalise: modele.personnalise,
  };
}

/* ------------------------------------------------------------------ */
/*  Aperçu                                                             */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request }) => {
  if (!(await requeteAutorisee(request))) {
    return jsonResponse({ error: 'Session expirée. Rechargez la page.', code: 'acces' }, 401);
  }

  const params = new URL(request.url).searchParams;
  const id = params.get('id') ?? '';
  const gabarit = params.get('gabarit') ?? '';
  if (!gabaritValide(gabarit)) return jsonResponse({ error: 'Gabarit inconnu.' }, 400);

  const contact = await lireContact(id);
  if (!contact) return jsonResponse({ error: 'Contact introuvable.' }, 404);

  try {
    return jsonResponse({ ok: true, ...(await rendre(contact, gabarit)) }, 200);
  } catch (err) {
    console.error('[reseau-envoi] Rendu du gabarit impossible :', err);
    return jsonResponse({ error: 'Ce gabarit n’a pas pu être rendu.' }, 500);
  }
};

/* ------------------------------------------------------------------ */
/*  Envoi                                                              */
/* ------------------------------------------------------------------ */

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

  const message = parserMessage(source);
  if (!message.ok) return jsonResponse({ error: message.erreur }, 400);

  const id = typeof source.id === 'string' ? source.id : '';
  const contact = await lireContact(id);
  if (!contact) return jsonResponse({ error: 'Contact introuvable.' }, 404);

  // 1. Le retrait ne se contourne pas. Vérifié ici, à l'envoi — pas seulement à l'affichage.
  if (!peutRecevoir(contact.etat)) {
    return jsonResponse(
      { error: 'Ce contact a demandé à ne plus être sollicité.', code: 'retire' },
      409,
    );
  }

  // 2. Le plafond du jour, compté sur le carnet entier.
  let contacts: Contact[];
  try {
    contacts = await listerContacts();
  } catch (err) {
    console.error('[reseau-envoi] Carnet illisible :', err);
    return jsonResponse({ error: 'Le carnet n’a pas pu être lu.' }, 502);
  }
  const partis = envoisDuJour(contacts);
  if (partis >= PLAFOND_QUOTIDIEN) {
    return jsonResponse(
      {
        error: `Plafond du jour atteint (${PLAFOND_QUOTIDIEN} envois). Reprenez demain — c'est ce qui garde vos courriels hors des indésirables.`,
        code: 'plafond',
      },
      429,
    );
  }

  // 3. Sans Resend, on ne prétend pas avoir envoyé.
  const env = loadResendEnv();
  if (!env) {
    if (import.meta.env.DEV) {
      console.log(
        `[reseau-envoi] ⚠️  Resend non configuré — message simulé pour ${contact.courriel}\n` +
          `Objet : ${message.valeur.objet}\n${message.valeur.corps}\n` +
          `Retrait : ${lienRetrait(contact, loadSiteConfig().site_url)}`,
      );
      const maj = await journaliserEnvoi(contact.id, message.valeur, { simule: true });
      return jsonResponse({ ok: true, dev: true, contact: maj ? versFiche(maj) : null }, 200);
    }
    console.error('[reseau-envoi] Variables Resend absentes — envoi impossible.');
    return jsonResponse({ error: 'L’envoi de courriels n’est pas configuré sur ce site.' }, 503);
  }

  try {
    await envoyerApproche(env, contact, message.valeur, lienRetrait(contact, loadSiteConfig().site_url));
  } catch (err) {
    console.error('[reseau-envoi] Envoi refusé par Resend :', err);
    return jsonResponse({ error: 'Le courriel n’est pas parti. Réessayez dans un moment.' }, 502);
  }

  // Journaliser après coup : l'inverse ferait croire à un envoi qui n'a pas eu lieu, et la
  // relance suivante serait calculée sur du vide.
  const maj = await journaliserEnvoi(contact.id, message.valeur);
  return jsonResponse(
    { ok: true, contact: maj ? versFiche(maj) : null, envoisDuJour: partis + 1, plafond: PLAFOND_QUOTIDIEN },
    200,
  );
};
