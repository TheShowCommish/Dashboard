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

  /* How many pages of /movie/upcoming to walk. TMDB returns 20 a page and
     the endpoint's natural horizon is a few months, so this reaches the end
     of its range rather than stopping at an arbitrary date. */
  const PAGES = 5;

  /* Detail lookups are one request per film, so they are reserved for the
     films the calendar can actually show. The rest keep their list-payload
     fields, which is all the poster rails need. */
  const DETAIL = 24;

  async function load(){
    if(!key()) return;                      // no key: the calendar simply carries no films

    await loadGenres();

    try{
      const first = guard(await getJSON(
        `https://api.themoviedb.org/3/movie/upcoming?language=en-US&page=1&region=US&api_key=${key()}`));

      const pages = Math.min(PAGES, first.total_pages || 1);
      const rest = await Promise.all(
        Array.from({length: Math.max(0, pages - 1)}, (_, i) =>
          getJSON('https://api.themoviedb.org/3/movie/upcoming' +
            `?language=en-US&page=${i+2}&region=US&api_key=${key()}`)
            .then(guard)
            .catch(e => { console.error('Upcoming page', i+2, 'failed:', e.message); return null; })));

      const results = [first, ...rest.filter(Boolean)].flatMap(d => d.results || []);

      /* One row per film — paging can repeat a title as the window slides. */
      const byId = new Map();
      for(const m of results) if(m.id != null && !byId.has(m.id)) byId.set(m.id, m);

      const soon = [...byId.values()]
        .filter(m => m.release_date && new Date(m.release_date+'T12:00:00') >= new Date(Date.now()-864e5))
        .sort((a,b) => a.release_date.localeCompare(b.release_date));

      if(!soon.length){ films = []; return; }

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
      films = await Promise.all(soon.slice(0, DETAIL).map(async m => {
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

  function open(id){
    const f = films.find(x => String(x.id) === String(id));
    if(!f) return;
    const d0 = f.date ? new Date(f.date+'T12:00:00') : null;

    mBody.innerHTML = `
      <div class="mv-detail">
        ${f.poster ? `<img src="${IMG}${esc(f.poster)}" alt="" class="mv-detail-art">` : ''}
        <div>
          <h2>${esc(f.title)}</h2>
          <p class="mv-line">${d0 ? d0.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}) : 'Release date unknown'}${
            f.runtime ? ` · ${Math.floor(f.runtime/60)}h ${f.runtime%60}m` : ''}${
            f.genres.length ? ` · ${esc(f.genres.join(', '))}` : ''}</p>
          ${f.director ? `<p class="mv-line"><i>Director</i> ${esc(f.director)}</p>` : ''}
          ${f.cast.length ? `<p class="mv-line"><i>Cast</i> ${esc(f.cast.join(', '))}</p>` : ''}
          <p class="mv-overview">${esc(f.overview) || 'No synopsis available yet.'}</p>
        </div>
      </div>`;
    modal.hidden = false;
  }

  const close = () => { modal.hidden = true; };

  return {
    load, close, open, openTmdb, detail, ratings,
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
