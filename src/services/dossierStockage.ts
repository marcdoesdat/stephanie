/**
 * Socle de stockage des dossiers de signature — partagé par le « Profil des emprunteurs »
 * et le « Contrat de courtage ».
 *
 * Les deux parcours ont le même besoin : garder un dossier en attente le temps que tout le
 * monde signe, l'atteindre depuis n'importe quelle instance de fonction, et le détruire dès
 * que le PDF est produit. Seule la forme du contenu diffère, d'où ce socle générique et
 * deux services métier au-dessus.
 *
 * ⚠️ Un dossier en attente contient des tracés de signature au repos — la donnée la plus
 * sensible du système. D'où l'expiration courte, la suppression immédiate à la complétion,
 * et la purge opportuniste des dossiers périmés.
 *
 * En développement local (sans Netlify Blobs), le stockage retombe sur une Map en mémoire :
 * suffisant pour dérouler le parcours, perdu au redémarrage.
 *
 * @module dossierStockage
 */

/** Comment une signature a été recueillie — déterminant pour la valeur de la preuve. */
export type VoieSignature = 'presence' | 'distance';

export interface SignatureEnregistree {
  /** Le tracé PNG en base64 (sans le préfixe `data:`). */
  readonly tracePngBase64: string;
  readonly signeLe: string;
  readonly voie: VoieSignature;
  readonly ip: string;
  readonly agent: string;
  readonly empreinteTrace: string;
}

/** Tout dossier stocké doit au moins porter sa date de péremption — la purge s'en sert. */
export interface DossierExpirable {
  readonly expireLe: string;
}

type BlobStore = {
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(): Promise<{ blobs: Array<{ key: string }> }>;
};

export interface Stockage {
  lire(id: string): Promise<string | null>;
  /** Tous les dossiers vivants, contenu brut. Sert aux écrans de suivi de la courtière. */
  lister(): Promise<Array<{ id: string; contenu: string }>>;
  ecrire(id: string, contenu: string): Promise<void>;
  supprimer(id: string): Promise<void>;
  purgerExpires(): Promise<void>;
  /** Message unique relayé par les endpoints sous le code « dossier ». */
  erreur(cause: unknown): Error;
}

/**
 * Le repli mémoire n'a de sens qu'en développement. En production, chaque invocation de
 * fonction Netlify a sa propre mémoire : un dossier écrit là serait introuvable à
 * l'ouverture du lien de signature — c'est-à-dire un lien mort, sans le moindre signal.
 */
function repliMemoireAutorise(): boolean {
  return import.meta.env.DEV === true;
}

/**
 * Fabrique le stockage d'une famille de dossiers.
 *
 * @param nomStore  Nom du store Netlify Blobs — un par famille, jamais partagé.
 * @param etiquette Préfixe des logs, pour savoir lequel des deux parcours a échoué.
 */
export function creerStockage(nomStore: string, etiquette: string): Stockage {
  const memoire = new Map<string, string>();

  // Netlify Blobs n'existe qu'avec un contexte Netlify. On ne le déduit **pas** de
  // `process.env.NETLIFY` : cette variable n'est pas garantie au runtime des fonctions (même
  // constat que ratesService). On tente l'appel, et on retient le résultat pour l'instance.
  let blobsIndisponibles = false;

  async function chargerStore(): Promise<BlobStore | null> {
    if (blobsIndisponibles) return null;
    try {
      const { getStore } = await import('@netlify/blobs');
      // Consistance forte : la signature de l'un doit être visible dès l'ouverture du lien du
      // suivant, sur n'importe quelle instance. Le défaut (éventuel) rendrait un lien encore
      // valide après usage, ou un dossier fraîchement créé introuvable.
      return getStore({ name: nomStore, consistency: 'strong' }) as unknown as BlobStore;
    } catch (err) {
      blobsIndisponibles = true;
      console.warn(`[${etiquette}] Netlify Blobs indisponible :`, err);
      return null;
    }
  }

  function erreur(cause: unknown): Error {
    return new Error(
      `Stockage des dossiers indisponible (Netlify Blobs)${cause ? ` : ${(cause as Error)?.message ?? cause}` : ''}`,
    );
  }

  return {
    erreur,

    async lire(id) {
      const store = await chargerStore();
      if (!store) {
        if (!repliMemoireAutorise()) {
          console.error(`[${etiquette}] Lecture impossible : Netlify Blobs indisponible en production.`);
          return null;
        }
        return memoire.get(id) ?? null;
      }
      try {
        return await store.get(id, { type: 'text' });
      } catch (err) {
        console.error(`[${etiquette}] Échec de lecture du dossier :`, err);
        return null;
      }
    },

    async lister() {
      const store = await chargerStore();
      if (!store) {
        if (!repliMemoireAutorise()) return [];
        return [...memoire].map(([id, contenu]) => ({ id, contenu }));
      }
      try {
        const { blobs } = await store.list();
        const entrees: Array<{ id: string; contenu: string }> = [];
        for (const { key } of blobs) {
          const contenu = await store.get(key, { type: 'text' });
          if (contenu) entrees.push({ id: key, contenu });
        }
        return entrees;
      } catch (err) {
        console.error(`[${etiquette}] Listage impossible :`, err);
        return [];
      }
    },

    async ecrire(id, contenu) {
      const store = await chargerStore();
      if (!store) {
        // Sans Blobs en production, écrire en mémoire reviendrait à envoyer des liens morts :
        // mieux vaut faire échouer la soumission tout de suite, avec la cause nommée.
        if (!repliMemoireAutorise()) throw erreur(null);
        memoire.set(id, contenu);
        return;
      }
      try {
        await store.set(id, contenu);
      } catch (err) {
        // Un dossier qu'on ne peut pas écrire est un dossier perdu : le lien de signature ne
        // mènerait nulle part. On remonte l'erreur en la nommant, plutôt que d'échouer plus
        // loin sans savoir que Netlify Blobs est en cause.
        throw new Error(`Écriture du dossier impossible dans Netlify Blobs (${(err as Error)?.message ?? err})`);
      }
    },

    async supprimer(id) {
      const store = await chargerStore();
      if (!store) {
        memoire.delete(id);
        return;
      }
      try {
        await store.delete(id);
      } catch {
        // Un dossier qu'on n'arrive pas à supprimer expirera de toute façon.
      }
    },

    /**
     * Supprime les dossiers périmés. Appelée au passage lors d'une création — le volume est
     * trop faible (quelques dizaines de dossiers vivants) pour justifier une tâche planifiée.
     */
    async purgerExpires() {
      const store = await chargerStore();
      const maintenant = Date.now();

      if (!store) {
        for (const [id, contenu] of memoire) {
          try {
            if (Date.parse((JSON.parse(contenu) as DossierExpirable).expireLe) < maintenant) memoire.delete(id);
          } catch {
            memoire.delete(id);
          }
        }
        return;
      }

      try {
        const { blobs } = await store.list();
        for (const { key } of blobs) {
          const contenu = await store.get(key, { type: 'text' });
          if (!contenu) continue;
          try {
            if (Date.parse((JSON.parse(contenu) as DossierExpirable).expireLe) < maintenant) {
              await store.delete(key);
            }
          } catch {
            await store.delete(key);
          }
        }
      } catch {
        // Purge best-effort : jamais une raison de faire échouer une soumission.
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Jetons                                                             */
/*                                                                     */
/*  Ce que la chaîne de signature prouve réellement : le contrôle d'une */
/*  boîte courriel distincte, rien de plus. Les jetons ne sont donc pas */
/*  un secret d'authentification fort, mais ils sont traités comme tel :*/
/*  256 bits d'aléa, stockés hachés, à usage unique, avec expiration.   */
/* ------------------------------------------------------------------ */

function base64url(octets: Uint8Array): string {
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Identifiant de dossier : 16 octets d'aléa, non devinable. */
export function nouvelIdentifiant(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Jeton d'invitation : 32 octets d'aléa. N'existe en clair que dans le courriel envoyé. */
export function nouveauJeton(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hexadécimal d'une chaîne — sert à stocker les jetons sans les connaître. */
export async function hacher(valeur: string): Promise<string> {
  const octets = new TextEncoder().encode(valeur);
  const condensat = await crypto.subtle.digest('SHA-256', octets.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(condensat))
    .map((octet) => octet.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparaison à temps constant — évite de distinguer deux jetons par la durée du test. */
export function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/** Forme d'un identifiant de dossier acceptable — filtre avant toute lecture du store. */
export function identifiantPlausible(id: unknown, jeton: unknown): boolean {
  if (typeof id !== 'string' || typeof jeton !== 'string') return false;
  return id.length <= 64 && jeton.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);
}
