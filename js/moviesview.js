/* ============================================================
   moviesview.js — the Movies tab.

   Four blocks, in the order they earn their space:
     1. Must watch — the Letterboxd watchlist.
     2. Popular right now — what is actually in cinemas this week,
        ranked by TMDB popularity.
     3. Coming out — TMDB upcoming releases, the same data the calendar
        pills already use, here with room for posters.
     4. Recently watched — the Letterboxd diary feed, compact.

   The three poster blocks are each ONE line that crawls, on the same
   mechanism as the market ticker: two copies of the row translated by
   half their width. Nothing to swipe, nothing to scroll, and it keeps
   moving on a screen nobody is touching.
   ============================================================ */

const MoviesView = (() => {
  const body  = document.getElementById('moviesBody');
  const count = document.getElementById('mvCount');

  /* A crawl is a fixed-height line, so the cap is about how long the loop
     takes rather than how much fits: 40 posters at 6 seconds each is a
     four-minute lap, which is about as slow as is still interesting. */
  const CAP = 40;

  function posterHtml(f, badge){
    const art = f.poster
      ? `<img class="mv-poster" src="${esc(f.poster)}" alt="" loading="lazy">`
      : '<div class="mv-poster mv-noart">🎬</div>';
    const genres = (f.genres || []).join(' · ');
    /* What the people I follow made of it, if any of them have seen it —
       the same gold frame and the same sticker the AD uses, so a poster
       means the same thing wherever it turns up. */
    const v = window.Letterboxd ? Letterboxd.verdict(f.title, f.year, f.slug) : null;
    return `<button class="mv-card${v?.love ? ' is-five' : ''}${v?.hate ? ' is-poop' : ''}"
                    data-film="${esc(f.tmdbId || '')}"
                    data-url="${esc(f.url || '')}" title="${esc(f.title)}${
                      v?.love ? ` — ${v.love.who || 'you'} gave it ${v.love.rated}` : ''}${
                      v?.hate ? ` — ${v.hate.who || 'you'} gave it ${v.hate.rated}` : ''}">
      ${art}
      ${v?.hate ? `<span class="mv-poop" title="${esc(v.hate.who || 'you')} gave it ${
        v.hate.rated}">💩</span>` : ''}
      ${badge ? `<span class="mv-chip${badge.warn ? ' warn' : ''}">${esc(badge.text)}</span>` : ''}
      <span class="mv-info">
        <span class="mv-title">${esc(f.title)}</span>
        <span class="mv-line">${esc(String(f.year || ''))}${
          f.score ? ` · <i>${f.score.toFixed(1)}</i>` : ''}</span>
        <span class="mv-genre">${esc(genres) || '&mdash;'}</span>
      </span>
    </button>`;
  }

  /* One block: a heading and a single crawling line of posters. */
  function block(title, films, opts = {}){
    const shown = films.slice(0, opts.cap || CAP);
    const row = shown.map(f => posterHtml(f, f._badge)).join('');
    const secs = Math.max(30, shown.length * 6);
    return `<section class="mv-strip">
      <div class="car-head">
        <h3 class="pf-h3">${title}${
          films.length ? ` <span class="pf-h3-n">${films.length}</span>` : ''}</h3>
        ${opts.note ? `<span class="plot-key">${opts.note}</span>` : ''}
      </div>
      <div class="mv-marquee">
        <div class="mv-track" style="${shown.length > 1
          ? `animation:crawl ${secs}s linear infinite` : 'animation:none'}">${row}${row}</div>
      </div>
    </section>`;
  }

  function watchlistHtml(){
    const films = Letterboxd.decorated();

    if(!films.length){
      if(!Letterboxd.hasProxy){
        return `<section class="mv-strip">
          <div class="car-head"><h3 class="pf-h3">Must watch</h3></div>
          <p class="empty">No watchlist yet. Letterboxd cannot be read directly from a
            static page, so either set the scrape proxy URL in Settings &rarr; Movies, or use
            <b>Import watchlist CSV</b> above (Letterboxd &rarr; Settings &rarr; Data &rarr; Export).</p>
        </section>`;
      }
      return `<section class="mv-strip">
        <div class="car-head"><h3 class="pf-h3">Must watch</h3></div>
        <p class="empty">Nothing came back from Letterboxd${
          Letterboxd.error ? ` &mdash; ${esc(Letterboxd.error)}` : ''}.</p>
      </section>`;
    }
    return block('Must watch', films);
  }

  function playingHtml(){
    const films = (window.Movies ? Movies.playing : []) || [];
    if(!films.length) return '';
    /* No badge: every film in this block is already out, and a row of
       identical "in cinemas" chips is just noise over the posters. */
    return block('Popular movies out now', films.map(f => ({
      title: f.title,
      year: (f.date || '').slice(0,4),
      slug: '',
      poster: f.poster ? `https://image.tmdb.org/t/p/w342${f.poster}` : '',
      tmdbId: f.id, score: f.score, genres: f.genres
    })), {cap:20, note:'in cinemas this week, most popular first'});
  }

  /* The diary as a tall narrow column down the left: poster, when it was
     watched, the stars, and what was said about it. It is the only part of
     this tab that is actually the user's own writing, so it gets read as a
     column rather than skimmed as a row. */
  function diaryHtml(){
    /* Mine and everyone I follow, in one column, newest first — the
       username is what tells them apart. */
    const feed = Letterboxd.feed || [];
    const seen = feed.slice(0, 40);
    if(!seen.length){
      return `<aside class="mv-diary">
        <h3 class="pf-h3">Recently watched</h3>
        <p class="empty">Nothing logged yet — this comes from the Letterboxd diary feed.</p>
      </aside>`;
    }

    const when = f => {
      const d = new Date(f.watchedAt);
      return Number.isNaN(+d) ? ''
        : d.toLocaleDateString(undefined,{month:'short', day:'numeric'});
    };

    return `<aside class="mv-diary">
      <h3 class="pf-h3">Recently watched <span class="pf-h3-n">${feed.length}</span>
        <span class="plot-key">yours and your network</span></h3>
      <div class="mv-diary-list">${seen.map(f => `
        <a class="mv-seen-row${f.mine ? ' is-mine' : ''}${
             f.rated >= Letterboxd.LOVE ? ' is-five' : ''}${
             f.rated != null && f.rated <= Letterboxd.HATE ? ' is-poop' : ''}"
           href="${esc(f.link)}" target="_blank" rel="noopener">
          ${f.poster
            ? `<img class="mv-seen-art" src="${esc(f.poster)}" alt="" loading="lazy">`
            : '<span class="mv-seen-art mv-noart">🎬</span>'}
          ${f.rated != null && f.rated <= Letterboxd.HATE
            ? `<span class="mv-poop" title="${esc(f.who || 'you')} gave it ${f.rated}">💩</span>`
            : ''}
          <span class="mv-seen-body">
            <span class="mv-seen-title">${esc(f.title)}${f.year ? ` <i>${f.year}</i>` : ''}</span>
            <span class="mv-seen-meta">
              <span class="mv-seen-who">${esc(f.who || 'you')}</span>
              <span class="mv-seen-when">${esc(when(f))}</span>
              ${f.rated != null
                ? `<span class="mv-stars">${stars(f.rated)}</span>`
                : ''}
            </span>
            ${f.review ? `<span class="mv-seen-review">${esc(f.review)}</span>` : ''}
          </span>
        </a>`).join('')}</div>
    </aside>`;
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

    /* Midday both sides: from midnight, a release five days out rounds to
       six and the chip reads a day late. */
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12);
    return block('Coming out', films.map(f => {
      const d = new Date(f.date + 'T12:00:00');
      const days = Math.round((d - today) / 864e5);
      return {
        title: f.title, year: (f.date || '').slice(0,4),
        poster: f.poster ? `https://image.tmdb.org/t/p/w342${f.poster}` : '',
        tmdbId: f.id, score: f.score, genres: f.genres,
        /* Only films still ahead get a chip, and it says how long. */
        _badge: days <= 0 ? null : {
          text: days < 7 ? `${days}d` : d.toLocaleDateString(undefined,{month:'short',day:'numeric'}),
          warn: days < 7
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

    /* Diary down the left, the crawling shelves in the remaining two
       thirds — they need the width, it needs the height. */
    body.innerHTML = `
      ${diaryHtml()}
      <div class="mv-shelves">
        ${watchlistHtml()}${playingHtml()}${upcomingHtml()}
      </div>`;

    /* A TMDB id opens the existing detail modal; a watchlist film with no
       match falls back to its Letterboxd page. */
    body.querySelectorAll('[data-film]').forEach(b => b.onclick = () => {
      const id = b.dataset.film;
      if(id && window.Movies && Movies.byId(id)) return Movies.open(id);
      if(id && window.Movies) return Movies.openTmdb(id);
      if(b.dataset.url) window.open(b.dataset.url, '_blank', 'noopener');
    });
  }

  const STAR = '★';

  /* Letterboxd rates in halves, so a rounded whole star misreports what
     someone actually gave a film: 4.5 is not five. Only the stars given
     are drawn — the hollow remainder was padding, and at this size it
     read as part of the score. */
  function stars(n){
    const full = Math.floor(n), half = n - full >= .5;
    return STAR.repeat(full) + (half ? '½' : '');
  }

  return { render };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.MoviesView = MoviesView;
