/* ============================================================
   calendarview.js — the two-week grid that anchors the dashboard.

   Every other source feeds this one view: Google events, followed-team
   games, earnings dates, movie releases, the weather forecast, and any
   sticky note pinned to a day. Each provider is asked for events and is
   allowed to fail — a broken tile costs its own pills, not the grid.

   The window starts on the Sunday of the anchor week so the columns line
   up under fixed weekday headers.
   ============================================================ */

const CalendarView = (() => {
  const grid  = document.getElementById('calGrid');
  const dow   = document.getElementById('calDow');
  const range = document.getElementById('calRange');
  const modal = document.getElementById('dayModal');
  const mBody = document.getElementById('dayModalBody');

  const DAYS = 14;
  let anchor = startOfWeek(new Date());

  function startOfWeek(d){
    const x = new Date(d);
    x.setHours(0,0,0,0);
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
  function today(){ anchor = startOfWeek(new Date()); render(); }

  /* ---- gather ----
     Each source is wrapped: a provider that throws or is not loaded yet
     simply contributes nothing. */
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

    take('games', () => (window.Teams ? Teams.games : []).map(g => ({
      date: new Date(g.kickoff), kind:'game',
      title: `${g.abbr || g.name} ${g.home ? 'vs' : '@'} ${g.opponent}`,
      sub: g.state === 'in' ? `LIVE ${g.score}`
         : g.state === 'post' ? `${g.result === 'win' ? 'W' : 'L'} ${g.score}`
         : new Date(g.kickoff).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),
      where: g.venue
    })));

    take('earnings', () => (window.Stocks ? Stocks.earnings : []).map(e => ({
      date: new Date(e.date + 'T12:00:00'), kind:'earn',
      title: `${e.symbol} earnings`,
      sub: e.hour === 'bmo' ? 'Before open' : e.hour === 'amc' ? 'After close' : ''
    })));

    take('movies', () => (window.Movies ? Movies.releases : []).map(m => ({
      date: new Date(m.date + 'T12:00:00'), kind:'movie',
      title: m.title, sub: 'In theaters', filmId: m.id
    })));

    return out;
  }

  /* ---- render ---- */
  function render(){
    if(!grid) return;

    if(dow && !dow.childElementCount){
      dow.innerHTML = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        .map(d => `<span>${d}</span>`).join('');
    }

    const events = collect();
    const byDay = new Map();
    for(const e of events){
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
    const past = day < new Date(new Date().setHours(0,0,0,0));
    cell.className = `cal-day${isToday(day) ? ' is-today' : ''}${past ? ' is-past' : ''}`;
    cell.dataset.day = k;

    const wx = window.Weather ? Weather.forDay(day) : null;
    events.sort((a,b) => a.date - b.date);

    const notes = window.StickyNotes ? StickyNotes.forDay(k) : [];

    cell.innerHTML = `
      <div class="cal-day-head">
        <span class="cal-num">${day.getDate()}</span>
        ${wx ? `<span class="cal-wx" title="${esc(wx.desc)}">${Weather.glyph(wx.main)}
                 <i>${wx.hi}°<b>${wx.lo}°</b></i></span>` : ''}
      </div>
      <div class="cal-pills">
        ${events.slice(0,4).map(e => `
          <span class="pill pill-${e.kind}" title="${esc(e.title)}${e.sub ? ' · ' + esc(e.sub) : ''}"
                ${e.filmId ? `data-film="${esc(e.filmId)}"` : ''}>${esc(e.title)}</span>`).join('')}
        ${events.length > 4 ? `<span class="pill pill-more">+${events.length-4} more</span>` : ''}
      </div>
      <div class="cal-notes" data-notes="${k}"></div>`;

    const holder = cell.querySelector('.cal-notes');
    notes.forEach(n => holder.appendChild(StickyNotes.noteEl(n, true)));

    /* A movie pill opens the film, anything else opens the day. */
    cell.querySelectorAll('[data-film]').forEach(p => p.onclick = e => {
      e.stopPropagation();
      if(window.Movies) Movies.open(p.dataset.film);
    });

    cell.addEventListener('click', e => {
      if(e.target.closest('.note') || e.target.closest('[data-film]')) return;
      openDay(day, events);
    });

    /* drag and drop: pin a note to this day */
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

  /* ---- day detail ---- */
  function openDay(day, events){
    const wx = window.Weather ? Weather.forDay(day) : null;
    const k = key(day);
    const notes = window.StickyNotes ? StickyNotes.forDay(k) : [];

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
        </div>`).join('')
        : '<p class="empty">Nothing scheduled.</p>'}
      ${notes.length ? `<h3 class="day-sub">Notes</h3><div class="day-notes"></div>` : ''}
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="ghost-btn sm" id="dayAddNote">Add a note here</button>
      </div>`;

    const holder = mBody.querySelector('.day-notes');
    if(holder) notes.forEach(n => holder.appendChild(StickyNotes.noteEl(n, true)));

    mBody.querySelector('#dayAddNote').onclick = () => {
      StickyNotes.add(day);
      close();
    };
    modal.hidden = false;
  }

  const close = () => { modal.hidden = true; };

  return { render, shift, today, close };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.CalendarView = CalendarView;
