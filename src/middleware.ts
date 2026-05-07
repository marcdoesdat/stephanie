import { defineMiddleware } from 'astro:middleware';

const COOKIE_NAME = 'sw_client_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Protection basique par mot de passe pour /client/*.
 * Activée uniquement si la variable d'environnement CLIENT_PASSWORD est définie
 * (Netlify → Site settings → Environment variables).
 *
 * Sans cette variable, l'espace client reste accessible (mais déjà noindex et exclu du sitemap).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/client')) {
    return next();
  }

  const expected = import.meta.env.CLIENT_PASSWORD ?? process.env.CLIENT_PASSWORD;
  if (!expected) {
    return next();
  }

  // Soumission via ?p=... pour le premier accès
  const submitted = url.searchParams.get('p');
  if (submitted && submitted === expected) {
    const response = await next();
    response.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/client; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
    );
    return response;
  }

  const cookieHeader = context.request.headers.get('cookie') ?? '';
  const cookieValue = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1];
  if (cookieValue && decodeURIComponent(cookieValue) === expected) {
    return next();
  }

  return new Response(
    `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><title>Accès restreint</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:system-ui,sans-serif;background:#f7f5f0;color:#1a1a1a;display:flex;
    align-items:center;justify-content:center;min-height:100vh;margin:0}
    form{background:#fff;padding:2rem;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.06);
    max-width:340px;width:90%}h1{font-family:Lora,serif;margin:0 0 .5rem;font-size:1.4rem}
    p{font-size:.85rem;color:#666;margin:0 0 1.2rem}input{width:100%;padding:.7rem .9rem;
    border:1px solid #e0ddd7;border-radius:8px;font-size:1rem;box-sizing:border-box}
    button{width:100%;margin-top:.8rem;padding:.7rem;background:#2d5a3d;color:#fff;border:0;
    border-radius:8px;font-weight:600;cursor:pointer}</style></head><body>
    <form method="get"><h1>Espace client</h1>
    <p>Entrez le mot de passe transmis par Stéphanie pour accéder à vos outils privés.</p>
    <input type="password" name="p" autofocus required aria-label="Mot de passe"/>
    <button type="submit">Accéder</button></form></body></html>`,
    { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
});
