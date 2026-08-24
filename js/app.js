/* ============================================================
   app.js — wiring. Owns the tab router, the clock, the settings
   drawer, and re-evaluates the theme when data changes.

   Every boot step is isolated: a module that fails to load must not
   abort the rest of the wiring, or the page ends up with dead buttons.
   ============================================================ */

const App = (() => {

  /* ---- theme context ---- */
  function recheckTheme(){
    const now = new Date();
    Themes.refresh({
      weather: Weather.current,
      games:   (window.Teams ? Teams.games : []),
      hour:    now.getHours(),
      month:   now.getMonth() + 1
    });
  }

  /* ---- tabs ---- */
  function showTab(name){
    document.querySelectorAll('.tab-btn').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach(v => {
      const on = v.id === `view-${name}`;
      v.hidden = !on;
      v.classList.toggle('is-on', on);
    });
    Store.set('ui.tab', name);

    /* Repaint on entry: a view hidden while its data arrived may be stale. */
    try{
      if(name === 'calendar'){ CalendarView.render(); CalendarView.renderFocus(); }
      if(name === 'sports')    SportsView.render();
      if(name === 'portfolio') Stocks.load();
      if(name === 'notes')     StickyNotes.renderArchive();
      if(name === 'fantasy')   Fantasy.load();
    }catch(e){ console.error(`Tab "${name}" refresh failed:`, e); }
  }

  /* ---- clock ---- */
  function clock(){
    const now = new Date();
    document.getElementById('clockTime').textContent =
      now.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    document.getElementById('clockDate').textContent =
      now.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  }

  /* ---- settings drawer ---- */
  const drawer = document.getElementById('drawer');
  const scrim  = document.getElementById('scrim');

  const FIELDS = {
    k_finnhub:'keys.finnhub', k_twelve:'keys.twelve',
    k_tmdb:'keys.tmdb', k_gclient:'keys.gclient',
    k_wxUrl:'weather.url',
    k_ffLeague:'fantasy.league', k_ffSeason:'fantasy.season',
    k_ffTeam:'fantasy.team', k_ffProxy:'fantasy.proxy',
    k_themeMode:'theme.mode', k_themePick:'theme.pick'
  };

  function openDrawer(){
    const pick = document.getElementById('k_themePick');
    pick.innerHTML = Themes.all.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    for(const [el,path] of Object.entries(FIELDS))
      document.getElementById(el).value = Store.get(path,'');
    /* Show the weather URL actually in use so it can be edited rather
       than retyped from scratch. */
    const wx = document.getElementById('k_wxUrl');
    if(wx && !wx.value) wx.value = Weather.DEFAULT_URL;
    drawer.hidden = false; scrim.hidden = false;
  }

  function closeDrawer(){
    for(const [el,path] of Object.entries(FIELDS))
      Store.set(path, document.getElementById(el).value.trim());
    drawer.hidden = true; scrim.hidden = true;
    refreshAll();
  }

  /* ---- refresh ----
     Each loader is independent: one failing service must not stop the
     others from painting. */
  async function run(label, fn){
    try{ await fn(); }
    catch(e){ console.error(`${label} refresh failed:`, e); }
  }

  async function refreshAll(){
    await run('Weather', () => Weather.load());
    recheckTheme();
    run('Movies',   () => Movies.load());
    run('Stocks',   () => Stocks.load());
    run('Teams',    () => Teams.load());
    run('Schedules',() => CalendarView.loadGames());
    run('Sports',   () => SportsView.render());
    run('Ticker',   () => Ticker.render());
    if(Google.ready){
      run('Calendar', () => Calendar.load());
      run('Mail',     () => Mail.load());
    }
  }

  /* ---- boot ---- */
  function step(label, fn){
    try{ fn(); }
    catch(e){ console.error(`Boot step "${label}" failed:`, e); }
  }

  function on(id, event, handler){
    const el = document.getElementById(id);
    if(!el) return console.error(`Missing element #${id} — handler not attached.`);
    el.addEventListener(event, handler);
  }

  function boot(){
    step('clock', () => { clock(); setInterval(clock, 15000); });
    step('notes', () => StickyNotes.render());
    step('theme', () => recheckTheme());

    step('tabs', () => {
      document.querySelectorAll('.tab-btn').forEach(b =>
        b.addEventListener('click', () => showTab(b.dataset.tab)));
      showTab(Store.get('ui.tab','calendar'));
    });

    on('calPrev','click',  () => CalendarView.shift(-2));
    on('calNext','click',  () => CalendarView.shift(2));
    on('calToday','click', () => CalendarView.today());
    on('dayClose','click', () => CalendarView.close());

    on('headSub','click',      () => Weather.refresh().then(recheckTheme));
    on('btnPfRefresh','click', () => Stocks.refresh());
    on('mvClose','click',      () => Movies.close());
    on('standClose','click',   () => StandingsView.close());
    on('playerClose','click',  () => PlayerLog.close());

    on('btnAddNote','click',  () => StickyNotes.add());
    on('btnAddNote2','click', () => StickyNotes.add());
    on('notesFilter','click', e => {
      const order = ['all','open','done'];
      const next = order[(order.indexOf(StickyNotes.filterMode) + 1) % order.length];
      StickyNotes.setFilter(next);
      e.currentTarget.textContent = `Showing: ${next}`;
    });

    on('btnSettings','click',    openDrawer);
    on('btnCloseDrawer','click', closeDrawer);
    scrim.onclick = closeDrawer;
    on('btnGoogle','click', () => Google.connect());
    on('csvInput','change', e => {
      if(e.target.files[0]) Stocks.ingest(e.target.files[0]);
      e.target.value = '';
    });

    on('btnAddTeam','click',  () => Teams.openPicker());
    on('btnAddTeam2','click', () => Teams.openPicker());
    on('tmCancel','click',    () => Teams.closePicker());
    on('tmSave','click',      () => Teams.saveTeam());
    on('tmLeague','change',   () => Teams.fillTeams());

    on('btnExport','click', () => Store.export());
    on('btnWipe','click', () => {
      if(confirm('Erase every saved key, note, holding and team from this browser?')){
        Store.wipe(); location.reload();
      }
    });

    addEventListener('keydown', e => {
      if(e.key === 'Escape'){
        if(!drawer.hidden) closeDrawer();
        for(const id of ['teamModal','movieModal','dayModal','standModal','playerModal']){
          const el = document.getElementById(id);
          if(el) el.hidden = true;
        }
      }
    });

    step('first refresh', refreshAll);
    step('weather schedule', () => Weather.scheduleNext());   // 6am, noon, 3pm, 6pm, 10pm

    /* Quotes are a daily job, not a ticker. load() no-ops if it already
       priced today, so this hourly poke just catches the date rolling
       over on a dashboard left running. */
    setInterval(() => { Stocks.load(); }, 60*60*1000);
    setInterval(() => { Teams.load(); }, 15*60*1000);
    setInterval(() => { if(Google.ready){ Calendar.load(); Mail.load(); } }, 5*60*1000);

    /* Live games move; re-pull schedules and repaint the focus strip. */
    setInterval(() => {
      Sports.clearCache();
      CalendarView.loadGames();
    }, 5*60*1000);
  }

  return { boot, recheckTheme, refreshAll, showTab };
})();

document.addEventListener('DOMContentLoaded', App.boot);
