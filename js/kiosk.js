/* ============================================================
   kiosk.js — auto-advancing dashboard for unattended display.

   Cycles through the six top-level tabs on a 15s tick. After each full
   pass, a full-screen "AD" summarises the most important thing from one
   tab; ADs rotate evenly one per pass so every tab gets equal airtime.

   Only one setTimeout is ever live — the state machine reschedules itself
   at each transition rather than running an interval alongside the tick.

   Manual interaction pauses everything and the cycle resumes 20 seconds
   after the last real pointer or key event.

   An AD that would be blank is skipped rather than shown — see
   AD_CONTENT_CHECKS — and its slot is burned so the rotation stays fair.

   Kiosk.previewAd(name) holds one AD on screen with no timer and no
   advance, for iterating on its styling. It works with rotation off.
   ============================================================ */

const Kiosk = (() => {

  /* The tab order. What actually rotates is this filtered by Settings —
     see ROTATION below. */
  const TABS = ['calendar','sports','portfolio','movies','notes','fantasy','todo'];

  /* ADs are no longer one-per-tab: weather earns a full screen without
     owning a tab, and To Do is working notes nobody wants on a wall. */
  const ADS = ['calendar','sports','weather','portfolio','movies','notes','fantasy'];

  /* Everything the rotation can show, and whether it is on by default.
     Settings writes kiosk.show.<name>; both lists are filtered through it,
     so turning off Movies drops both the tab and its AD. */
  const ROTATION = [
    {name:'calendar',  label:'Calendar',  tab:true,  ad:true},
    {name:'sports',    label:'Sports',    tab:true,  ad:true},
    {name:'weather',   label:'Weather',   tab:false, ad:true},
    {name:'portfolio', label:'Portfolio', tab:true,  ad:true},
    {name:'movies',    label:'Movies',    tab:true,  ad:true},
    {name:'notes',     label:'Notes',     tab:true,  ad:true},
    {name:'fantasy',   label:'Fantasy',   tab:true,  ad:true},
    {name:'todo',      label:'To Do',     tab:true,  ad:false, off:true}
  ];

  const shown = name => {
    const row = ROTATION.find(r => r.name === name);
    return Store.get(`kiosk.show.${name}`, row ? !row.off : true);
  };

  /* The live lists. Everything switched off in Settings is simply not in
     them, so no index arithmetic has to know about it. An empty list would
     stall the machine, so the deck falls back to the calendar. */
  function tabs(){
    const list = ROTATION.filter(r => r.tab && shown(r.name)).map(r => r.name);
    return list.length ? list : ['calendar'];
  }
  function ads(){
    const list = ROTATION.filter(r => r.ad && shown(r.name)).map(r => r.name);
    return list.length ? list : ['calendar'];
  }
  const TAB_MS = 15000;
  const AD_MS  = 30000;
  const RESUME_MS = 20000;

  let enabled  = false;
  let mode     = 'tab';        // 'tab' | 'ad'
  let tabIdx   = 0;
  let adIdx    = 0;
  let timerId  = null;
  let pausedUntil = 0;
  /* Preview holds a single AD on screen indefinitely: no timer, no
     advance, and independent of whether rotation is even enabled. */
  let preview  = false;
  /* Per-AD arguments — currently only which team the sports AD should be
     about. Cleared with the overlay. */
  let adOpts   = null;

  /* One cursor per sub-selecting tab. Read modulo current list length so a
     team added or removed at runtime wraps cleanly rather than throwing or
     skipping. */
  const subCursor = {sports:0, portfolio:0};

  const overlay = () => document.getElementById('adOverlay');
  const toggleBtn = () => document.getElementById('kioskToggle');

  /* ---- timer plumbing ---- */
  function clearTimer(){
    if(timerId){ clearTimeout(timerId); timerId = null; }
  }

  function schedule(ms){
    clearTimer();
    if(!enabled) return;
    timerId = setTimeout(tick, ms);
  }

  /* ---- state machine ---- */
  function tick(){
    if(!enabled || preview) return;

    /* Interaction may have landed since this timer was armed; honour the
       pause instead of firing on top of a user still using the deck. */
    const wait = pausedUntil - Date.now();
    if(wait > 0){ schedule(wait); return; }

    if(mode === 'ad'){
      closeAd();
      mode = 'tab';
      tabIdx = 0;
      adIdx = (adIdx + 1) % ads().length;
      showCurrentTab();
      schedule(TAB_MS);
      return;
    }

    tabIdx++;
    if(tabIdx >= tabs().length) startAd();
    else { showCurrentTab(); schedule(TAB_MS); }
  }

  /* Open the AD whose turn it is — unless that AD has nothing worth a
     full screen, in which case its slot is burned and the next pass of
     tabs starts immediately. adIdx still advances, so an AD that is
     empty every pass cannot monopolise the following slot. */
  function startAd(){
    const list = ads();
    if(adIdx >= list.length) adIdx = 0;
    const name = list[adIdx];
    if(!hasContent(name)){
      adIdx = (adIdx + 1) % list.length;
      mode = 'tab';
      tabIdx = 0;
      showCurrentTab();
      schedule(TAB_MS);
      return;
    }
    mode = 'ad';
    openAd(name);
    schedule(AD_MS);
  }

  /* Default true: an AD is shown unless its renderer has declared a way
     to know it would be blank. */
  function hasContent(name){
    try{
      const fn = AD_CONTENT_CHECKS[name];
      return fn ? !!fn() : true;
    }catch(e){
      console.error(`AD content check "${name}" failed:`, e);
      return true;
    }
  }

  function showCurrentTab(){
    const list = tabs();
    if(tabIdx >= list.length) tabIdx = 0;
    const name = list[tabIdx];
    try{ App.showTab(name); }
    catch(e){ console.error('Kiosk showTab failed:', e); }
    /* Give the tab a paint frame before touching its sub-tabs — the sub-tab
       list is regenerated by that tab's render(). */
    setTimeout(() => applySubCursor(name), 60);
  }

  function applySubCursor(name){
    if(name === 'sports'){
      const btns = document.querySelectorAll('#teamTabs .subtab[data-team]');
      if(!btns.length) return;
      const i = subCursor.sports % btns.length;
      programmaticClick(btns[i]);
      subCursor.sports = (i + 1) % btns.length;
    } else if(name === 'portfolio'){
      const btns = document.querySelectorAll('#pfAccounts .subtab[data-acct]');
      if(btns.length < 2) return;   // 'All' alone isn't a rotation
      const i = subCursor.portfolio % btns.length;
      programmaticClick(btns[i]);
      subCursor.portfolio = (i + 1) % btns.length;
    }
  }

  /* A dispatched click fires the button's own handler but not our
     interaction listener (which listens for pointerdown/keydown), so
     rotating the sub-tabs does not look like a user interruption. */
  function programmaticClick(el){
    try{ el.click(); } catch(e){ /* button removed mid-tick — ignore */ }
  }

  /* ---- start / stop / toggle ---- */
  function start(){
    if(enabled) return;
    preview = false;
    enabled = true;
    Store.set('kiosk.enabled', true);
    document.body.classList.add('kiosk-on');
    updateToggleUi();
    /* Reset to the beginning of the cycle so a fresh start is predictable —
       the user just enabled it, they should see it begin. */
    mode = 'tab';
    tabIdx = 0;
    subCursor.sports = 0;
    subCursor.portfolio = 0;
    showCurrentTab();
    schedule(TAB_MS);
  }

  function stop(){
    enabled = false;
    Store.set('kiosk.enabled', false);
    document.body.classList.remove('kiosk-on');
    clearTimer();
    closeAd();
    updateToggleUi();
  }

  function toggle(){ enabled ? stop() : start(); }

  function updateToggleUi(){
    const b = toggleBtn();
    if(!b) return;
    b.textContent = enabled ? 'AUTO ON' : 'AUTO';
    b.classList.toggle('is-on', enabled);
    b.title = enabled ? 'Rotation on — click to stop' : 'Start rotation';
  }

  /* ---- interaction detection ---- */
  function noteInteraction(){
    /* A preview is a deliberate, held state — touching the screen must not
       schedule a tick that would pull the deck out from under it. */
    if(!enabled || preview) return;
    pausedUntil = Date.now() + RESUME_MS;
    /* If an AD is up when the user touches the screen, get out of the way
       immediately rather than making them wait for the ad timer. */
    if(mode === 'ad') closeAd();
    schedule(RESUME_MS);
  }

  /* ---- AD overlay ---- */
  function openAd(name, opts){
    adOpts = opts || null;
    const el = overlay();
    if(!el) return;
    el.className = `ad ad-${name} is-on${preview ? ' is-preview' : ''}`;
    el.innerHTML = `${preview ? `<button id="adClose" class="ad-x" title="Close preview"
                       aria-label="Close preview">✕</button>` : ''}
                    <span id="adLine" class="ad-line-tag" hidden></span>
                    <div class="ad-brand">${name.toUpperCase()}${preview ? ' · PREVIEW' : ''}</div>
                    <div class="ad-body" id="adBody">
                      <div class="ad-fit" id="adFit">
                        <p class="ad-empty">Loading…</p>
                      </div>
                    </div>`;
    const x = el.querySelector('#adClose');
    if(x) x.addEventListener('click', closePreview);

    /* Half these renderers finish asynchronously, so the fit pass cannot
       be a one-shot after render — it watches the AD instead. */
    const fit = el.querySelector('#adFit');
    if(fitWatch) fitWatch.disconnect();
    if(fit && window.MutationObserver){
      fitWatch = new MutationObserver(() => { clearTimeout(fitTimer); fitTimer = setTimeout(fitAd, 60); });
      fitWatch.observe(fit, {childList:true, subtree:true});
    }

    renderAd(name);
    setTimeout(fitAd, 80);
  }

  function closeAd(){
    preview = false;
    adOpts = null;
    updateToggleUi();
    const el = overlay();
    if(!el) return;
    el.className = 'ad';
    /* Team colours are set inline by the sports AD — clear them or the
       next AD inherits them. */
    el.removeAttribute('style');
    el.innerHTML = '';
  }

  /* ---- preview ----
     Open one AD and leave it there. Works with rotation off, and with it
     on it parks the state machine until the preview is dismissed. */
  function previewAd(name, opts){
    if(!AD_RENDERERS[name]){
      console.error(`No such AD: "${name}". Try one of: ${ADS.join(', ')}.`);   // eslint-disable-line
      return;
    }
    clearTimer();
    preview = true;
    updateToggleUi();
    openAd(name, opts);
  }

  /* Back to whatever tab was showing. Rotation, if it was on, picks up
     from where it was parked rather than restarting the pass. */
  function closePreview(){
    const wasPreview = preview;
    closeAd();
    if(!wasPreview) return;
    if(enabled){ mode = 'tab'; schedule(TAB_MS); }
  }

  /* ---- fit to the screen ----
     An AD never scrolls: a wall display has no scrollbar and nobody to
     use it. Anything too tall is scaled down until it fits, in small
     steps, with a floor so it cannot shrink into nothing. */
  let fitWatch = null, fitTimer = null;

  function fitAd(){
    const host = document.getElementById('adBody');
    const fit  = document.getElementById('adFit');
    if(!host || !fit) return;

    fit.style.zoom = '';
    const room = host.clientHeight;
    if(!room) return;

    let z = 1;
    while(fit.getBoundingClientRect().height > room - 2 && z > 0.5){
      z -= 0.04;
      fit.style.zoom = z.toFixed(2);
    }
  }

  function renderAd(name){
    const body = document.getElementById('adFit');
    if(!body) return;
    try{
      const fn = AD_RENDERERS[name];
      if(fn) fn(body, adOpts || {});
      else body.innerHTML = `<p class="ad-empty">Nothing to show.</p>`;
    }catch(e){
      /* Name the failure on the screen as well as in the console: an AD
         that silently reads "nothing to show" is indistinguishable from
         an AD that genuinely has nothing. */
      console.error(`AD "${name}" failed:`, e);
      body.innerHTML = `<p class="ad-empty">Nothing to show right now.</p>
        <p class="ad-why">${esc(name)} AD failed: ${esc(e.message || String(e))}</p>`;
    }
  }

  /* ============================================================
     AD renderers — one per tab, single topic, glanceable typography.
     Every renderer degrades to a clean empty state rather than a
     blank overlay.
     ============================================================ */

  const AD_RENDERERS = {
    calendar: adCalendar,
    weather:  adWeather,
    sports:   adSports,
    portfolio:adPortfolio,
    movies:   adMovies,
    notes:    adNotes,
    fantasy:  adFantasy
  };

  /* Only ADs that can be genuinely blank need an entry; everything else
     defaults to "show it". A false return burns the slot — see startAd. */
  const AD_CONTENT_CHECKS = {
    calendar: () => !!calendarWindow(),
    /* No reading yet means no forecast to put on a full screen. */
    weather:  () => !!(window.Weather && Weather.current)
  };

  /* Whole days from today to a YYYY-MM-DD date, counted midday to midday
     so neither a timezone nor a DST boundary can shift the answer. */
  function daysUntil(date){
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12);
    const then  = new Date(date + 'T12:00:00');
    return Math.round((then - today) / 864e5);
  }

  const sameDay = (a,b) => a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  /* The nearest day inside the next week that actually has events —
     today first, then one day at a time out to day 7. Null means the
     whole window is empty, which is what lets the AD be skipped. */
  function calendarWindow(){
    const all = (window.Calendar ? Calendar.events : []) || [];
    const base = new Date();
    for(let i = 0; i <= 7; i++){
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const events = all
        .filter(e => e.start && sameDay(new Date(e.start), day))
        .sort((a,b) => new Date(a.start) - new Date(b.start));
      if(events.length) return {day, days:i, events: events.slice(0, 8)};
    }
    return null;
  }

  function adCalendar(host){
    const win = calendarWindow();

    /* Rotation never lands here — startAd skips an empty calendar. A
       preview can, so it still needs to say something. */
    if(!win){
      const today = new Date();
      host.innerHTML = `<div class="ad-hero">
        <h1 class="ad-h1">${today.toLocaleDateString(undefined,{weekday:'long'})}</h1>
        <p class="ad-sub">${today.toLocaleDateString(undefined,{month:'long',day:'numeric'})}</p>
        <p class="ad-empty ad-big">Nothing on the calendar this week.</p>
      </div>`;
      return;
    }

    const head = win.days === 0 ? 'Today'
               : win.days === 1 ? 'Tomorrow'
               : `In ${win.days} days`;

    host.innerHTML = `
      <div class="ad-hero">
        <h1 class="ad-h1">${esc(head)}</h1>
        <p class="ad-sub">${win.day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p>
      </div>
      <ul class="ad-list">${win.events.map(e => {
        const t = new Date(e.start);
        const when = e.allDay ? 'All day'
                    : t.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
        return `<li class="ad-row">
          <span class="ad-time">${esc(when)}</span>
          <span class="ad-title">${esc(e.title)}</span>
          ${e.where ? `<span class="ad-where">${esc(e.where)}</span>` : ''}
        </li>`;
      }).join('')}</ul>`;
  }

  /* Both teams, both sets of season leaders, where to watch — and for
     baseball the two probable starters, given the room they deserve.
     The schedule payload alone cannot fill a screen this size, so the
     summary is fetched and the AD upgrades itself when it lands. */
  /* ---- weather AD ----
     The rest of today hour by hour, then the week. This is the forecast
     that used to be squeezed into a tile under the calendar grid. */
  function adWeather(host){
    const w = window.Weather;
    if(!w || !w.current){
      host.innerHTML = `<p class="ad-empty ad-big">No weather reading yet.</p>`;
      return;
    }

    const c = w.current;
    const rain = w.rainToday();
    const hours = w.restOfToday();
    const days = w.daily(8).slice(1);          // tomorrow onward

    const temps = hours.map(h => h.temp);
    const lo = temps.length ? Math.min(...temps) : 0;
    const hi = temps.length ? Math.max(...temps) : 1;
    const span = Math.max(1, hi - lo);

    host.innerHTML = `
      <div class="ad-wx-now">
        <span class="ad-wx-glyph">${w.glyph(c.main)}</span>
        <div class="ad-wx-id">
          <h1 class="ad-h1">${c.temp}&deg;</h1>
          <p class="ad-sub">${esc(c.desc)} &middot; feels ${c.feels}&deg; &middot; wind ${c.wind} mph${
            c.humidity != null ? ` &middot; ${c.humidity}% humidity` : ''}</p>
          <p class="ad-wx-rain${rain && !rain.dry ? ' is-wet' : ''}">${
            !rain ? ''
            : rain.dry ? `Rain unlikely today &mdash; peaks at ${rain.peak}%`
            : `Rain ${rain.peak}% today &middot; ${esc(rain.window)}`}</p>
        </div>
        <div class="ad-wx-place">${esc(c.place || '')}</div>
      </div>

      <div class="ad-wx-hours">
        ${hours.map((h,i) => `
          <div class="ad-wx-hour">
            <span class="ad-wx-h-t">${i === 0 ? 'now' : esc(w.hourLabel(h.t))}</span>
            <span class="ad-wx-h-g">${w.glyph(h.main)}</span>
            <span class="ad-wx-h-bar"><i style="height:${(14 + (h.temp - lo) / span * 54).toFixed(0)}px"></i></span>
            <span class="ad-wx-h-n">${h.temp}&deg;</span>
            <span class="ad-wx-h-p${(h.pop || 0) >= 30 ? ' is-wet' : ''}">${h.pop ? h.pop + '%' : ''}</span>
          </div>`).join('')}
      </div>

      <div class="ad-wx-days">
        ${days.map(d => `
          <div class="ad-wx-day">
            <b>${d.date.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase()}</b>
            <span class="ad-wx-d-g">${w.glyph(d.noon.main)}</span>
            <span class="ad-wx-d-t">${d.hi}&deg;<i>${d.lo}&deg;</i></span>
            <span class="ad-wx-d-p${d.pop >= 30 ? ' is-wet' : ''}">${d.pop ? d.pop + '%' : ''}</span>
          </div>`).join('')}
      </div>`;
  }

  function adSports(host, opts = {}){
    let games = (window.Teams ? Teams.games : []) || [];

    /* A preview button names one followed team; rotation names none and
       takes whichever game is nearest across all of them. */
    if(opts.team){
      const only = games.filter(g => `${g.league}|${g.id}` === opts.team);
      if(only.length) games = only;
    }

    if(!games.length){
      host.innerHTML = `<p class="ad-empty ad-big">No games scheduled for followed teams.</p>`;
      return;
    }
    const now = Date.now();
    const upcoming = games
      .filter(g => new Date(g.kickoff).getTime() >= now - 4*36e5)
      .sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff));
    const past = games
      .filter(g => g.state === 'post')
      .sort((a,b) => new Date(b.kickoff) - new Date(a.kickoff));

    const g = upcoming[0] || past[0];
    if(!g){ host.innerHTML = `<p class="ad-empty ad-big">No games right now.</p>`; return; }

    /* Schedule-only first paint, so the screen is never empty while the
       summary is in flight. */
    host.innerHTML = adSportsHtml(g, null);

    Sports.summary(g.league, g.eventId, g.state === 'in')
      .then(sum => {
        /* The AD may have been closed or replaced while this was away. */
        if(!host.isConnected) return;
        host.innerHTML = adSportsHtml(g, sum);
        tint(sum, g);
      })
      .catch(e => console.error('Sports AD summary failed:', e.message));
  }

  /* Paint the overlay with the two teams' own colours, split by who the
     market likes. Cleared by closeAd so the next AD does not inherit it. */
  function tint(sum, g){
    const el = overlay();
    if(!el) return;
    const away = sum.sides?.find(s => !s.home);
    const home = sum.sides?.find(s =>  s.home);
    if(!away?.color && !home?.color) return;

    el.style.setProperty('--ad-a', away?.color || home?.color);
    el.style.setProperty('--ad-h', home?.color || away?.color);

    /* --ad-split is where the away colour hands over to the home colour,
       measured from the left, so the favourite's side is the wider one. */
    const fav = Sports.lineSplit(sum.odds || g?.odds);
    let split = 0.5;
    if(fav){
      const isAway = away?.abbr && fav.abbr.toUpperCase() === away.abbr.toUpperCase();
      const isHome = home?.abbr && fav.abbr.toUpperCase() === home.abbr.toUpperCase();
      if(isAway) split = fav.share;
      else if(isHome) split = 1 - fav.share;
    }
    el.style.setProperty('--ad-split', `${(split * 100).toFixed(1)}%`);
    el.classList.add('is-tinted');

    /* The seam is where the market thinks the game sits, so it says so:
       the line itself, printed on the divider. */
    const raw = sum.odds || g?.odds || '';
    const tag = el.querySelector('#adLine');
    if(tag){
      tag.textContent = raw ? raw : '';
      tag.hidden = !raw;
    }
  }

  function adSportsHtml(g, sum){
    const away = sum?.sides?.find(s => !s.home) || (g.me?.home ? g.opp : g.me) || {};
    const home = sum?.sides?.find(s =>  s.home) || (g.me?.home ? g.me : g.opp) || {};

    const kick = new Date(g.kickoff);
    const live = (sum?.state || g.state) === 'in';
    const done = (sum?.state || g.state) === 'post';
    /* The big line under the score says how far off it is; the meta line
       below carries the exact date and time. */
    const when = live ? `LIVE · ${sum?.status || g.status || ''}`
               : done ? `Final ${g.score || ''}`
               : sameDay(kick, new Date())
                 ? `Today · ${kick.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`
                 : kick.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});

    const logoOf = s => s.logo || Sports.logoFor({league:g.league, id:s.id});
    const score = (live || done)
      ? `<span class="ad-sc">${esc(String(away.score ?? ''))}<i>–</i>${esc(String(home.score ?? ''))}</span>`
      : `<span class="ad-vs">${g.home ? 'vs' : '@'}</span>`;

    const side = (s, cls) => `
      <div class="ad-team ${cls}">
        <img class="ad-team-logo" src="${esc(logoOf(s))}" alt="">
        <span class="ad-team-name">${esc(s.abbr || s.name || '')}</span>
        <span class="ad-team-rec">${esc(s.record || '')}</span>
      </div>`;

    const tv = (sum?.broadcast?.length ? sum.broadcast : g.broadcast) || [];
    /* Everything a preview card carries, at wall-screen size: the date in
       full, the start time, where it is, who is showing it and the line. */
    /* When it is belongs between the two logos, where the @ used to be —
       it is the second thing anyone looks for after who is playing. The
       line under it keeps where and how to watch. */
    const dateLine = done ? ''
      : `${kick.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})}`;

    const meta = [
      esc(Sports.leagueName(g.league)),
      sum?.venue || g.venue ? `📍 ${esc(sum?.venue || g.venue)}` : '',
      tv.length ? `📺 ${esc(tv.join(', '))}` : ''
    ].filter(Boolean).join(' · ');

    /* Leaders come back flat with a team abbreviation on each row. */
    const forTeam = s => (sum?.leaders || []).filter(l =>
      l.team && s.abbr && l.team.toUpperCase() === s.abbr.toUpperCase());

    const column = s => {
      const rows = forTeam(s);
      return `<div class="ad-lead-col">
        <h3 class="ad-h3">${esc(s.abbr || s.name || '')}</h3>
        ${!rows.length ? '<p class="ad-empty">No season leaders published.</p>' : ''}
        <ul class="ad-lead">${rows.map(l => `
          <li>
            <span class="ad-lead-cat">${esc(l.category)}</span>
            <span class="ad-lead-name">${esc(l.athlete)}${l.position ? ` <i>${esc(l.position)}</i>` : ''}</span>
            <span class="ad-lead-val">${esc(l.value)}</span>
          </li>`).join('')}</ul>
      </div>`;
    };

    const pitcher = (s, cls) => {
      const p = s.probable;
      if(!p) return `<div class="ad-sp ${cls}"><p class="ad-sp-tbd">${esc(s.abbr || '')} starter TBD</p></div>`;
      return `<div class="ad-sp ${cls}">
        ${p.headshot ? `<img class="ad-sp-shot" src="${esc(p.headshot)}" alt="">` : ''}
        <div class="ad-sp-txt">
          <span class="ad-sp-lab">${esc(s.abbr || '')} · ${esc(p.label || 'Starter')}</span>
          <span class="ad-sp-name">${esc(p.name)}${p.throws ? ` <i>${esc(p.throws)}HP</i>` : ''}</span>
          <span class="ad-sp-line">${esc(p.line || '')}</span>
        </div>
      </div>`;
    };

    /* Football's preview is about the units, not individuals: ESPN hands
       back season averages per team — yards a game, points a game, third
       down — and those say more about the matchup than one leader each. */
    /* The league keys are short names — "nfl", not "football/nfl" — so a
       substring test for "football" quietly matched nothing. */
    const isFootball = ['nfl','college-football'].includes(g.league);
    const statRows = (sum?.teamStats || []).length >= 2
      ? teamStatRows(sum, away, home, isFootball) : '';

    const probables = (!done && (away.probable || home.probable))
      ? `<div class="ad-sps">
           <span class="ad-sp-head">Probable starters</span>
           <div class="ad-sp-row">${pitcher(away,'is-away')}${pitcher(home,'is-home')}</div>
         </div>`
      : '';

    return `
      <div class="ad-matchup">
        ${side(away,'is-away')}
        <div class="ad-mid">
          ${score}
          <span class="ad-when${live ? ' ad-live' : ''}">${esc(when)}</span>
          <span class="ad-date">${esc(dateLine)}</span>
        </div>
        ${side(home,'is-home')}
      </div>
      <p class="ad-sub ad-gmeta">${meta}</p>
      ${probables}
      ${isFootball && statRows ? statRows : ''}
      ${(sum?.leaders || []).length
        ? `<div class="ad-leads${isFootball ? ' is-minor' : ''}">${column(away)}${column(home)}</div>` : ''}
      ${!isFootball && statRows ? statRows : ''}`;
  }

  /* Both teams' totals read across rather than down: the label in the
     middle, each side's number under its own logo. */
  function teamStatRows(sum, away, home, big){
    const byId = id => (sum.teamStats || []).find(t => String(t.id) === String(id));
    const A = byId(away?.id), H = byId(home?.id);
    if(!A || !H) return '';

    const labels = [];
    for(const t of [A, H])
      for(const st of (t.stats || []))
        if(st.label && !labels.includes(st.label)) labels.push(st.label);
    if(!labels.length) return '';

    const val = (t, l) => (t.stats || []).find(x => x.label === l)?.value ?? '—';

    return `<div class="ad-tstats${big ? ' is-big' : ''}">
      <span class="ad-sp-head">Team stats</span>
      <div class="ad-tstat-grid">${labels.slice(0, big ? 8 : 6).map(l => `
        <span class="ad-ts-a">${esc(String(val(A, l)))}</span>
        <span class="ad-ts-l">${esc(l)}</span>
        <span class="ad-ts-h">${esc(String(val(H, l)))}</span>`).join('')}</div>
    </div>`;
  }

  function adPortfolio(host){
    /* Today's percent change is the return over the previous close, which
       Finnhub's quote endpoint has already given us — dp is per-holding, so
       weight to portfolio percent rather than averaging. */
    const hold = Store.get('holdings',[]);
    const movers = (window.Stocks ? Stocks.movers : []) || [];
    if(!hold.length || !movers.length){
      host.innerHTML = `<p class="ad-empty ad-big">No quotes priced today.</p>`;
      return;
    }

    /* Approximate portfolio-weighted today's return.
       Best-effort: without exposing the internal weight calc, use straight
       average of dp values as a headline. */
    const dps = movers.map(m => m.dp).filter(x => x != null);
    const avg = dps.length ? dps.reduce((s,x) => s + x, 0) / dps.length : 0;
    const sign = avg >= 0 ? '+' : '−';

    const gainers = [...movers].filter(m => m.dp > 0).sort((a,b) => b.dp - a.dp).slice(0, 5);
    const losers  = [...movers].filter(m => m.dp < 0).sort((a,b) => a.dp - b.dp).slice(0, 5);

    const col = (label, list, cls, empty) => `
      <div class="ad-col">
        <h3 class="ad-h3">${label}</h3>
        <ul class="ad-list">${list.length ? list.map(m => `
          <li class="ad-row">
            <span class="ad-title">${esc(m.symbol)}</span>
            <span class="${cls} ad-big-sm">${m.dp >= 0 ? '+' : '−'}${Math.abs(m.dp).toFixed(2)}%</span>
          </li>`).join('') : `<li class="ad-empty">${empty}</li>`}</ul>
      </div>`;

    host.innerHTML = `
      <div class="ad-hero">
        <h1 class="ad-h1 ${avg >= 0 ? 'ad-up' : 'ad-down'}">${sign}${Math.abs(avg).toFixed(2)}%</h1>
        <p class="ad-sub">Today across ${dps.length} holdings</p>
      </div>
      <div class="ad-cols is-two">
        ${col('Top gainers', gainers, 'ad-up', 'Nothing green today.')}
        ${col('Top losers',  losers,  'ad-down', 'Nothing red today.')}
      </div>`;
  }

  /* 80% next-two-weeks upcoming, 20% Letterboxd watchlist. Pick fresh each
     AD so a long uptime cycles through the shelf.

     Painted twice: once from whatever is already cached so the screen is
     never empty, then again once the synopsis and the outside ratings have
     been fetched for the film that was picked. */
  function adMovies(host){
    const now = Date.now();
    const soon = ((window.Movies ? Movies.upcoming : []) || [])
      .filter(f => f.date && (new Date(f.date + 'T12:00:00').getTime() - now) < 14*864e5 &&
                              new Date(f.date + 'T12:00:00').getTime() > now - 864e5);
    const watch = (window.Letterboxd ? Letterboxd.decorated() : []) || [];

    const pool = (Math.random() < 0.2 && watch.length) ? 'watch'
               : soon.length ? 'soon' : (watch.length ? 'watch' : null);

    if(!pool){
      host.innerHTML = `<p class="ad-empty ad-big">No films to preview.</p>`;
      return;
    }

    let film;
    if(pool === 'soon'){
      const pick = soon[Math.floor(Math.random() * soon.length)];
      const full = window.Movies ? Movies.byId(pick.id) : null;
      film = {
        id: pick.id,
        slug: '',
        title: pick.title,
        date: pick.date || '',
        year: (pick.date || '').slice(0,4),
        poster: pick.poster ? `https://image.tmdb.org/t/p/w500${pick.poster}`
                            : (full?.poster ? `https://image.tmdb.org/t/p/w500${full.poster}` : ''),
        overview: full?.overview || '',
        cast: full?.cast || [],
        director: full?.director || '',
        genres: full?.genres || pick.genres || [],
        tmdbScore: full?.score ?? pick.score ?? null,
        imdb: full?.imdb || '',
        upcoming: true
      };
    } else {
      const pick = watch[Math.floor(Math.random() * watch.length)];
      film = {
        id: pick.tmdbId || null,
        slug: pick.slug || '',
        title: pick.title,
        date: '',
        year: pick.year || '',
        poster: pick.poster || '',
        overview: pick.overview || '',
        cast: [], director: '',
        genres: pick.genres || [],
        tmdbScore: pick.score ?? null,
        imdb: '',
        upcoming: false
      };
    }

    host.innerHTML = adMovieHtml(film, null);
    enrichMovie(host, film);
  }

  /* Everything the first paint could not know: the synopsis for a film past
     the detail cap, and the two outside scores. */
  async function enrichMovie(host, film){
    try{
      if(film.id && !film.overview && window.Movies){
        const full = await Movies.detail(film.id);
        if(full){
          film.overview = full.overview || film.overview;
          film.director = full.director || film.director;
          film.cast     = full.cast?.length ? full.cast : film.cast;
          film.genres   = full.genres?.length ? full.genres : film.genres;
          film.imdb     = full.imdb || film.imdb;
          film.tmdbScore = film.tmdbScore ?? full.score ?? null;
          if(!film.poster && full.poster) film.poster = `https://image.tmdb.org/t/p/w500${full.poster}`;
          if(host.isConnected) host.innerHTML = adMovieHtml(film, null);
        }
      }

      const rates = {rt:'', lb:null, tmdb:film.tmdbScore};

      /* Letterboxd knows the film by slug; a watchlist pick already has one,
         a TMDB pick gets the title slugified and both spellings tried. */
      if(window.Letterboxd){
        const slugs = film.slug ? [film.slug]
                    : Letterboxd.filmSlug(film.title, film.year);
        for(const s of slugs){
          const r = await Letterboxd.rating(s);
          if(r != null){ rates.lb = r; break; }
        }
      }

      if(window.Movies && film.imdb){
        const o = await Movies.ratings(film.imdb);
        if(o){ rates.rt = o.rt || ''; }
      }

      if(host.isConnected) host.innerHTML = adMovieHtml(film, rates);
    }catch(e){
      console.error('Movie AD enrich failed:', e.message);
    }
  }

  function adMovieHtml(f, rates){
    const relDate = f.date
      ? new Date(f.date + 'T12:00:00').toLocaleDateString(undefined,
          {weekday:'long', month:'long', day:'numeric', year:'numeric'})
      : '';
    /* Both sides at midday, so the difference is a whole number of days
       and "five days out" cannot round to six. */
    const days = f.date ? daysUntil(f.date) : null;
    const countdown = days == null ? ''
      : days <= 0 ? 'Out now'
      : days === 1 ? 'Out tomorrow'
      : `Out in ${days} days`;

    /* All three always render — an em dash reads as "not scored yet", a
       missing row reads as a bug. */
    const rate = (label, val) => `
      <span class="ad-rate"><i>${label}</i><b>${val || '&mdash;'}</b></span>`;

    return `
      <div class="ad-movie">
        ${f.poster
          ? `<img class="ad-poster" src="${esc(f.poster)}" alt="">`
          : `<div class="ad-poster ad-noart">🎬</div>`}
        <div class="ad-movie-info">
          <h1 class="ad-h1">${esc(f.title)}</h1>
          <p class="ad-sub">${esc(String(f.year || ''))}${
            f.genres?.length ? ` · ${esc(f.genres.join(', '))}` : ''}${
            f.upcoming ? '' : ' · Watchlist'}</p>
          ${f.upcoming && relDate
            ? `<p class="ad-release"><b>${esc(countdown)}</b> · ${esc(relDate)}</p>` : ''}
          <div class="ad-rates">
            ${rate('Rotten Tomatoes', rates?.rt)}
            ${rate('Letterboxd', rates?.lb != null ? `${rates.lb.toFixed(1)}/5` : '')}
            ${rate('TMDB', f.tmdbScore ? f.tmdbScore.toFixed(1) : '')}
          </div>
          ${f.director ? `<p class="ad-line"><i>Directed by</i> ${esc(f.director)}</p>` : ''}
          ${f.cast?.length ? `<p class="ad-line"><i>Starring</i> ${esc(f.cast.join(', '))}</p>` : ''}
          <p class="ad-overview">${esc(f.overview) || 'No synopsis published for this film yet.'}</p>
        </div>
      </div>`;
  }

  function adNotes(host){
    const todayKey = keyOf(new Date());
    const all = Store.get('notes', []) || [];
    /* Closest note whose day is today or later and that is still open. */
    const upcoming = all
      .filter(n => n.day && !n.done && n.day >= todayKey)
      .sort((a,b) => (a.day || '').localeCompare(b.day || ''));

    if(!upcoming.length){
      host.innerHTML = `<p class="ad-empty ad-big">No upcoming notes.</p>`;
      return;
    }
    const n = upcoming[0];
    const day = new Date(n.day + 'T12:00:00');
    const when = sameDay(day, new Date()) ? 'Today'
               : day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    const days = Math.round((day - new Date(new Date().toDateString())) / 864e5);
    const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

    host.innerHTML = `
      <div class="ad-note-card" style="--note:${esc(n.color || 'var(--accent)')}">
        <p class="ad-sub">${esc(when)} · ${esc(rel)}</p>
        <p class="ad-note-text">${esc(n.text || '(empty note)')}</p>
      </div>`;
  }

  function adFantasy(host){
    /* Thu–Mon (day 4,5,6,0,1) shows the current matchup. Tue–Wed (2,3)
       shows the future matchup — the next week's board is what the user
       is planning for on those mid-week days. */
    const dow = new Date().getDay();
    const isFuture = dow === 2 || dow === 3;
    host.innerHTML = `<p class="ad-empty ad-big">Loading matchup…</p>`;

    if(!window.Fantasy || !Store.get('fantasy.league','')){
      host.innerHTML = `<p class="ad-empty ad-big">Fantasy not set up.</p>`;
      return;
    }

    Fantasy.matchup({weekOffset: isFuture ? 1 : 0})
      .then(m => {
        if(!m){ host.innerHTML = `<p class="ad-empty ad-big">No matchup this week.</p>`; return; }

        /* Every starter, not the top three: on a full screen the whole
           lineup is the interesting part — who is carrying it and who has
           not played yet. */
        const side = s => `
          <div class="ad-ff-side${s.mine ? ' is-mine' : ''}">
            <div class="ad-ff-head">
              ${s.logo ? `<img class="ad-ff-logo" src="${esc(s.logo)}" alt="">` : ''}
              <div>
                <p class="ad-ff-team">${esc(s.name)}</p>
                <p class="ad-ff-score">${(s.score || 0).toFixed(1)}</p>
              </div>
            </div>
            <ul class="ad-ff-line">${(s.starters || s.top || []).map(p => `
              <li>
                <span class="ad-ff-pos">${esc(p.pos)}</span>
                <span class="ad-ff-name">${esc(p.name)}</span>
                <span class="ad-ff-pts">${p.points.toFixed(1)}</span>
              </li>`).join('')}</ul>
          </div>`;

        host.innerHTML = `
          <div class="ad-hero">
            <h1 class="ad-h1">Week ${m.week}${isFuture ? ' · Preview' : ''}</h1>
            <p class="ad-sub">${isFuture ? 'Next week matchup' : 'Current matchup'}</p>
          </div>
          <div class="ad-ff-vs">${side(m.away)}<span class="ad-ff-dash">vs</span>${side(m.home)}</div>`;
      })
      .catch(e => {
        host.innerHTML = `<p class="ad-empty ad-big">Matchup unavailable (${esc(e.message)}).</p>`;
      });
  }

  const keyOf = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };

  /* ---- wiring ---- */
  function boot(){
    /* Interaction listeners are capture-phase so nothing else can swallow
       them. pointerdown covers mouse+touch+pen in one event. Skip and
       toggle buttons live inside #kioskControls and are excluded. */
    const isInternal = target => !!(target && target.closest &&
      (target.closest('#kioskControls') || target.closest('#kioskToggle')));

    document.addEventListener('pointerdown', e => {
      if(!isInternal(e.target)) noteInteraction();
    }, true);
    document.addEventListener('keydown', e => {
      if(!isInternal(e.target)) noteInteraction();
    }, true);
    document.addEventListener('wheel', e => {
      if(!isInternal(e.target)) noteInteraction();
    }, {capture:true, passive:true});

    /* Escape is the way out of every other overlay on the deck, so it is
       the way out of a preview too. */
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && preview) closePreview();
    });

    const t = toggleBtn();
    if(t) t.addEventListener('click', toggle);

    if(Store.get('kiosk.enabled', false)) start();
    updateToggleUi();
  }

  return { boot, start, stop, toggle, previewAd, closePreview,
           /* Settings renders its switches from this. */
           get rotation(){ return ROTATION.map(r => ({...r, on: shown(r.name)})); },
           get enabled(){ return enabled; },
           get previewing(){ return preview; } };
})();

window.Kiosk = Kiosk;
