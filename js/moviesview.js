/* ============================================================
   moviesview.js — the Movies tab.

   Three strips, in the order they earn their space:
     1. Must watch — the Letterboxd watchlist, as a scrolling carousel.
     2. Recently watched — the Letterboxd diary feed, compact.
     3. Coming out — TMDB upcoming releases, the same data the calendar
        pills already use, here with room for posters.
   ============================================================ */

const MoviesView = (() => {
  const body  = document.getElementById('moviesBody');
  const count = document.getElementById('mvCount');

  /* A carousel is only useful with arrows when it actually overflows, and
     that depends on the rail width, so the check happens after paint. */
  function wireRail(section){
    const rail = section.querySelector('.car-rail');
    const nav  = section.querySelector('.car-nav');
    if(!rail) return;

    if(nav){
      const overflows = rail.scrollWidth > rail.clientWidth + 4;
      nav.hidden = !overflows;
      nav.querySelectorAll('[data-car]').forEach(b =>
        b.onclick = () => rail.scrollBy({left: +b.dataset.car * rail.clientWidth * 0.8,
                                         behavior:'smooth'}));
    }

    /* A horizontal rail inside a page that must not scroll vertically: turn
       a plain wheel into sideways movement so it is usable without a
       trackpad gesture. */
    rail.addEventListener('wheel', e => {
      if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      rail.scrollLeft += e.deltaY;
    }, {passive:false});
  }

  function posterHtml(f, badge){
    const art = f.poster
      ? `<img class="mv-poster" src="${esc(f.poster)}" alt="" loading="lazy">`
      : '<div class="mv-poster mv-noart">🎬</div>';
    return `<button class="mv-card car-item" data-film="${esc(f.tmdbId || '')}"
                    data-url="${esc(f.url || '')}" title="${esc(f.title)}">
      ${art}
      ${badge ? `<span class="mv-chip${badge.warn ? ' warn' : ''}">${esc(badge.text)}</span>` : ''}
      <span class="mv-info">
        <span class="mv-title">${esc(f.title)}</span>
        <span class="mv-line">${esc(String(f.year || ''))}${
          f.score ? ` · <i>${f.score.toFixed(1)}</i>` : ''}</span>
      </span>
    </button>`;
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

    return `<section class="mv-strip">
      <div class="car-head">
        <h3 class="pf-h3">Must watch <span class="pf-h3-n">${films.length}</span></h3>
        <span class="car-nav" hidden>
          <button class="ghost-btn sm" data-car="-1" aria-label="Scroll left">‹</button>
          <button class="ghost-btn sm" data-car="1" aria-label="Scroll right">›</button>
        </span>
      </div>
      <div class="car-rail mv-rail">${films.map(f => posterHtml(f, null)).join('')}</div>
    </section>`;
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
    return `<section class="mv-strip">
      <div class="car-head">
        <h3 class="pf-h3">Coming out <span class="pf-h3-n">${films.length}</span></h3>
        <span class="car-nav" hidden>
          <button class="ghost-btn sm" data-car="-1" aria-label="Scroll left">‹</button>
          <button class="ghost-btn sm" data-car="1" aria-label="Scroll right">›</button>
        </span>
      </div>
      <div class="car-rail mv-rail">${films.map(f => {
        const d = new Date(f.date + 'T12:00:00');
        const days = Math.round((d - today) / 864e5);
        const badge = {
          text: days <= 0 ? 'out now' : days < 7 ? `${days}d` :
                d.toLocaleDateString(undefined,{month:'short',day:'numeric'}),
          warn: days >= 0 && days < 7
        };
        return posterHtml({
          title: f.title, year: (f.date || '').slice(0,4),
          poster: f.poster ? `https://image.tmdb.org/t/p/w342${f.poster}` : '',
          tmdbId: f.id, score: f.score
        }, badge);
      }).join('')}</div>
    </section>`;
  }

  function render(){
    if(!body) return;

    if(count){
      const n = Letterboxd.count;
      count.textContent = n ? `${n} to watch` : '—';
    }

    body.innerHTML = watchlistHtml() + upcomingHtml() + diaryHtml();

    body.querySelectorAll('.mv-strip').forEach(wireRail);

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
