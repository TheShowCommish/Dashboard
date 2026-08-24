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
    el.className = `gc gc-open${isLive(g) ? ' is-live' : ''}`;
    el.dataset.event = g.eventId;
    el.tabIndex = 0;
    el.title = 'Open game stats';
    el.innerHTML = render(g, null);
    wire(el, g, null);

    /* The whole card is the way into the game modal. Bound once on the
       element rather than on its contents, so it survives the innerHTML
       swap when the summary lands; the inner controls stop propagation. */
    el.addEventListener('click', () => GameStats.open(g));
    el.addEventListener('keydown', e => {
      /* Only the card itself — Enter on a player button inside it belongs
         to that button, and its own handler has already run. */
      if(e.target !== el) return;
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); GameStats.open(g); }
    });

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
      <span class="gc-rec">${esc(s.record || '&mdash;')}</span>
    </div>`;
  }

  /* Baseball is the one sport whose matchup is really a pitching matchup,
     and ESPN publishes the probables days ahead of first pitch. Every other
     league leaves this empty and the row disappears. */
  function probablesHtml(away, home){
    if(!away?.probable && !home?.probable) return '';
    const one = s => {
      const p = s?.probable;
      if(!p) return `<span class="gc-pitch is-tbd">Starter TBD</span>`;
      return `<button class="gc-pitch" data-athlete="${esc(p.id || '')}"
                data-name="${esc(p.name)}" data-pos="${esc(p.position)}"
                data-shot="${esc(p.headshot)}"
                title="Game log for ${esc(p.name)}">
        ${p.headshot ? `<img class="gc-pitch-shot" src="${esc(p.headshot)}" alt="" loading="lazy">` : ''}
        <span class="gc-pitch-txt">
          <span class="gc-pitch-name">${esc(p.name)}${p.throws ? ` <i>${esc(p.throws)}HP</i>` : ''}</span>
          <span class="gc-pitch-line">${esc(p.line || p.label)}</span>
        </span>
      </button>`;
    };
    return `<div class="gc-probables">
      <span class="gc-lab">Probable starters</span>
      <div class="gc-pitches">${one(away)}${one(home)}</div>
    </div>`;
  }

  /* Deliberately thin: the matchup, when it is, both records, and where to
     watch. Everything else — leaders, team totals, the line score — is one
     click away in the game modal rather than crowding three of these onto
     the top of the tab. */
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
           <i>&ndash;</i>
           <b class="${done && +home.score > +away.score ? 'win' : ''}">${esc(String(home.score ?? ''))}</b>
         </div>`
      : `<div class="gc-at">@</div>`;

    const tv = (sum?.broadcast?.length ? sum.broadcast : g.broadcast) || [];

    return `
      <div class="gc-top">
        <span class="gc-league">${esc(Sports.leagueName(g.league))}</span>
        ${live ? '<span class="gc-livedot">LIVE</span>' : ''}
        <span class="gc-when">${esc(when)}</span>
      </div>
      <div class="gc-matchup">
        ${sideHtml(away, g)}
        <div class="gc-mid">${scoreBlock}</div>
        ${sideHtml(home, g)}
      </div>
      ${done ? '' : probablesHtml(away, home)}
      <div class="gc-meta">
        ${tv.length ? `<span class="gc-tv">📺 ${esc(tv.join(', '))}</span>` : ''}
        ${(sum?.venue || g.venue) ? `<span>📍 ${esc(sum?.venue || g.venue)}</span>` : ''}
        ${sum?.odds ? `<span>${esc(sum.odds)}</span>` : ''}
        <button class="gc-stand" data-league="${esc(g.league)}">Standings</button>
      </div>`;
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

/* ---------------- one game's stats ----------------
   Opened by clicking a finished game in the Sports tab. Shows the final
   line, the per-period strip, both teams' totals side by side, and the
   leaders — each still a button through to that player's game log. */
const GameStats = (() => {
  const modal = document.getElementById('gameModal');
  const body  = document.getElementById('gameModalBody');

  function headHtml(g){
    const kick = new Date(g.kickoff);
    return `<div class="gs-head">
      <h2>${esc(g.abbr || g.teamName)} ${g.home ? 'vs' : '@'} ${esc(g.opponent)}</h2>
      <p class="row-sub">${esc(Sports.leagueName(g.league))} · ${
        kick.toLocaleString(undefined,{weekday:'short', month:'short', day:'numeric',
                                       hour:'numeric', minute:'2-digit'})}${
        g.venue ? ` · ${esc(g.venue)}` : ''}</p>
    </div>`;
  }

  /* Team totals are two flat lists of label/value; pair them up by label so
     the table reads across instead of down. A stat only one team reports
     still gets a row, with an em dash on the other side. */
  function statTable(teamStats, sides){
    if(teamStats.length < 2) return '';
    const labels = [];
    for(const t of teamStats)
      for(const s of t.stats)
        if(!labels.includes(s.label)) labels.push(s.label);
    if(!labels.length) return '';

    const valueFor = (t, label) => t.stats.find(s => s.label === label)?.value ?? '—';
    const nameFor = t => {
      const side = sides.find(s => String(s.id) === String(t.id));
      return side?.abbr || t.abbr || '—';
    };

    return `<h3 class="pf-h3">Team totals</h3>
      <div class="tbl-wrap"><table class="std-table">
        <thead><tr><th>Stat</th>${teamStats.map(t => `<th>${esc(nameFor(t))}</th>`).join('')}</tr></thead>
        <tbody>${labels.map(l => `<tr>
          <td>${esc(l)}</td>
          ${teamStats.map(t => `<td>${esc(String(valueFor(t, l)))}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function periodTable(sides){
    const withPeriods = sides.filter(s => s.periods?.length);
    if(withPeriods.length < 2) return '';
    const n = Math.max(...withPeriods.map(s => s.periods.length));
    return `<div class="tbl-wrap"><table class="std-table gs-line">
      <thead><tr><th>Team</th>
        ${Array.from({length:n}, (_,i) => `<th>${i+1}</th>`).join('')}
        <th>T</th></tr></thead>
      <tbody>${withPeriods.map(s => `<tr>
        <td>${esc(s.abbr || s.name)}</td>
        ${Array.from({length:n}, (_,i) => `<td>${esc(String(s.periods[i] ?? '—'))}</td>`).join('')}
        <td><b>${esc(String(s.score ?? ''))}</b></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function leaderHtml(leaders){
    if(!leaders.length) return '';
    return `<h3 class="pf-h3">Leaders</h3>
      <div class="gs-leaders">${leaders.map(l => `
        <button class="gc-player" data-athlete="${esc(l.athleteId || '')}"
                data-name="${esc(l.athlete)}" data-pos="${esc(l.position)}"
                data-shot="${esc(l.headshot)}"
                title="Game log for ${esc(l.athlete)}">
          <span class="gc-pcat">${esc(l.team)} · ${esc(l.category)}</span>
          <span class="gc-pname">${esc(l.athlete)}${l.position ? ` <i>${esc(l.position)}</i>` : ''}</span>
          <span class="gc-pval">${esc(l.value)}</span>
        </button>`).join('')}</div>`;
  }

  async function open(g){
    modal.hidden = false;
    body.innerHTML = headHtml(g) + '<p class="empty">Loading game stats…</p>';

    let sum;
    try{
      sum = await Sports.summary(g.league, g.eventId, g.state === 'in');
    }catch(e){
      body.innerHTML = headHtml(g) +
        `<p class="empty">Stats unavailable (${esc(e.message)}).</p>`;
      return;
    }

    const sides = sum.sides?.length ? sum.sides : [];
    const away = sides.find(s => !s.home);
    const home = sides.find(s => s.home);

    const scoreLine = (away && home) ? `
      <div class="gs-score">
        <span class="gs-team"><img src="${esc(away.logo)}" alt="" class="gc-logo">
          <b>${esc(away.abbr || away.name)}</b></span>
        <span class="gs-nums">${esc(String(away.score ?? ''))} – ${esc(String(home.score ?? ''))}</span>
        <span class="gs-team"><img src="${esc(home.logo)}" alt="" class="gc-logo">
          <b>${esc(home.abbr || home.name)}</b></span>
      </div>
      <p class="row-sub gs-status">${esc(sum.status || 'Final')}${
        sum.odds ? ` · ${esc(sum.odds)}` : ''}</p>` : '';

    /* Pre-game baseball has no box score yet, but it does have the two
       probable starters — which is the whole reason to open the game. */
    const probables = (sum.state !== 'post' && (away?.probable || home?.probable))
      ? `<h3 class="pf-h3">Probable starters</h3>
         <div class="gs-pitches">${[away, home].map(s => {
            const p = s?.probable;
            if(!p) return `<span class="gc-pitch is-tbd">${esc(s?.abbr || '')} starter TBD</span>`;
            return `<button class="gc-pitch" data-athlete="${esc(p.id || '')}"
                      data-name="${esc(p.name)}" data-pos="${esc(p.position)}"
                      data-shot="${esc(p.headshot)}">
              ${p.headshot ? `<img class="gc-pitch-shot" src="${esc(p.headshot)}" alt="">` : ''}
              <span class="gc-pitch-txt">
                <span class="gc-pitch-name">${esc(s.abbr || '')} · ${esc(p.name)}${
                  p.throws ? ` <i>${esc(p.throws)}HP</i>` : ''}</span>
                <span class="gc-pitch-line">${esc(p.line || p.label)}</span>
              </span></button>`;
          }).join('')}</div>`
      : '';

    const detail = scoreLine + probables + periodTable(sides) +
      statTable(sum.teamStats || [], sides) + leaderHtml(sum.leaders || []);

    body.innerHTML = headHtml(g) +
      (detail || '<p class="empty">No stats published for this game.</p>');

    /* Same drill-through as the preview cards. */
    body.querySelectorAll('[data-athlete]').forEach(b => {
      if(!b.dataset.athlete) return;
      b.onclick = () => PlayerLog.open(g.league, b.dataset.athlete, {
        name: b.dataset.name, position: b.dataset.pos, headshot: b.dataset.shot
      });
    });
  }

  const close = () => { modal.hidden = true; };
  return { open, close };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.GameCard = GameCard;
window.StandingsView = StandingsView;
window.PlayerLog = PlayerLog;
window.GameStats = GameStats;
