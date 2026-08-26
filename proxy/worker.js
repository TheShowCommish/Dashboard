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
 *
 * It also forwards three things that have nothing to do with ESPN cookies
 * and everything to do with CORS: Letterboxd pages, Fantasy Football
 * Calculator's mock-draft ADP feed, and a single recipe page for the Menu
 * tab. Each gets its own branch so the ESPN cookies are never attached to
 * a third-party request.
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

    // ---- Letterboxd ----
    // Letterboxd publishes no watchlist API and sends no CORS headers, so the
    // browser cannot read letterboxd.com directly from GitHub Pages. This
    // forwards the public profile pages and RSS feed as text.
    //
    // Deliberately a separate branch with its OWN headers: the ESPN cookies
    // below must never travel to a third-party host.
    if (url.pathname.startsWith('/letterboxd/')) {
      const path = url.pathname.slice('/letterboxd'.length);

      // Only public read-only surfaces: a profile's own pages, and a film
      // page (for its site-wide average rating). No account or settings paths.
      const PROFILE = /^\/[A-Za-z0-9_-]+\/(rss\/?|watchlist\/(page\/\d+\/?)?|films\/(diary\/)?(page\/\d+\/?)?|following\/(page\/\d+\/?)?)?$/;
      const FILM    = /^\/film\/[A-Za-z0-9-]+\/$/;
      if (!PROFILE.test(path) && !FILM.test(path))
        return new Response('That Letterboxd path is not proxied.', { status: 400, headers: cors });

      const lb = await fetch('https://letterboxd.com' + path + url.search, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'User-Agent': 'control-deck (personal dashboard)'
        }
      });
      const text = await lb.text();

      return new Response(text, {
        status: lb.status,
        headers: {
          ...cors,
          'Content-Type': 'text/plain; charset=utf-8',
          // Letterboxd is not a live feed; an hour of cache spares them the load.
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // ---- Recipe pages ----
    // The Menu tab's "+ Add by link" reads the schema.org JSON-LD that
    // recipe sites already publish for search engines. The browser cannot
    // fetch those pages from GitHub Pages — no CORS header — so this
    // forwards one page as text.
    //
    // Deliberately narrow so this does not become an open proxy: GET
    // only, http(s) only, no private or loopback hosts, response capped,
    // and no cookie of ours ever travels with it.
    if (url.pathname === '/recipe') {
      const target = url.searchParams.get('url') || '';
      let want;
      try { want = new URL(target); }
      catch { return new Response('Not a URL.', { status: 400, headers: cors }); }

      if (!/^https?:$/.test(want.protocol))
        return new Response('Only http and https.', { status: 400, headers: cors });

      // No reaching back into a private network through this worker.
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(want.hostname))
        return new Response('That host is not reachable from here.', { status: 400, headers: cors });

      const page = await fetch(want.toString(), {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'control-deck (personal meal planner)'
        },
        redirect: 'follow'
      });

      const type = page.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml/i.test(type))
        return new Response('That link is not a web page.', { status: 400, headers: cors });

      // A recipe page is a few hundred KB; anything past 2 MB is not one.
      const text = (await page.text()).slice(0, 2_000_000);

      return new Response(text, {
        status: page.status,
        headers: {
          ...cors,
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }

    // ---- Fantasy Football Calculator: mock-draft ADP ----
    // FFC publishes the consensus of every mock draft run on their site in
    // the last week, filtered to an exact format — for a 12-team PPR league
    // that is thousands of real drafts, with the high pick, the low pick and
    // the standard deviation for each player, not just a mean.
    //
    // It has to come through here because FFC sends no CORS header at all,
    // so the browser cannot read the response no matter which origin asks.
    //
    // Its own branch, before the ESPN block, so the ESPN cookies below never
    // travel to a third party.
    if (url.pathname === '/ffc/adp') {
      const teams  = url.searchParams.get('teams')  || '12';
      const year   = url.searchParams.get('year')   || String(new Date().getFullYear());
      const format = url.searchParams.get('format') || 'ppr';

      // Whitelist rather than forward: these are the only shapes FFC serves,
      // and it keeps a crafted query from turning this into an open proxy.
      const FORMATS = ['ppr', 'half-ppr', 'standard', '2qb', 'dynasty', 'rookie'];
      if (!FORMATS.includes(format) || !/^(8|10|12|14)$/.test(teams) || !/^20dd$/.test(year))
        return new Response('Unsupported ADP format.', { status: 400, headers: cors });

      const ffc = await fetch(
        `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${year}`,
        { headers: { 'Accept': 'application/json', 'User-Agent': 'control-deck (personal dashboard)' } });

      return new Response(await ffc.text(), {
        status: ffc.status,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          // ADP is a rolling seven-day window; it does not move minute to
          // minute, and an hour of cache spares them a hit per page load.
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // ---- ESPN ----
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
