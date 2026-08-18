// Écriture dans le carnet du réseau — /api/reseau-contact. Réservé à la courtière.
//
// Une seule porte pour tout ce qui modifie une fiche : créer, corriger, supprimer, changer
// l'état, noter, fixer une relance, importer une liste. Le champ `action` dit lequel.
//
// Tout ce qui entre passe par le catalogue de src/utils/reseauCourtiers.ts — une profession,
// un état ou une base de consentement hors catalogue fait échouer la requête.

import type { APIRoute } from 'astro';
import { requeteAutorisee } from '../../services/accesCourtiere';
import { jsonResponse } from '../../services/emailService';
import {
  ajouterNote,
  changerEtat,
  creerContact,
  fixerRelance,
  modifierContact,
  supprimerContact,
  versFiche,
  type Contact,
} from '../../services/reseauContactService';
import {
  LONGUEURS,
  consentementValide,
  courrielValide,
  etatValide,
  normaliser,
  normaliserCourriel,
  parserContact,
  professionValide,
  type DonneesContact,
} from '../../utils/reseauCourtiers';

export const prerender = false;

/** Un import qui dépasse ce volume n'est plus une liste travaillée : c'est un achat d'adresses. */
const IMPORT_MAX = 200;

function fiche(contact: Contact): Response {
  return jsonResponse({ ok: true, contact: versFiche(contact) }, 200);
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

  try {
    switch (source.action) {
      case 'creer': {
        const parse = parserContact(source.contact);
        if (!parse.ok) return jsonResponse({ error: parse.erreur }, 400);

        const resultat = await creerContact(parse.valeur);
        if ('doublon' in resultat) {
          return jsonResponse(
            {
              error: `${resultat.doublon.nom} est déjà au carnet avec cette adresse.`,
              code: 'doublon',
              contact: versFiche(resultat.doublon),
            },
            409,
          );
        }
        return fiche(resultat);
      }

      case 'modifier': {
        const id = identifiant(source);
        if (!id) return jsonResponse({ error: 'Contact introuvable.' }, 400);

        const parse = parserContact(source.contact);
        if (!parse.ok) return jsonResponse({ error: parse.erreur }, 400);

        const contact = await modifierContact(id, parse.valeur);
        return contact ? fiche(contact) : jsonResponse({ error: 'Contact introuvable.' }, 404);
      }

      case 'supprimer': {
        const id = identifiant(source);
        if (!id) return jsonResponse({ error: 'Contact introuvable.' }, 400);
        await supprimerContact(id);
        return jsonResponse({ ok: true }, 200);
      }

      case 'etat': {
        const id = identifiant(source);
        if (!id) return jsonResponse({ error: 'Contact introuvable.' }, 400);
        if (!etatValide(source.etat)) return jsonResponse({ error: 'État inconnu.' }, 400);

        const resultat = await changerEtat(id, source.etat, normaliser(source.note, LONGUEURS.source));
        if (resultat === null) return jsonResponse({ error: 'Contact introuvable.' }, 404);
        if ('verrouille' in resultat) {
          return jsonResponse(
            {
              error:
                'Ce contact a demandé à ne plus être sollicité. Seul un consentement exprès de sa part permet de rouvrir la fiche.',
              code: 'retire',
            },
            409,
          );
        }
        return fiche(resultat);
      }

      case 'note': {
        const id = identifiant(source);
        if (!id) return jsonResponse({ error: 'Contact introuvable.' }, 400);

        const texte = normaliser(source.texte, LONGUEURS.notes);
        if (texte.length < 2) return jsonResponse({ error: 'Note vide.' }, 400);

        const contact = await ajouterNote(id, texte);
        return contact ? fiche(contact) : jsonResponse({ error: 'Contact introuvable.' }, 404);
      }

      case 'relance': {
        const id = identifiant(source);
        if (!id) return jsonResponse({ error: 'Contact introuvable.' }, 400);

        const date = dateRelance(source.date);
        if (date === undefined) return jsonResponse({ error: 'Date de relance invalide.' }, 400);

        const contact = await fixerRelance(id, date);
        return contact ? fiche(contact) : jsonResponse({ error: 'Contact introuvable.' }, 404);
      }

      case 'importer':
        return await importer(source);

      default:
        return jsonResponse({ error: 'Action inconnue.' }, 400);
    }
  } catch (err) {
    console.error('[reseau-contact] Écriture impossible :', err);
    return jsonResponse({ error: 'Le carnet n’a pas pu être mis à jour.' }, 502);
  }
};

/**
 * Import en lot depuis un collage (nom, courriel, agence).
 *
 * La profession et la **base de consentement s'appliquent à tout le lot** : coller cent
 * adresses sans dire d'où elles viennent est précisément ce qu'on ne veut pas rendre
 * possible. Les doublons sont ignorés en silence — recoller une liste enrichie de trois
 * noms est un geste normal, pas une erreur.
 */
async function importer(source: Record<string, unknown>): Promise<Response> {
  if (!professionValide(source.profession)) return jsonResponse({ error: 'Profession inconnue.' }, 400);

  const consentementBrut =
    typeof source.consentement === 'object' && source.consentement !== null
      ? (source.consentement as Record<string, unknown>)
      : {};
  if (!consentementValide(consentementBrut.base)) {
    return jsonResponse({ error: 'Base de consentement inconnue.' }, 400);
  }
  const sourceConsentement = normaliser(consentementBrut.source, LONGUEURS.source);
  if (sourceConsentement.length < 3) {
    return jsonResponse({ error: 'Indiquez d’où vient cette liste (exigence anti-pourriel).' }, 400);
  }

  const lignes = Array.isArray(source.lignes) ? source.lignes.slice(0, IMPORT_MAX) : [];
  if (lignes.length === 0) return jsonResponse({ error: 'Rien à importer.' }, 400);

  let crees = 0;
  let ignores = 0;
  const rejets: string[] = [];

  for (const brute of lignes) {
    const ligne = (typeof brute === 'object' && brute !== null ? brute : {}) as Record<string, unknown>;
    const nom = normaliser(ligne.nom, LONGUEURS.nom);
    if (nom.length < 2 || !courrielValide(ligne.courriel)) {
      rejets.push(nom || String(ligne.courriel ?? '').slice(0, 60));
      continue;
    }

    const donnees: DonneesContact = {
      nom,
      courriel: normaliserCourriel(ligne.courriel),
      telephone: normaliser(ligne.telephone, LONGUEURS.telephone),
      agence: normaliser(ligne.agence, LONGUEURS.agence),
      secteur: normaliser(ligne.secteur, LONGUEURS.secteur),
      profession: source.profession,
      notes: '',
      consentement: { base: consentementBrut.base, source: sourceConsentement },
    };

    const resultat = await creerContact(donnees);
    if ('doublon' in resultat) ignores += 1;
    else crees += 1;
  }

  return jsonResponse({ ok: true, crees, ignores, rejets: rejets.slice(0, 20) }, 200);
}
