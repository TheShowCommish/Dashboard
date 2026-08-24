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
  let films = [];

  const key = () => Store.get('keys.tmdb','');

  /* TMDB answers 200 with an error envelope for a bad key, so the HTTP
     status alone is not enough to trust the payload. */
  function guard(d){
    if(d && d.success === false) throw new Error(d.status_message || 'TMDB rejected the request');
    return d;
  }

  async function load(){
    if(!key()) return;                      // no key: the calendar simply carries no films

    try{
      const d = guard(await getJSON(
        `https://api.themoviedb.org/3/movie/upcoming?language=en-US&page=1&region=US&api_key=${key()}`));

      const soon = (d.results||[])
        .filter(m => m.release_date && new Date(m.release_date+'T12:00:00') >= new Date(Date.now()-864e5))
        .sort((a,b) => a.release_date.localeCompare(b.release_date))
        .slice(0,8);

      if(!soon.length){ films = []; return; }

      /* One detail call per film, in parallel. A film whose details fail
         still renders from the list payload it already has. */
      films = await Promise.all(soon.map(async m => {
        try{
          const full = guard(await getJSON(
            `https://api.themoviedb.org/3/movie/${m.id}?language=en-US` +
            `&append_to_response=credits&api_key=${key()}`));
          return {
            id: m.id,
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
    }catch(e){
      console.error('Movies failed to load:', e);
      Store.toast(`Movies failed to load (${e.message}). Check the TMDB key.`);
    }
  }

  function open(id){
    const f = films.find(x => String(x.id) === String(id));
    if(!f) return;
    const d0 = new Date(f.date+'T12:00:00');

    mBody.innerHTML = `
      <div class="mv-detail">
        ${f.poster ? `<img src="${IMG}${esc(f.poster)}" alt="" class="mv-detail-art">` : ''}
        <div>
          <h2>${esc(f.title)}</h2>
          <p class="mv-line">${d0.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}${
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
    load, close, open,
    /* [{id, title, date}] for the calendar. */
    get releases(){ return films.map(f => ({id:f.id, title:f.title, date:f.date})); },
    /* Full record for the poster carousel, which wants art and credits. */
    byId(id){ return films.find(f => String(f.id) === String(id)) || null; }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Movies = Movies;
