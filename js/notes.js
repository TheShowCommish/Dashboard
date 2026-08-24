/* ============================================================
   notes.js — sticky notes.

   A note carries an optional day. Unscheduled notes live in the tray
   beside the calendar and can be dragged onto a day; pinned notes render
   inside that day's cell and can be dragged between days or back to the
   tray. Nothing is ever deleted by completing it — the Notes tab is a
   permanent record of every note, when it was pinned, and whether it
   was finished.
   ============================================================ */

const StickyNotes = (() => {
  const tray    = document.getElementById('trayBoard');
  const archive = document.getElementById('notesArchive');
  const countEl = document.getElementById('notesCount');

  const COLORS = ['#F2B705','#4CC9A7','#E5484D','#7AA2F7','#C77DFF','#FF9F43'];

  /* Older saves predate day/done/created, so fill them in on read rather
     than migrating destructively. */
  function all(){
    return Store.get('notes',[]).map(n => ({
      day: null, done: false, created: null, ...n
    }));
  }
  const save = list => Store.set('notes', list);

  const key = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };

  function add(day = null){
    const list = all();
    list.push({
      id: Store.uid(),
      text: '',
      color: COLORS[list.length % COLORS.length],
      tilt: (Math.random()*4 - 2).toFixed(2),
      day: day ? key(day) : null,
      done: false,
      created: new Date().toISOString()
    });
    save(list);
    render();
    /* Focus the note that was just created so it can be typed into. */
    const el = document.querySelector(`[data-note="${list[list.length-1].id}"] .note-text`);
    if(el) el.focus();
  }

  function update(id, patch){
    const list = all();
    const n = list.find(x => x.id === id);
    if(!n) return;
    Object.assign(n, patch);
    save(list);
  }

  function remove(id){
    save(all().filter(n => n.id !== id));
    render();
  }

  function assign(id, day){
    update(id, {day: day ? key(day) : null});
    render();
  }

  const forDay = dayKey => all().filter(n => n.day === dayKey && !n.done);

  /* ---- note element ---- */
  function noteEl(n, compact){
    const el = document.createElement('div');
    el.className = `note${compact ? ' note-sm' : ''}${n.done ? ' is-done' : ''}`;
    el.dataset.note = n.id;
    el.draggable = true;
    el.style.setProperty('--note', n.color);
    if(!compact) el.style.transform = `rotate(${n.tilt}deg)`;

    el.innerHTML = `
      <div class="note-text" contenteditable="plaintext-only"
           role="textbox" aria-label="Note text">${esc(n.text)}</div>
      <div class="note-bar">
        <button class="note-btn" data-done="${n.id}" title="${n.done ? 'Reopen' : 'Mark done'}">${n.done ? '↺' : '✓'}</button>
        <button class="note-btn" data-del="${n.id}" title="Delete">×</button>
      </div>`;

    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', n.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));

    const text = el.querySelector('.note-text');
    text.addEventListener('blur', () => update(n.id, {text: text.textContent.trim()}));
    /* Enter commits instead of inserting a newline — these are one-liners. */
    text.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); text.blur(); }
    });

    el.querySelector(`[data-done="${n.id}"]`).onclick = () => {
      update(n.id, {done: !n.done, doneAt: !n.done ? new Date().toISOString() : null});
      render();
    };
    el.querySelector(`[data-del="${n.id}"]`).onclick = () => remove(n.id);
    return el;
  }

  /* ---- tray (unscheduled) ---- */
  function renderTray(){
    if(!tray) return;
    const loose = all().filter(n => !n.day && !n.done);
    tray.innerHTML = '';
    if(!loose.length){
      tray.innerHTML = '<p class="empty">Nothing loose. New notes land here.</p>';
      return;
    }
    loose.forEach(n => tray.appendChild(noteEl(n, false)));
  }

  /* Dropping anywhere on the tray panel un-pins a note. The whole panel
     is the target, not just the inner board — aiming at a thin strip of
     board between notes is needlessly fiddly. */
  const trayZone = tray ? (tray.closest('.tray') || tray) : null;
  if(trayZone){
    trayZone.addEventListener('dragover', e => { e.preventDefault(); trayZone.classList.add('drop-on'); });
    trayZone.addEventListener('dragleave', e => {
      if(!trayZone.contains(e.relatedTarget)) trayZone.classList.remove('drop-on');
    });
    trayZone.addEventListener('drop', e => {
      e.preventDefault();
      trayZone.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/plain');
      if(id) assign(id, null);
    });
  }

  /* ---- archive tab ---- */
  let filter = 'all';           // all | open | done

  function setFilter(mode){ filter = mode; renderArchive(); }

  function renderArchive(){
    if(!archive) return;
    let list = all();
    if(filter === 'open') list = list.filter(n => !n.done);
    if(filter === 'done') list = list.filter(n => n.done);

    if(countEl) countEl.textContent = all().filter(n => !n.done).length;

    if(!list.length){
      archive.innerHTML = `<p class="empty">${
        filter === 'done' ? 'Nothing marked done yet.' :
        filter === 'open' ? 'No open notes.' : 'No notes yet.'}</p>`;
      return;
    }

    /* Newest first, by the day it was pinned to, then by creation. */
    list.sort((a,b) => (b.day || '').localeCompare(a.day || '')
                    || (b.created || '').localeCompare(a.created || ''));

    archive.innerHTML = `
      <table class="arch-table">
        <thead><tr><th>Note</th><th>Day</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(n => {
          const day = n.day
            ? new Date(n.day + 'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})
            : '<span class="row-sub">unscheduled</span>';
          const made = n.created
            ? new Date(n.created).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'})
            : '—';
          return `<tr class="${n.done ? 'is-done' : ''}">
            <td><span class="arch-dot" style="background:${esc(n.color)}"></span>${esc(n.text) || '<span class="row-sub">(empty)</span>'}</td>
            <td>${day}</td>
            <td class="row-sub">${made}</td>
            <td>${n.done ? '<span class="chip ok">done</span>' : '<span class="chip">open</span>'}</td>
            <td class="arch-acts">
              ${n.day ? `<button class="note-btn" data-aunpin="${n.id}"
                  title="Unpin from ${day.replace(/<[^>]*>/g,'')}">⇱</button>` : ''}
              <button class="note-btn" data-adone="${n.id}">${n.done ? '↺' : '✓'}</button>
              <button class="note-btn" data-adel="${n.id}">×</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;

    archive.querySelectorAll('[data-adone]').forEach(b => b.onclick = () => {
      const n = all().find(x => x.id === b.dataset.adone);
      update(b.dataset.adone, {done: !n.done, doneAt: !n.done ? new Date().toISOString() : null});
      render();
    });
    archive.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => remove(b.dataset.adel));
    /* The calendar tray used to be the drop target for un-pinning a note.
       With the tray gone, that has to live somewhere — here. */
    archive.querySelectorAll('[data-aunpin]').forEach(b => b.onclick = () => {
      assign(b.dataset.aunpin, null);
      renderArchive();
    });
  }

  function render(){
    renderTray();
    renderArchive();
    if(window.CalendarView) CalendarView.render();
  }

  return { add, render, renderArchive, setFilter, forDay, noteEl, assign, key,
           get filterMode(){ return filter; } };
})();


/* ---------------- To-dos ----------------
   Kept as a thin alias so nothing that still calls Todos breaks; tasks
   and sticky notes collapsed into one concept in the redesign. */
const Todos = {
  render(){ /* folded into StickyNotes */ },
  add(text){ if(text && text.trim()) StickyNotes.add(); }
};

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.StickyNotes = StickyNotes;
window.Todos = Todos;
