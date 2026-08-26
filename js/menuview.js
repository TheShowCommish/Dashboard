/* ============================================================
   menuview.js — the Menu tab.

   Four screens behind one tab, because they are four questions about
   the same three facts (what we have, what we can make, what we chose):

     Plan     a fortnight of meals, with the suggestion rail under it
     Fridge   what is in the kitchen; add a shop, use things up
     Recipes  the whole backlog, filtered
     Grocery  everything the plan needs that the kitchen has not got

   The rail under the calendar is the part worth explaining. Pick a day
   and a slot, and the rail below re-sorts the entire backlog around the
   meals already on the plan — recipes that reuse the same bunch of
   cilantro, the same tub of yogurt, the same half a cabbage. Clicking
   one drops it straight into the selected slot. Building a week is
   meant to be fourteen clicks in the same place, not fourteen searches.
   ============================================================ */

const MenuView = (() => {

  const body = () => document.getElementById('menuBody');

  const MODES = [
    {id:'next',    label:'Up next'},
    {id:'plan',    label:'Plan'},
    {id:'fridge',  label:'Fridge'},
    {id:'recipes', label:'Recipes'},
    {id:'grocery', label:'Grocery'}
  ];

  /* ---- state that is worth surviving a reload ---- */
  const mode      = () => Store.get('menu.mode', 'next');
  const setMode   = m => { Store.set('menu.mode', m); render(); };
  const startDate = () => new Date(Store.get('menu.start', Menu.iso(new Date())) + 'T00:00:00');
  const selected  = () => Store.get('menu.sel', null);

  /* ---- transient: filters live for the session, not forever ---- */
  let suggestTab = 'reuse';                 // reuse | now | near — now *derived* from scroll
  let filters = {q:'', within:null, cuisine:'', maxMin:0, sort:'best', limit:60};

  /* The rail is one continuous strip and the tab under the cursor is
     whichever stretch of it you have scrolled to. That makes its scroll
     position real state: every repaint rebuilds the strip from scratch,
     and a strip that snapped back to the left every time a meal was
     planned would be unusable. */
  let railScroll = 0;

  /* What is being dragged. The HTML drag API will not let you read
     dataTransfer during dragover — only on drop — so the slot under the
     cursor cannot ask what is coming. It has to have been told. */
  let dragging = null;                      // {kind:'recipe'|'meal', ...}

  const days = () => Menu.fortnight(startDate());

  /* ============================================================
     shared bits
     ============================================================ */

  const dayLabel = d => d.toLocaleDateString(undefined,{weekday:'short'});
  const numLabel = d => d.getDate();
  const isToday  = d => Menu.iso(d) === Menu.iso(new Date());

  function recipeById(id){ return Recipes.byId(id); }

  /* A number nobody has to squint at: 1,240 not 1240.4 */
  const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString());

  function card(match, extra){
    const r = match.recipe || match;
    const need = match.need;
    /* "have it all" has to mean something was checked. A recipe whose
       every line is a staple has nothing to be missing, and saying you
       have all of it before you have put anything in the fridge is the
       planner telling you a thing it does not know. */
    const badge = need === 0
        ? (match.matched ? '<span class="chip ok">have it all</span>'
                         : '<span class="chip">nothing to buy</span>')
        : need != null ? `<span class="chip warn">${need} to buy</span>` : '';
    const shared = match.shared ? `<span class="chip">reuses ${match.shared}</span>` : '';
    const n = r.nutrition || {};
    return `
      <article class="rc" data-recipe="${esc(r.id)}" tabindex="0" draggable="true"
               title="Drag me onto a day, or click to open">
        ${r.image ? `<img class="rc-img" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                  : '<div class="rc-img rc-noimg">🍳</div>'}
        <div class="rc-body">
          <h4 class="rc-title">${esc(r.title)}</h4>
          <p class="rc-meta">${[
              r.minutes ? `${r.minutes} min` : '',
              n.kcal ? `${n0(n.kcal)} kcal` : '',
              r.cuisine || r.category || ''
            ].filter(Boolean).map(esc).join(' · ')}</p>
          <div class="rc-chips">${badge}${shared}${extra || ''}</div>
        </div>
      </article>`;
  }

  /* ============================================================
     Plan
     ============================================================ */

  function planGrid(){
    const sel = selected();
    return `<div class="mv-grid">${days().map(d => {
      const key = Menu.iso(d);
      const m = Menu.macrosPerPerson(d);
      const cells = Menu.SLOTS.map(s => {
        const list = Menu.entries(d, s.id);
        const on = sel && sel.date === key && sel.slot === s.id;
        return `<div class="mv-slot${on ? ' is-sel' : ''}" data-day="${key}" data-slot="${s.id}">
          <span class="mv-slot-tag">${s.label[0]}</span>
          <div class="mv-slot-meals">${list.map(e => {
            const r = recipeById(e.recipeId);
            return `<button class="mv-meal${e.cooked ? ' is-cooked' : ''}" data-entry="${esc(e.id)}"
                      data-day="${key}" data-slot="${s.id}" draggable="true"
                      title="${esc(r ? r.title : 'Missing recipe')}">
                      ${esc(r ? r.title : 'Removed recipe')}</button>`;
          }).join('') || '<span class="mv-slot-empty">—</span>'}</div>
        </div>`;
      }).join('');

      return `<div class="mv-day${isToday(d) ? ' is-today' : ''}" data-day="${key}">
        <div class="mv-day-head">
          <span class="mv-dow">${esc(dayLabel(d))}</span>
          <span class="mv-num">${numLabel(d)}</span>
          ${m.meals ? `<span class="mv-kcal" title="Per person, ${m.people} eating">${n0(m.kcal)}</span>` : ''}
        </div>
        ${cells}
      </div>`;
    }).join('')}</div>`;
  }

  /* The rail: the reason the plan screen is not just a grid.

     One strip, three answers, no seam. The three filters used to be
     three separate lists behind three buttons, which meant three clicks
     to see what was really on offer. Now they are laid end to end in a
     single scroller: keep going right past the end of "reuses your
     week" and you are in "cook tonight" without anything having
     happened. The buttons stop being a switch and become a read-out —
     they light up to say where in the strip you are, and clicking one
     glides you to that stretch rather than redrawing the screen.

     Which means the strip's scroll position is the filter state. Never
     re-render the rail to change the highlighted button; move the
     highlight in place (see markRail) or the strip jumps back to the
     left under your hand. */

  const RAIL_GROUPS = [
    {id:'reuse', label:'Reuses your week'},
    {id:'now',   label:'Cook tonight'},
    {id:'near',  label:'1–2 away'}
  ];

  function railLists(){
    const seeds = Menu.recipesIn(days());
    const have  = Pantry.keys();

    const reuse = seeds.length
      ? Recipes.reusing(seeds, have, {within:2, limit:30})
      : Recipes.cookable(have, 0).slice(0, 30);

    return {
      reuse: {
        list: reuse,
        note: seeds.length
          ? `Sorted by how much they reuse the ${seeds.length} ${seeds.length === 1 ? 'meal' : 'meals'} already on this fortnight.`
          : 'Plan one meal and this stretch fills with everything that shares its ingredients.',
        empty: 'Nothing shares an ingredient with this fortnight yet.'
      },
      now: {
        list: Recipes.cookable(have, 0).slice(0, 30),
        note: 'Nothing to buy — every non-staple ingredient is already in the kitchen.',
        empty: 'Nothing yet. Put a shop away in the Fridge screen and this fills up.'
      },
      near: {
        list: Recipes.cookable(have, 2).filter(m => m.need > 0).slice(0, 30),
        note: 'One or two ingredients short. The missing ones are on each card.',
        empty: 'Nothing within two ingredients of what the kitchen has.'
      }
    };
  }

  function suggestions(){
    const sel = selected();
    const groups = railLists();

    const target = sel
      ? `Adding to <b>${esc(new Date(sel.date + 'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'}))}</b> · ${esc(sel.slot)}`
      : 'Drag a card onto any day — or pick a slot above and click one.';

    const strip = RAIL_GROUPS.map(g => {
      const {list, empty} = groups[g.id];
      return `<div class="mv-rail-group" data-group="${g.id}">${
        list.length
          ? list.map(m => card(m, m.missing && m.missing.length
              ? `<span class="chip" title="${esc(m.missing.map(i => i.item || i.key).join(', '))}">${esc(m.missing.slice(0,2).map(i => i.key).join(', '))}${m.missing.length > 2 ? '…' : ''}</span>`
              : '')).join('')
          : `<p class="mv-rail-blank">${esc(empty)}</p>`
      }</div>`;
    }).join('');

    return `
      <div class="mv-rail">
        <div class="mv-rail-head">
          <nav class="subtabs sm" id="mvRailTabs">
            ${RAIL_GROUPS.map(g =>
              `<button class="ghost-btn sm${suggestTab === g.id ? ' primary' : ''}" data-suggest="${g.id}">${g.label}</button>`).join('')}
          </nav>
          <span class="mv-target">${target}</span>
        </div>
        <p class="empty" id="mvRailNote">${esc(groups[suggestTab].note)}</p>
        <div class="mv-carousel">
          <button class="mv-rail-arrow" data-rail="-1" aria-label="Scroll back">‹</button>
          <div class="mv-rail-strip" id="mvRailStrip">${strip}</div>
          <button class="mv-rail-arrow" data-rail="1" aria-label="Scroll on">›</button>
        </div>
      </div>`;
  }

  /* Which stretch of the strip is under the left edge — the answer the
     buttons are reporting. Measured against the strip's own scroll box
     so it survives zoom, wrapping and a resized window. */
  function railGroupAt(strip){
    const els = [...strip.querySelectorAll('.mv-rail-group')];
    if(!els.length) return suggestTab;
    /* A third of a card in from the left: at a boundary the eye calls
       the strip "the next one" slightly before its first card is flush. */
    const at = strip.scrollLeft + 56;
    let id = els[0].dataset.group;
    for(const el of els) if(el.offsetLeft <= at) id = el.dataset.group;
    return id;
  }

  /* Move the highlight without redrawing anything. Redrawing would reset
     scrollLeft, which is the very thing that decided the highlight. */
  function markRail(id, notes){
    if(id === suggestTab) return;
    suggestTab = id;
    document.querySelectorAll('#mvRailTabs [data-suggest]').forEach(b =>
      b.classList.toggle('primary', b.dataset.suggest === id));
    const note = document.getElementById('mvRailNote');
    if(note && notes && notes[id]) note.textContent = notes[id];
  }

  /* The strip's own behaviour: remember where it was, follow it as it
     moves, and turn a vertical wheel into sideways travel so a plain
     mouse can get from one end to the other. */
  function wireRail(){
    const strip = document.getElementById('mvRailStrip');
    if(!strip) return;

    const notes = {};
    const lists = railLists();
    for(const g of RAIL_GROUPS) notes[g.id] = lists[g.id].note;

    /* `instant`, not a bare assignment: the strip is smooth-scrolling by
       stylesheet, so plain scrollLeft would animate all the way back
       from zero every time the screen repaints. Restoring where you
       were should not look like travelling there. */
    strip.scrollTo({left: railScroll, behavior:'instant'});

    /* Straight through, no rAF. markRail bails out unless the group
       actually changed, so the common scroll tick costs one comparison —
       and the highlight can never lag a frame behind the strip it is
       reporting on. */
    strip.addEventListener('scroll', () => {
      railScroll = strip.scrollLeft;
      markRail(railGroupAt(strip), notes);
    }, {passive:true});

    strip.addEventListener('wheel', e => {
      if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      strip.scrollBy({left: e.deltaY, behavior:'instant'});
    }, {passive:false});

    markRail(railGroupAt(strip), notes);
  }

  /* Glide to a stretch, rather than switching to it. Same strip either
     way — the only difference is that you did not have to drag. */
  function railTo(id){
    const strip = document.getElementById('mvRailStrip');
    const el = strip && strip.querySelector(`.mv-rail-group[data-group="${id}"]`);
    if(!strip || !el) return;
    strip.scrollTo({left: Math.max(0, el.offsetLeft - 4), behavior:'smooth'});
  }

  function renderPlan(){
    const ds = days();
    const range = `${ds[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${ds[13].toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    body().innerHTML = `
      <div class="mv-plan">
        <div class="mv-plan-head">
          <span class="chip">${esc(range)}</span>
          <button class="ghost-btn sm" data-shift="-14">‹ Previous</button>
          <button class="ghost-btn sm" data-shift="0">This week</button>
          <button class="ghost-btn sm" data-shift="14">Next ›</button>
          <span class="mv-spacer"></span>
          <label class="mv-people">Eating
            <input id="mvPeople" type="number" min="1" max="12" value="${esc(String(Store.get('menu.people',2)))}">
          </label>
        </div>
        ${planGrid()}
        ${suggestions()}
      </div>`;
    wireRail();
  }

  /* ============================================================
     Up next — the advert
     ============================================================

     The one screen in this tab that is not a tool. It has a single job:
     you walk past the dashboard at five o'clock and it tells you what
     you are cooking, everything you need down the left, everything you
     do at the right, and a picture so it reads from across the room.

     The sticky note is the part that earns it. A plan that says "chicken
     thighs — in the kitchen" is technically right and practically
     useless when the chicken is a brick at the back of the freezer, and
     the moment to learn that is the morning, not when the pan is hot. So
     anything the recipe needs that is in the freezer gets slapped on the
     front of the ad in the same handwriting you would have used.
     ============================================================ */

  /* Everything the recipe wants that is currently frozen. Matched with
     the same covers() the whole tab matches on, so "chicken" in the
     freezer answers a recipe asking for "chicken thigh". */
  function frozenFor(recipe){
    const cold = Pantry.inLocation('freezer');
    if(!cold.length) return [];
    const out = [], seen = new Set();
    for(const ing of recipe.ingredients || []){
      if(ing.staple || !ing.key) continue;
      for(const item of cold){
        if(!Recipes.covers(item.key, ing.key)) continue;
        if(seen.has(item.key)) break;
        seen.add(item.key);
        out.push(item);
        break;
      }
    }
    return out;
  }

  /* How long before the meal, in whole days — a thaw note that says
     "tomorrow" is worth more than one that says "soon". */
  function whenLabel(date){
    const d = new Date(date); d.setHours(0,0,0,0);
    const t = new Date();    t.setHours(0,0,0,0);
    const days = Math.round((d - t) / 86400000);
    if(days <= 0) return 'Tonight';
    if(days === 1) return 'Tomorrow';
    return d.toLocaleDateString(undefined, {weekday:'long'});
  }

  function thawNote(frozen, date){
    if(!frozen.length) return '';
    const names = frozen.map(i => i.label || Food.pretty(null, i.key));
    const list = names.length === 1 ? names[0]
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    const when = whenLabel(date);
    const lead = when === 'Tonight' ? 'Get it out now' : `${when}'s dinner`;
    return `
      <aside class="mv-ad-note" role="note">
        <span class="mv-ad-note-pin" aria-hidden="true"></span>
        <b>Thaw ${esc(list)}</b>
        <span>${esc(lead)} — ${names.length === 1 ? 'it is' : 'they are'} in the freezer.</span>
      </aside>`;
  }

  async function renderNext(){
    const up = Menu.nextMeal();
    if(!up){
      body().innerHTML = `
        <div class="mv-ad is-blank">
          <p class="empty">Nothing on the menu yet. Plan a meal and this becomes the poster for it.</p>
          <button class="ghost-btn sm primary" data-act="goPlan">Open the plan</button>
        </div>`;
      return;
    }

    const r = recipeById(up.entry.recipeId);
    if(!r){
      body().innerHTML = '<div class="mv-ad is-blank"><p class="empty">The next meal points at a recipe that is no longer in the book.</p></div>';
      return;
    }

    const have = Pantry.keys();
    const m    = Recipes.against(r, have);
    const n    = r.nutrition || {};
    const frozen = frozenFor(r);
    const when = up.date.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});

    /* Drawn once off the index so it is on screen instantly, then the
       method drops into the right-hand column when its shard lands. */
    body().innerHTML = `
      <div class="mv-ad${frozen.length ? ' has-note' : ''}">
        ${thawNote(frozen, up.date)}
        <header class="mv-ad-head">
          <div class="mv-ad-title">
            <p class="mv-ad-eyebrow">${esc(whenLabel(up.date))} · ${esc(when)} · ${esc(up.slotLabel)}</p>
            <h1>${esc(r.title)}</h1>
            <p class="mv-ad-meta">${[
              r.servings ? `serves ${r.servings}` : '',
              up.entry.servings ? `${up.entry.servings} planned` : '',
              r.minutes ? `${r.minutes} min` : '',
              r.cuisine || r.category || '',
              r.source
            ].filter(Boolean).map(esc).join('  ·  ')}</p>
            ${n.kcal ? `<p class="mv-ad-macros"><b>${n0(n.kcal)}</b> kcal &nbsp; ${n0(n.protein)}g protein &nbsp; ${n0(n.carbs)}g carbs &nbsp; ${n0(n.fat)}g fat <i>per serving</i></p>` : ''}
            <div class="mv-ad-actions">
              <button class="ghost-btn sm primary" data-act="cook"
                      data-day="${esc(up.dateKey)}" data-slot="${esc(up.slot)}" data-entry="${esc(up.entry.id)}">Cooked it</button>
              <button class="ghost-btn sm" data-act="openRecipe" data-recipe="${esc(r.id)}">Open the card</button>
              ${r.url ? `<a class="ghost-btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">The original</a>` : ''}
            </div>
          </div>
          ${r.image
            ? `<div class="mv-ad-shot"><img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer"></div>`
            : '<div class="mv-ad-shot mv-ad-noshot">🍳</div>'}
        </header>

        <div class="mv-ad-split">
          <section class="mv-ad-ing">
            <h2>What goes in <span class="chip${m.need ? ' warn' : ' ok'}">${m.need ? `${m.need} still to buy` : 'all in'}</span></h2>
            <ul class="rd-ing" id="mvAdIng">${ingredientList(r, m, null)}</ul>
          </section>
          <section class="mv-ad-steps">
            <h2>What you do</h2>
            <ol class="rd-steps" id="mvAdSteps"><li class="empty">Loading the method…</li></ol>
          </section>
        </div>
      </div>`;

    const detail = await Recipes.details(r.id);
    if(mode() !== 'next') return;

    const ol = document.getElementById('mvAdSteps');
    if(ol) ol.innerHTML = detail.steps.length
      ? detail.steps.map(x => `<li>${esc(x)}</li>`).join('')
      : `<li class="empty">This one keeps its method on the original page.${r.url ? ' The link is up there.' : ''}</li>`;

    const ul = document.getElementById('mvAdIng');
    if(ul && detail.lines.length) ul.innerHTML = ingredientList(r, m, detail.lines);
  }

  /* ============================================================
     Fridge
     ============================================================ */

  function renderFridge(){
    const g = Pantry.grouped();
    const committed = Menu.committed(days());
    const total = Pantry.count;

    const column = (loc, title) => `
      <section class="mv-col">
        <h4>${title} <span class="chip">${g[loc].length}</span></h4>
        <div class="mv-items">${g[loc].map(i => {
          const spoken = committed.get(i.key);
          return `<div class="mv-item${spoken ? ' is-committed' : ''}" data-item="${esc(i.id)}">
            <span class="mv-item-name">${esc(i.label)}</span>
            <span class="mv-item-qty">${i.qty != null ? esc(`${i.qty}${i.unit ? ' ' + i.unit : ''}`) : ''}</span>
            ${spoken ? `<span class="chip" title="Planned for ${esc(spoken.recipes.join(', '))}">planned</span>` : ''}
            <button class="mv-item-x" data-act="drop" aria-label="Remove ${esc(i.label)}">×</button>
          </div>`;
        }).join('') || '<p class="empty">Empty.</p>'}</div>
      </section>`;

    body().innerHTML = `
      <div class="mv-fridge">
        <div class="mv-add">
          <textarea id="mvAdd" rows="2" placeholder="2 lbs chicken thighs&#10;bag of spinach&#10;half a jar of salsa — one per line"></textarea>
          <div class="mv-add-tools">
            <select id="mvAddLoc">
              <option value="fridge">Fridge</option>
              <option value="freezer">Freezer</option>
              <option value="pantry">Pantry</option>
            </select>
            <button class="ghost-btn sm primary" data-act="addItems">Put it away</button>
            <span class="hint">${total} ${total === 1 ? 'thing' : 'things'} in the kitchen · quantities are for you to read, matching is on the item itself</span>
          </div>
        </div>
        <div class="mv-cols">
          ${column('fridge','Fridge')}
          ${column('freezer','Freezer')}
          ${column('pantry','Pantry')}
        </div>
      </div>`;
  }

  /* ============================================================
     Recipes
     ============================================================ */

  function filtered(){
    const have = Pantry.keys();
    let list = Recipes.search(filters.q);

    if(filters.cuisine)
      list = list.filter(r => r.cuisine === filters.cuisine || r.category === filters.cuisine);
    if(filters.maxMin)
      list = list.filter(r => r.minutes && r.minutes <= filters.maxMin);

    let scored;
    if(filters.within != null){
      scored = Recipes.cookable(have, filters.within, list);
    }else{
      scored = list.map(r => ({recipe:r, ...Recipes.against(r, have)}));
    }

    if(filters.sort === 'quick')   scored.sort((a,b) => (a.recipe.minutes || 999) - (b.recipe.minutes || 999));
    else if(filters.sort === 'kcal') scored.sort((a,b) => ((a.recipe.nutrition||{}).kcal || 9999) - ((b.recipe.nutrition||{}).kcal || 9999));
    else if(filters.sort === 'protein') scored.sort((a,b) => ((b.recipe.nutrition||{}).protein || 0) - ((a.recipe.nutrition||{}).protein || 0));
    else scored.sort((a,b) => a.need - b.need || b.matched - a.matched || (b.recipe.rating || 0) - (a.recipe.rating || 0));

    return scored;
  }

  function renderRecipes(){
    const list = filtered();
    const shown = list.slice(0, filters.limit);
    const cuisines = [...new Set(Recipes.all().map(r => r.cuisine).filter(Boolean))].sort().slice(0, 40);

    body().innerHTML = `
      <div class="mv-recipes">
        <div class="mv-filters">
          <input id="mvQ" class="td-input" type="search" placeholder="Search titles and ingredients…" value="${esc(filters.q)}">
          <button class="ghost-btn sm${filters.within === 0 ? ' primary' : ''}" data-within="0">Can make today</button>
          <button class="ghost-btn sm${filters.within === 2 ? ' primary' : ''}" data-within="2">Within 2 ingredients</button>
          <button class="ghost-btn sm${filters.within === null ? ' primary' : ''}" data-within="">Everything</button>
          <select id="mvCuisine">
            <option value="">Any kind</option>
            ${cuisines.map(c => `<option value="${esc(c)}"${filters.cuisine === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          <select id="mvTime">
            ${[[0,'Any time'],[20,'Under 20 min'],[30,'Under 30 min'],[45,'Under 45 min'],[60,'Under an hour']]
              .map(([v,l]) => `<option value="${v}"${filters.maxMin === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <select id="mvSort">
            ${[['best','Best match'],['quick','Quickest'],['protein','Most protein'],['kcal','Fewest calories']]
              .map(([v,l]) => `<option value="${v}"${filters.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <button class="ghost-btn sm" data-act="addLink">+ Add by link</button>
        </div>
        <p class="empty">${list.length.toLocaleString()} of ${Recipes.count.toLocaleString()} dishes${
          Recipes.hidden ? ` · ${Recipes.hidden.toLocaleString()} sauces, seasonings and drinks held back` : ''}${
          Recipes.built ? ` · backlog built ${esc(new Date(Recipes.built).toLocaleDateString())}` : ''}</p>
        <div class="mv-cards">${shown.map(m => card(m)).join('') || '<p class="empty">Nothing matches. Loosen a filter.</p>'}</div>
        ${list.length > shown.length
          ? `<div class="mv-more"><button class="ghost-btn sm" data-act="more">Show ${Math.min(60, list.length - shown.length)} more</button></div>`
          : ''}
      </div>`;
  }

  /* ============================================================
     Grocery
     ============================================================ */

  function renderGrocery(){
    const groups = Menu.grocery(days());
    const count = groups.reduce((n,g) => n + g.items.length, 0);
    const ticked = groups.reduce((n,g) => n + g.items.filter(i => i.bought).length, 0);

    body().innerHTML = `
      <div class="mv-grocery">
        <div class="mv-plan-head">
          <span class="chip">${count} to buy</span>
          ${ticked ? `<span class="chip ok">${ticked} ticked</span>` : ''}
          <button class="ghost-btn sm" data-act="stow"${ticked ? '' : ' disabled'}>Put ticked away in the kitchen</button>
          <button class="ghost-btn sm" data-act="copyList">Copy list</button>
          <button class="ghost-btn sm" data-act="clearTicks">Clear ticks</button>
        </div>
        ${count ? groups.map(g => `
          <section class="mv-aisle">
            <h4>${esc(g.aisle)}</h4>
            ${g.items.map(i => `
              <label class="mv-buy${i.bought ? ' is-bought' : ''}">
                <input type="checkbox" data-buy="${esc(i.key)}"${i.bought ? ' checked' : ''}>
                <span class="mv-buy-name">${esc(i.item || i.key)}</span>
                <span class="mv-buy-for">${esc(i.recipes.slice(0,3).join(' · '))}${i.recipes.length > 3 ? ' …' : ''}</span>
              </label>`).join('')}
          </section>`).join('')
        : '<p class="empty">Nothing to buy — either the plan is empty, or the kitchen already has all of it.</p>'}
      </div>`;
  }

  /* ============================================================
     the recipe card popup
     ============================================================ */

  async function openRecipe(id){
    const r = recipeById(id);
    if(!r) return;
    const modal = document.getElementById('recipeModal');
    const host  = document.getElementById('recipeModalBody');
    const have  = Pantry.keys();
    const m     = Recipes.against(r, have);
    const n     = r.nutrition || {};
    const per   = Store.get('menu.servings', 2);

    host.innerHTML = `
      <div class="rd">
        <div class="rd-head">
          ${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : ''}
          <div>
            <h2>${esc(r.title)}</h2>
            <p class="rd-meta">${[
              r.source, r.servings ? `serves ${r.servings}` : '', r.minutes ? `${r.minutes} min` : '',
              r.cuisine, r.rating ? `★ ${r.rating.toFixed(1)}` : ''
            ].filter(Boolean).map(esc).join(' · ')}</p>
            <p class="rd-macros">${n.kcal ? `<b>${n0(n.kcal)}</b> kcal · ${n0(n.protein)}g protein · ${n0(n.carbs)}g carbs · ${n0(n.fat)}g fat <i class="hint">per serving, ${n.stated ? 'as published' : `estimated from ${n.known}/${n.total} ingredients`}</i>` : '<i class="hint">No nutrition data for this one.</i>'}</p>
            <div class="rd-actions">
              <label>Add to
                <select id="rdDay">${days().map(d => `<option value="${Menu.iso(d)}">${esc(d.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric'}))}</option>`).join('')}</select>
              </label>
              <select id="rdSlot">${Menu.SLOTS.map(s => `<option value="${s.id}"${s.id === 'dinner' ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
              <label>Servings <input id="rdServings" type="number" min="1" max="24" value="${esc(String(per))}"></label>
              <button class="ghost-btn sm primary" data-act="planIt" data-recipe="${esc(r.id)}">Put it on the plan</button>
              ${r.url ? `<a class="ghost-btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open the original</a>` : ''}
              ${r.id.startsWith('u') ? `<button class="ghost-btn sm danger" data-act="forget" data-recipe="${esc(r.id)}">Forget it</button>` : ''}
            </div>
          </div>
        </div>
        <div class="rd-split">
          <section>
            <h3>Ingredients <span class="chip${m.need ? ' warn' : ' ok'}">${m.need ? `${m.need} to buy` : 'all in'}</span></h3>
            <ul class="rd-ing" id="rdIng">${ingredientList(r, m, null)}</ul>
          </section>
          <section>
            <h3>Method</h3>
            <ol class="rd-steps" id="rdSteps"><li class="empty">Loading…</li></ol>
          </section>
        </div>
      </div>`;
    modal.hidden = false;

    /* The card draws immediately off the index, then fills in from the
       shard. Opening a recipe should never look like waiting. */
    const detail = await Recipes.details(r.id);
    if(document.getElementById('recipeModal').hidden) return;

    const ol = document.getElementById('rdSteps');
    if(ol) ol.innerHTML = detail.steps.length
      ? detail.steps.map(s => `<li>${esc(s)}</li>`).join('')
      : `<li class="empty">This one keeps its method on the original page.${r.url ? ' Open the link above.' : ''}</li>`;

    const ul = document.getElementById('rdIng');
    if(ul && detail.lines.length) ul.innerHTML = ingredientList(r, m, detail.lines);
  }

  /* The cook dialog. Everything the recipe used that the kitchen has is
     ticked; untick whatever survived, because half an onion is still an
     onion and a planner that silently empties the fridge stops being
     believed after about a week. */
  function openCook(dateKey, slot, entryId){
    const e = Menu.entries(new Date(dateKey + 'T00:00:00'), slot).find(x => x.id === entryId);
    if(!e) return;
    const r = recipeById(e.recipeId);
    if(!r) return;
    const have = Pantry.keys();
    const used = (r.ingredients || []).filter(i => !i.staple && i.key && [...have].some(k => Recipes.covers(k, i.key)));

    const host = document.getElementById('recipeModalBody');
    host.innerHTML = `
      <div class="rd">
        <h2>Cooked ${esc(r.title)}?</h2>
        <p class="empty">Tick what ran out. Anything left unticked stays in the kitchen.</p>
        <div class="mv-cook">${used.length ? used.map(i => `
          <label class="fx-row"><input type="checkbox" data-used="${esc(i.key)}" checked> ${esc(i.item || i.key)}</label>`).join('')
          : '<p class="empty">None of its ingredients are in the kitchen right now — nothing to use up.</p>'}</div>
        <div class="modal-actions">
          <button class="ghost-btn sm" data-act="cookCancel">Not yet</button>
          <button class="ghost-btn sm primary" data-act="cookConfirm"
                  data-day="${esc(dateKey)}" data-slot="${esc(slot)}" data-entry="${esc(entryId)}">Cooked it</button>
        </div>
      </div>`;
    document.getElementById('recipeModal').hidden = false;
  }

  /* The meal chip's own little menu: cook it, unplan it. */
  function openMeal(dateKey, slot, entryId){
    const e = Menu.entries(new Date(dateKey + 'T00:00:00'), slot).find(x => x.id === entryId);
    if(!e) return;
    const r = recipeById(e.recipeId);
    const host = document.getElementById('recipeModalBody');
    host.innerHTML = `
      <div class="rd">
        <h2>${esc(r ? r.title : 'This meal')}</h2>
        <p class="empty">${esc(new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'}))} · ${esc(slot)} · ${e.servings} servings${e.cooked ? ' · cooked' : ''}</p>
        <div class="rd-actions">
          ${r ? `<button class="ghost-btn sm" data-act="openRecipe" data-recipe="${esc(r.id)}">Open the recipe</button>` : ''}
          ${e.cooked
            ? `<button class="ghost-btn sm" data-act="uncook" data-day="${esc(dateKey)}" data-slot="${esc(slot)}" data-entry="${esc(entryId)}">Mark as not cooked</button>`
            : `<button class="ghost-btn sm primary" data-act="cook" data-day="${esc(dateKey)}" data-slot="${esc(slot)}" data-entry="${esc(entryId)}">Cooked it</button>`}
          <button class="ghost-btn sm danger" data-act="unplan" data-day="${esc(dateKey)}" data-slot="${esc(slot)}" data-entry="${esc(entryId)}">Take it off the plan</button>
        </div>
      </div>`;
    document.getElementById('recipeModal').hidden = false;
  }

  /* One row per ingredient, coloured by whether the kitchen has it.
     `lines` is the text as the author wrote it, which arrives a moment
     after the card opens; until then the normalised name stands in, so
     the list never appears empty. */
  function ingredientList(r, m, lines){
    return (r.ingredients || []).map((i, idx) => {
      const state = i.staple ? 'staple'
        : m.missing.some(x => x.key === i.key) ? 'missing' : 'have';
      const label = (lines && lines[idx]) || Food.pretty(i.item, i.key);
      const why = state === 'staple' ? 'Assumed always in the cupboard'
                : state === 'have'   ? 'In the kitchen' : 'Not in the kitchen';
      return `<li class="is-${state}" title="${why}">${esc(label)}</li>`;
    }).join('');
  }

  function closeModal(){
    const m = document.getElementById('recipeModal');
    if(m) m.hidden = true;
  }

  /* ============================================================
     adding a recipe by link
     ============================================================ */
  async function addByLink(){
    const url = prompt('Paste the link to a recipe:');
    if(!url) return;
    Store.toast('Reading that page…');
    try{
      const rec = await Recipes.fromUrl(url);
      Recipes.addCustom(rec);
      Recipes.forgetIndex();
      Store.toast(`Added “${rec.title}”.`);
      render();
      openRecipe(rec.id);
    }catch(e){
      Store.toast(e.message);
    }
  }

  /* ============================================================
     plumbing
     ============================================================ */

  function plan(recipeId, dateKey, slot, servings){
    Menu.add(new Date(dateKey + 'T00:00:00'), slot, recipeId, servings);
    const r = recipeById(recipeId);
    Store.toast(`${r ? r.title : 'Meal'} → ${new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined,{weekday:'short'})} ${slot}`);
  }

  /* One delegated listener for the whole tab. Every screen is rebuilt
     from scratch on any change, so per-element handlers would be
     re-attached constantly and leak the ones they replaced.

     Two hosts, not one: the recipe popup is a sibling of the deck, not a
     child of #menuBody, so a listener on the body alone would never see
     "Put it on the plan" or "Cooked it" — the two buttons that do the
     most work in this tab. */
  function wire(){
    const host  = body();
    const modal = document.getElementById('recipeModal');
    if(!host || host.dataset.wired) return;
    host.dataset.wired = '1';

    const onClick = async e => {
      const t = e.target;

      const shift = t.closest('[data-shift]');
      if(shift){
        const by = +shift.dataset.shift;
        const base = by ? startDate() : new Date();
        if(by) base.setDate(base.getDate() + by);
        Store.set('menu.start', Menu.iso(base));
        return render();
      }

      const sug = t.closest('[data-suggest]');
      if(sug) return railTo(sug.dataset.suggest);

      const arrow = t.closest('[data-rail]');
      if(arrow){
        const strip = document.getElementById('mvRailStrip');
        if(strip) strip.scrollBy({left: (+arrow.dataset.rail) * Math.round(strip.clientWidth * 0.8), behavior:'smooth'});
        return;
      }

      const within = t.closest('[data-within]');
      if(within){
        const v = within.dataset.within;
        filters.within = v === '' ? null : +v;
        filters.limit = 60;
        return render();
      }

      const slotEl = t.closest('.mv-slot');
      const mealEl = t.closest('.mv-meal');
      if(mealEl){
        e.stopPropagation();
        return openMeal(mealEl.dataset.day, mealEl.dataset.slot, mealEl.dataset.entry);
      }
      if(slotEl){
        Store.set('menu.sel', {date: slotEl.dataset.day, slot: slotEl.dataset.slot});
        return render();
      }

      const rc = t.closest('[data-recipe]');
      const act = t.closest('[data-act]');

      if(act){
        const a = act.dataset.act;

        if(a === 'addItems'){
          const box = document.getElementById('mvAdd');
          const loc = document.getElementById('mvAddLoc').value;
          const n = Pantry.addMany(box.value, loc);
          box.value = '';
          Store.toast(n ? `Put ${n} ${n === 1 ? 'thing' : 'things'} away.` : 'Nothing readable in that.');
          return render();
        }
        if(a === 'drop'){
          Pantry.remove(act.closest('[data-item]').dataset.item);
          return render();
        }
        if(a === 'more'){ filters.limit += 60; return render(); }
        if(a === 'goPlan') return setMode('plan');
        if(a === 'addLink') return addByLink();

        if(a === 'planIt'){
          const dayKey = document.getElementById('rdDay').value;
          const slot   = document.getElementById('rdSlot').value;
          const serv   = Math.max(1, +document.getElementById('rdServings').value || 2);
          plan(act.dataset.recipe, dayKey, slot, serv);
          closeModal(); return render();
        }
        if(a === 'forget'){
          Recipes.removeCustom(act.dataset.recipe);
          Recipes.forgetIndex();
          closeModal(); return render();
        }
        if(a === 'openRecipe'){ return openRecipe(act.dataset.recipe); }
        if(a === 'cook')   return openCook(act.dataset.day, act.dataset.slot, act.dataset.entry);
        if(a === 'cookCancel') return closeModal();
        if(a === 'cookConfirm'){
          const used = [...document.querySelectorAll('[data-used]:checked')].map(b => b.dataset.used);
          Menu.cook(new Date(act.dataset.day + 'T00:00:00'), act.dataset.slot, act.dataset.entry, used);
          closeModal(); return render();
        }
        if(a === 'uncook'){
          Menu.uncook(new Date(act.dataset.day + 'T00:00:00'), act.dataset.slot, act.dataset.entry);
          closeModal(); return render();
        }
        if(a === 'unplan'){
          Menu.remove(new Date(act.dataset.day + 'T00:00:00'), act.dataset.slot, act.dataset.entry);
          closeModal(); return render();
        }

        if(a === 'clearTicks'){ Menu.clearBought(); return render(); }
        if(a === 'stow'){
          /* Ticked items are in the bags; put them in the kitchen and
             they stop being on the list at all. */
          const bought = Object.keys(Store.get('menu.bought', {}));
          for(const k of bought) Pantry.add(k, 'fridge');
          Menu.clearBought();
          Store.toast(`Put ${bought.length} ${bought.length === 1 ? 'thing' : 'things'} away.`);
          return render();
        }
        if(a === 'copyList'){
          const text = Menu.grocery(days())
            .map(g => `${g.aisle}\n` + g.items.map(i => `  ${i.item || i.key}`).join('\n')).join('\n\n');
          try{ await navigator.clipboard.writeText(text); Store.toast('Grocery list copied.'); }
          catch{ Store.toast('Could not reach the clipboard.'); }
          return;
        }
      }

      if(rc && rc.classList.contains('rc')){
        /* On the plan screen a card is a click-to-plan; everywhere else
           it opens the recipe. */
        const sel = selected();
        if(mode() === 'plan' && sel){
          plan(rc.dataset.recipe, sel.date, sel.slot, Store.get('menu.servings', 2));
          return render();
        }
        return openRecipe(rc.dataset.recipe);
      }
    };

    host.addEventListener('click', onClick);
    if(modal) modal.addEventListener('click', onClick);

    /* ---- dragging things onto the fortnight ----

       Two things are draggable and they land in the same place: a recipe
       card from the rail (or the backlog), which plans a new meal, and a
       meal chip already on the grid, which moves that meal without
       losing its servings or its cooked flag.

       What is being carried is kept in a module variable as well as on
       the dataTransfer, because dragover — the event that has to decide
       whether a slot will accept the drop — is not allowed to read the
       dataTransfer. Only drop is. The payload still goes on the
       dataTransfer so a drag that leaves the window behaves. */

    const clearDropMarks = () =>
      document.querySelectorAll('.mv-slot.is-drop').forEach(el => el.classList.remove('is-drop'));

    host.addEventListener('dragstart', e => {
      const meal = e.target.closest && e.target.closest('.mv-meal');
      const rc   = e.target.closest && e.target.closest('.rc');
      if(meal){
        dragging = {kind:'meal', day: meal.dataset.day, slot: meal.dataset.slot, entry: meal.dataset.entry};
      }else if(rc){
        dragging = {kind:'recipe', id: rc.dataset.recipe};
      }else return;
      e.target.classList.add('is-dragging');
      try{
        e.dataTransfer.effectAllowed = dragging.kind === 'meal' ? 'move' : 'copy';
        e.dataTransfer.setData('text/plain', dragging.kind === 'meal' ? dragging.entry : dragging.id);
      }catch{}
    });

    host.addEventListener('dragend', e => {
      if(e.target.classList) e.target.classList.remove('is-dragging');
      dragging = null;
      clearDropMarks();
    });

    host.addEventListener('dragover', e => {
      if(!dragging) return;
      const slot = e.target.closest && e.target.closest('.mv-slot');
      if(!slot) return;
      e.preventDefault();                       // the only way to say "yes, drop here"
      e.dataTransfer.dropEffect = dragging.kind === 'meal' ? 'move' : 'copy';
      if(!slot.classList.contains('is-drop')){
        clearDropMarks();
        slot.classList.add('is-drop');
      }
    });

    host.addEventListener('dragleave', e => {
      const slot = e.target.closest && e.target.closest('.mv-slot');
      /* relatedTarget is where the cursor went; if it is still inside the
         same slot this is a child boundary, not a real exit. */
      if(slot && !(e.relatedTarget && slot.contains(e.relatedTarget))) slot.classList.remove('is-drop');
    });

    host.addEventListener('drop', e => {
      const slot = e.target.closest && e.target.closest('.mv-slot');
      if(!slot || !dragging) return;
      e.preventDefault();
      clearDropMarks();
      const held = dragging;
      dragging = null;

      const dayKey = slot.dataset.day, slotId = slot.dataset.slot;

      if(held.kind === 'meal'){
        const moved = Menu.move(new Date(held.day + 'T00:00:00'), held.slot, held.entry,
                                new Date(dayKey + 'T00:00:00'), slotId);
        if(moved) Store.toast(`Moved to ${new Date(dayKey + 'T00:00:00').toLocaleDateString(undefined,{weekday:'short'})} ${slotId}.`);
        return render();
      }

      plan(held.id, dayKey, slotId, Store.get('menu.servings', 2));
      /* Dropping somewhere is choosing it: the next click-to-plan should
         go to the slot you just used, not the one you picked ten minutes
         ago. */
      Store.set('menu.sel', {date: dayKey, slot: slotId});
      render();
    });

    host.addEventListener('change', e => {
      const t = e.target;
      if(t.id === 'mvPeople'){ Store.set('menu.people', Math.max(1, +t.value || 2)); return render(); }
      if(t.id === 'mvCuisine'){ filters.cuisine = t.value; filters.limit = 60; return render(); }
      if(t.id === 'mvTime'){ filters.maxMin = +t.value; filters.limit = 60; return render(); }
      if(t.id === 'mvSort'){ filters.sort = t.value; return render(); }
      if(t.dataset.buy != null){ Menu.setBought(t.dataset.buy, t.checked); return render(); }
    });

    /* Search is the one control that must not re-render on every
       keystroke against four thousand recipes. */
    let typing = null;
    host.addEventListener('input', e => {
      if(e.target.id !== 'mvQ') return;
      clearTimeout(typing);
      const v = e.target.value;
      typing = setTimeout(() => {
        filters.q = v; filters.limit = 60;
        render();
        const box = document.getElementById('mvQ');
        if(box){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }, 220);
    });
  }

  function renderModes(){
    const host = document.getElementById('menuModes');
    if(!host) return;
    host.innerHTML = MODES.map(m =>
      `<button class="ghost-btn sm${mode() === m.id ? ' primary' : ''}" data-menumode="${m.id}">${m.label}</button>`).join('');
  }

  function render(){
    if(!body()) return;
    renderModes();
    wire();
    const chip = document.getElementById('menuCount');
    if(chip) chip.textContent = Recipes.ready ? `${Recipes.count.toLocaleString()} recipes` : 'loading…';

    try{
      if(mode() === 'next')         renderNext().catch(err => {
        console.error('Menu render failed:', err);
        body().innerHTML = `<p class="empty">That screen could not be drawn: ${esc(err.message)}</p>`;
      });
      else if(mode() === 'fridge')  renderFridge();
      else if(mode() === 'recipes') renderRecipes();
      else if(mode() === 'grocery') renderGrocery();
      else                          renderPlan();
    }catch(err){
      console.error('Menu render failed:', err);
      body().innerHTML = `<p class="empty">That screen could not be drawn: ${esc(err.message)}</p>`;
    }
  }

  async function load(){
    render();                 // draw the shell immediately, corpus or not
    await Recipes.load();
    render();
  }

  function boot(){
    const modes = document.getElementById('menuModes');
    if(modes) modes.addEventListener('click', e => {
      const b = e.target.closest('[data-menumode]');
      if(b) setMode(b.dataset.menumode);
    });
  }

  return { boot, load, render, setMode, openRecipe, closeModal };
})();

window.MenuView = MenuView;
