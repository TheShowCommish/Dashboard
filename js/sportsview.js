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

    const now = Date.now();
    const upcoming = games.filter(g => new Date(g.kickoff).getTime() > now - 4*36e5).slice(0,5);
    const recent   = games.filter(g => g.state === 'post').slice(-3).reverse();

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

      <h3 class="pf-h3">Upcoming</h3>
      <div class="tm-games" id="tmGames"></div>

      ${recent.length ? `<h3 class="pf-h3">Recent</h3>
        <div class="tm-recent">${recent.map(g => `
          <div class="row">
            <span class="row-main">
              <span class="row-title">${g.home ? 'vs' : '@'} ${esc(g.opponent)}</span>
              <span class="row-sub">${new Date(g.kickoff).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
            </span>
            <span class="row-side"><span class="chip ${g.result === 'win' ? 'ok' : 'hot'}">${
              g.result === 'win' ? 'W' : 'L'} ${esc(g.score)}</span></span>
          </div>`).join('')}</div>` : ''}

      <h3 class="pf-h3">Latest news</h3>
      <div class="tm-news">${news.length ? news.map(n => `
        <a class="nw" href="${esc(n.link)}" target="_blank" rel="noopener">
          ${n.image ? `<img class="nw-img" src="${esc(n.image)}" alt="" loading="lazy">` : ''}
          <span class="nw-body">
            <span class="nw-head">${esc(n.headline)}</span>
            <span class="nw-desc">${esc(n.description)}</span>
            <span class="nw-date">${n.published ? new Date(n.published).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : ''}</span>
          </span>
        </a>`).join('') : '<p class="empty">No recent stories.</p>'}</div>`;

    const holder = body.querySelector('#tmGames');
    if(upcoming.length) upcoming.forEach(g => holder.appendChild(GameCard.shell(g)));
    else holder.innerHTML = '<p class="empty">No games scheduled.</p>';

    const sb = body.querySelector('[data-stand]');
    if(sb) sb.onclick = () => StandingsView.open(t.league);
  }

  return { render, select(k){ active = k; render(); } };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.SportsView = SportsView;
