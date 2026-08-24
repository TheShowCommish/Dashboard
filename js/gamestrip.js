/* ============================================================
   gamestrip.js — the live score bar in the header.

   Appears only when a followed team is playing right now, or is about to:
   from an hour before first pitch until the final is posted. It sits
   between the tabs and the clock, so whatever tab is up, the score is on
   screen.

   The schedule refresh is a fifteen-minute job and a live score is not,
   so while a game is in progress this polls that one game's summary on
   its own timer.
   ============================================================ */

const GameStrip = (() => {
  const el = () => document.getElementById('gameStrip');

  const LEAD_MS  = 60 * 60 * 1000;   // show it this long before kickoff
  const POLL_MS  = 45 * 1000;        // live score refresh
  const IDLE_MS  = 5 * 60 * 1000;    // pre-game refresh

  let timer = null;
  let showing = null;                // eventId currently on screen

  /* The one game worth a permanent strip: live first, then the next one
     inside the lead window. A final is left to the tabs. */
  function pick(){
    const games = (window.Teams ? Teams.games : []) || [];
    const now = Date.now();

    const live = games.find(g => g.state === 'in');
    if(live) return live;

    return games
      .filter(g => g.state === 'pre')
      .map(g => ({g, t: new Date(g.kickoff).getTime()}))
      .filter(x => x.t - now <= LEAD_MS && x.t - now > -4 * 36e5)
      .sort((a,b) => a.t - b.t)[0]?.g || null;
  }

  function hide(){
    const host = el();
    if(!host) return;
    host.hidden = true;
    host.innerHTML = '';
    showing = null;
  }

  function paint(g, sum){
    const host = el();
    if(!host) return;

    const away = sum?.sides?.find(s => !s.home) || (g.me?.home ? g.opp : g.me) || {};
    const home = sum?.sides?.find(s =>  s.home) || (g.me?.home ? g.me : g.opp) || {};
    const state = sum?.state || g.state;
    const live  = state === 'in';

    const kick = new Date(g.kickoff);
    const mins = Math.round((kick - Date.now()) / 60000);
    const status = live ? (sum?.status || 'In progress')
                 : state === 'post' ? (sum?.status || 'Final')
                 : mins > 0 ? `in ${mins} min`
                 : kick.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});

    const side = s => `
      <span class="gs-side">
        <img src="${esc(s.logo || Sports.logoFor({league:g.league, id:s.id}))}" alt="">
        <b>${esc(s.abbr || s.name || '')}</b>
      </span>`;

    const score = (live || state === 'post')
      ? `<span class="gs-num">${esc(String(away.score ?? '0'))}<i>–</i>${esc(String(home.score ?? '0'))}</span>`
      : '<span class="gs-at">@</span>';

    host.hidden = false;
    host.className = live ? 'is-live' : '';
    host.innerHTML = `
      ${live ? '<span class="gs-dot">LIVE</span>' : ''}
      ${side(away)}${score}${side(home)}
      <span class="gs-when">${esc(status)}</span>`;

    /* Clicking it opens the same game popup the tabs use. */
    host.onclick = () => { if(window.GameStats && g.eventId) GameStats.open(g); };
    host.title = 'Open the game';
  }

  async function refresh(){
    if(window.GameBalls) GameBalls.render();
    const g = pick();
    if(!g){ hide(); schedule(IDLE_MS); return; }

    /* Paint from the schedule first so the bar is never blank, then
       upgrade with the live line. */
    if(showing !== g.eventId){ paint(g, null); showing = g.eventId; }

    let sum = null;
    try{
      if(g.eventId) sum = await Sports.summary(g.league, g.eventId, true);
    }catch(e){
      console.error('Score strip summary failed:', e.message);
    }
    paint(g, sum);

    const live = (sum?.state || g.state) === 'in';
    schedule(live ? POLL_MS : IDLE_MS);
  }

  function schedule(ms){
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  function boot(){
    refresh();
  }

  return { boot, refresh };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.GameStrip = GameStrip;


/* ============================================================
   gameballs.js — the game-day markers.

   One small ball at the top of the screen per followed team playing
   today, in that team's own colour and in the shape of its sport. Four
   teams out on the same day reads as four balls: two footballs, a
   basketball and a baseball.

   Lives with the score strip because both answer the same question —
   who is playing right now — off the same schedule.
   ============================================================ */

const GameBalls = (() => {
  const host = () => document.getElementById('gameBalls');

  const SPORT = {
    'nfl':'football', 'college-football':'football',
    'nba':'basketball', 'mens-college-basketball':'basketball',
    'mlb':'baseball', 'nhl':'puck'
  };

  /* Drawn rather than emoji: these have to take the team's colour, and
     they have to stay legible at twenty-odd pixels. */
  const BALL = {
    football: c => `
      <svg viewBox="0 0 32 22" aria-hidden="true">
        <ellipse cx="16" cy="11" rx="15" ry="9.5" fill="${c}" stroke="rgba(0,0,0,.35)"/>
        <path d="M4 11h24" stroke="#fff" stroke-width="1.3" opacity=".85"/>
        <path d="M12 11v-4M16 11v-5M20 11v-4" stroke="#fff" stroke-width="1.3"
              stroke-linecap="round" opacity=".85" transform="translate(0,2)"/>
        <path d="M2.6 6.5c2 4.5 2 5.5 0 10M29.4 6.5c-2 4.5-2 5.5 0 10"
              stroke="#fff" stroke-width="1.2" fill="none" opacity=".7"/>
      </svg>`,
    basketball: c => `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="${c}" stroke="rgba(0,0,0,.35)"/>
        <path d="M1 12h22M12 1v22" stroke="#fff" stroke-width="1.2" opacity=".85"/>
        <path d="M4 4c5 4 5 12 0 16M20 4c-5 4-5 12 0 16"
              stroke="#fff" stroke-width="1.2" fill="none" opacity=".85"/>
      </svg>`,
    baseball: c => `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="${c}" stroke="rgba(0,0,0,.35)"/>
        <path d="M5.5 3.2C8.6 7 8.6 17 5.5 20.8M18.5 3.2c-3.1 3.8-3.1 13.8 0 17.6"
              stroke="#fff" stroke-width="1.4" fill="none" opacity=".9"/>
      </svg>`,
    puck: c => `
      <svg viewBox="0 0 26 20" aria-hidden="true">
        <ellipse cx="13" cy="14" rx="11" ry="5" fill="${c}" stroke="rgba(0,0,0,.35)"/>
        <rect x="2" y="7" width="22" height="7" fill="${c}"/>
        <ellipse cx="13" cy="7" rx="11" ry="5" fill="${c}" stroke="rgba(0,0,0,.35)"/>
        <ellipse cx="13" cy="7" rx="7" ry="3" fill="none" stroke="#fff" opacity=".55"/>
      </svg>`,
    generic: c => `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="${c}" stroke="rgba(0,0,0,.35)"/>
      </svg>`
  };

  const isToday = d => d && new Date(d).toDateString() === new Date().toDateString();

  /* One entry per followed team with a game today — not per game, so a
     doubleheader is still one ball. */
  function playing(){
    const forced = Store.get('theme.gamedayTest','');
    if(forced){
      const [league, id] = forced.split('|');
      const t = (window.Sports ? Sports.teams() : []).find(x =>
        x.league === league && String(x.id) === String(id));
      if(!t) return [];
      const saved = Store.get('teams.colors', {})[forced];
      const col = typeof saved === 'string' ? saved : (saved?.c || '');
      return [{league, name: t.name, abbr: t.abbr, colour: col}];
    }

    const seen = new Set();
    const out = [];
    for(const g of ((window.Teams ? Teams.games : []) || [])){
      if(!isToday(g.kickoff)) continue;
      const key = `${g.league}|${g.id}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push({league: g.league, name: g.name || g.abbr, abbr: g.abbr,
                colour: g.me?.color || g.me?.altColor || ''});
    }
    return out;
  }

  function render(){
    const el = host();
    if(!el) return;
    const list = playing();
    if(!list.length){ el.hidden = true; el.innerHTML = ''; return; }

    el.hidden = false;
    el.innerHTML = list.map(t => {
      const shape = SPORT[t.league] || 'generic';
      /* The team's own colour, falling back to the deck's accent so a ball
         is never invisible. */
      const c = t.colour || 'var(--accent)';
      return `<span class="gb" title="${esc(t.name || '')} play today">${BALL[shape](c)}</span>`;
    }).join('');
  }

  return { render };
})();

window.GameBalls = GameBalls;
