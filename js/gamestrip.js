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
