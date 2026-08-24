/* ============================================================
   moviesview.js — the Movies tab.

   Four blocks, in the order they earn their space:
     1. Must watch — the Letterboxd watchlist.
     2. Popular right now — what is actually in cinemas this week,
        ranked by TMDB popularity.
     3. Coming out — TMDB upcoming releases, the same data the calendar
        pills already use, here with room for posters.
     4. Recently watched — the Letterboxd diary feed, compact.

   Posters wrap into a grid rather than a side-scrolling rail: the tab has
   to be readable on a wall screen nobody is going to swipe.
   ============================================================ */

const MoviesView = (() => {
  const body  = document.getElementById('moviesBody');
  const count = document.getElementById('mvCount');

  /* How many posters a block shows before it stops. Two to three rows at
     the widths this deck runs at — enough to browse, not so many that the
     block below is pushed off the screen entirely. */
  const CAP = 24;

  function posterHtml(f, badge){
    const art = f.poster
      ? `<img class="mv-poster" src="${esc(f.poster)}" alt="" loading="lazy">`
      : '<div class="mv-poster mv-noart">🎬</div>';
    const genres = (f.genres || []).join(' · ');
    return `<button class="mv-card" data-film="${esc(f.tmdbId || '')}"
                    data-url="${esc(f.url || '')}" title="${esc(f.title)}">
      ${art}
      ${badge ? `<span class="mv-chip${badge.warn ? ' warn' : ''}">${esc(badge.text)}</span>` : ''}
      <span class="mv-info">
        <span class="mv-title">${esc(f.title)}</span>
        <span class="mv-line">${esc(String(f.year || ''))}${
          f.score ? ` · <i>${f.score.toFixed(1)}</i>` : ''}</span>
        <span class="mv-genre">${esc(genres) || '—'}</span>
      </span>
    </button>`;
  }

  /* One block: a heading, a capped grid, and an honest note when the cap
     hid something. */
  function block(title, films, opts = {}){
    const shown = films.slice(0, opts.cap || CAP);
    const rest  = films.length - shown.length;
    return `<section class="mv-strip">
      <div class="car-head">
        <h3 class="pf-h3">${title}${
          films.length ? ` <span class="pf-h3-n">${films.length}</span>` : ''}</h3>
        ${opts.note ? `<span class="plot-key">${opts.note}</span>` : ''}
      </div>
      <div class="mv-grid">${shown.map(f => posterHtml(f, f._badge)).join('')}</div>
      ${rest > 0 ? `<p class="mv-more">+${rest} more not shown</p>` : ''}
    </section>`;
  }

  function watchlistHtml(){
    const films = Letterboxd.decorated();

    if(!films.length){
      if(!Letterboxd.hasProxy){
        return `<section class="mv-strip">
          <div class="car-head"><h3 class="pf-h3">Must watch</h3></div>
          <p class="empty">No watchlist yet. Letterboxd cannot be read directly from a
            static page, so either set the scrape proxy URL in Settings → Movies, or use
            <b>Import watchlist CSV</b> above (Letterboxd → Settings → Data → Export).</p>
        </section>`;
      }
      return `<section class="mv-strip">
        <div class="car-head"><h3 class="pf-h3">Must watch</h3></div>
        <p class="empty">Nothing came back from Letterboxd${
          Letterboxd.error ? ` — ${esc(Letterboxd.error)}` : ''}.</p>
      </section>`;
    }
    return block('Must watch', films);
  }

  function playingHtml(){
    const films = (window.Movies ? Movies.playing : []) || [];
    if(!films.length) return '';
    const today = new Date(); today.setHours(0,0,0,0);
    return block('Popular movies out now', films.map(f => ({
      title: f.title,
      year: (f.date || '').slice(0,4),
      poster: f.poster ? `https://image.tmdb.org/t/p/w342${f.poster}` : '',
      tmdbId: f.id, score: f.score, genres: f.genres,
      _badge: {text:'in cinemas', warn:false}
    })), {cap:12, note:'in cinemas this week, most popular first'});
  }

  function diaryHtml(){
    const seen = Letterboxd.diary.slice(0, 12);
    if(!seen.length) return '';
    return `<section class="mv-strip">
      <div class="car-head"><h3 class="pf-h3">Recently watched</h3>
        <span class="plot-key">from the Letterboxd diary feed</span></div>
      <div class="mv-seen">${seen.map(f => `
        <a class="mv-seen-row" href="${esc(f.link)}" target="_blank" rel="noopener">
          <span class="row-title">${esc(f.title)}${f.year ? ` <i>${f.year}</i>` : ''}</span>
          <span class="row-side">${f.rated != null
            ? `<span class="mv-stars">${'★'.repeat(Math.round(f.rated))}${
                 '☆'.repeat(Math.max(0, 5 - Math.round(f.rated)))}</span>`
            : ''}</span>
        </a>`).join('')}</div>
    </section>`;
  }

  function upcomingHtml(){
    const films = window.Movies ? Movies.upcoming : [];
    if(!films.length){
      return `<section class="mv-strip">
        <div class="car-head"><h3 class="pf-h3">Coming out</h3></div>
        <p class="empty">${Store.get('keys.tmdb','')
          ? 'No upcoming releases loaded yet.'
          : 'Add a TMDB key in Settings to see upcoming releases.'}</p>
      </section>`;
    }

    const today = new Date(); today.setHours(0,0,0,0);
    return block('Coming out', films.map(f => {
      const d = new Date(f.date + 'T12:00:00');
      const days = Math.round((d - today) / 864e5);
      return {
        title: f.title, year: (f.date || '').slice(0,4),
        poster: f.poster ? `https://image.tmdb.org/t/p/w342${f.poster}` : '',
        tmdbId: f.id, score: f.score, genres: f.genres,
        _badge: {
          text: days <= 0 ? 'out now' : days < 7 ? `${days}d`
              : d.toLocaleDateString(undefined,{month:'short',day:'numeric'}),
          warn: days >= 0 && days < 7
        }
      };
    }));
  }

  function render(){
    if(!body) return;

    if(count){
      const n = Letterboxd.count;
      count.textContent = n ? `${n} to watch` : '—';
    }

    body.innerHTML = watchlistHtml() + playingHtml() + upcomingHtml() + diaryHtml();

    /* A TMDB id opens the existing detail modal; a watchlist film with no
       match falls back to its Letterboxd page. */
    body.querySelectorAll('[data-film]').forEach(b => b.onclick = () => {
      const id = b.dataset.film;
      if(id && window.Movies && Movies.byId(id)) return Movies.open(id);
      if(id && window.Movies) return Movies.openTmdb(id);
      if(b.dataset.url) window.open(b.dataset.url, '_blank', 'noopener');
    });
  }

  return { render };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.MoviesView = MoviesView;
