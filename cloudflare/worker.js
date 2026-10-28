// Serves Business Quick Fix at klinikbisnessme.rcg.my/business-quick-fix-assessment/ without changing
// the address bar: every request under that path is fetched from the app on Railway and passed back.
// Route (Cloudflare → Workers → this Worker → Settings → Domains & Routes):
//   klinikbisnessme.rcg.my/business-quick-fix-assessment*
// Variables (Settings → Variables and Secrets):
//   APP_ORIGIN    the app's Railway address, e.g. https://xxxx.up.railway.app (Railway → Settings → Networking).
//                 Not quickfix.rcg.my: a hostname in the same Cloudflare zone follows the zone's SSL setting,
//                 which can turn this request into http and loop on Railway's move to https.
//   PROXY_SECRET  (secret) the same value as PROXY_SECRET on Railway
const PREFIX = '/business-quick-fix-assessment';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return fetch(request);
    // The app uses relative links, so the page must end in "/".
    if (url.pathname === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 302);

    const target = new URL(url.pathname.slice(PREFIX.length) + url.search, env.APP_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || '');
    headers.set('X-Proxy-Secret', env.PROXY_SECRET || '');
    headers.delete('Cookie');

    const res = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });

    // Keep any redirect from the app inside the masked path, never cached; one that would point back to
    // this same address means the setup is wrong (see APP_ORIGIN), so say so instead of looping.
    const out = new Response(res.body, res);
    const loc = res.headers.get('Location');
    if (loc) {
      const to = new URL(loc, target);
      out.headers.set('Cache-Control', 'no-store');
      if (to.origin === new URL(env.APP_ORIGIN).origin) {
        const masked = `${url.origin}${PREFIX}${to.pathname}${to.search}`;
        if (masked === url.href) return new Response('Setup error: the app redirected to itself. Check APP_ORIGIN.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
        out.headers.set('Location', masked);
      }
    }
    return out;
  },
};
