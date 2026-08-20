// Retrait de la liste — /api/reseau-retrait. **La seule route du réseau qui soit publique.**
//
// Elle doit l'être : un lien de désabonnement qui demande un mot de passe n'est pas un lien
// de désabonnement. C'est aussi une obligation légale (LCAP) — le mécanisme d'exclusion doit
// rester fonctionnel au moins soixante jours après l'envoi et être traité sans délai.
//
// GET  → une page de confirmation avec un bouton. Les antivirus et aperçus de messagerie
//        visitent les liens des courriels : un GET qui retirerait directement produirait des
//        désabonnements que personne n'a demandés.
// POST → le retrait lui-même, immédiat et idempotent. Trois émetteurs, tous légitimes :
//        le bouton de la page (formulaire), le retrait en un clic d'un fournisseur de
//        messagerie (RFC 8058), et le lien « List-Unsubscribe » d'un client qui poste à vide.
//
// La réponse ne dit jamais si l'adresse existe : « c'est fait » dans tous les cas. Un lien de
// retrait qui distingue les cas devient un moyen de tester des identifiants.
//
// **Mais « c'est fait » doit être vrai.** La version précédente jetait le verdict de
// `retirerParJeton` : un identifiant abîmé en route, un jeton tombé du corps du formulaire,
// une panne de stockage — tout aboutissait à la même page rassurante, la personne restait
// inscrite, et personne ne l'apprenait. D'où les deux règles ci-dessous :
//
//   1. **`c` et `j` sont cherchés partout** — corps du formulaire, puis chaîne de requête.
//      Un POST en un clic porte un corps `List-Unsubscribe=One-Click` et garde les
//      paramètres dans l'URL ; ne lire que le corps revenait à les perdre.
//   2. **Un retrait qui n'aboutit pas prévient la courtière.** La personne, elle, voit
//      toujours la même page — c'est à nous de rattraper, pas à elle de réessayer.

import type { APIRoute } from 'astro';
import { checkRateLimit, escapeHtml, loadResendEnv } from '../../services/emailService';
import { loadSiteConfig } from '../../config';
import { alerterRetraitNonEnregistre } from '../../services/reseauCourriels';
import { retirerParJeton, type ResultatRetrait } from '../../services/reseauContactService';

export const prerender = false;

function page(titre: string, corps: string, bouton: { c: string; j: string } | null): Response {
  const config = loadSiteConfig();
  const html = `<!doctype html>
<html lang="fr-CA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(titre)} — ${escapeHtml(config.nom)}</title>
  <style>
    body { margin:0; background:#f7f2eb; color:#1f1e1c; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; }
    main { max-width:34rem; margin:0 auto; padding:3rem 1.5rem; }
    .carte { background:#fff; border:1px solid #e3d9cc; border-radius:16px; padding:2rem; }
    h1 { font-size:1.35rem; margin:0 0 1rem; }
    p { font-size:.98rem; line-height:1.65; margin:0 0 1rem; }
    button { background:#a85f38; color:#fff; border:none; border-radius:50px; padding:.85rem 1.8rem; font-size:.95rem; font-weight:600; cursor:pointer; }
    button:hover { background:#8d4d2c; }
    .pied { font-size:.8rem; color:#6b6459; margin-top:1.5rem; }
    a { color:#a85f38; }
  </style>
</head>
<body>
  <main>
    <div class="carte">
      <h1>${escapeHtml(titre)}</h1>
      ${corps}
      ${
        bouton
          ? // Les paramètres restent aussi dans l'action du formulaire : si un client de
            // messagerie ou une extension dépouille le corps du POST, la chaîne de requête
            // porte encore de quoi retrouver la fiche.
            `<form method="post" action="/api/reseau-retrait?c=${encodeURIComponent(bouton.c)}&amp;j=${encodeURIComponent(bouton.j)}">
               <input type="hidden" name="c" value="${escapeHtml(bouton.c)}">
               <input type="hidden" name="j" value="${escapeHtml(bouton.j)}">
               <button type="submit">Confirmer le retrait</button>
             </form>`
          : ''
      }
      <p class="pied">
        ${escapeHtml(config.nom)}, ${escapeHtml(config.titre)} — ${escapeHtml(config.organisation)}<br>
        ${escapeHtml(config.adresse)} · ${escapeHtml(config.telephone)}
      </p>
    </div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export const GET: APIRoute = ({ request }) => {
  const params = new URL(request.url).searchParams;
  const c = params.get('c') ?? '';
  const j = params.get('j') ?? '';

  return page(
    'Ne plus recevoir de courriels',
    `<p>Un clic et c’est terminé : vous ne recevrez plus aucun courriel de ${escapeHtml(loadSiteConfig().nom)}.</p>`,
    { c, j },
  );
};

/**
 * Ce qu'un POST porte : le couple (identifiant, jeton), et s'il s'agit d'un retrait en un
 * clic.
 *
 * Le bouton de la page met le couple dans le corps **et** dans l'URL ; un retrait en un clic
 * (RFC 8058) n'a que l'URL, son corps ne portant que `List-Unsubscribe=One-Click`. Le corps
 * a donc la priorité quand il est renseigné, et la chaîne de requête sert de filet — ne lire
 * que l'un des deux revenait à perdre l'un des deux émetteurs.
 */
async function lireDemande(request: Request): Promise<{ c: string; j: string; unClic: boolean }> {
  const params = new URL(request.url).searchParams;
  let c = params.get('c') ?? '';
  let j = params.get('j') ?? '';
  let unClic = false;

  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  try {
    if (type.includes('multipart/form-data')) {
      const donnees = await request.formData();
      c = String(donnees.get('c') ?? '') || c;
      j = String(donnees.get('j') ?? '') || j;
    } else if (type.includes('urlencoded') || type.includes('text/plain')) {
      const brut = await request.text();
      const corps = new URLSearchParams(brut);
      c = (corps.get('c') ?? '') || c;
      j = (corps.get('j') ?? '') || j;
      unClic = corps.get('List-Unsubscribe') === 'One-Click';
    }
  } catch {
    // Corps illisible : la chaîne de requête suffit. Échouer ici priverait la personne de
    // son retrait pour une raison qui ne la regarde pas.
  }

  return { c, j, unClic };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const { c, j, unClic } = await lireDemande(request);
  const config = loadSiteConfig();

  let verdict: ResultatRetrait = 'inconnu';
  let panne: unknown = null;
  try {
    verdict = await retirerParJeton(c, j);
  } catch (err) {
    panne = err;
    console.error('[reseau-retrait] Retrait non enregistré :', err);
  }

  // Un retrait qui n'a pas abouti est un problème de conformité, pas un détail : il faut
  // que quelqu'un le sache. La personne, elle, voit la même page dans tous les cas.
  if (verdict === 'inconnu' || panne) {
    console.error(
      `[reseau-retrait] Retrait sans effet (verdict=${verdict}, id=${c.slice(0, 64)}) — la fiche reste active.`,
    );
    await prevenirLaCourtiere(request, c, j, verdict, panne, clientAddress);
  }

  // Un retrait en un clic est exécuté par le fournisseur de messagerie, pas par un
  // navigateur : il attend une réponse courte, et personne n'est devant l'écran pour lire
  // une page.
  if (unClic) {
    return new Response('OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  return page(
    'C’est fait',
    `<p>Vous ne recevrez plus de courriel de ma part. Aucune autre démarche n’est nécessaire.</p>
     <p>Si vous changez d’avis un jour, écrivez-moi simplement à
        <a href="mailto:${escapeHtml(config.courriel)}">${escapeHtml(config.courriel)}</a>.</p>
     <p><a href="${escapeHtml(config.site_url)}">Retour au site</a></p>`,
    null,
  );
};

/**
 * Le rattrapage : une alerte dans la boîte de la courtière, avec de quoi retrouver la fiche
 * et la retirer à la main. Sans Resend, il ne reste que la console — mais on ne fait jamais
 * échouer le retrait pour une panne d'alerte.
 *
 * Deux filtres avant d'écrire, parce que la route est publique et qu'un courriel déclenché
 * par n'importe qui est un moyen d'inonder une boîte :
 *
 * 1. **Le couple doit être complet.** Un lien réellement cliqué porte toujours `c` et `j` ;
 *    ce qui n'en porte qu'un (ou aucun) est un robot qui balaie, pas quelqu'un qui veut être
 *    retiré. Rien à rattraper, donc rien à signaler.
 * 2. **Un plafond global**, et non par IP : cinq alertes par heure, tous visiteurs confondus.
 *    Une vraie série d'échecs n'a pas besoin de cinquante courriels pour se faire remarquer,
 *    et un balayage distribué ne peut pas faire du rattrapage une nuisance.
 */
async function prevenirLaCourtiere(
  request: Request,
  c: string,
  j: string,
  verdict: ResultatRetrait,
  panne: unknown,
  ip: string | undefined,
): Promise<void> {
  if (!c || !j) return;

  const env = loadResendEnv();
  if (!env) {
    console.error('[reseau-retrait] Resend absent : la courtière n’a pas pu être prévenue.');
    return;
  }

  if (!(await checkRateLimit('global', 'retrait-alerte'))) {
    console.error('[reseau-retrait] Plafond d’alertes atteint — voir les journaux de la fonction.');
    return;
  }
  // Le jeton ne voyage pas dans l'alerte — pas plus dans le lien recopié que dans un champ
  // à lui. Savoir s'il était présent suffit à trancher entre « lien abîmé en route » et
  // « fiche disparue » ; le reproduire ferait vivre dans une boîte de réception ce qui n'a
  // de raison d'être que dans le courriel de la personne.
  const lienSansJeton = new URL(request.url);
  if (lienSansJeton.searchParams.has('j')) lienSansJeton.searchParams.set('j', '(retiré)');

  try {
    await alerterRetraitNonEnregistre(env, {
      identifiant: c,
      jetonPresent: j.length > 0,
      verdict,
      cause: panne ? String((panne as Error)?.message ?? panne) : null,
      url: lienSansJeton.toString(),
      ip: ip ?? '',
      recuLe: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[reseau-retrait] Alerte non envoyée :', err);
  }
}
