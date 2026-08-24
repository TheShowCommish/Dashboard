/**
 * ESPN fantasy proxy — Cloudflare Worker.
 *
 * Why this exists: a private ESPN league requires two cookies (espn_s2 and
 * SWID). A browser will not attach those to a cross-site request, and ESPN
 * will not accept a custom header from a random origin. So this small worker
 * sits in the middle: your dashboard calls it, it calls ESPN with the cookies,
 * and it hands the answer back.
 *
 * Deploy:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler deploy
 *   4. wrangler secret put ESPN_S2      (paste the cookie value)
 *      wrangler secret put ESPN_SWID    (paste the cookie value, braces included)
 *      wrangler secret put ALLOW_ORIGIN (e.g. https://yourname.github.io)
 *   5. Put the worker URL in the dashboard's Settings → Fantasy → Proxy URL.
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'X-Fantasy-Filter, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET')
      return new Response('Only GET is supported.', { status: 405, headers: cors });

    const url = new URL(request.url);

    // Two allowed paths, each to its own ESPN host. Nothing else forwards.
    let host;
    if (url.pathname.startsWith('/apis/v3/games/ffl/'))      host = 'https://lm-api-reads.fantasy.espn.com';
    else if (url.pathname.startsWith('/apis/site/v2/sports/')) host = 'https://site.api.espn.com';
    else return new Response('That path is not proxied.', { status: 400, headers: cors });

    const target = host + url.pathname + url.search;

    const headers = {
      'Cookie': `espn_s2=${env.ESPN_S2}; SWID=${env.ESPN_SWID}`,
      'Accept': 'application/json',
      'User-Agent': 'control-deck'
    };

    // Pass the roster/player filter through untouched if the dashboard sent one.
    const filter = request.headers.get('X-Fantasy-Filter');
    if (filter) headers['X-Fantasy-Filter'] = filter;

    const res = await fetch(target, { headers });
    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};
