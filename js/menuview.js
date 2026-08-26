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
    {id:'plan',    label:'Plan'},
    {id:'fridge',  label:'Fridge'},
    {id:'recipes', label:'Recipes'},
    {id:'grocery', label:'Grocery'}
  ];

  /* ---- state that is worth surviving a reload ---- */
  const mode      = () => Store.get('menu.mode', 'plan');
  const setMode   = m => { Store.set('menu.mode', m); render(); };
  const startDate = () => new Date(Store.get('menu.start', Menu.iso(new Date())) + 'T00:00:00');
  const selected  = () => Store.get('menu.sel', null);

  /* ---- transient: filters live for the session, not forever ---- */
  let suggestTab = 'reuse';                 // reuse | now | near
  let filters = {q:'', within:null, cuisine:'', maxMin:0, sort:'best', limit:60};

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
    const badge = need === 0 ? '<span class="chip ok">have it all</span>'
                : need != null ? `<span class="chip warn">${need} to buy</span>` : '';
    const shared = match.shared ? `<span class="chip">reuses ${match.shared}</span>` : '';
    const n = r.nutrition || {};
    return `
      <article class="rc" data-recipe="${esc(r.id)}" tabindex="0">
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
                      data-day="${key}" data-slot="${s.id}" title="${esc(r ? r.title : 'Missing recipe')}">
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

  /* The rail: the reason the plan screen is not just a grid. */
  function suggestions(){
    const sel = selected();
    const window14 = days();
    const seeds = Menu.recipesIn(window14);
    const have = Pantry.keys();

    let list = [], note = '';
    if(suggestTab === 'reuse'){
      list = Recipes.reusing(seeds, have, {within:2, limit:30});
      note = seeds.length
        ? `Sorted by how much they reuse the ${seeds.length} ${seeds.length === 1 ? 'meal' : 'meals'} already on this fortnight.`
        : 'Plan one meal and this rail fills with everything that shares its ingredients.';
      if(!seeds.length) list = Recipes.cookable(have, 0).slice(0, 30);
    }else if(suggestTab === 'now'){
      list = Recipes.cookable(have, 0).slice(0, 30);
      note = 'Nothing to buy — every non-staple ingredient is already in the kitchen.';
    }else{
      list = Recipes.cookable(have, 2).filter(m => m.need > 0).slice(0, 30);
      note = 'One or two ingredients short. The missing ones are on each card.';
    }

    const target = sel
      ? `Adding to <b>${esc(new Date(sel.date + 'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'}))}</b> · ${esc(sel.slot)}`
      : 'Pick a day and a meal above, then click a recipe to plan it.';

    return `
      <div class="mv-rail">
        <div class="mv-rail-head">
          <nav class="subtabs sm">
            ${[['reuse','Reuses your week'],['now','Cook tonight'],['near','1–2 away']]
              .map(([id,label]) => `<button class="ghost-btn sm${suggestTab === id ? ' primary' : ''}" data-suggest="${id}">${label}</button>`).join('')}
          </nav>
          <span class="mv-target">${target}</span>
        </div>
        <p class="empty">${note}</p>
        <div class="mv-rail-strip">${
          list.length
            ? list.map(m => card(m, m.missing && m.missing.length
                ? `<span class="chip" title="${esc(m.missing.map(i => i.item).join(', '))}">${esc(m.missing.slice(0,2).map(i => i.key).join(', '))}${m.missing.length > 2 ? '…' : ''}</span>`
                : '')).join('')
            : '<p class="empty">Nothing to suggest yet — put something in the fridge, or plan a meal.</p>'
        }</div>
      </div>`;
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
        <p class="empty">${list.length.toLocaleString()} of ${Recipes.count.toLocaleString()} recipes${
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
      if(sug){ suggestTab = sug.dataset.suggest; return render(); }

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
      if(mode() === 'fridge')       renderFridge();
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
