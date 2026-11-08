/**
 * Les en-têtes de sécurité du site — un seul exemplaire pour les deux chemins qui servent
 * une page.
 *
 * Les pages statiques sont servies par le CDN de Netlify, qui leur applique les
 * `[[headers]]` de `netlify.toml`. Les pages et routes rendues à la demande, elles, sont la
 * réponse d'une fonction : **Netlify ne leur applique pas ces règles**. L'audit de
 * novembre 2026 l'a montré en production — 45 pages sur 58 sans CSP, sans X-Frame-Options ni
 * Referrer-Policy : l'accueil, `/outils/`, les pages villes, toute la version anglaise, et les
 * écrans de signature et de la courtière. `src/middleware.ts` pose donc ces mêmes valeurs sur
 * chaque réponse du serveur.
 *
 * Les deux copies (ici et `netlify.toml`) doivent rester identiques : un test les compare.
 * Changer la CSP, c'est la changer aux deux endroits.
 *
 * @module utils/enTetesSecurite
 */

/**
 * `img-src` accepte `blob:` pour l'import d'une signature photographiée sur `/contrat` : la
 * photo est lue depuis la mémoire du navigateur (`URL.createObjectURL`) avant d'être
 * détourée. Seul un script de la page peut fabriquer une adresse `blob:`, et elle ne vaut que
 * pour notre origine — même raisonnement que `frame-src` pour l'aperçu du contrat.
 */
export const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://cloud.umami.is https://api-gateway.umami.dev https://www.googletagmanager.com https://googleads.g.doubleclick.net; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' https://cloud.umami.is https://api-gateway.umami.dev https://gateway.umami.is https://www.googleadservices.com https://googleads.g.doubleclick.net https://ad.doubleclick.net https://pagead2.googlesyndication.com https://analytics.google.com https://*.google-analytics.com https://www.google.com; " +
  "frame-src 'self' blob: https://outlook.office.com https://bookings.cloud.microsoft; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

export const EN_TETES_SECURITE: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': CSP,
};

function poser(entetes: Headers): void {
  for (const [nom, valeur] of Object.entries(EN_TETES_SECURITE)) {
    // Une route qui a choisi sa propre valeur la garde : l'aperçu du contrat doit pouvoir
    // s'afficher dans un cadre de notre origine (SAMEORIGIN, frame-ancestors 'self').
    if (!entetes.has(nom)) entetes.set(nom, valeur);
  }
}

/**
 * Pose les en-têtes de sécurité absents de la réponse. Une réponse aux en-têtes figés
 * (`Response.redirect`, par exemple) est recopiée plutôt que de faire échouer la requête.
 */
export function avecEnTetesSecurite(reponse: Response): Response {
  try {
    poser(reponse.headers);
    return reponse;
  } catch {
    const copie = new Response(reponse.body, reponse);
    poser(copie.headers);
    return copie;
  }
}
