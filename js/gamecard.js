/* ============================================================
   gamecard.js — one game preview, used by both the calendar focus
   strip and the Sports tab.

   Renders synchronously from the schedule payload so something appears
   immediately, then fills in live score, leaders and broadcast from the
   summary endpoint when it arrives. A game in progress bypasses the
   cache; a finished or future one does not.
   ============================================================ */

const GameCard = (() => {

  const isLive = g => g.state === 'in';

  function shell(g){
    const el = document.createElement('div');
    el.className = `gc${isLive(g) ? ' is-live' : ''}`;
    el.dataset.event = g.eventId;
    el.innerHTML = render(g, null);
    wire(el, g, null);

    /* Enrich in the background; a failure leaves the schedule view intact. */
    Sports.summary(g.league, g.eventId, isLive(g))
      .then(sum => { el.innerHTML = render(g, sum); wire(el, g, sum); })
      .catch(e => console.error('Game summary failed for', g.eventId, e.message));

    return el;
  }

  function sideHtml(s, g){
    const logo = s.logo || Sports.logoFor({league:g.league, id:s.id});
    return `<div class="gc-side">
      <img class="gc-logo" src="${esc(logo)}" alt="" loading="lazy">
      <span class="gc-name">${esc(s.abbr || s.name)}</span>
      <span class="gc-rec">${esc(s.record || '—')}</span>
    </div>`;
  }

  function render(g, sum){
    const state = sum?.state || g.state;
    const live  = state === 'in';
    const done  = state === 'post';

    /* The summary carries records and live scores; the schedule may not. */
    const away = sum?.sides?.find(s => !s.home) || (g.me.home ? g.opp : g.me);
    const home = sum?.sides?.find(s =>  s.home) || (g.me.home ? g.me : g.opp);

    const kick = new Date(g.kickoff);
    const when = live ? (sum?.status || g.status || 'In progress')
               : done ? (sum?.status || 'Final')
               : kick.toLocaleString(undefined,{weekday:'short', month:'short', day:'numeric',
                                                hour:'numeric', minute:'2-digit'});

    const scoreBlock = (live || done)
      ? `<div class="gc-score">
           <b class="${done && +away.score > +home.score ? 'win' : ''}">${esc(String(away.score ?? ''))}</b>
           <i>–</i>
           <b class="${done && +home.score > +away.score ? 'win' : ''}">${esc(String(home.score ?? ''))}</b>
         </div>`
      : `<div class="gc-at">@</div>`;

    const tv = (sum?.broadcast?.length ? sum.broadcast : g.broadcast) || [];

    const leaders = (sum?.leaders || []).slice(0,6);
    const leaderHtml = leaders.length ? `
      <div class="gc-leaders">
        <span class="gc-lab">${live || done ? 'Leaders' : 'Watch for'}</span>
        <div class="gc-lgrid">
          ${leaders.map(l => `
            <button class="gc-player" data-athlete="${esc(l.athleteId || '')}"
                    data-name="${esc(l.athlete)}" data-pos="${esc(l.position)}"
                    data-shot="${esc(l.headshot)}"
                    title="Game log for ${esc(l.athlete)}">
              <span class="gc-pcat">${esc(l.team)} · ${esc(l.category)}</span>
              <span class="gc-pname">${esc(l.athlete)}${l.position ? ` <i>${esc(l.position)}</i>` : ''}</span>
              <span class="gc-pval">${esc(l.value)}</span>
            </button>`).join('')}
        </div>
      </div>` : '';

    return `
      <div class="gc-top">
        <span class="gc-league">${esc(Sports.leagueName(g.league))}</span>
        ${live ? '<span class="gc-livedot">LIVE</span>' : ''}
        <span class="gc-when">${esc(when)}</span>
      </div>
      <div class="gc-matchup">
        ${sideHtml(away, g)}
        ${scoreBlock}
        ${sideHtml(home, g)}
      </div>
      <div class="gc-meta">
        ${tv.length ? `<span class="gc-tv">📺 ${esc(tv.join(', '))}</span>` : ''}
        ${(sum?.venue || g.venue) ? `<span>📍 ${esc(sum?.venue || g.venue)}</span>` : ''}
        ${sum?.odds ? `<span>${esc(sum.odds)}</span>` : ''}
        <button class="gc-stand" data-league="${esc(g.league)}">Standings</button>
      </div>
      ${leaderHtml}`;
  }

  function wire(el, g, sum){
    el.querySelectorAll('[data-athlete]').forEach(b => {
      if(!b.dataset.athlete) return;
      b.onclick = e => {
        e.stopPropagation();
        PlayerLog.open(g.league, b.dataset.athlete, {
          name: b.dataset.name, position: b.dataset.pos, headshot: b.dataset.shot
        });
      };
    });
    const st = el.querySelector('[data-league]');
    if(st) st.onclick = e => { e.stopPropagation(); StandingsView.open(g.league); };
  }

  return { shell };
})();


/* ---------------- standings modal ---------------- */
const StandingsView = (() => {
  const modal = document.getElementById('standModal');
  const body  = document.getElementById('standModalBody');

  async function open(league){
    modal.hidden = false;
    body.innerHTML = '<p class="empty">Loading standings…</p>';
    try{
      const groups = await Sports.standings(league);
      if(!groups.length) return body.innerHTML = '<p class="empty">No standings published for this league.</p>';

      body.innerHTML = `<h2>${esc(Sports.leagueName(league))} standings</h2>
        ${groups.map(g => `
          <h3 class="day-sub">${esc(g.name)}</h3>
          <div class="tbl-wrap"><table class="std-table">
            <thead><tr><th>Team</th><th>W-L</th><th>Conf</th><th>Home</th><th>Away</th><th>Streak</th></tr></thead>
            <tbody>${g.rows.map(r => `<tr>
              <td><img class="std-logo" src="${esc(r.logo || '')}" alt="" loading="lazy">${esc(r.team)}</td>
              <td>${esc(r.stats.overall || `${r.stats.wins || 0}-${r.stats.losses || 0}`)}</td>
              <td>${esc(r.stats['vs. Conf.'] || r.stats['vs Division'] || '—')}</td>
              <td>${esc(r.stats.Home || '—')}</td>
              <td>${esc(r.stats.Away || '—')}</td>
              <td>${esc(r.stats.streak || '—')}</td>
            </tr>`).join('')}</tbody>
          </table></div>`).join('')}`;
    }catch(e){
      body.innerHTML = `<p class="empty">Standings unavailable (${esc(e.message)}).</p>`;
    }
  }

  const close = () => { modal.hidden = true; };
  return { open, close };
})();


/* ---------------- player game log ---------------- */
const PlayerLog = (() => {
  const modal = document.getElementById('playerModal');
  const body  = document.getElementById('playerModalBody');

  /* who: {name, position, headshot} — the gamelog endpoint returns stats
     only, so the identity comes from whatever opened this. */
  async function open(league, athleteId, who = {}){
    modal.hidden = false;
    const head = `
      <div class="pl-head">
        ${who.headshot ? `<img class="pl-shot" src="${esc(who.headshot)}" alt="">` : ''}
        <div><h2>${esc(who.name || 'Game log')}</h2>
          <p class="row-sub">${esc(who.position || '')}</p></div>
      </div>`;
    body.innerHTML = head + '<p class="empty">Loading game log…</p>';
    try{
      const g = await Sports.gamelog(league, athleteId);
      if(!g.rows.length) return body.innerHTML = head +
        '<p class="empty">No games logged this season yet.</p>';

      const cols = g.displayNames.length ? g.displayNames : g.names;
      body.innerHTML = `
        ${head}
        <div class="tbl-wrap"><table class="std-table">
          <thead><tr><th>Date</th><th>Opp</th><th>Result</th>
            ${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${g.rows.map(r => `<tr>
            <td>${esc(r.date ? new Date(r.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '—')}</td>
            <td>${esc(r.opponent || '—')}</td>
            <td>${esc(r.result || '—')}</td>
            ${cols.map((_,i) => `<td>${esc(r.stats[i] ?? '—')}</td>`).join('')}
          </tr>`).join('')}</tbody>
        </table></div>`;
    }catch(e){
      body.innerHTML = head + `<p class="empty">Game log unavailable (${esc(e.message)}).</p>`;
    }
  }

  const close = () => { modal.hidden = true; };
  return { open, close };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.GameCard = GameCard;
window.StandingsView = StandingsView;
window.PlayerLog = PlayerLog;
