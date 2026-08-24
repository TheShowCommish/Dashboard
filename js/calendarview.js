/* ============================================================
   calendarview.js — the two-week grid, plus the focus strip beneath it.

   The grid stays deliberately sparse: a weather glyph, event pills, and
   pinned notes. Anything that needs room — a game preview, movie posters,
   a fantasy scoreboard — renders in the focus strip below for whichever
   day is selected, so the grid itself can stay large and readable.

   Game schedules for every followed team are loaded once and indexed by
   day, because the grid needs the whole fortnight, not just the next game.
   ============================================================ */

const CalendarView = (() => {
  const grid  = document.getElementById('calGrid');
  const dow   = document.getElementById('calDow');
  const range = document.getElementById('calRange');
  const modal = document.getElementById('dayModal');
  const mBody = document.getElementById('dayModalBody');

  const fTitle  = document.getElementById('focusTitle');
  const fGames  = document.getElementById('focusGames');
  const fMovies = document.getElementById('focusMovies');
  const fFant   = document.getElementById('focusFantasy');
  const fEmpty  = document.getElementById('focusEmpty');

  const DAYS = 14;
  let anchor = startOfWeek(new Date());
  let focus  = startOfDay(new Date());
  let allGames = [];            // every followed team's schedule
  let gameIdx  = 0;             // which game of the focus day is showing

  /* The focus strip runs unattended on a wall screen: the game previews
     advance themselves on this timer, and the poster row crawls on a CSS
     animation. The handle lives here so a repaint clears the old timer. */
  let gameTimer  = null;
  const GAME_MS  = 12000;

  /* Nothing animates while the calendar is not the visible tab. */
  const calVisible = () => {
    const v = document.getElementById('view-calendar');
    return !!v && !v.hidden;
  };

  function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function startOfWeek(d){
    const x = startOfDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  const key = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };
  const isToday = d => key(d) === key(new Date());

  function shift(weeks){
    anchor = new Date(anchor);
    anchor.setDate(anchor.getDate() + weeks*7);
    render();
  }
  function today(){
    anchor = startOfWeek(new Date());
    select(new Date());
  }

  function select(day){
    focus = startOfDay(day);
    gameIdx = 0;
    render();
    renderFocus();
  }

  /* ---- game schedules ---- */
  async function loadGames(){
    const teams = Sports.teams();
    const out = [];
    for(const t of teams){
      try{ out.push(...await Sports.schedule(t)); }
      catch(e){ console.error('Schedule failed for', t.name, e.message); }
    }
    allGames = out;
    render();
    renderFocus();
  }

  const gamesOn = d => allGames.filter(g => key(new Date(g.kickoff)) === key(d))
                               .sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff));
  const moviesOn = d => (window.Movies ? Movies.releases : [])
                          .filter(m => m.date === key(d));

  /* ---- gather pills ---- */
  function collect(){
    const out = [];
    const take = (label, fn) => {
      try{ out.push(...(fn() || [])); }
      catch(e){ console.error(`Calendar source "${label}" failed:`, e); }
    };

    take('google', () => (window.Calendar ? Calendar.events : []).map(e => ({
      date: e.start, kind:'google', title: e.title,
      sub: e.allDay ? 'All day' : e.start.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),
      where: e.where
    })));

    take('games', () => allGames.map(g => ({
      date: new Date(g.kickoff), kind:'game',
      title: `${g.abbr || g.teamName} ${g.home ? 'vs' : '@'} ${g.opp.abbr || g.opponent}`,
      sub: g.state === 'in' ? `LIVE ${g.score}`
         : g.state === 'post' ? `${g.result === 'win' ? 'W' : 'L'} ${g.score}`
         : new Date(g.kickoff).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
    })));

    take('earnings', () => (window.Stocks ? Stocks.earnings : []).map(e => ({
      date: new Date(e.date + 'T12:00:00'), kind:'earn',
      title: `${e.symbol} earnings`,
      sub: e.hour === 'bmo' ? 'Before open' : e.hour === 'amc' ? 'After close' : ''
    })));

    return out;
  }

  /* ---- grid ---- */
  function render(){
    if(!grid) return;

    if(dow && !dow.childElementCount){
      dow.innerHTML = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        .map(d => `<span><b>${d.slice(0,3)}</b><i>${d}</i></span>`).join('');
    }

    const byDay = new Map();
    for(const e of collect()){
      if(!e.date || isNaN(e.date)) continue;
      const k = key(e.date);
      if(!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }

    const first = new Date(anchor);
    const last  = new Date(anchor); last.setDate(last.getDate() + DAYS - 1);
    if(range){
      const fmt = d => d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
      range.textContent = `${fmt(first)} – ${fmt(last)}`;
    }

    grid.innerHTML = '';
    for(let i = 0; i < DAYS; i++){
      const day = new Date(anchor);
      day.setDate(day.getDate() + i);
      grid.appendChild(dayCell(day, (byDay.get(key(day)) || [])));
    }
  }

  function dayCell(day, events){
    const k = key(day);
    const cell = document.createElement('div');
    const past = day < startOfDay(new Date());
    cell.className = `cal-day${isToday(day) ? ' is-today' : ''}${past ? ' is-past' : ''}` +
                     `${key(day) === key(focus) ? ' is-focus' : ''}`;
    cell.dataset.day = k;

    const wx = window.Weather ? Weather.forDay(day) : null;
    events.sort((a,b) => a.date - b.date);
    const notes = window.StickyNotes ? StickyNotes.forDay(k) : [];

    /* Films live in the carousel below, not on the grid — a marker keeps
       the day discoverable without eating a row. */
    const films = moviesOn(day).length;

    cell.innerHTML = `
      <div class="cal-day-head">
        <span class="cal-num">${day.getDate()}</span>
        <span class="cal-marks">
          ${films ? `<span class="mark mark-movie" title="${films} release${films>1?'s':''}">🎬</span>` : ''}
          ${wx ? `<span class="cal-wx" title="${esc(wx.desc)}">${Weather.glyph(wx.main)}
                   <i>${wx.hi}°<b>${wx.lo}°</b></i></span>` : ''}
        </span>
      </div>
      <div class="cal-pills">
        ${events.slice(0,5).map(e => `
          <span class="pill pill-${e.kind}" title="${esc(e.title)}${e.sub ? ' · ' + esc(e.sub) : ''}">${esc(e.title)}</span>`).join('')}
        ${events.length > 5 ? `<span class="pill pill-more">+${events.length-5} more</span>` : ''}
      </div>
      <div class="cal-notes"></div>`;

    const holder = cell.querySelector('.cal-notes');
    notes.forEach(n => holder.appendChild(StickyNotes.noteEl(n, true)));

    cell.addEventListener('click', e => {
      if(e.target.closest('.note')) return;
      select(day);
    });
    cell.addEventListener('dblclick', e => {
      if(e.target.closest('.note')) return;
      openDay(day, events);
    });

    cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drop-on'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-on'));
    cell.addEventListener('drop', e => {
      e.preventDefault();
      cell.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/plain');
      if(id) StickyNotes.assign(id, day);
    });

    return cell;
  }

  /* ---- focus strip ---- */
  function renderFocus(){
    if(!fTitle) return;

    fTitle.textContent = isToday(focus)
      ? `Today · ${focus.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})}`
      : focus.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'});

    renderFantasy();
    renderGames();
    renderMovies();

    const anything = !fFant.hidden || fGames.childElementCount || fMovies.childElementCount;
    if(fEmpty) fEmpty.hidden = !!anything;
  }

  /* Sundays and Mondays get the fantasy scoreboard. */
  function renderFantasy(){
    const dayNo = focus.getDay();
    const show = (dayNo === 0 || dayNo === 1) && window.Fantasy && Store.get('fantasy.league','');
    if(!show){ fFant.hidden = true; fFant.innerHTML = ''; return; }

    fFant.hidden = false;
    fFant.innerHTML = '<div class="ff-board"><p class="empty">Loading fantasy…</p></div>';

    Fantasy.matchup()
      .then(m => {
        if(!m){ fFant.hidden = true; return; }
        /* Score only. The lineup is a full screen's worth of reading and
           it has one — the fantasy AD — while this panel shares its height
           with a game preview and a poster row. */
        const side = s => `
          <div class="ff-side${s.mine ? ' is-mine' : ''}">
            <span class="ff-team">${esc(s.name)}</span>
            <span class="ff-score">${s.score.toFixed(1)}</span>
          </div>`;
        fFant.innerHTML = `
          <div class="ff-board">
            <div class="ff-head">Week ${m.week} matchup</div>
            <div class="ff-vs">${side(m.away)}<span class="ff-dash">vs</span>${side(m.home)}</div>
          </div>`;
      })
      .catch(e => {
        console.error('Fantasy matchup failed:', e.message);
        fFant.innerHTML = `<div class="ff-board"><p class="empty">Fantasy unavailable (${esc(e.message)}).</p></div>`;
      });
  }

  /* One preview at a time, with dots when a day holds several. */
  function renderGames(){
    if(gameTimer){ clearInterval(gameTimer); gameTimer = null; }
    const games = gamesOn(focus);
    fGames.innerHTML = '';
    if(!games.length) return;

    if(gameIdx >= games.length) gameIdx = 0;

    const wrap = document.createElement('div');
    wrap.className = 'gc-wrap';

    const stage = document.createElement('div');
    stage.className = 'gc-stage';
    stage.appendChild(GameCard.shell(games[gameIdx]));
    wrap.appendChild(stage);

    if(games.length > 1){
      const dots = document.createElement('div');
      dots.className = 'gc-dots';
      dots.innerHTML = games.map((g,i) => `
        <button class="gc-dot${i === gameIdx ? ' is-on' : ''}" data-i="${i}"
                aria-label="${esc(g.abbr || g.teamName)} game" title="${esc(g.teamName)} ${g.home?'vs':'@'} ${esc(g.opponent)}"></button>`).join('');
      dots.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        gameIdx = +b.dataset.i;
        renderGames();        // also restarts the rotation from this game
      });
      wrap.appendChild(dots);

      /* Hold on the one being read: a pointer anywhere over the card
         pauses the carousel until it leaves. */
      let held = false;
      wrap.addEventListener('pointerenter', () => { held = true; });
      wrap.addEventListener('pointerleave', () => { held = false; });

      gameTimer = setInterval(() => {
        if(held || !calVisible() || !wrap.isConnected) return;
        gameIdx = (gameIdx + 1) % games.length;
        renderGames();
      }, GAME_MS);
    }

    fGames.appendChild(wrap);
  }

  /* Poster crawl for the focus day. Same mechanism as the market ticker
     below it: two identical copies of the row translated by exactly half
     their width, so the loop never seams and nothing has to be measured.
     A CSS animation also keeps running when a timer-driven scroll would
     not, which matters on a screen nobody is sitting in front of. */
  function renderMovies(){
    const films = moviesOn(focus);
    fMovies.innerHTML = '';
    if(!films.length) return;

    const card = f => {
      const full = Movies.byId(f.id);
      const art = full?.poster
        ? `<img class="car-art" src="https://image.tmdb.org/t/p/w342${esc(full.poster)}" alt="" loading="lazy">`
        : '<div class="car-art car-noart">🎬</div>';
      const genres = (full?.genres || []).join(' · ');
      return `<button class="car-item" data-film="${esc(f.id)}" title="${esc(f.title)}">
        ${art}
        <span class="car-title">${esc(f.title)}</span>
        ${genres ? `<span class="car-sub">${esc(genres)}</span>` : ''}
        ${full?.director ? `<span class="car-sub">${esc(full.director)}</span>` : ''}
      </button>`;
    };

    const row = films.map(card).join('');

    const wrap = document.createElement('div');
    wrap.className = 'car';
    wrap.innerHTML = `
      <div class="car-head">
        <span class="pf-h3">Out ${isToday(focus) ? 'today' : 'this day'}</span>
      </div>
      <div class="mv-marquee">
        <div class="mv-track">${row}${row}</div>
      </div>`;

    /* Pace by content so two posters do not race past and twenty do not
       crawl. Only animate when there is more than one — a single poster
       sliding under itself looks broken. */
    const track = wrap.querySelector('.mv-track');
    if(films.length > 1) track.style.animation = `crawl ${Math.max(24, films.length * 7)}s linear infinite`;
    else track.style.animation = 'none';

    wrap.querySelectorAll('[data-film]').forEach(b =>
      b.onclick = () => Movies.open(b.dataset.film));

    fMovies.appendChild(wrap);
  }

  /* ---- day modal (double-click) ---- */
  function openDay(day, events){
    const wx = window.Weather ? Weather.forDay(day) : null;
    const notes = window.StickyNotes ? StickyNotes.forDay(key(day)) : [];

    mBody.innerHTML = `
      <h2>${day.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})}</h2>
      ${wx ? `<p class="day-wx">${Weather.glyph(wx.main)} ${esc(wx.desc)} · ${wx.hi}° / ${wx.lo}°${
        wx.pop > 20 ? ` · ${wx.pop}% rain` : ''}</p>` : ''}
      ${events.length ? events.map(e => `
        <div class="row">
          <span class="row-main">
            <span class="row-title"><span class="dot dot-${e.kind}"></span>${esc(e.title)}</span>
            <span class="row-sub">${esc(e.sub || '')}${e.where ? ` · ${esc(e.where)}` : ''}</span>
          </span>
        </div>`).join('') : '<p class="empty">Nothing scheduled.</p>'}
      ${notes.length ? '<h3 class="day-sub">Notes</h3><div class="day-notes"></div>' : ''}
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="ghost-btn sm" id="dayAddNote">Add a note here</button>
      </div>`;

    const holder = mBody.querySelector('.day-notes');
    if(holder) notes.forEach(n => holder.appendChild(StickyNotes.noteEl(n, true)));
    mBody.querySelector('#dayAddNote').onclick = () => { StickyNotes.add(day); close(); };
    modal.hidden = false;
  }

  const close = () => { modal.hidden = true; };

  return { render, renderFocus, shift, today, select, loadGames, close,
           get focusDay(){ return focus; } };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.CalendarView = CalendarView;
