/* ============================================================
   notes.js — to-do list and sticky notes.
   These are the two tiles that work with no API key at all.
   ============================================================ */

const Todos = (() => {
  const list  = document.getElementById('todoList');
  const count = document.getElementById('todoCount');

  function render(){
    const items = Store.get('todos',[]);
    count.textContent = items.filter(t => !t.done).length;

    if(!items.length){
      list.innerHTML = '<li><span class="empty">Nothing here yet. Add the first task above.</span></li>';
      return;
    }

    list.innerHTML = items.map(t => `
      <li class="${t.done?'done':''}" data-id="${t.id}">
        <input type="checkbox" ${t.done?'checked':''} aria-label="Mark done">
        <span class="todo-text" contenteditable="true" spellcheck="false">${esc(t.text)}</span>
        <button class="x-btn" aria-label="Delete task">×</button>
      </li>`).join('');

    list.querySelectorAll('li[data-id]').forEach(li => {
      const id = li.dataset.id;
      li.querySelector('input').onchange = e => update(id, {done:e.target.checked});
      li.querySelector('.x-btn').onclick = () => remove(id);
      const txt = li.querySelector('.todo-text');
      txt.onblur = () => {
        const v = txt.textContent.trim();
        if(!v) return remove(id);
        update(id, {text:v}, false);
      };
      txt.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); txt.blur(); } };
    });
  }

  function add(text){
    text = text.trim(); if(!text) return;
    const items = Store.get('todos',[]);
    items.unshift({id:Store.uid(), text, done:false});
    Store.set('todos', items); render();
  }
  function update(id, patch, redraw = true){
    const items = Store.get('todos',[]).map(t => t.id === id ? {...t, ...patch} : t);
    Store.set('todos', items); if(redraw) render(); else count.textContent = items.filter(t=>!t.done).length;
  }
  function remove(id){
    Store.set('todos', Store.get('todos',[]).filter(t => t.id !== id)); render();
  }

  return { render, add };
})();


const StickyNotes = (() => {
  const board  = document.getElementById('noteBoard');
  const COLORS = ['#FFE066','#A0E7A0','#9AD5FF','#FFB3C6','#E4D3FF','#FFD6A5'];

  function render(){
    const notes = Store.get('notes',[]);
    if(!notes.length){
      board.innerHTML = '<p class="empty">No notes on the board. Click “New note” to pin one up.</p>';
      return;
    }

    board.innerHTML = notes.map(n => `
      <div class="note" data-id="${n.id}" style="background:${n.color};--tilt:${n.tilt}deg">
        <button class="note-x" aria-label="Delete note">×</button>
        <textarea placeholder="Write something…" aria-label="Note text">${esc(n.text)}</textarea>
        <div class="swatches">${COLORS.map(c =>
          `<span data-c="${c}" style="background:${c}" title="Change colour"></span>`).join('')}</div>
      </div>`).join('');

    board.querySelectorAll('.note').forEach(el => {
      const id = el.dataset.id;
      const ta = el.querySelector('textarea');
      ta.oninput = () => patch(id, {text: ta.value}, false);
      el.querySelector('.note-x').onclick = () => remove(id);
      el.querySelectorAll('.swatches span').forEach(s =>
        s.onclick = () => patch(id, {color: s.dataset.c}));
    });
  }

  function add(){
    const notes = Store.get('notes',[]);
    notes.push({
      id: Store.uid(), text:'',
      color: COLORS[notes.length % COLORS.length],
      tilt: (Math.random()*4 - 2).toFixed(2)
    });
    Store.set('notes', notes); render();
    const last = board.querySelector('.note:last-child textarea');
    if(last) last.focus();
  }
  function patch(id, p, redraw = true){
    Store.set('notes', Store.get('notes',[]).map(n => n.id === id ? {...n, ...p} : n));
    if(redraw) render();
  }
  function remove(id){
    Store.set('notes', Store.get('notes',[]).filter(n => n.id !== id)); render();
  }

  return { render, add };
})();
