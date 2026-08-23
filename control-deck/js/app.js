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
    k_owm:'keys.owm', k_finnhub:'keys.finnhub', k_tmdb:'keys.tmdb', k_gclient:'keys.gclient',
    k_ffLeague:'fantasy.league', k_ffSeason:'fantasy.season',
    k_ffTeam:'fantasy.team', k_ffProxy:'fantasy.proxy',
    k_themeMode:'theme.mode', k_themePick:'theme.pick'
  };

  function openDrawer(){
    const pick = document.getElementById('k_themePick');
    pick.innerHTML = Themes.all.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    for(const [el,path] of Object.entries(FIELDS))
      document.getElementById(el).value = Store.get(path,'');
    drawer.hidden = false; scrim.hidden = false;
  }

  function closeDrawer(){
    for(const [el,path] of Object.entries(FIELDS))
      Store.set(path, document.getElementById(el).value.trim());
    drawer.hidden = true; scrim.hidden = true;
    refreshAll();
  }

  /* ---- refresh ---- */
  async function refreshAll(){
    await Weather.load();
    recheckTheme();
    Movies.load();
    Stocks.load();
    Fantasy.load();
    Teams.load();
    if(Google.ready){ Calendar.load(); Mail.load(); }
  }

  /* ---- boot ---- */
  function boot(){
    clock(); setInterval(clock, 15000);

    document.getElementById('zipInput').value = Store.get('zip','');
    Todos.render();
    StickyNotes.render();
    recheckTheme();

    document.getElementById('zipForm').onsubmit = e => {
      e.preventDefault();
      const z = document.getElementById('zipInput').value.trim();
      if(!/^\d{5}$/.test(z)) return Store.toast('That is not a 5-digit ZIP code.');
      Store.set('zip', z);
      Weather.load().then(recheckTheme);
    };

    document.getElementById('todoForm').onsubmit = e => {
      e.preventDefault();
      const i = document.getElementById('todoInput');
      Todos.add(i.value); i.value = '';
    };

    document.getElementById('btnAddNote').onclick = StickyNotes.add;
    document.getElementById('btnSettings').onclick = openDrawer;
    document.getElementById('btnCloseDrawer').onclick = closeDrawer;
    scrim.onclick = closeDrawer;
    document.getElementById('btnGoogle').onclick = () => Google.connect();
    document.getElementById('csvInput').onchange = e => {
      if(e.target.files[0]) Stocks.ingest(e.target.files[0]);
      e.target.value = '';
    };

    document.getElementById('btnAddTeam').onclick = Teams.openPicker;
    document.getElementById('tmCancel').onclick   = Teams.closePicker;
    document.getElementById('tmSave').onclick     = Teams.saveTeam;
    document.getElementById('tmLeague').onchange  = Teams.fillTeams;

    document.getElementById('btnExport').onclick = Store.export;
    document.getElementById('btnWipe').onclick = () => {
      if(confirm('Erase every saved key, note, task, holding and team from this browser?')){
        Store.wipe(); location.reload();
      }
    };

    addEventListener('keydown', e => {
      if(e.key === 'Escape'){
        if(!drawer.hidden) closeDrawer();
        Teams.closePicker();
      }
    });

    refreshAll();
    setInterval(() => { Weather.load().then(recheckTheme); }, 10*60*1000); // weather: 10 min
    setInterval(() => { Stocks.load(); }, 5*60*1000);                       // quotes: 5 min
    setInterval(() => { Teams.load(); }, 15*60*1000);                       // scores: 15 min
    setInterval(() => { if(Google.ready){ Calendar.load(); Mail.load(); } }, 5*60*1000);
  }

  return { boot, recheckTheme, refreshAll };
})();

document.addEventListener('DOMContentLoaded', App.boot);
