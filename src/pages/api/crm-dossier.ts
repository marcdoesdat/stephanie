// Écriture dans le carnet des dossiers clients — /api/crm-dossier. Réservé à la courtière.
//
// Une seule porte pour tout ce qui modifie un dossier : créer, corriger, supprimer, avancer
// l'étape, noter, fixer une relance, ajouter/retirer/cocher une pièce. Le champ `action` dit
// lequel.
//
// Tout ce qui entre passe par le catalogue de src/utils/dossiersClients.ts — une étape, un
// document, un destinataire ou un état hors catalogue fait échouer la requête.
//
// ⚠️ **L'état des documents ne se change que d'ici.** Le portail client n'a aucune route
// d'écriture : il lit sa liste, il ne la coche pas.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import {
  ajouterDocument,
  ajouterNote,
  changerEtape,
  creerDossier,
  fixerRelance,
  marquerDocument,
  modifierDossier,
  retirerDocument,
  supprimerDossier,
  versFiche,
  type DossierClient,
} from '../../services/dossierClientService';
import {
  LONGUEURS,
  destinataireValide,
  documentValide,
  etapeValide,
  etatDocumentValide,
  normaliser,
  parserDonneesDossier,
} from '../../utils/dossiersClients';

export const prerender = false;

function fiche(dossier: DossierClient): Response {
  return jsonResponse({ ok: true, dossier: versFiche(dossier) }, 200);
}

function identifiant(source: Record<string, unknown>): string | null {
  const id = source.id;
  return typeof id === 'string' && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** Une date de relance : un jour, pas un instant. Le passé est accepté — « à faire hier » existe. */
function dateRelance(valeur: unknown): string | null | undefined {
  if (valeur === null || valeur === '') return null;
  if (typeof valeur !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return undefined;
  return Number.isNaN(Date.parse(valeur)) ? undefined : valeur;
}

/** La pièce visée par une action de checklist : une clé de document **et** une personne. */
function cibleDocument(
  source: Record<string, unknown>,
): { cle: Parameters<typeof ajouterDocument>[1]; pourQui: Parameters<typeof ajouterDocument>[2] } | null {
  if (!documentValide(source.document) || !destinataireValide(source.pourQui)) return null;
  return { cle: source.document, pourQui: source.pourQui };
}

const INTROUVABLE = 'Dossier introuvable.';

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

  const id = identifiant(source);

  try {
    switch (source.action) {
      case 'creer': {
        const parse = parserDonneesDossier(source.dossier);
        if (!parse.ok) return jsonResponse({ error: parse.erreur }, 400);

        const resultat = await creerDossier(parse.valeur);
        if ('doublon' in resultat) {
          return jsonResponse(
            {
              error: `${resultat.doublon.nom} a déjà un dossier avec cette adresse.`,
              code: 'doublon',
              dossier: versFiche(resultat.doublon),
            },
            409,
          );
        }
        return fiche(resultat);
      }

      case 'modifier': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const parse = parserDonneesDossier(source.dossier);
        if (!parse.ok) return jsonResponse({ error: parse.erreur }, 400);

        const dossier = await modifierDossier(id, parse.valeur);
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      case 'supprimer': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        await supprimerDossier(id);
        return jsonResponse({ ok: true }, 200);
      }

      case 'etape': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        if (!etapeValide(source.etape)) return jsonResponse({ error: 'Étape inconnue.' }, 400);

        const dossier = await changerEtape(id, source.etape, normaliser(source.note, LONGUEURS.note));
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      case 'document-ajouter': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const cible = cibleDocument(source);
        if (!cible) return jsonResponse({ error: 'Document inconnu.' }, 400);

        const dossier = await ajouterDocument(id, cible.cle, cible.pourQui);
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      case 'document-retirer': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const cible = cibleDocument(source);
        if (!cible) return jsonResponse({ error: 'Document inconnu.' }, 400);

        const dossier = await retirerDocument(id, cible.cle, cible.pourQui);
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      case 'document-etat': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const cible = cibleDocument(source);
        if (!cible) return jsonResponse({ error: 'Document inconnu.' }, 400);
        if (!etatDocumentValide(source.etat)) return jsonResponse({ error: 'État inconnu.' }, 400);

        const dossier = await marquerDocument(id, cible.cle, cible.pourQui, source.etat);
        return dossier ? fiche(dossier) : jsonResponse({ error: 'Pièce absente de la liste.' }, 404);
      }

      case 'note': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const texte = normaliser(source.texte, LONGUEURS.note);
        if (texte.length < 2) return jsonResponse({ error: 'Note vide.' }, 400);

        const dossier = await ajouterNote(id, texte);
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      case 'relance': {
        if (!id) return jsonResponse({ error: INTROUVABLE }, 400);
        const date = dateRelance(source.date);
        if (date === undefined) return jsonResponse({ error: 'Date de relance invalide.' }, 400);

        const dossier = await fixerRelance(id, date);
        return dossier ? fiche(dossier) : jsonResponse({ error: INTROUVABLE }, 404);
      }

      default:
        return jsonResponse({ error: 'Action inconnue.' }, 400);
    }
  } catch (err) {
    console.error('[crm-dossier] Écriture impossible :', err);
    return jsonResponse({ error: 'Le dossier n’a pas pu être mis à jour.' }, 502);
  }
};
