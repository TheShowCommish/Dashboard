/* ============================================================
   letterboxd.js — the watchlist and the recent-diary feed.

   Letterboxd has no public API and sends no CORS headers, so nothing here
   can talk to letterboxd.com from the page itself. Two routes in:

     1. The Cloudflare Worker in /proxy, which forwards the public profile
        pages and the RSS feed server-side. Scraping the watchlist depends
        on Letterboxd's markup, so the parse is written defensively and
        every failure degrades to whatever is already cached.
     2. A watchlist CSV exported from Letterboxd → Settings → Data. No
        proxy, no fragility, but it goes stale until re-imported.

   Posters are not in either payload. Titles are matched against TMDB,
   which the dashboard already has a key for, and the result is cached by
   title so a match costs one lookup ever rather than one per repaint.
   ============================================================ */

const Letterboxd = (() => {
  const IMG = 'https://image.tmdb.org/t/p/w342';

  const user  = () => Store.get('movies.lbUser','ijustwannabox').trim().replace(/^@/,'');
  const proxy = () => Store.get('movies.lbProxy','').trim().replace(/\/+$/,'');
  const tmdb  = () => Store.get('keys.tmdb','');

  /* { slug: {title, year, poster, tmdbId, overview} } — poster lookups are
     expensive in API calls and never change, so they outlive a session. */
  const artCache = () => Store.get('movies.art', {});

  let watchlist = [];      // [{slug, title, year, poster, tmdbId}]
  let diary     = [];      // [{title, year, rated, watchedAt, link}]
  let lastError = '';

  /* Used as a cache key when the export carries no film URL. Accents are
     folded rather than stripped, or "Sátántangó" collapses to "s-t-ntang"
     and two differently-accented titles could land on the same key. */
  const slugify = t => String(t)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/['’.]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

  /* ---- fetching through the worker ---- */
  async function viaProxy(path){
    const p = proxy();
    if(!p) throw new Error('no proxy configured');
    const res = await fetch(`${p}/letterboxd/${user()}${path}`);
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }

  /* ---- watchlist scrape ----
     Letterboxd's current grid renders each film as a lazy-poster component
     carrying its own metadata as attributes:

       data-item-slug="thief"  data-item-name="Thief (1981)"

     Both are read independently, and three older attribute spellings are
     kept as fallbacks, because this is the one part of the module that
     depends on someone else's markup. If every pattern misses, the caller
     sees an empty result and says so rather than silently showing nothing.

     Deliberately attribute-driven rather than DOM-parsed: the poster images
     themselves are lazy-loaded placeholders on a server-rendered fetch, so
     the <img> tags carry no useful artwork or, often, any real title. */
  function parseWatchlist(html){
    const out = [];
    const seen = new Set();

    /* One pass per tag that carries a slug, then both attributes read out
       of that tag — Letterboxd emits data-item-name BEFORE data-item-slug,
       and a regex that assumed the other order matched nothing at all. */
    const TAG = /<[^>]*data-item-slug="[^"]+"[^>]*>/g;
    let m;
    while((m = TAG.exec(html))){
      const tag = m[0];
      const slug = (tag.match(/data-item-slug="([^"]+)"/) || [])[1] || '';
      const name = (tag.match(/data-item-name="([^"]*)"/) || [])[1] || '';
      add(slug, decodeEntities(name));
    }

    /* Legacy shapes: the older grid used data-film-slug with the title in
       the poster image's alt text. */
    if(!out.length){
      const blocks = html.match(/data-film-slug="[^"]+"[\s\S]{0,600}?(?:<\/div>|<\/li>)/g) || [];
      for(const b of blocks){
        const slug = (b.match(/data-film-slug="([^"]+)"/) || [])[1] || '';
        const alt  = (b.match(/<img[^>]*alt="([^"]*)"/) || [])[1] || '';
        add(slug, decodeEntities(alt));
      }
    }

    /* Last resort: film links alone still give a slug, and a slug still
       gives a searchable title. */
    if(!out.length){
      const links = html.match(/(?:href|data-item-link)="\/film\/([a-z0-9-]+)\/"/g) || [];
      for(const l of links) add((l.match(/\/film\/([a-z0-9-]+)\//) || [])[1], '');
    }

    function add(slug, name){
      const raw = (name || '').trim();
      /* data-item-name is "Title (Year)"; split rather than lose the year. */
      const ym = raw.match(/^(.*?)\s*\((\d{4})\)\s*$/);
      const title = (ym ? ym[1] : raw) || slugToTitle(slug);
      const year  = ym ? +ym[2] : yearFromSlug(slug);
      if(!title) return;

      const key = slug || slugify(title);
      if(seen.has(key)) return;
      seen.add(key);
      out.push({slug: key, title, year});
    }

    return out;
  }

  /* Letterboxd disambiguates remakes by appending the year: "the-master-2012". */
  function yearFromSlug(slug){
    const m = String(slug || '').match(/-(\d{4})$/);
    return m ? +m[1] : null;
  }

  /* Fallback when the alt text is missing: "the-thing-1982" → "The Thing". */
  function slugToTitle(slug){
    if(!slug) return '';
    return slug.replace(/-\d{4}$/,'').split('-')
      .map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim();
  }

  function decodeEntities(s){
    if(!s) return '';
    const el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  }

  /* Letterboxd paginates the watchlist at 28 posters a page. Walk pages
     until one comes back short or empty, with a hard stop so a markup
     change cannot turn this into an unbounded crawl. */
  async function scrapeWatchlist(){
    const films = [];
    for(let page = 1; page <= 12; page++){
      const html = await viaProxy(page === 1 ? '/watchlist/' : `/watchlist/page/${page}/`);
      const batch = parseWatchlist(html);
      if(!batch.length) break;
      films.push(...batch);
      if(batch.length < 28) break;
    }
    return films;
  }

  /* ---- diary RSS ----
     The feed carries logged films only — never the watchlist — which is
     exactly why it powers the "recently watched" strip and nothing else. */
  function parseRss(xml){
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('feed was not valid XML');

    return [...doc.querySelectorAll('item')].map(it => {
      const text = tag => it.getElementsByTagName(tag)[0]?.textContent || '';
      /* letterboxd:filmTitle etc. are namespaced; getElementsByTagName with
         the prefix is the reliable read across browsers. */
      const title = text('letterboxd:filmTitle') ||
                    (text('title') || '').replace(/\s*-\s*\d{4}.*$/,'');
      const year  = text('letterboxd:filmYear');
      const rated = text('letterboxd:memberRating');
      return {
        title: title.trim(),
        year: year ? +year : null,
        rated: rated ? +rated : null,
        watchedAt: text('letterboxd:watchedDate') || text('pubDate'),
        link: text('link')
      };
    }).filter(f => f.title);
  }

  /* ---- CSV import ----
     Letterboxd's export is Date,Name,Year,Letterboxd URI. */
  function parseCsv(text){
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2) throw new Error('that file has no rows');

    const split = line => {
      const out = []; let cur = '', q = false;
      for(const ch of line){
        if(ch === '"') q = !q;
        else if(ch === ',' && !q){ out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };

    const head = split(lines[0]).map(h => h.replace(/^"|"$/g,'').trim().toLowerCase());
    const iName = head.findIndex(h => /^(name|title|film)$/.test(h));
    const iYear = head.findIndex(h => /^year$/.test(h));
    const iUri  = head.findIndex(h => /uri|url/.test(h));
    if(iName < 0) throw new Error('needs a "Name" column — use the Letterboxd watchlist export');

    return lines.slice(1).map(split).map(c => {
      const title = (c[iName] || '').replace(/^"|"$/g,'').trim();
      const uri   = iUri >= 0 ? (c[iUri] || '') : '';
      const slug  = (uri.match(/film\/([^/]+)/) || [])[1] || slugify(title);
      return {slug, title, year: iYear >= 0 ? +String(c[iYear]).replace(/\D/g,'') || null : null};
    }).filter(f => f.title);
  }

  function ingestCsv(file){
    const r = new FileReader();
    r.onload = async () => {
      try{
        const films = parseCsv(r.result);
        watchlist = films;
        Store.set('movies.watchlist', {at:new Date().toISOString(), source:'csv', films});
        Store.toast(`Imported ${films.length} films from your watchlist export.`);
        await decorate();
        paint();
      }catch(e){
        Store.toast(`Watchlist CSV problem: ${e.message}.`);
      }
    };
    r.readAsText(file);
  }

  /* ---- posters ----
     One TMDB search per unseen title, in small batches. Films already in the
     art cache cost nothing, so a settled watchlist reloads for free. */
  async function decorate(){
    const key = tmdb();
    if(!key) return;

    const cache = artCache();
    /* Entries cached before genres were stored are refreshed once, so the
       tab is not permanently missing the genre line for old rows. */
    const need = watchlist.filter(f => {
      const a = cache[f.slug];
      return !a || (!a.miss && !a.genreIds);
    });

    for(let i = 0; i < need.length; i += 5){
      await Promise.all(need.slice(i, i+5).map(async f => {
        try{
          const q = encodeURIComponent(f.title);
          const d = await getJSON('https://api.themoviedb.org/3/search/movie' +
            `?query=${q}${f.year ? `&year=${f.year}` : ''}&include_adult=false&language=en-US&api_key=${key}`);
          const hit = (d.results || [])[0];
          if(!hit) { cache[f.slug] = {miss:true}; return; }
          cache[f.slug] = {
            tmdbId: hit.id,
            poster: hit.poster_path || '',
            title: hit.title || f.title,
            year: (hit.release_date || '').slice(0,4),
            overview: hit.overview || '',
            score: hit.vote_count > 40 ? hit.vote_average : null,
            genreIds: hit.genre_ids || []
          };
        }catch(e){
          console.error('Poster lookup failed for', f.title, e.message);
        }
      }));
    }
    Store.set('movies.art', cache);
  }

  /* ---- load ---- */
  function restore(){
    const w = Store.get('movies.watchlist', null);
    if(w && Array.isArray(w.films)) watchlist = w.films;
    const d = Store.get('movies.diary', null);
    if(d && Array.isArray(d.films)) diary = d.films;
    return !!watchlist.length;
  }

  /* force=true re-scrapes even when a cached watchlist exists. */
  async function load(force = false){
    const had = restore();
    if(had && !force) paint();

    if(!proxy()){
      /* Nothing more to do without a proxy — a CSV import is the whole path. */
      lastError = had ? '' : 'no-proxy';
      await decorate();
      paint();
      return;
    }

    /* The two feeds are independent: a watchlist markup change must not
       cost the diary strip, and vice versa. */
    const [wl, rss] = await Promise.allSettled([scrapeWatchlist(), viaProxy('/rss/')]);

    if(wl.status === 'fulfilled' && wl.value.length){
      watchlist = wl.value;
      lastError = '';
      Store.set('movies.watchlist', {at:new Date().toISOString(), source:'scrape', films:watchlist});
    }else if(wl.status === 'rejected'){
      console.error('Letterboxd watchlist scrape failed:', wl.reason?.message);
      lastError = wl.reason?.message || 'scrape failed';
    }else{
      /* Fetch worked, parse found nothing — almost always a markup change
         or a private watchlist. Worth naming, since the cache still shows. */
      lastError = 'watchlist page returned no films (private profile, or their markup changed)';
    }

    if(rss.status === 'fulfilled'){
      try{
        diary = parseRss(rss.value);
        Store.set('movies.diary', {at:new Date().toISOString(), films:diary});
      }catch(e){ console.error('Letterboxd RSS parse failed:', e.message); }
    }else{
      console.error('Letterboxd RSS failed:', rss.reason?.message);
    }

    await decorate();
    paint();
  }

  function paint(){ if(window.MoviesView) MoviesView.render(); }

  /* ---- one film's Letterboxd average ----
     The film page carries the site-wide average in a twitter:data2 meta
     tag ("3.61 out of 5"). Cached forever per slug: it moves in the third
     decimal place and every lookup is a page fetch through the worker.
     Needs the proxy; without one this quietly returns null. */
  const rateCache = () => Store.get('movies.lbRating', {});

  async function rating(slug){
    if(!slug) return null;
    const cache = rateCache();
    if(slug in cache) return cache[slug];
    if(!proxy()) return null;

    try{
      const res = await fetch(`${proxy()}/letterboxd/film/${slug}/`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const m = html.match(/name="twitter:data2"\s+content="([\d.]+)\s+out of 5"/i)
             || html.match(/"ratingValue"\s*:\s*([\d.]+)/i);
      const val = m ? parseFloat(m[1]) : null;
      cache[slug] = Number.isFinite(val) ? val : null;
      Store.set('movies.lbRating', cache);
      return cache[slug];
    }catch(e){
      console.error('Letterboxd rating failed for', slug, e.message);
      return null;
    }
  }

  /* Letterboxd film URLs are the title slugified; good enough to look up a
     film we only know from TMDB. A miss caches as null and is not retried. */
  const filmSlug = (title, year) => {
    const base = slugify(title);
    return year ? [base, `${base}-${year}`] : [base];
  };

  /* Watchlist rows joined to their cached art. */
  function decorated(){
    const cache = artCache();
    return watchlist.map(f => {
      const a = cache[f.slug] || {};
      return {
        slug: f.slug,
        title: a.title || f.title,
        year: a.year || f.year || '',
        poster: a.poster ? IMG + a.poster : '',
        tmdbId: a.tmdbId || null,
        overview: a.overview || '',
        score: a.score ?? null,
        genres: (window.Movies ? Movies.genreNames(a.genreIds) : []),
        url: `https://letterboxd.com/film/${f.slug}/`
      };
    });
  }

  return {
    load, ingestCsv, decorated, rating, filmSlug,
    get diary(){ return diary; },
    get count(){ return watchlist.length; },
    get error(){ return lastError; },
    get hasProxy(){ return !!proxy(); },
    get username(){ return user(); }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Letterboxd = Letterboxd;
