// Retrait de la liste — /api/reseau-retrait. **La seule route du réseau qui soit publique.**
//
// Elle doit l'être : un lien de désabonnement qui demande un mot de passe n'est pas un lien
// de désabonnement. C'est aussi une obligation légale (LCAP) — le mécanisme d'exclusion doit
// rester fonctionnel au moins soixante jours après l'envoi et être traité sans délai.
//
// GET  → une page de confirmation avec un bouton. Les antivirus et aperçus de messagerie
//        visitent les liens des courriels : un GET qui retirerait directement produirait des
//        désabonnements que personne n'a demandés.
// POST → le retrait lui-même, immédiat et idempotent.
//
// La réponse ne dit jamais si l'adresse existe : « c'est fait » dans tous les cas. Un lien de
// retrait qui distingue les cas devient un moyen de tester des identifiants.

import type { APIRoute } from 'astro';
import { escapeHtml } from '../../services/emailService';
import { loadSiteConfig } from '../../config';
import { retirerParJeton } from '../../services/reseauContactService';

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
          ? `<form method="post" action="/api/reseau-retrait">
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

export const POST: APIRoute = async ({ request }) => {
  let c = '';
  let j = '';

  // Le bouton envoie un formulaire ; le lien « List-Unsubscribe » d'un client de messagerie
  // peut poster sans corps utile. Les deux doivent aboutir.
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('form')) {
    const donnees = await request.formData();
    c = String(donnees.get('c') ?? '');
    j = String(donnees.get('j') ?? '');
  } else {
    const params = new URL(request.url).searchParams;
    c = params.get('c') ?? '';
    j = params.get('j') ?? '';
  }

  const config = loadSiteConfig();
  try {
    await retirerParJeton(c, j);
  } catch (err) {
    // On ne le dit pas à la personne : le carnet sera de toute façon nettoyé à la main.
    console.error('[reseau-retrait] Retrait non enregistré :', err);
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
