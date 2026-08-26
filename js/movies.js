/* ============================================================
   movies.js — upcoming theatrical releases from TMDB.

   Releases become pills on the calendar; clicking one opens the poster,
   synopsis, director, genre and top-3 cast. Credits and genres come from
   one append_to_response call per film rather than three requests.
   ============================================================ */

const Movies = (() => {
  const modal  = document.getElementById('movieModal');
  const mBody  = document.getElementById('movieModalBody');

  const IMG = 'https://image.tmdb.org/t/p/w342';
  let films  = [];        // enriched: credits, genres, runtime — the calendar detail
  let listed = [];        // every upcoming release, list payload only
  let playing = [];       // in cinemas now, most popular first
  let genres = {};        // { id: name } — one request, cached for the session

  /* The list payloads carry genre ids, not names, so every poster can show
     its genre without paying for a detail lookup per film. */
  function genreNames(ids){
    return (ids || []).map(id => genres[id]).filter(Boolean).slice(0, 2);
  }

  async function loadGenres(){
    if(Object.keys(genres).length) return;
    try{
      const d = guard(await getJSON(
        `https://api.themoviedb.org/3/genre/movie/list?language=en-US&api_key=${key()}`));
      genres = Object.fromEntries((d.genres || []).map(g => [g.id, g.name]));
    }catch(e){ console.error('Genre list unavailable:', e.message); }
  }

  /* What is actually in cinemas this week, ranked by TMDB popularity —
     the "worth going out for" shelf, as opposed to the release calendar. */
  async function loadPlaying(){
    try{
      const pages = await Promise.all([1,2].map(n =>
        getJSON('https://api.themoviedb.org/3/movie/now_playing' +
          `?language=en-US&page=${n}&region=US&api_key=${key()}`)
          .then(guard)
          .catch(e => { console.error('Now playing page', n, 'failed:', e.message); return null; })));

      const byId = new Map();
      for(const m of pages.filter(Boolean).flatMap(d => d.results || []))
        if(m.id != null && !byId.has(m.id)) byId.set(m.id, m);

      playing = [...byId.values()]
        .sort((a,b) => (b.popularity || 0) - (a.popularity || 0))
        .map(m => ({
          id: m.id, title: m.title, date: m.release_date || '',
          poster: m.poster_path || '',
          score: m.vote_count > 40 ? m.vote_average : null,
          genres: genreNames(m.genre_ids)
        }));
    }catch(e){ console.error('Now playing failed:', e.message); }
  }

  const key = () => Store.get('keys.tmdb','');

  /* TMDB answers 200 with an error envelope for a bad key, so the HTTP
     status alone is not enough to trust the payload. */
  function guard(d){
    if(d && d.success === false) throw new Error(d.status_message || 'TMDB rejected the request');
    return d;
  }

  /* ---------- the release window ----------

     This used to walk /movie/upcoming, which looks like a release
     calendar and is not one. Two things about that endpoint made the
     calendar under-report, and they compounded:

       1. It sorts by POPULARITY, not by date. Walking five pages got the
          hundred most popular films across its whole window, so a Friday
          with fifteen releases showed only whichever three or four were
          famous enough to make that hundred. Everything else existed in
          TMDB and was simply never fetched.

       2. It is a curated subset over a narrow, TMDB-chosen date range —
          the `dates.minimum`/`dates.maximum` block in its own response —
          rather than "every film out on the day you asked about".

     So this asks /discover/movie directly, which is what /movie/upcoming
     calls internally anyway, but with the window and the ordering set
     deliberately:

       release_date.gte/lte   an explicit range, so completeness is a
                              property of the query rather than a hope
       region=US              regional release dates, not primary ones
       with_release_type=2|3  theatrical, limited and wide. Same pair
                              /movie/upcoming uses by default; the order
                              2|3 means a film that opened limited first
                              is dated from its limited opening, which is
                              the day you could actually go and see it.
       sort_by=…date.asc      nearest first, so if the page cap is ever
                              reached what is lost is the far future
                              rather than this weekend.

     Backwards as well as forwards: the grid draws a fortnight starting
     on Sunday, so days already past are on screen and want their films
     too. */
  const WINDOW_BACK    = 21;     // days behind today
  const WINDOW_FORWARD = 75;     // days ahead
  const MAX_PAGES      = 25;     // 500 films, far past any real fortnight

  const isoDay = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };

  function discoverUrl(from, to, page){
    return 'https://api.themoviedb.org/3/discover/movie'
         + `?api_key=${key()}&language=en-US&region=US`
         + '&include_adult=false&include_video=false'
         + '&with_release_type=2%7C3'
         + `&release_date.gte=${from}&release_date.lte=${to}`
         + '&sort_by=primary_release_date.asc'
         + `&page=${page}`;
  }

  /* Detail lookups are one request per film, so they are reserved for the
     films the calendar can actually show. The rest keep their list-payload
     fields — poster, genres and score — which is everything the carousel
     draws except the director line, and that line is optional.

     Counted from TODAY rather than from the start of the window: the
     window now reaches three weeks back so past days on the grid carry
     their films, and spending the whole detail budget on films that came
     out a fortnight ago would leave this weekend bare. */
  const DETAIL = 30;

  async function load(){
    if(!key()) return;                      // no key: the calendar simply carries no films

    await loadGenres();

    try{
      const today = new Date();
      const from = isoDay(new Date(today.getTime() - WINDOW_BACK    * 864e5));
      const to   = isoDay(new Date(today.getTime() + WINDOW_FORWARD * 864e5));

      const first = guard(await getJSON(discoverUrl(from, to, 1)));

      /* Page through the whole window rather than a fixed few. The bound
         is the date range, so "all of it" is a finite and usually modest
         number — the cap only exists so a pathological range cannot fire
         off hundreds of requests. */
      const pages = Math.min(MAX_PAGES, first.total_pages || 1);
      const rest = await Promise.all(
        Array.from({length: Math.max(0, pages - 1)}, (_, i) =>
          getJSON(discoverUrl(from, to, i + 2))
            .then(guard)
            .catch(e => { console.error('Release page', i+2, 'failed:', e.message); return null; })));

      if((first.total_pages || 0) > MAX_PAGES)
        console.warn(`Release calendar: ${first.total_results} films in range, reading the first ${MAX_PAGES * 20} by date.`);

      const results = [first, ...rest.filter(Boolean)].flatMap(d => d.results || []);

      /* One row per film — a film can appear on more than one page as the
         window slides under a sort. */
      const byId = new Map();
      for(const m of results) if(m.id != null && !byId.has(m.id)) byId.set(m.id, m);

      /* Date first, then popularity WITHIN a day, so a Friday with
         fifteen releases leads with the ones you have heard of and still
         carries the other eleven. */
      const soon = [...byId.values()]
        .filter(m => m.release_date)
        .sort((a,b) => a.release_date.localeCompare(b.release_date)
                    || (b.popularity || 0) - (a.popularity || 0));

      if(!soon.length){ films = []; listed = []; return; }

      /* Everything is kept for the Movies tab; only the nearest handful is
         enriched with credits. */
      listed = soon.map(m => ({
        id: m.id, title: m.title, date: m.release_date,
        poster: m.poster_path || '',
        score: m.vote_count > 40 ? m.vote_average : null,
        genres: genreNames(m.genre_ids)
      }));

      /* Independent of the upcoming list, and cheap — two pages. */
      await loadPlaying();

      /* One detail call per film, in parallel. A film whose details fail
         still renders from the list payload it already has. */
      const todayKey = isoDay(new Date());
      const ahead = soon.filter(m => m.release_date >= todayKey);
      const enrich = (ahead.length ? ahead : soon).slice(0, DETAIL);

      films = await Promise.all(enrich.map(async m => {
        try{
          const full = guard(await getJSON(
            `https://api.themoviedb.org/3/movie/${m.id}?language=en-US` +
            `&append_to_response=credits&api_key=${key()}`));
          return {
            id: m.id,
            imdb: full.imdb_id || '',
            title: full.title || m.title,
            date: m.release_date,
            poster: full.poster_path || m.poster_path,
            overview: full.overview || m.overview || '',
            runtime: full.runtime || 0,
            score: m.vote_count > 40 ? m.vote_average : null,
            genres: (full.genres||[]).slice(0,2).map(g => g.name),
            director: (full.credits?.crew||[]).find(c => c.job === 'Director')?.name || '',
            cast: (full.credits?.cast||[]).slice(0,3).map(c => c.name)
          };
        }catch(e){
          console.error('Detail lookup failed for', m.title, e);
          return {
            id:m.id, title:m.title, date:m.release_date, poster:m.poster_path,
            overview:m.overview||'', runtime:0,
            score: m.vote_count > 40 ? m.vote_average : null,
            genres:[], director:'', cast:[]
          };
        }
      }));

      if(window.CalendarView) CalendarView.render();
      if(window.MoviesView) MoviesView.render();
    }catch(e){
      console.error('Movies failed to load:', e);
      Store.toast(`Movies failed to load (${e.message}). Check the TMDB key.`);
    }
  }

  /* A film past the detail cap, or a watchlist match, has no cached record —
     fetch it on demand and render the same card. */
  async function openTmdb(id){
    const have = films.find(x => String(x.id) === String(id));
    if(have) return open(id);

    modal.hidden = false;
    mBody.innerHTML = '<p class="empty">Loading…</p>';
    try{
      const full = guard(await getJSON(
        `https://api.themoviedb.org/3/movie/${id}?language=en-US` +
        `&append_to_response=credits&api_key=${key()}`));
      films.push({
        id: full.id,
        imdb: full.imdb_id || '',
        title: full.title || '',
        date: full.release_date || '',
        poster: full.poster_path || '',
        overview: full.overview || '',
        runtime: full.runtime || 0,
        score: full.vote_count > 40 ? full.vote_average : null,
        genres: (full.genres||[]).slice(0,2).map(g => g.name),
        director: (full.credits?.crew||[]).find(c => c.job === 'Director')?.name || '',
        cast: (full.credits?.cast||[]).slice(0,3).map(c => c.name)
      });
      open(id);
    }catch(e){
      mBody.innerHTML = `<p class="empty">Could not load that film (${esc(e.message)}).</p>`;
    }
  }

  /* Full record for one film, fetched and cached on demand. The list
     payloads carry no synopsis for anything past the detail cap, which is
     why the movies AD kept saying "no synopsis available". */
  async function detail(id){
    const have = films.find(x => String(x.id) === String(id));
    if(have && have.overview) return have;
    if(!key()) return have || null;

    try{
      const full = guard(await getJSON(
        `https://api.themoviedb.org/3/movie/${id}?language=en-US` +
        `&append_to_response=credits&api_key=${key()}`));
      const rec = {
        id: full.id,
        imdb: full.imdb_id || '',
        title: full.title || '',
        date: full.release_date || '',
        poster: full.poster_path || '',
        overview: full.overview || '',
        runtime: full.runtime || 0,
        score: full.vote_count > 40 ? full.vote_average : null,
        genres: (full.genres||[]).slice(0,2).map(g => g.name),
        director: (full.credits?.crew||[]).find(c => c.job === 'Director')?.name || '',
        cast: (full.credits?.cast||[]).slice(0,3).map(c => c.name)
      };
      const i = films.findIndex(x => String(x.id) === String(id));
      if(i >= 0) films[i] = {...films[i], ...rec}; else films.push(rec);
      return rec;
    }catch(e){
      console.error('Detail lookup failed for', id, e.message);
      return have || null;
    }
  }

  /* ---- find a film we only know the name of ----
     The diary and the network hand back a title and a year and nothing
     else. TMDB's search turns that into an id, which is what every other
     lookup here needs. Cached per title forever, misses included, so a
     film nobody can find is not searched for on every rotation. */
  const searchCache = () => Store.get('movies.search', {});

  async function find(title, year){
    if(!title || !key()) return null;
    const k = `${title}|${year || ''}`.toLowerCase();
    const cache = searchCache();
    if(k in cache) return cache[k];

    try{
      const d = guard(await getJSON('https://api.themoviedb.org/3/search/movie' +
        `?language=en-US&query=${encodeURIComponent(title)}` +
        (year ? `&year=${encodeURIComponent(year)}` : '') +
        `&api_key=${key()}`));
      const hit = (d.results || [])[0] || null;
      const out = hit ? hit.id : null;
      cache[k] = out;
      Store.set('movies.search', cache);
      return out;
    }catch(e){
      console.error('Film search failed for', title, e.message);
      return null;
    }
  }

  /* ---- outside ratings (OMDb) ----
     TMDB publishes its own average and nothing else. Rotten Tomatoes comes
     from OMDb, which is free but needs its own key — with no key the AD
     simply shows one fewer rating rather than an error. Cached per film
     forever: a released film's scores barely move and the free tier is
     1,000 calls a day. */
  const omdbCache = () => Store.get('movies.omdb', {});

  async function ratings(imdbId){
    if(!imdbId) return null;
    const cache = omdbCache();
    if(cache[imdbId]) return cache[imdbId];

    const k = Store.get('keys.omdb','');
    if(!k) return null;

    try{
      const d = await getJSON(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${k}`);
      if(!d || d.Response === 'False') throw new Error(d?.Error || 'not found');
      const find = n => (d.Ratings || []).find(r => r.Source === n)?.Value || '';
      const out = {
        rt: find('Rotten Tomatoes'),
        meta: find('Metacritic'),
        imdb: d.imdbRating && d.imdbRating !== 'N/A' ? d.imdbRating : ''
      };
      cache[imdbId] = out;
      Store.set('movies.omdb', cache);
      return out;
    }catch(e){
      console.error('OMDb ratings failed for', imdbId, e.message);
      return null;
    }
  }

  /* Every diary entry for this film — yours and the network's — above
     the studio's synopsis. A film four people have seen is four rows;
     that IS the interesting part of a watchlist. */
  function saidHtml(f){
    if(!window.Letterboxd) return '';
    const said = Letterboxd.reviewsFor(f.title, (f.date || '').slice(0,4), f.slug);
    if(!said.length) return '';

    /* Letterboxd rates in halves and so does this: rounding 4.5 up to
       five stars misreports what someone actually gave a film. Only the
       stars given are drawn — the empty ones were padding. */
    const stars = n => {
      if(n == null) return '';
      const full = Math.floor(n), half = n - full >= .5;
      return '★'.repeat(full) + (half ? '½' : '');
    };
    const when = f2 => f2.watchedAt && !Number.isNaN(+new Date(f2.watchedAt))
      ? new Date(f2.watchedAt).toLocaleDateString(undefined,{month:'short', day:'numeric'})
      : '';

    return `<div class="mv-saids">
      <span class="mv-saids-head">Letterboxd${
        said.length > 1 ? ` <i>${said.length}</i>` : ''}</span>
      ${said.map(r => `
        <blockquote class="mv-said${r.mine ? ' is-mine' : ''}${
            r.rated >= Letterboxd.LOVE ? ' is-five' : ''}${
            r.rated != null && r.rated <= Letterboxd.HATE ? ' is-poop' : ''}">
          <span class="mv-said-head">${esc(r.who || 'you')}${
            r.rated != null ? ` <em>${stars(r.rated)}</em>` : ''}${
            when(r) ? ` <i>${esc(when(r))}</i>` : ''}</span>
          ${r.review ? `<span class="mv-said-text">${esc(r.review)}</span>` : ''}
        </blockquote>`).join('')}
    </div>`;
  }

  function open(id){
    const f = films.find(x => String(x.id) === String(id));
    if(!f) return;
    const d0 = f.date ? new Date(f.date+'T12:00:00') : null;

    /* The bare number on a poster is meaningless — 7.4 out of what, from
       whom. Here it gets its name and its scale, alongside whatever the
       other two sources know. */
    const rateRow = `
      <div class="mv-rates">
        <span class="mv-rate"><i>TMDB</i><b>${f.score ? `${f.score.toFixed(1)}<em>/10</em>` : '—'}</b></span>
        <span class="mv-rate" data-rate="rt"><i>Rotten Tomatoes</i><b>—</b></span>
        <span class="mv-rate" data-rate="lb"><i>Letterboxd</i><b>—</b></span>
      </div>`;

    mBody.innerHTML = `
      <div class="mv-detail">
        ${f.poster ? `<img src="${IMG}${esc(f.poster)}" alt="" class="mv-detail-art">` : ''}
        <div>
          <h2>${esc(f.title)}</h2>
          <p class="mv-line">${d0 ? d0.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}) : 'Release date unknown'}${
            f.runtime ? ` · ${Math.floor(f.runtime/60)}h ${f.runtime%60}m` : ''}${
            f.genres.length ? ` · ${esc(f.genres.join(', '))}` : ''}</p>
          ${rateRow}
          ${f.director ? `<p class="mv-line"><i>Director</i> ${esc(f.director)}</p>` : ''}
          ${f.cast.length ? `<p class="mv-line"><i>Cast</i> ${esc(f.cast.join(', '))}</p>` : ''}
          ${saidHtml(f)}
          <p class="mv-overview">${esc(f.overview) || 'No synopsis available yet.'}</p>
          <button class="ghost-btn sm mv-ad-btn" data-ad-film>Show as AD</button>
        </div>
      </div>`;
    modal.hidden = false;

    /* Straight to the full-screen version of this film. The popup closes
       first — an AD covers the whole screen and a modal left open under
       it would be waiting there on the way back. */
    const adBtn = mBody.querySelector('[data-ad-film]');
    if(adBtn) adBtn.onclick = () => {
      close();
      if(window.Kiosk) Kiosk.previewAd('movies', {
        title:f.title, year:(f.date || '').slice(0,4), tmdbId:f.id,
        poster:f.poster ? `https://image.tmdb.org/t/p/w500${f.poster}` : ''
      });
    };

    /* The two outside scores arrive later than the card does. */
    fillRates(f);
  }

  /* Rotten Tomatoes through OMDb, the Letterboxd average off the film's
     own page. Either can be missing — the label stays, the value becomes
     an em dash, so the row never changes shape. */
  async function fillRates(f){
    const set = (which, val) => {
      const el = mBody.querySelector(`[data-rate="${which}"] b`);
      if(el) el.innerHTML = val;
    };

    try{
      const imdb = f.imdb || (await detail(f.id))?.imdb;
      if(imdb){
        const r = await ratings(imdb);
        if(r && r.rt) set('rt', esc(r.rt));
      }
    }catch(e){ console.error('RT lookup failed:', e.message); }

    try{
      if(window.Letterboxd){
        /* ratingFor, not rating: it checks the page's year against the
           film's, so a remake cannot answer for the original. */
        const v = await Letterboxd.ratingFor(f.title, (f.date || '').slice(0,4));
        if(v != null) set('lb', `${v.toFixed(1)}<em>/5</em>`);
      }
    }catch(e){ console.error('Letterboxd rating lookup failed:', e.message); }
  }

  const close = () => { modal.hidden = true; };

  return {
    load, close, open, openTmdb, detail, ratings, find,
    /* [{id, title, date}] for the calendar — every release in range, not
       just the enriched ones, so a pill appears for the full window. */
    get releases(){ return listed.map(f => ({id:f.id, title:f.title, date:f.date})); },
    /* The whole forward window, list payload, for the Movies tab grids. */
    get upcoming(){ return listed; },
    /* In cinemas now, most popular first. */
    get playing(){ return playing; },
    genreNames,
    /* Full record for the poster carousel, which wants art and credits.
       Falls back to the list payload for films past the detail cap — the
       carousel's credit lines are all optional, the poster is not. */
    byId(id){
      return films.find(f => String(f.id) === String(id))
          || listed.find(f => String(f.id) === String(id))
          || null;
    }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Movies = Movies;
