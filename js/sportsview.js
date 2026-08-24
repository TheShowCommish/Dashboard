/* ============================================================
   sportsview.js — the Sports tab, one sub-tab per followed team.

   Three panels, and the whole thing fits a screen without scrolling:

     top left    the next game, at size — both teams, the date and time,
                 the line drawn as a bar in the two teams' own colours,
                 the probable starters for baseball or the team numbers
                 for football, and how each side has done in its last
                 three.
     top right   where the team stands: its conference table, or for
                 college the AP poll.
     bottom      the next five games as mini previews — who, when, where
                 and the line. No carousel, no scroll: five is the whole
                 point of the row.
   ============================================================ */

const SportsView = (() => {
  const tabs = document.getElementById('teamTabs');
  const body = document.getElementById('sportsBody');

  let active = null;         // "league|id"
  let token  = 0;            // guards against a slow paint landing late

  const keyOf = t => `${t.league}|${t.id}`;
  const isCollege = lg => lg.includes('college');
  const isBaseball = lg => lg === 'mlb';
  const isFootball = lg => lg === 'nfl' || lg === 'college-football';

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

  /* ---- the shell, painted before any of the slow parts land ---- */
  async function paint(t){
    if(!t) return;
    const mine = ++token;

    body.innerHTML = `
      <div class="sp-grid">
        <section class="sp-card" id="spNext"><p class="empty">Loading the next game…</p></section>
        <section class="sp-panel" id="spTable"><p class="empty">Loading standings…</p></section>
        <section class="sp-minis" id="spMinis"></section>
      </div>`;

    /* Every block is independent: standings failing must not cost the
       game, and the game failing must not cost the row of minis. */
    const [info, games] = await Promise.all([
      Sports.info(t).catch(e => ({error:e.message})),
      Sports.schedule(t).catch(() => [])
    ]);
    if(mine !== token) return;

    const now = Date.now();
    const future = games.filter(g => new Date(g.kickoff).getTime() > now - 4*36e5);
    const past   = games.filter(g => g.state === 'post').reverse();

    nextGame(t, info, future[0] || past[0], past, mine);
    table(t, info, mine);
    minis(future.slice(0, 5), mine);
  }

  /* ---- top left: the next game ---- */
  async function nextGame(t, info, g, past, mine){
    const host = document.getElementById('spNext');
    if(!host) return;

    if(!g){
      host.innerHTML = `<p class="empty">No games on the schedule for ${esc(info.name || t.name)}.</p>`;
      return;
    }

    host.innerHTML = shellHtml(t, info, g, null, past);
    wire(host, g);

    let sum = null;
    try{ sum = await Sports.summary(g.league, g.eventId, g.state === 'in'); }
    catch(e){ console.error('Next game summary failed:', e.message); }
    if(mine !== token) return;

    /* The opponent's form needs their schedule, which is one more request
       and only worth making once the card is already up. */
    let oppPast = [];
    try{
      const oppId = g.opp?.id;
      if(oppId){
        const evs = await Sports.schedule({league:g.league, id:oppId, name:g.opponent, abbr:g.opp?.abbr});
        oppPast = evs.filter(x => x.state === 'post').reverse();
      }
    }catch(e){ console.error('Opponent form failed:', e.message); }
    if(mine !== token) return;

    host.innerHTML = shellHtml(t, info, g, sum, past, oppPast);
    wire(host, g);
  }

  /* The card itself opens the game popup; the pitcher buttons inside it
     open that player's log and stop there. */
  function wire(host, g){
    host.onclick = e => {
      if(e.target.closest('[data-athlete]')) return;
      GameStats.open(g);
    };
    host.classList.add('is-clickable');
    host.querySelectorAll('[data-athlete]').forEach(b => {
      if(!b.dataset.athlete) return;
      b.onclick = e => {
        e.stopPropagation();
        PlayerLog.open(g.league, b.dataset.athlete, {
          name: b.dataset.name, position: b.dataset.pos, headshot: b.dataset.shot
        });
      };
    });
  }

  /* Last three, newest first, as W/L pills with the score behind them. */
  function formHtml(list){
    const rows = (list || []).slice(0, 3);
    if(!rows.length) return '<span class="sp-form-none">—</span>';
    return `<span class="sp-form">${rows.map(x => `
      <span class="sp-pill ${x.result === 'win' ? 'is-w' : 'is-l'}" title="${
        esc(x.home ? 'vs' : '@')} ${esc(x.opponent)} · ${esc(x.score)}">${
        x.result === 'win' ? 'W' : 'L'}</span>`).join('')}</span>`;
  }

  function shellHtml(t, info, g, sum, myPast, oppPast){
    const away = sum?.sides?.find(s => !s.home) || (g.me?.home ? g.opp : g.me) || {};
    const home = sum?.sides?.find(s =>  s.home) || (g.me?.home ? g.me : g.opp) || {};
    const kick = new Date(g.kickoff);
    const live = (sum?.state || g.state) === 'in';
    const done = (sum?.state || g.state) === 'post';

    /* Which side is us, so the form rows land under the right logo. */
    const meIsHome = !!g.me?.home;
    const formFor = side => (side === (meIsHome ? 'home' : 'away')) ? myPast : oppPast;

    const logoOf = s => s.logo || Sports.logoFor({league:g.league, id:s.id});
    const colOf  = s => s.color || '';

    const sideHtml = (s, which) => `
      <div class="sp-side">
        <img class="sp-logo" src="${esc(logoOf(s))}" alt="" loading="lazy">
        <span class="sp-abbr">${esc(s.abbr || s.name || '')}</span>
        <span class="sp-rec">${esc(s.record || '')}</span>
        ${formHtml(formFor(which))}
      </div>`;

    /* The line as a bar: each team's own colour, split where the market
       has it, with the line itself printed on the seam. Same maths the
       full-screen AD uses. */
    const odds = sum?.odds || '';
    const fav = Sports.lineSplit(odds);
    let split = 50;
    if(fav){
      const isAway = away.abbr && fav.abbr.toUpperCase() === away.abbr.toUpperCase();
      split = (isAway ? fav.share : 1 - fav.share) * 100;
    }
    const bar = (colOf(away) || colOf(home)) ? `
      <div class="sp-line" style="--a:${esc(colOf(away) || colOf(home))};--h:${esc(colOf(home) || colOf(away))};--split:${split.toFixed(1)}%">
        ${odds ? `<span class="sp-line-tag" style="left:${split.toFixed(1)}%">${esc(odds)}</span>` : ''}
      </div>` : '';

    const when = live ? (sum?.status || 'In progress')
               : done ? (sum?.status || 'Final')
               : `${kick.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})} · ${
                    kick.toLocaleTimeString(undefined,{hour:'numeric', minute:'2-digit'})}`;

    const tv = (sum?.broadcast?.length ? sum.broadcast : g.broadcast) || [];

    /* Baseball is a pitching matchup; football is a units matchup. */
    const extra = isBaseball(g.league) ? probablesHtml(away, home)
                : isFootball(g.league) ? statsHtml(sum, away, home)
                : '';

    return `
      <div class="sp-head">
        <span class="sp-league">${esc(Sports.leagueName(g.league))}</span>
        ${live ? '<span class="gc-livedot">LIVE</span>' : ''}
        <span class="sp-when">${esc(when)}</span>
      </div>

      <div class="sp-matchup">
        ${sideHtml(away, 'away')}
        <div class="sp-mid">
          ${(live || done)
            ? `<span class="sp-score">${esc(String(away.score ?? ''))}<i>–</i>${esc(String(home.score ?? ''))}</span>`
            : '<span class="sp-at">@</span>'}
        </div>
        ${sideHtml(home, 'home')}
      </div>

      ${bar}

      <p class="sp-meta">${[
        sum?.venue || g.venue ? `📍 ${esc(sum?.venue || g.venue)}` : '',
        tv.length ? `📺 ${esc(tv.join(', '))}` : ''
      ].filter(Boolean).join(' · ')}</p>

      ${extra}`;
  }

  function probablesHtml(away, home){
    if(!away.probable && !home.probable) return '';
    const one = s => {
      const p = s.probable;
      if(!p) return '<span class="gc-pitch is-tbd">Starter TBD</span>';
      return `<button class="gc-pitch" data-athlete="${esc(p.id || '')}"
                data-name="${esc(p.name)}" data-pos="${esc(p.position)}"
                data-shot="${esc(p.headshot)}">
        ${p.headshot ? `<img class="gc-pitch-shot" src="${esc(p.headshot)}" alt="" loading="lazy">` : ''}
        <span class="gc-pitch-txt">
          <span class="gc-pitch-name">${esc(p.name)}${p.throws ? ` <i>${esc(p.throws)}HP</i>` : ''}</span>
          <span class="gc-pitch-line">${esc(p.line || p.label)}</span>
        </span></button>`;
    };
    return `<div class="gc-probables">
      <span class="gc-lab">Probable starters</span>
      <div class="gc-pitches">${one(away)}${one(home)}</div>
    </div>`;
  }

  function statsHtml(sum, away, home){
    const rows = sum?.teamStats || [];
    if(rows.length < 2) return '';
    const byId = id => rows.find(r => String(r.id) === String(id));
    const A = byId(away.id), H = byId(home.id);
    if(!A || !H) return '';

    const labels = [];
    for(const t of [A, H])
      for(const st of (t.stats || []))
        if(st.label && !labels.includes(st.label)) labels.push(st.label);
    if(!labels.length) return '';

    const val = (t, l) => (t.stats || []).find(x => x.label === l)?.value ?? '—';

    return `<div class="sp-stats">
      <span class="gc-lab">Team stats</span>
      <div class="sp-stat-grid">${labels.slice(0, 6).map(l => `
        <span class="sp-sa">${esc(String(val(A, l)))}</span>
        <span class="sp-sl">${esc(l)}</span>
        <span class="sp-sh">${esc(String(val(H, l)))}</span>`).join('')}</div>
    </div>`;
  }

  /* ---- top right: the table, or the poll ---- */
  async function table(t, info, mine){
    const host = document.getElementById('spTable');
    if(!host) return;

    if(isCollege(t.league)){
      try{
        const poll = await Sports.rankings(t.league);
        if(mine !== token) return;
        if(!poll) return host.innerHTML = '<p class="empty">No poll published yet.</p>';
        host.innerHTML = `
          <h3 class="pf-h3">${esc(poll.name)}</h3>
          <div class="sp-rank">${poll.rows.map(r => `
            <div class="sp-rank-row${String(r.id) === String(t.id) ? ' is-mine' : ''}">
              <span class="sp-rank-n">${r.rank}</span>
              ${r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy">` : '<span></span>'}
              <span class="sp-rank-t">${esc(r.team)}</span>
              <span class="sp-rank-r">${esc(r.record)}</span>
            </div>`).join('')}</div>`;
      }catch(e){
        host.innerHTML = `<p class="empty">Poll unavailable (${esc(e.message)}).</p>`;
      }
      return;
    }

    try{
      const groups = await Sports.standings(t.league);
      if(mine !== token) return;

      /* The conference this team is actually in — the group holding it,
         and if several do, the biggest, which is the conference rather
         than the division. */
      const holds = groups.filter(gr => gr.rows.some(r => String(r.id) === String(t.id)));
      const group = holds.sort((a,b) => b.rows.length - a.rows.length)[0] || groups[0];
      if(!group) return host.innerHTML = '<p class="empty">No standings published.</p>';

      host.innerHTML = `
        <h3 class="pf-h3">${esc(group.name)}</h3>
        <div class="sp-table">${group.rows.map((r, i) => `
          <div class="sp-table-row${String(r.id) === String(t.id) ? ' is-mine' : ''}">
            <span class="sp-rank-n">${i + 1}</span>
            ${r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy">` : '<span></span>'}
            <span class="sp-rank-t">${esc(r.team)}</span>
            <span class="sp-rank-r">${esc(r.stats.overall || `${r.stats.wins || 0}-${r.stats.losses || 0}`)}</span>
          </div>`).join('')}</div>`;
    }catch(e){
      host.innerHTML = `<p class="empty">Standings unavailable (${esc(e.message)}).</p>`;
    }
  }

  /* ---- bottom: the next five ---- */
  function minis(list, mine){
    const host = document.getElementById('spMinis');
    if(!host) return;
    if(!list.length){ host.innerHTML = '<p class="empty">Nothing else scheduled.</p>'; return; }

    host.innerHTML = list.map((g, i) => {
      const k = new Date(g.kickoff);
      return `<button class="sp-mini" data-mini="${i}">
        <span class="sp-mini-when">${esc(k.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric'}))}
          · ${esc(k.toLocaleTimeString(undefined,{hour:'numeric', minute:'2-digit'}))}</span>
        <span class="sp-mini-teams">
          <img src="${esc(Sports.logoFor({league:g.league, id:g.opp?.id}))}" alt="" loading="lazy">
          <b>${esc(g.home ? 'vs' : '@')} ${esc(g.opp?.abbr || g.opponent)}</b>
        </span>
        <span class="sp-mini-where">${esc(g.venue || '')}</span>
        <span class="sp-mini-line" data-line="${esc(g.eventId)}">—</span>
      </button>`;
    }).join('');

    host.querySelectorAll('[data-mini]').forEach(b =>
      b.onclick = () => GameStats.open(list[+b.dataset.mini]));

    /* The line only exists on the summary, so each mini fills its own in
       when that arrives. Cached, so this costs nothing on a repaint. */
    list.forEach(async g => {
      try{
        const sum = await Sports.summary(g.league, g.eventId, false);
        if(mine !== token) return;
        const el = host.querySelector(`[data-line="${g.eventId}"]`);
        if(el && sum?.odds) el.textContent = sum.odds;
      }catch(e){ /* a missing line is not worth a message */ }
    });
  }

  return { render, select(k){ active = k; render(); } };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.SportsView = SportsView;
