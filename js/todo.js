/* ============================================================
   todo.js — the To Do tab: a running list of improvement ideas
   for this dashboard.

   Deliberately not the sticky notes: notes are pinned to days and
   expire from usefulness, ideas are a backlog with no date at all.
   Same storage rules as everything else — this browser only.
   ============================================================ */

const TodoList = (() => {
  const body  = document.getElementById('todoBody');
  const count = document.getElementById('todoCount');
  const input = document.getElementById('todoInput');

  const KEY = 'todo.items';

  /* 'all' | 'open' | 'done' — matches the Notes tab's filter idea so the
     two lists behave the same way. */
  let filter = 'open';

  const all = () => Store.get(KEY, []);
  const save = list => { Store.set(KEY, list); render(); };

  function add(text){
    const t = String(text || '').trim();
    if(!t) return;
    save([{id: `t${Date.now()}${Math.random().toString(36).slice(2,6)}`,
           text: t, done: false, at: new Date().toISOString()}, ...all()]);
  }

  function toggle(id){
    save(all().map(i => i.id === id ? {...i, done: !i.done} : i));
  }

  function remove(id){
    save(all().filter(i => i.id !== id));
  }

  function setFilter(mode){ filter = mode; render(); }

  function visible(){
    const list = all();
    if(filter === 'open') return list.filter(i => !i.done);
    if(filter === 'done') return list.filter(i => i.done);
    return list;
  }

  function render(){
    if(!body) return;
    const list = visible();
    const open = all().filter(i => !i.done).length;

    if(count) count.textContent = open ? `${open} open` : 'nothing open';

    if(!list.length){
      body.innerHTML = `<p class="empty">${
        filter === 'done' ? 'Nothing finished yet.'
        : filter === 'open' ? 'No open ideas. Type one above.'
        : 'No ideas yet — type one above and hit Add.'}</p>`;
      return;
    }

    body.innerHTML = `<div class="td-list">${list.map(i => `
      <div class="td-row${i.done ? ' is-done' : ''}" data-id="${esc(i.id)}">
        <button class="td-check" data-act="toggle" aria-label="${
          i.done ? 'Mark as still open' : 'Mark as done'}">${i.done ? '✓' : ''}</button>
        <span class="td-text">${esc(i.text)}</span>
        <span class="td-when">${new Date(i.at).toLocaleDateString(undefined,
          {month:'short', day:'numeric'})}</span>
        <button class="td-x" data-act="remove" aria-label="Delete idea">×</button>
      </div>`).join('')}</div>`;

    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id;
      if(b.dataset.act === 'toggle') toggle(id);
      else remove(id);
    });
  }

  /* Enter adds without reaching for the button — this is a list you add to
     in bursts. */
  function boot(){
    if(!input) return;
    input.addEventListener('keydown', e => {
      if(e.key !== 'Enter') return;
      e.preventDefault();
      add(input.value);
      input.value = '';
    });
  }

  return { boot, render, add, setFilter,
           get filterMode(){ return filter; },
           addFromInput(){ if(input){ add(input.value); input.value = ''; } } };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.TodoList = TodoList;
