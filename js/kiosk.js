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
  const ADS = ['calendar','sports','weather','portfolio','movies','notes','fantasy','menu'];

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
    /* Menu has a tab of its own, but the tab is a planner and the AD is
       a poster — what you are cooking next, big enough to read from the
       kitchen door. It is only ever an AD. */
    {name:'menu',      label:'Menu',      tab:false, ad:true},
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
    fantasy:  adFantasy,
    menu:     adMenu
  };

  /* Only ADs that can be genuinely blank need an entry; everything else
     defaults to "show it". A false return burns the slot — see startAd. */
  const AD_CONTENT_CHECKS = {
    calendar: () => !!calendarWindow(),
    /* Nothing on the watchlist, nothing out soon and nobody watching
       anything: the movie AD would be a blank screen. */
    movies:   () => movieChoices().length > 0,
    /* No reading yet means no forecast to put on a full screen. */
    weather:  () => !!(window.Weather && Weather.current),
    /* Nothing planned, or the backlog has not loaded: a poster for a
       meal that does not exist is worse than one fewer poster. */
    menu:     () => !!(window.Menu && window.Recipes && Recipes.ready && Menu.upNext())
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

  /* ---- what the movie AD can be about ----
     Three sources, one flat list:
       talked — somebody I follow has just logged it
       soon   — out in the next fortnight
       watch  — sitting on the Letterboxd watchlist
     Built as one function because Settings needs the same list the
     rotation picks from: a film that cannot be chosen deliberately is a
     film that cannot be checked before it goes on a wall. */
  function movieChoices(){
    const now = Date.now();
    const out = [], seen = new Set();
    const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

    /* A film appears once. The first group to claim it wins, and the
       groups are added in the order they are worth showing — a watchlist
       film a friend saw last night is news, not a watchlist film. */
    const push = (group, film) => {
      const k = `${norm(film.title)}|${film.year || ''}`;
      if(!film.title || seen.has(k)) return;
      seen.add(k);
      out.push({key:`${group}:${k}`, group, label:film.title +
        (film.year ? ` (${film.year})` : ''), film:{...film, source:group}});
    };

    if(window.Letterboxd){
      for(const r of Letterboxd.talkedAbout(30))
        push('talked', {
          id:null, slug:r.slug || '', title:r.title, date:'', year:r.year || '',
          poster:r.poster || '', overview:'', cast:[], director:'', genres:[],
          tmdbScore:null, imdb:'', upcoming:false
        });
    }

    for(const f of ((window.Movies ? Movies.upcoming : []) || [])){
      if(!f.date) continue;
      const t = new Date(f.date + 'T12:00:00').getTime();
      if(t - now >= 14*864e5 || t <= now - 864e5) continue;
      const full = window.Movies ? Movies.byId(f.id) : null;
      push('soon', {
        id:f.id, slug:'', title:f.title, date:f.date || '',
        year:(f.date || '').slice(0,4),
        poster:f.poster ? `https://image.tmdb.org/t/p/w500${f.poster}`
                        : (full?.poster ? `https://image.tmdb.org/t/p/w500${full.poster}` : ''),
        overview:full?.overview || '', cast:full?.cast || [], director:full?.director || '',
        genres:full?.genres || f.genres || [], tmdbScore:full?.score ?? f.score ?? null,
        imdb:full?.imdb || '', upcoming:true
      });
    }

    for(const f of ((window.Letterboxd ? Letterboxd.decorated() : []) || []))
      push('watch', {
        id:f.tmdbId || null, slug:f.slug || '', title:f.title, date:'',
        year:f.year || '', poster:f.poster || '', overview:f.overview || '',
        cast:[], director:'', genres:f.genres || [], tmdbScore:f.score ?? null,
        imdb:'', upcoming:false
      });

    return out;
  }

  /* Which group a pass draws from. Something a friend just watched beats
     a release date, which beats the undifferentiated pile — but every
     group keeps a real share so a long uptime cycles the shelf. The
     weights are renormalised over whichever groups have anything in them,
     so an empty diary simply hands its share to the others. */
  const MOVIE_MIX = {talked:.45, soon:.35, watch:.20};

  function pickMovie(all){
    const groups = Object.keys(MOVIE_MIX).filter(g => all.some(c => c.group === g));
    if(!groups.length) return null;
    const total = groups.reduce((n,g) => n + MOVIE_MIX[g], 0);
    let r = Math.random() * total;
    let group = groups[groups.length - 1];
    for(const g of groups){ r -= MOVIE_MIX[g]; if(r <= 0){ group = g; break; } }
    const pool = all.filter(c => c.group === group);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* Painted twice: once from whatever is already cached so the screen is
     never empty, then again once the synopsis, the credits and the outside
     ratings have come back for the film that was picked. */
  function adMovies(host, opts){
    const all = movieChoices();
    /* A caller can name the film outright — the AD button on a film's
       popup, or a diary entry on the Movies tab. It may well be a film
       that is on none of the three shelves (an old favourite, something
       out of range), so a title is enough to build an AD from and the
       enrich pass fills in the rest. */
    const choice = namedMovie(opts, all) || pickMovie(all);
    if(!choice){
      host.innerHTML = `<p class="ad-empty ad-big">No films to preview.</p>`;
      return;
    }

    const film = {...choice.film};
    film.saids = reviewsOf(film);
    host.innerHTML = adMovieHtml(film, null);
    enrichMovie(host, film);
  }

  /* The film a caller asked for by name, if they asked for one. A title
     already on a shelf is used as-is so it keeps its poster and its
     credits; anything else becomes a film of its own. */
  function namedMovie(opts, all){
    if(!opts) return null;
    if(opts.film){
      const hit = all.find(c => c.key === opts.film);
      if(hit) return hit;
    }
    if(!opts.title) return null;

    const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const year = opts.year ? String(opts.year) : '';
    const known = all.find(c => norm(c.film.title) === norm(opts.title) &&
      (!year || !c.film.year || String(c.film.year) === year));
    if(known) return known;

    return {key:'', group:'picked', label:opts.title, film:{
      id:opts.tmdbId || null, slug:opts.slug || '', title:opts.title,
      date:'', year:year, poster:opts.poster || '', overview:'',
      cast:[], director:'', genres:[], tmdbScore:null, imdb:'',
      upcoming:false, source:'picked'
    }};
  }

  /* Every diary entry anyone has written about this film — mine and the
     network's. The AD has room for all of them, and a film four people
     have seen IS the interesting one. */
  function reviewsOf(film){
    if(!window.Letterboxd) return [];
    return Letterboxd.reviewsFor(film.title, film.year, film.slug);
  }

  /* Everything the first paint could not know: a TMDB id for a film only
     the diary knew about, the synopsis and credits behind it, and the two
     outside scores. */
  async function enrichMovie(host, film){
    try{
      /* A film the network watched comes with a title and nothing else.
         One search turns that into the id every other lookup needs —
         without it the AD has no director, no plot and no RT score. */
      if(!film.id && window.Movies)
        film.id = await Movies.find(film.title, film.year);

      if(film.id && window.Movies && (!film.overview || !film.director)){
        const full = await Movies.detail(film.id);
        if(full){
          film.overview = full.overview || film.overview;
          film.director = full.director || film.director;
          film.cast     = full.cast?.length ? full.cast : film.cast;
          film.genres   = full.genres?.length ? full.genres : film.genres;
          film.imdb     = full.imdb || film.imdb;
          film.year     = film.year || (full.date || '').slice(0,4);
          film.tmdbScore = film.tmdbScore ?? full.score ?? null;
          if(!film.poster && full.poster) film.poster = `https://image.tmdb.org/t/p/w500${full.poster}`;
          if(host.isConnected) host.innerHTML = adMovieHtml(film, null);
        }
      }

      const rates = {rt:'', lb:null, tmdb:film.tmdbScore};

      film.saids = reviewsOf(film);

      /* Letterboxd knows the film by slug; a watchlist pick already has one,
         a TMDB pick gets the title slugified and both spellings tried. */
      if(window.Letterboxd){
        rates.lb = film.slug
          ? await Letterboxd.rating(film.slug)
          : await Letterboxd.ratingFor(film.title, film.year);
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

  /* Letterboxd rates in halves and so does this: rounding 4.5 up to five
     stars misreports what someone gave a film. Only the stars given are
     drawn — the hollow remainder read as part of the score. */
  function starsOf(n){
    if(n == null) return '';
    const full = Math.floor(n), half = n - full >= .5;
    return '★'.repeat(full) + (half ? '½' : '');
  }

  const whoOf = r => r.who || (window.Letterboxd && Letterboxd.username) || 'you';

  /* Everyone who has written about the film, quoted: who said it, what
     they gave it, and the words if there were any. The loved and the
     loathed are marked so each quote agrees with the sticker above it. */
  function saidsHtml(saids){
    const rows = (saids || []).slice(0, 5);
    if(!rows.length) return '';
    const LOVE = window.Letterboxd ? Letterboxd.LOVE : 4.1;
    const HATE = window.Letterboxd ? Letterboxd.HATE : 2.9;
    return `<div class="ad-saids">${rows.map(r => `
      <blockquote class="ad-said${r.rated >= LOVE ? ' is-gold' : ''}${
        r.rated != null && r.rated <= HATE ? ' is-poop' : ''}">
        <span class="ad-said-head">${esc(whoOf(r))}${
          r.rated != null ? ` <em>${starsOf(r.rated)}</em>` : ''}</span>
        ${r.review ? `<span class="ad-said-text">${esc(r.review)}</span>` : ''}
      </blockquote>`).join('')}</div>`;
  }

  /* A column of stickers down one edge of the poster — medals on the
     left, the other thing on the right, one per person who said so, each
     carrying the name that earned it. */
  function markStack(kind, rows){
    if(!rows.length) return '';
    const mark = kind === 'gold'
      ? (window.Letterboxd ? Letterboxd.GOLD_MARK : '🥇')
      : (window.Letterboxd ? Letterboxd.POOP_MARK : '💩');
    return `<span class="ad-marks is-${kind}">${rows.map(r => `
      <span class="ad-mark${r.crowd ? ' is-crowd' : ''}"
            title="${esc(whoOf(r))} rated it ${r.rated}">${mark}<i>${
        esc(whoOf(r))}</i></span>`).join('')}</span>`;
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

    /* Everyone who rated it, with the crowd counted as one more voice:
       the site-wide average is an opinion like any other, so Letterboxd
       earns a sticker on the same thresholds my friends do.

       Every reviewer gets their own sticker rather than only the loudest
       one — three friends calling a film a masterpiece is three medals,
       and collapsing that to one threw away the whole point. */
    const LOVE = window.Letterboxd ? Letterboxd.LOVE : 4.1;
    const HATE = window.Letterboxd ? Letterboxd.HATE : 2.9;
    const rated = (f.saids || []).filter(r => r.rated != null);
    const voices = rates?.lb != null
      ? [...rated, {who:'Letterboxd', rated:rates.lb, crowd:true}]
      : rated;

    const loved  = voices.filter(r => r.rated >= LOVE);
    const loathed = voices.filter(r => r.rated <= HATE);

    const source = f.upcoming ? ''
      : f.source === 'talked' ? ' · Just watched'
      : f.source === 'picked' ? ''
      : ' · Watchlist';

    return `
      <div class="ad-movie${loved.length ? ' is-gold' : ''}">
        <div class="ad-poster-wrap">
          ${f.poster
            ? `<img class="ad-poster" src="${esc(f.poster)}" alt="">`
            : `<div class="ad-poster ad-noart">🎬</div>`}
          ${markStack('gold', loved)}
          ${markStack('poop', loathed)}
        </div>
        <div class="ad-movie-info">
          <h1 class="ad-h1">${esc(f.title)}</h1>
          <p class="ad-sub">${esc(String(f.year || ''))}${
            f.genres?.length ? ` · ${esc(f.genres.join(', '))}` : ''}${source}</p>
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
          ${saidsHtml(f.saids)}
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

  /* ---- Menu ----
     The next meal, as a poster: everything that goes in down the left,
     everything you do down the right, the shot across the top, and a
     sticky note stuck over the corner when something has to come out of
     the freezer first.

     The freezer note is the part that earns the screen. A plan that says
     "chicken thighs — in the kitchen" is technically right and
     practically useless when the chicken is a brick, and the moment to
     learn that is while walking past at breakfast, not when the pan is
     already hot.

     The picture is deliberately its own column rather than a banner
     above the columns: as a banner it pushed the ingredients and the
     method down the screen until the fit pass shrank the words to
     nothing, which on a wall display means the poster stops being
     readable exactly when the recipe gets interesting. */
  function adMenu(host){
    const up = Menu.upNext();
    if(!up){
      host.innerHTML = `<p class="ad-empty ad-big">Nothing on the menu.</p>`;
      return;
    }
    const {recipe: r, match: m, frozen, entry} = up;

    const day  = new Date(up.dateKey + 'T12:00:00');
    const days = daysUntil(up.dateKey);
    const when = days <= 0 ? 'Tonight' : days === 1 ? 'Tomorrow'
               : day.toLocaleDateString(undefined, {weekday:'long'});

    const n = r.nutrition || {};
    const meta = [
      up.slotLabel,
      entry.servings ? `${entry.servings} servings` : '',
      r.minutes ? `${r.minutes} min` : '',
      n.kcal ? `${Math.round(n.kcal).toLocaleString()} kcal each` : ''
    ].filter(Boolean).join('  ·  ');

    const thaw = frozen.length ? (() => {
      const names = frozen.map(i => i.label || i.key);
      const list = names.length === 1 ? names[0]
        : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      return `
        <aside class="ad-menu-note">
          <span class="ad-menu-pin" aria-hidden="true"></span>
          <b>Thaw ${esc(list)}</b>
          <span>${esc(days <= 0 ? 'Get it out now' : when + "'s dinner")} — ${names.length === 1 ? 'it is' : 'they are'} in the freezer.</span>
        </aside>`;
    })() : '';

    const shortOf = new Map((m.short || []).map(x => [x.key, x]));
    const gone = new Set([...m.missing, ...m.staples].map(x => x.key));

    const ings = (r.ingredients || []).map(i => {
      const state = shortOf.has(i.key) ? 'short' : gone.has(i.key) ? 'missing' : 'have';
      const amount = i.qty != null ? Food.amount(i.qty, i.unit || 'ea') : '';
      return `<li class="is-${state}">
                ${amount ? `<i>${esc(amount)}</i> ` : ''}${esc(Food.pretty(i.item, i.key))}
              </li>`;
    }).join('');

    host.innerHTML = `
      <div class="ad-menu${frozen.length ? ' has-note' : ''}">
        ${thaw}
        <div class="ad-menu-head">
          <div class="ad-menu-title">
            <p class="ad-sub">${esc(when)} · ${esc(day.toLocaleDateString(undefined,{month:'long', day:'numeric'}))}</p>
            <h1 class="ad-h1">${esc(r.title)}</h1>
            <p class="ad-menu-meta">${esc(meta)}</p>
          </div>
          ${r.image
            ? `<div class="ad-menu-shot"><img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer"></div>`
            : ''}
        </div>
        <div class="ad-menu-cols">
          <section>
            <h3 class="ad-h3">In it${m.need ? ` · ${m.need} to buy` : ''}</h3>
            <ul class="ad-menu-ing">${ings}</ul>
          </section>
          <section>
            <h3 class="ad-h3">Method</h3>
            <ol class="ad-menu-steps" id="adMenuSteps"><li>…</li></ol>
          </section>
        </div>
      </div>`;

    /* The method lives in a shard. The poster is already on screen; the
       steps drop in when they land, and the fit pass is watching for
       exactly that. */
    Recipes.details(r.id).then(d => {
      const ol = document.getElementById('adMenuSteps');
      if(!ol) return;
      ol.innerHTML = d.steps.length
        ? d.steps.map(x => `<li>${esc(x)}</li>`).join('')
        : `<li>The method is on ${esc(r.source || 'the original page')}.</li>`;
    }).catch(() => {});
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

  return { boot, start, stop, toggle, previewAd, closePreview, movieChoices,
           /* Settings renders its switches from this. */
           get rotation(){ return ROTATION.map(r => ({...r, on: shown(r.name)})); },
           get enabled(){ return enabled; },
           get previewing(){ return preview; } };
})();

window.Kiosk = Kiosk;
