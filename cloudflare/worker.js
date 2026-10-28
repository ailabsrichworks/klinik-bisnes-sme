// Serves Business Quick Fix at klinikbisnessme.rcg.my/business-quick-fix-assessment/ without changing
// the address bar: every request under that path is fetched from the app on Railway and passed back.
// Route (Cloudflare → Workers → this Worker → Settings → Domains & Routes):
//   klinikbisnessme.rcg.my/business-quick-fix-assessment*
// Variables (Settings → Variables and Secrets):
//   APP_ORIGIN    https://quickfix.rcg.my
//   PROXY_SECRET  (secret) the same value as PROXY_SECRET on Railway
const PREFIX = '/business-quick-fix-assessment';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return fetch(request);
    // The app uses relative links, so the page must end in "/".
    if (url.pathname === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 301);

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

    // Keep any redirect from the app inside the masked path.
    const out = new Response(res.body, res);
    const loc = res.headers.get('Location');
    if (loc) {
      const to = new URL(loc, target);
      if (to.origin === new URL(env.APP_ORIGIN).origin) out.headers.set('Location', `${url.origin}${PREFIX}${to.pathname}${to.search}`);
    }
    return out;
  },
};
