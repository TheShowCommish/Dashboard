/* ============================================================
   app.js — wiring. Boots every tile, runs the clock, owns the
   settings drawer, and re-evaluates the theme when data changes.
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
    k_finnhub:'keys.finnhub', k_tmdb:'keys.tmdb', k_gclient:'keys.gclient',
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
    /* Show the URL actually in use, so it can be edited rather than
       retyped from scratch. */
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
     others from painting their tile. */
  async function run(label, fn){
    try{ await fn(); }
    catch(e){ console.error(`${label} refresh failed:`, e); }
  }

  async function refreshAll(){
    await run('Weather', () => Weather.load());
    recheckTheme();
    run('Movies',    () => Movies.load());
    run('Stocks',    () => Stocks.load());
    run('Fantasy',   () => Fantasy.load());
    run('Teams',     () => Teams.load());
    if(Google.ready){
      run('Calendar', () => Calendar.load());
      run('Mail',     () => Mail.load());
    }
  }

  /* ---- boot ---- */
  /* Every step is isolated. A module that fails to load (a bad CDN
     response, a blocked file) used to abort the whole of boot() at the
     first ReferenceError, which left every button on the page unwired —
     including Cancel on the team picker. Now one casualty stays one. */
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

    step('todos',      () => Todos.render());
    step('notes',      () => StickyNotes.render());
    step('theme',      () => recheckTheme());

    on('todoForm','submit', e => {
      e.preventDefault();
      const i = document.getElementById('todoInput');
      Todos.add(i.value); i.value = '';
    });

    on('btnWxRefresh','click', () => Weather.refresh().then(recheckTheme));
    on('mvClose','click',      () => Movies.close());
    on('btnAddNote','click',     () => StickyNotes.add());
    on('btnSettings','click',    openDrawer);
    on('btnCloseDrawer','click', closeDrawer);
    scrim.onclick = closeDrawer;
    on('btnGoogle','click',      () => Google.connect());
    on('csvInput','change', e => {
      if(e.target.files[0]) Stocks.ingest(e.target.files[0]);
      e.target.value = '';
    });

    on('btnAddTeam','click', () => Teams.openPicker());
    on('tmCancel','click',   () => Teams.closePicker());
    on('tmSave','click',     () => Teams.saveTeam());
    on('tmLeague','change',  () => Teams.fillTeams());

    on('btnExport','click', () => Store.export());
    on('btnWipe','click', () => {
      if(confirm('Erase every saved key, note, task, holding and team from this browser?')){
        Store.wipe(); location.reload();
      }
    });

    addEventListener('keydown', e => {
      if(e.key === 'Escape'){
        if(!drawer.hidden) closeDrawer();
        document.getElementById('teamModal').hidden = true;
        document.getElementById('movieModal').hidden = true;
      }
    });

    step('first refresh', refreshAll);
    step('weather schedule', () => Weather.scheduleNext());   // 6am, noon, 3pm, 6pm, 10pm
    setInterval(() => { Stocks.load(); }, 5*60*1000);                       // quotes: 5 min
    setInterval(() => { Teams.load(); }, 15*60*1000);                       // scores: 15 min
    setInterval(() => { if(Google.ready){ Calendar.load(); Mail.load(); } }, 5*60*1000);
  }

  return { boot, recheckTheme, refreshAll };
})();

document.addEventListener('DOMContentLoaded', App.boot);
