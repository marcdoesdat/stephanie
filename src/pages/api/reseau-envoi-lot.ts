// Envoi en lot — /api/reseau-envoi-lot. Réservé à la courtière.
//
// POST { lot: string[], gabarit } → envoie le gabarit **rendu pour chacun**, en série,
// avec un bilan qui nomme qui a reçu, qui a échoué et qui a été ignoré.
//
// Ce que le lot change par rapport à l'envoi un par un, et ce qu'il ne change pas :
//
// - **Le message est rendu par contact.** Pas de texte commun recopié : chacun reçoit le
//   gabarit en vigueur avec ses propres variables (prénom, agence, secteur). Pour changer
//   le texte, on change le modèle — c'est le même chemin que l'écran d'édition.
// - **Les deux refus tiennent.** Retrait (vérifié contact par contact), Resend absent
//   (en dev, tout est simulé et journalisé comme tel).
// - **Rendu avant envoi.** Tous les messages sont rendus avant que le premier ne parte :
//   un gabarit qui ne se rend pas fait échouer le lot entier, jamais une moitié.
// - **Envoi en série, espacé.** Comme les invitations du profil : Resend limite le débit,
//   et des envois parallèles déclenchent un 429 qui ferait échouer tout le lot.
// - **Un échec n'arrête pas les autres.** Chaque courriel est tenté, et le bilan dit ce
//   qui s'est passé — l'écran peut donc relancer précisément ce qui a échoué, sans risquer
//   de réécrire à qui a déjà reçu le message.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse, loadResendEnv } from '../../services/emailService';
import { loadSiteConfig } from '../../config';
import { envoyerApproche } from '../../services/reseauCourriels';
import {
  journaliserEnvoi,
  lienRetrait,
  lireContact,
  type Contact,
} from '../../services/reseauContactService';
import {
  gabaritValide,
  peutRecevoir,
  type CleGabarit,
  type MessageSortant,
} from '../../utils/reseauCourtiers';
import { rendrePourContact } from '../../services/reseauGabaritsService';

export const prerender = false;

/**
 * Un lot n'est pas un achat d'adresses. Au-delà de cette taille, la demande est tronquée.
 * L'écran découpe sa sélection en tranches de 4 pour garder chaque requête courte : la
 * limite protège la fonction, pas le carnet.
 */
const LOT_MAX = 12;

/** Un identifiant de fiche, comme `/api/reseau-contact` sait les lire. */
function identifiant(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length <= 64 && /^[A-Za-z0-9_-]+$/.test(valeur)
    ? valeur
    : null;
}

interface Ligne {
  /** L'identifiant de la fiche — permet à l'écran de décocher précisément ce qui est parti. */
  readonly id: string;
  readonly nom: string;
  readonly courriel: string;
}

export interface BilanLot {
  readonly envoyes: Ligne[];
  readonly echoues: Array<{ nom: string; courriel: string; raison: string }>;
  readonly ignores: Array<{ nom: string; courriel: string; raison: 'retrait' | 'introuvable' }>;
  /** Rempli au fil de l'envoi : vrai si Resend était absent et que tout a été simulé. */
  simule: boolean;
}

/** Espacement entre deux envois : assez pour rester sous la limite de débit de Resend. */
const ATTENTE = 300;

async function attendre(): Promise<void> {
  await new Promise((resoudre) => setTimeout(resoudre, ATTENTE));
}

/** Un contact, avec son message déjà rendu — le couple ne se sépare plus. */
interface Candidat {
  readonly contact: Contact;
  message: MessageSortant;
}

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

  if (!gabaritValide(source.gabarit)) return jsonResponse({ error: 'Gabarit inconnu.' }, 400);
  const gabarit: CleGabarit = source.gabarit;

  // Le lot : des identifiants, dédoublonnés, dans l'ordre reçu.
  const ids: string[] = [];
  if (Array.isArray(source.lot)) {
    const vus = new Set<string>();
    for (const brut of source.lot.slice(0, LOT_MAX * 2)) {
      const id = identifiant(brut);
      if (id && !vus.has(id)) {
        vus.add(id);
        ids.push(id);
        if (ids.length === LOT_MAX) break;
      }
    }
  }
  if (ids.length === 0) {
    return jsonResponse({ error: 'Personne dans la sélection à envoyer.' }, 400);
  }

  // Lecture une à une — la mémorisation du stockage suppose des lectures séquentielles.
  const candidats: Candidat[] = [];
  const ignores: BilanLot['ignores'] = [];
  for (const id of ids) {
    const contact = await lireContact(id);
    if (!contact) {
      continue; // fiche supprimée entre-temps : sans nom ni adresse, rien à signaler
    }
    if (!peutRecevoir(contact.etat)) {
      ignores.push({ nom: contact.nom, courriel: contact.courriel, raison: 'retrait' });
      continue;
    }
    candidats.push({
      contact,
      // Le rendu est fait à la boucle suivante, une fois la liste établie.
      message: { gabarit, objet: '', corps: '' },
    });
  }

  if (candidats.length === 0) {
    return jsonResponse(
      {
        ok: true,
        bilan: { envoyes: [], echoues: [], ignores, simule: false },
      },
      200,
    );
  }

  // Rendu complet avant le premier envoi : un gabarit qui ne se rend pas fait échouer le
  // lot entier, pas une moitié.
  try {
    for (const candidat of candidats) {
      const rendu = await rendrePourContact(candidat.contact, gabarit);
      candidat.message = { gabarit, objet: rendu.objet, corps: rendu.corps };
    }
  } catch (err) {
    console.error('[reseau-envoi-lot] Rendu du gabarit impossible :', err);
    return jsonResponse(
      { error: 'Ce gabarit n’a pas pu être rendu — aucun courriel n’est parti.' },
      500,
    );
  }

  const bilan: BilanLot = { envoyes: [], echoues: [], ignores, simule: false };

  const env = loadResendEnv();
  if (!env) {
    if (import.meta.env.DEV) {
      // En dev sans Resend, on simule le lot entier — même journal, étiquette « simulé ».
      const site = loadSiteConfig().site_url;
      for (const [index, candidat] of candidats.entries()) {
        if (index > 0) await attendre();
        const { contact, message } = candidat;
        console.log(
          `[reseau-envoi-lot] ⚠️  Resend non configuré — message simulé pour ${contact.courriel}\n` +
            `Objet : ${message.objet}\n${message.corps}\n` +
            `Retrait : ${lienRetrait(contact, site)}`,
        );
        try {
          await journaliserEnvoi(contact.id, message, { simule: true });
          bilan.envoyes.push({ id: contact.id, nom: contact.nom, courriel: contact.courriel });
        } catch (err) {
          console.error('[reseau-envoi-lot] Journalisation impossible :', err);
          bilan.echoues.push({
            nom: contact.nom,
            courriel: contact.courriel,
            raison: 'journal',
          });
        }
      }
      bilan.simule = true;
      return jsonResponse({ ok: true, bilan }, 200);
    }
    console.error('[reseau-envoi-lot] Variables Resend absentes — envoi impossible.');
    return jsonResponse({ error: 'L’envoi de courriels n’est pas configuré sur ce site.' }, 503);
  }

  const site = loadSiteConfig().site_url;
  for (const [index, candidat] of candidats.entries()) {
    if (index > 0) await attendre();
    const { contact, message } = candidat;

    try {
      await envoyerApproche(env, contact, message, lienRetrait(contact, site));
    } catch (err) {
      console.error(`[reseau-envoi-lot] Envoi refusé pour ${contact.courriel} :`, err);
      bilan.echoues.push({ nom: contact.nom, courriel: contact.courriel, raison: 'refus' });
      continue;
    }

    // Journaliser après coup — l'inverse ferait croire à un envoi qui n'a pas eu lieu.
    try {
      await journaliserEnvoi(contact.id, message);
    } catch (err) {
      // Le courriel est parti ; le journal, lui, manque. Ce qui compte pour la personne,
      // c'est de ne pas recevoir le même message deux fois : on le compte comme envoyé.
      console.error(`[reseau-envoi-lot] Journalisation impossible pour ${contact.courriel} :`, err);
    }
    bilan.envoyes.push({ id: contact.id, nom: contact.nom, courriel: contact.courriel });
  }

  return jsonResponse({ ok: true, bilan }, 200);
};
