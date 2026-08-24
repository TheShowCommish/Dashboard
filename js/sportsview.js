/* ============================================================
   sportsview.js — the Sports tab: one sub-tab per followed team,
   each showing record, standing, upcoming games and team news.
   ============================================================ */

const SportsView = (() => {
  const tabs = document.getElementById('teamTabs');
  const body = document.getElementById('sportsBody');

  let active = null;         // "league|id"

  const keyOf = t => `${t.league}|${t.id}`;

  function render(){
    if(!tabs || !body) return;
    const list = Sports.teams();

    if(!list.length){
      tabs.innerHTML = '';
      body.innerHTML = '<p class="empty">No teams followed. Use <b>Add team</b> to pick one.</p>';
      return;
    }

    if(!list.some(t => keyOf(t) === active)) active = keyOf(list[0]);

    tabs.innerHTML = list.map(t => `
      <button class="subtab${keyOf(t) === active ? ' is-on' : ''}" data-team="${esc(keyOf(t))}">
        <img src="${esc(Sports.logoFor(t))}" alt="" class="subtab-logo" loading="lazy">
        ${esc(t.abbr || t.name)}
      </button>`).join('');

    tabs.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
      active = b.dataset.team;
      render();
    });

    paint(list.find(t => keyOf(t) === active));
  }

  async function paint(t){
    if(!t) return;
    body.innerHTML = '<p class="empty">Loading…</p>';

    /* Each block is independent: news failing must not cost the schedule. */
    const [info, games, news] = await Promise.all([
      Sports.info(t).catch(e => ({error:e.message})),
      Sports.schedule(t).catch(() => []),
      Sports.news(t, 6).catch(() => [])
    ]);

    /* ESPN hands back the team's whole season, so show the whole season.
       Both lists scroll inside their own panel rather than being truncated
       to an arbitrary handful. */
    /* ESPN hands back the team's whole season, so show the whole season.
       Only the next few get a full preview card, because each card costs a
       summary request to enrich — a 12-game NFL season would fire twelve at
       once, a 162-game MLB season far worse. The rest list as compact rows
       that cost nothing and open the same stats popup on click. */
    const now = Date.now();
    const future = games.filter(g => new Date(g.kickoff).getTime() > now - 4*36e5);
    const CARDS = 3;
    const upcoming = future.slice(0, CARDS);
    const later    = future.slice(CARDS);
    const recent   = games.filter(g => g.state === 'post').reverse();

    body.innerHTML = `
      <div class="tm-hero"${info.color ? ` style="--tm:${esc(info.color)}"` : ''}>
        <img class="tm-logo" src="${esc(info.logo || Sports.logoFor(t))}" alt="" loading="lazy">
        <div class="tm-id">
          <h2>${esc(info.name || t.name)}</h2>
          <p>${esc(Sports.leagueName(t.league))}${info.error ? ' · record unavailable' : ''}</p>
        </div>
        <div class="tm-stats">
          <span class="tm-stat"><b>${esc(info.record || '—')}</b><i>Record</i></span>
          <span class="tm-stat"><b>${esc(info.standing || '—')}</b><i>Standing</i></span>
        </div>
        <button class="ghost-btn sm" data-stand="${esc(t.league)}">League standings</button>
      </div>

      <h3 class="pf-h3">Upcoming <span class="pf-h3-n">${future.length}</span></h3>
      <div class="tm-games" id="tmGames"></div>
      ${later.length ? `<div class="tm-later">
        <span class="gc-lab">Rest of the season</span>
        <div class="tm-recent">${later.map((g,i) => `
          <button class="row row-btn" data-later="${i}">
            <span class="row-main">
              <span class="row-title">${g.home ? 'vs' : '@'} ${esc(g.opponent)}</span>
              <span class="row-sub">${new Date(g.kickoff).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</span>
            </span>
            <span class="row-side"><span class="row-sub">${
              new Date(g.kickoff).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</span></span>
          </button>`).join('')}</div>
      </div>` : ''}

      ${recent.length ? `<h3 class="pf-h3">Recent <span class="pf-h3-n">${recent.length}</span>
          <span class="plot-key">click a game for its stats</span></h3>
        <div class="tm-recent">${recent.map((g,i) => `
          <button class="row row-btn" data-recent="${i}">
            <span class="row-main">
              <span class="row-title">${g.home ? 'vs' : '@'} ${esc(g.opponent)}</span>
              <span class="row-sub">${new Date(g.kickoff).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'})}</span>
            </span>
            <span class="row-side"><span class="chip ${g.result === 'win' ? 'ok' : 'hot'}">${
              g.result === 'win' ? 'W' : 'L'} ${esc(g.score)}</span></span>
          </button>`).join('')}</div>` : ''}

      <h3 class="pf-h3">Latest news</h3>
      ${news.length ? (() => {
        /* One row, crawling, like the tickers at the bottom of the deck:
           the news is the least urgent thing on this tab and it was taking
           three rows of it. Two copies of the row so the loop is seamless. */
        const row = news.map(n => `
          <a class="nw" href="${esc(n.link)}" target="_blank" rel="noopener">
            ${n.image ? `<img class="nw-img" src="${esc(n.image)}" alt="" loading="lazy">` : ''}
            <span class="nw-body">
              <span class="nw-head">${esc(n.headline)}</span>
              <span class="nw-date">${n.published ? new Date(n.published).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : ''}</span>
            </span>
          </a>`).join('');
        return `<div class="tm-news mv-marquee">
          <div class="mv-track" style="animation:crawl ${Math.max(30, news.length * 9)}s linear infinite">${row}${row}</div>
        </div>`;
      })() : '<p class="empty">No recent stories.</p>'}`;

    const holder = body.querySelector('#tmGames');
    if(upcoming.length) upcoming.forEach(g => holder.appendChild(GameCard.shell(g)));
    else holder.innerHTML = '<p class="empty">No games scheduled.</p>';

    const sb = body.querySelector('[data-stand]');
    if(sb) sb.onclick = () => StandingsView.open(t.league);

    body.querySelectorAll('[data-recent]').forEach(b =>
      b.onclick = () => GameStats.open(recent[+b.dataset.recent]));
    body.querySelectorAll('[data-later]').forEach(b =>
      b.onclick = () => GameStats.open(later[+b.dataset.later]));
  }

  return { render, select(k){ active = k; render(); } };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.SportsView = SportsView;
