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
  /* 'next' used to be a screen in here before it became a kiosk AD.
     Anyone who left the tab on it would otherwise come back to a deck
     with no tab lit, so an unknown mode falls back to the plan. */
  const mode = () => {
    const m = Store.get('menu.mode', 'plan');
    return MODES.some(x => x.id === m) ? m : 'plan';
  };
  const setMode   = m => { Store.set('menu.mode', m); render(); };
  const startDate = () => new Date(Store.get('menu.start', Menu.iso(new Date())) + 'T00:00:00');
  const selected  = () => Store.get('menu.sel', null);

  /* ---- transient: filters live for the session, not forever ---- */
  let suggestTab = 'weather';                 // reuse | now | near — now *derived* from scroll
  let filters = {q:'', within:null, cuisine:'', maxMin:0, sort:'best', limit:60};

  /* The rail is one continuous strip and the tab under the cursor is
     whichever stretch of it you have scrolled to. That makes its scroll
     position real state: every repaint rebuilds the strip from scratch,
     and a strip that snapped back to the left every time a meal was
     planned would be unusable. */
  let railScroll = 0;

  /* One ingredient the whole strip is narrowed to. Session-only: a filter
     you left on last week is a strip that looks broken today. */
  let railFilter = '';

  /* The strip drifts on its own. See startDrift. */
  let drift = null;

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
        : need != null
          ? `<span class="chip warn">${match.needFood || need} to buy</span>` +
            (match.needStaples ? `<span class="chip" title="From the spice rack — put yours in the Fridge screen and these stop counting">+${match.needStaples} rack</span>` : '')
          : '';
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

  const LENSES = [
    {id:'weather', label:'Suits today'},
    {id:'reuse',   label:'Reuses your week'},
    {id:'now',     label:'Cook tonight'},
    {id:'near',    label:'1–2 away'}
  ];

  /* Filtering collapses the four lenses into one stretch, and that is
     deliberate. Every lens is a question about your kitchen — what can
     I cook, what reuses the week, what am I two ingredients from — and
     all four therefore refuse anything you cannot nearly make. Typing an
     ingredient is a different question: show me the aubergine recipes.
     Run through the lenses it answered "none" four times over, which
     reads as a broken filter rather than an honest one. So while a
     filter is on the strip is one run of everything that uses it,
     nearest-to-cookable first, and the lens buttons stand down. */
  const railGroups = () => railFilter.trim()
    ? [{id:'find', label:`With ${railFilter.trim()}`}]
    : LENSES;

  /* Whatever the theme engine is currently reading the sky as. The Menu
     tab used to be the one screen that ignored it. */
  const sky = () => (window.Weather && Weather.current) || null;

  /* Four whole-library scans, and suggestions() and wireRail() both want
     the answer. Recomputing it twice per repaint was most of the second
     the tab took to open.

     Keyed on everything the answer actually depends on, so it survives a
     drag, a repaint or a trip to another tab and back, and is thrown away
     the moment the kitchen, the plan, the weather or the filter moves. */
  let railCache = null;

  function railKey(){
    const w = sky();
    return JSON.stringify([
      Pantry.items().length, Store.get('menu.pantry', []).map(i => `${i.key}:${i.qty}${i.unit}`).join(),
      Object.keys(Menu.plan).length, JSON.stringify(Menu.plan).length,
      w && w.main, w && w.temp, railFilter, Recipes.count
    ]);
  }

  function railLists(){
    const key = railKey();
    if(railCache && railCache.key === key) return railCache.groups;
    const groups = buildRailLists();
    railCache = {key, groups};
    return groups;
  }

  function buildRailLists(){
    const seeds = Menu.recipesIn(days());
    const have  = Pantry.stock();

    /* The filter narrows the POOL each lens scans, not the handful each
       one ends up showing. Narrowing the results was the obvious way to
       write it and it was wrong: every lens caps itself at thirty, so
       filtering afterwards asked "which of the top thirty happen to use
       aubergine", and the answer was almost always none. Filtering first
       asks the question actually meant — "of the recipes with aubergine
       in them, which suit today, which reuse the week, which can I cook
       tonight" — and each stretch keeps its own meaning. */
    const q = railFilter.trim();

    /* One stretch: everything using it, whether or not the kitchen is
       close. Sorted by how much shopping it would take, so the ones you
       could almost cook come first and the rest are still there to be
       looked at. */
    if(q){
      const find = Recipes.resolver(have);
      const hits = Recipes.using(q, Recipes.all())
        .map(r => ({recipe:r, ...Recipes.against(r, have, find)}))
        .sort((a,b) => a.need - b.need || b.matched - a.matched
                    || (b.recipe.rating || 0) - (a.recipe.rating || 0))
        .slice(0, 40);
      return {
        find: {
          list: hits,
          note: hits.length
            ? `${hits.length === 40 ? 'The closest 40' : hits.length} ${hits.length === 1 ? 'recipe uses' : 'recipes use'} ${q}, least shopping first.`
            : `Nothing in the book uses ${q}.`,
          empty: `No recipe in the book asks for ${q}. Try another spelling.`
        }
      };
    }

    const reuse = seeds.length
      ? Recipes.reusing(seeds, have, {within:2, limit:30})
      : Recipes.cookable(have, 0).slice(0, 30);

    const suits = Recipes.suiting(sky(), have, {within:2, limit:30});

    return {
      weather: {
        list: suits.list,
        note: suits.mood ? suits.mood.why
            : 'No weather reading yet — this stretch fills in once the forecast lands.',
        empty: suits.mood
          ? 'Nothing in the kitchen fits the weather yet. Put a shop away and this fills up.'
          : 'No weather reading yet.'
      },
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
    /* A filter appearing or clearing changes which stretches exist, so
       the highlighted one may no longer be among them. */
    if(!groups[suggestTab]) suggestTab = railGroups()[0].id;

    const target = sel
      ? `Adding to <b>${esc(new Date(sel.date + 'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'}))}</b> · ${esc(sel.slot)}`
      : 'Drag a card onto any day — or pick a slot above and click one.';

    const strip = railGroups().map(g => {
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
            ${railGroups().map(g =>
              `<button class="ghost-btn sm${suggestTab === g.id ? ' primary' : ''}" data-suggest="${g.id}">${g.label}</button>`).join('')}
          </nav>
          <span class="mv-target">${target}</span>
          <label class="mv-rail-find">
            <input id="mvRailFind" type="search" autocomplete="off" placeholder="has an ingredient&hellip;"
                   value="${esc(railFilter)}" aria-label="Only show recipes using this ingredient">
          </label>
        </div>
        <p class="empty" id="mvRailNote">${esc((groups[suggestTab] || groups[railGroups()[0].id]).note)}</p>
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
    if(!railGroups().some(g => g.id === id)) return;
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
    for(const g of railGroups()) notes[g.id] = (lists[g.id] || {}).note;

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
      stopDrift(true);
      strip.scrollBy({left: e.deltaY, behavior:'instant'});
    }, {passive:false});

    /* Anything that means "I am using this" stops the drift; letting go
       starts the clock on it coming back. */
    const carousel = strip.closest('.mv-carousel') || strip;
    carousel.addEventListener('pointerenter', () => stopDrift(false));
    carousel.addEventListener('pointerleave', () => stopDrift(true));
    carousel.addEventListener('pointerdown',  () => stopDrift(false));
    strip.addEventListener('dragstart', () => stopDrift(false));

    markRail(railGroupAt(strip), notes);
    startDrift();
  }

  /* ---- the drift ----
     The strip moves on its own, slowly, so the plan screen is something
     you can watch rather than something you have to operate. A pixel and
     a half a frame is about a card every four seconds: fast enough that
     the screen is alive, slow enough to read a title as it goes past.

     It stops the moment you touch it — hover, drag, a wheel, the arrows,
     the filter box — because a strip that keeps sliding while you are
     trying to grab a card off it is worse than one that never moved. It
     starts again a few seconds after you let go.

     At the end it turns around rather than snapping back to zero: a jump
     would break exactly the continuity the four stretches are laid out
     end to end to preserve. */
  const DRIFT_PX    = 1.5;      // per frame
  const DRIFT_IDLE  = 4000;     // how long after you stop before it resumes

  function stopDrift(pause){
    if(drift && drift.raf) cancelAnimationFrame(drift.raf);
    if(drift && drift.timer) clearTimeout(drift.timer);
    if(!drift) return;
    drift.raf = null;
    if(pause) drift.timer = setTimeout(() => runDrift(), DRIFT_IDLE);
  }

  function runDrift(){
    if(!drift) return;
    const strip = document.getElementById('mvRailStrip');
    if(!strip){ drift = null; return; }
    if(drift.raf) cancelAnimationFrame(drift.raf);

    const step = () => {
      const el = document.getElementById('mvRailStrip');
      if(!el || !drift) return;
      const max = el.scrollWidth - el.clientWidth;
      if(max <= 4){ drift.raf = requestAnimationFrame(step); return; }

      let next = el.scrollLeft + DRIFT_PX * drift.dir;
      if(next >= max){ next = max; drift.dir = -1; }
      else if(next <= 0){ next = 0; drift.dir = 1; }

      /* scrollTo, not scrollBy, and instant: the stylesheet smooth-scrolls
         this box, and asking it to smoothly travel 1.5px sixty times a
         second fights itself into a stutter. */
      el.scrollTo({left: next, behavior:'instant'});
      drift.raf = requestAnimationFrame(step);
    };
    drift.raf = requestAnimationFrame(step);
  }

  function startDrift(){
    if(prefersStill()) return;             // reduced motion: it sits still
    if(!drift) drift = {dir:1, raf:null, timer:null};
    runDrift();
  }

  const prefersStill = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
     Fridge
     ============================================================ */

  /* What is on screen while an ingredient is being typed. Kept out of
     Store because a half-finished line is not worth surviving a reload. */
  let entry = {text:'', qty:'', unit:'ea', loc:'fridge', open:false, hi:0, bulk:false, focus:false};
  let fridgeError = null;      // {title, lines:[]} — why something would not go away

  /* The type-ahead list, drawn from the ingredients the recipes actually
     ask for. Free text here is how a kitchen ends up holding "corriander"
     that no recipe will ever match; offering the library's own vocabulary
     is how the fridge and the backlog stay able to talk to each other. */
  function entryOptions(){
    return Recipes.ready ? Recipes.suggest(entry.text, 8) : [];
  }

  function renderFridge(){
    const g = Pantry.grouped();
    const committed = Menu.committed(days());
    const total = Pantry.count;
    const opts = entryOptions();

    const column = loc => `
      <section class="mv-col" data-col="${loc}">
        <h4>${esc(Pantry.LOCATION_LABELS[loc])} <span class="chip">${g[loc].length}</span></h4>
        ${loc === 'spices' && !g.spices.length
          ? `<p class="mv-col-hint">Nothing is assumed to be in your cupboard any more. Put your spice rack
             in here and recipes stop asking you to buy salt.
             <button class="ghost-btn sm" data-act="stockSpices">Add a standard rack</button></p>` : ''}
        <div class="mv-items">${g[loc].map(i => {
          const spoken = committed.get(i.key);
          const amount = i.qty != null ? Food.amount(i.qty, i.unit) : '';
          return `<div class="mv-item${spoken ? ' is-committed' : ''}" data-item="${esc(i.id)}">
            <span class="mv-item-name">${esc(i.label)}</span>
            <button class="mv-item-qty${i.qty == null ? ' is-unknown' : ''}" data-act="editAmount"
                    title="${i.qty == null ? 'No amount recorded. It still counts as having some, but nothing can be measured against it. Click to set one.' : 'Click to change'}"
                    >${esc(amount || 'some')}</button>
            ${spoken ? `<span class="chip" title="Planned for ${esc(spoken.recipes.join(', '))}">planned</span>` : ''}
            <button class="mv-item-x" data-act="drop" aria-label="Remove ${esc(i.label)}">&times;</button>
          </div>`;
        }).join('') || (loc === 'spices' && !g.spices.length ? '' : '<p class="empty">Empty.</p>')}</div>
      </section>`;

    body().innerHTML = `
      <div class="mv-fridge">
        <div class="mv-entry">
          <div class="mv-entry-row">
            <div class="mv-combo${entry.open && opts.length ? ' is-open' : ''}">
              <input id="mvFood" class="td-input" type="text" autocomplete="off" spellcheck="false"
                     role="combobox" aria-expanded="${entry.open && opts.length ? 'true' : 'false'}"
                     aria-controls="mvFoodList"
                     placeholder="Start typing a food &mdash; chicken thighs, cumin, spinach&hellip;"
                     value="${esc(entry.text)}">
              <ul class="mv-combo-list" id="mvFoodList" role="listbox">${
                opts.map((o, i) => `
                  <li role="option" class="${i === entry.hi ? 'is-hi' : ''}" data-pick="${esc(o.key)}"
                      aria-selected="${i === entry.hi}">
                    <span class="mv-combo-name">${esc(o.key)}</span>
                    <span class="mv-combo-meta">${esc(o.staple ? 'spice rack' : o.aisle)} &middot; ${o.count.toLocaleString()} ${o.count === 1 ? 'recipe' : 'recipes'}</span>
                  </li>`).join('')
              }</ul>
            </div>
            <input id="mvQty" class="mv-qty" type="number" min="0" step="any" placeholder="amount"
                   value="${esc(entry.qty)}" aria-label="How much">
            <select id="mvUnit" class="mv-unit" aria-label="Units">
              ${Food.UNIT_CHOICES.map(u => `<option value="${u.id}"${entry.unit === u.id ? ' selected' : ''}>${esc(u.label)}</option>`).join('')}
            </select>
            <select id="mvAddLoc" class="mv-unit" aria-label="Where it goes">
              ${Pantry.LOCATIONS.map(l => `<option value="${l}"${entry.loc === l ? ' selected' : ''}>${esc(Pantry.LOCATION_LABELS[l])}</option>`).join('')}
            </select>
            <button class="ghost-btn sm primary" data-act="putAway">Put it away</button>
          </div>
          <p class="hint">${total} ${total === 1 ? 'thing' : 'things'} in the kitchen &middot;
             leave the amount blank for &ldquo;some&rdquo;, and nothing will be measured against it &middot;
             <button class="ghost-btn sm" data-act="bulkToggle">${entry.bulk ? 'One at a time' : 'Paste a whole shop'}</button></p>
          ${fridgeError ? `
            <div class="mv-error" role="alert">
              <b>${esc(fridgeError.title)}</b>
              <ul>${fridgeError.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
              <button class="ghost-btn sm" data-act="dismissError">Dismiss</button>
            </div>` : ''}
          ${entry.bulk ? `
            <div class="mv-bulk">
              <textarea id="mvAdd" rows="4" placeholder="2 lbs chicken thighs&#10;bag of spinach&#10;half a jar of salsa &mdash; one per line"></textarea>
              <button class="ghost-btn sm" data-act="addItems">Put all of it away</button>
            </div>` : ''}
        </div>
        <div class="mv-cols">${Pantry.LOCATIONS.map(column).join('')}</div>
      </div>`;

    const box = document.getElementById('mvFood');
    if(box && entry.focus){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    entry.focus = false;
  }

  /* A starting spice rack, for the very common case of "I own the obvious
     things but I am not typing forty of them". Everything here is a
     Food.STAPLES member — exactly the set that used to be assumed — so
     this button is the old behaviour, made explicit and opted into
     rather than decided on your behalf. */
  const STARTER_RACK = [
    'salt','black pepper','olive oil','vegetable oil','flour','sugar','brown sugar',
    'baking powder','baking soda','cornstarch','vinegar','vanilla extract',
    'garlic powder','onion powder','paprika','cumin','chili powder','oregano',
    'basil','thyme','rosemary','bay leaf','cinnamon','nutmeg','cayenne',
    'red pepper flake','italian seasoning','curry powder','turmeric','soy sauce',
    'honey','ketchup','mustard','mayonnaise','hot sauce','sesame oil'
  ];

  function stockSpices(){
    const failed = [];
    let n = 0;
    for(const key of STARTER_RACK){
      try{ Pantry.add(key, 'spices'); n++; }
      catch(e){ failed.push(`${key} — ${e.message}`); }
    }
    fridgeError = failed.length
      ? {title:`${failed.length} of them could not go on the shelf.`, lines:failed} : null;
    Store.toast(`Put ${n} ${n === 1 ? 'thing' : 'things'} on the spice shelf.`);
    render();
  }

  /* Putting one thing away. Every way this can fail is something the
     person typing can fix, so every failure says what went wrong and what
     to do about it, rather than the form simply not responding. */
  function putAway(){
    const text = entry.text.trim();
    const qty  = entry.qty === '' ? null : Number(entry.qty);
    try{
      if(entry.qty !== '' && !Number.isFinite(qty))
        throw new Pantry.PantryError(`"${entry.qty}" is not a number.`);
      const r = Pantry.add(text, entry.loc, {qty, unit: entry.unit});
      fridgeError = null;
      Store.toast(r.note || `${r.item.label} → ${Pantry.LOCATION_LABELS[entry.loc].toLowerCase()}${
        r.item.qty != null ? ` (${Food.amount(r.item.qty, r.item.unit)})` : ''}`);
      entry = {...entry, text:'', qty:'', open:false, hi:0, focus:true};
    }catch(e){
      fridgeError = {title:'That could not go in the kitchen.', lines:[e.message]};
    }
    render();
  }

  /* A whole shop at once. Nothing is all-or-nothing: what parses goes in,
     and every line that did not is named with its reason, so a receipt
     with two odd lines in it does not have to be retyped. */
  function putAwayMany(){
    const box = document.getElementById('mvAdd');
    if(!box) return;
    const res = Pantry.addMany(box.value, entry.loc);
    fridgeError = res.failed.length
      ? {title:`${res.failed.length} ${res.failed.length === 1 ? 'line' : 'lines'} could not go in the kitchen.`,
         lines: res.failed.map(f => `"${f.line}" — ${f.why}`)}
      : null;
    if(res.added.length) box.value = '';
    Store.toast(res.added.length
      ? `Put ${res.added.length} ${res.added.length === 1 ? 'thing' : 'things'} away.`
      : 'Nothing readable in that.');
    render();
  }

  /* Changing what is on a shelf after the fact — a pack half used, a
     guess corrected. Blank means "some", which is the honest answer when
     nobody weighed it. */
  function editAmount(id){
    const it = Pantry.items().find(x => x.id === id);
    if(!it) return;
    const raw = prompt(`How much ${it.label}? Blank for "some".`,
                       it.qty != null ? `${it.qty} ${it.unit || ''}`.trim() : '');
    if(raw === null) return;
    const text = raw.trim();
    try{
      if(!text){ Pantry.setAmount(id, null, null); }
      else{
        const m = text.match(/^([\d.]+)\s*([a-z]*)$/i);
        if(!m) throw new Pantry.PantryError(`Could not read "${text}". Try something like "2 lb" or "400 g".`);
        const unit = (m[2] || it.unit || 'ea').toLowerCase();
        if(!Object.prototype.hasOwnProperty.call(Food.UNITS, unit))
          throw new Pantry.PantryError(`"${unit}" is not a unit this kitchen knows. Try one of: ${Food.UNIT_CHOICES.map(u => u.id).join(', ')}.`);
        Pantry.setAmount(id, Number(m[1]), unit);
      }
      fridgeError = null;
    }catch(e){
      fridgeError = {title:'That amount would not go in.', lines:[e.message]};
    }
    render();
  }

  /* ============================================================
     Recipes
     ============================================================ */

  function filtered(){
    const have = Pantry.stock();
    let list = Recipes.search(filters.q);

    if(filters.cuisine)
      list = list.filter(r => r.cuisine === filters.cuisine || r.category === filters.cuisine);
    if(filters.maxMin)
      list = list.filter(r => r.minutes && r.minutes <= filters.maxMin);

    let scored;
    if(filters.within != null){
      scored = Recipes.cookable(have, filters.within, list);
    }else{
      const find = Recipes.resolver(have);
      scored = list.map(r => ({recipe:r, ...Recipes.against(r, have, find)}));
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

  /* Grams are what the plan adds up in, but nobody shops in grams for
     everything. Anything over half a kilo reads in kilos, anything under
     a hundred grams is not worth a number at all — you are buying a jar
     of it either way. */
  function bulkLabel(g){
    if(g >= 1000) return `${Math.round(g / 100) / 10} kg`;
    if(g >= 100)  return `${Math.round(g / 10) * 10} g`;
    return 'a little';
  }
  const shortLabel = i => bulkLabel(i.short.gapG);

  function renderGrocery(){
    const groups = Menu.grocery(days());
    const count = groups.reduce((n,g) => n + g.items.length, 0);
    const ticked = groups.reduce((n,g) => n + g.items.filter(i => i.bought).length, 0);

    body().innerHTML = `
      <div class="mv-grocery">
        <div class="mv-plan-head">
          <span class="chip">${count - ticked} to buy</span>
          <span class="chip ok">${ticked} ticked</span>
          <button class="ghost-btn sm" data-act="stow"${ticked ? '' : ' disabled'}>Put ticked away in the kitchen</button>
          <button class="ghost-btn sm" data-act="copyList">Copy list</button>
          <a class="ghost-btn sm" href="grocery.html" target="_blank" rel="noopener"
             title="The same list, on its own page, sized for a phone">Open on my phone</a>
          <button class="ghost-btn sm" data-act="clearTicks">Clear ticks</button>
        </div>
        ${count ? groups.map(g => `
          <section class="mv-aisle">
            <h4>${esc(g.aisle)}${g.aisle === 'Spices'
              ? ' <i class="hint">nothing is assumed to be in your cupboard — put what you own on the Spices shelf</i>' : ''}</h4>
            ${g.items.map(i => `
              <label class="mv-buy${i.bought ? ' is-bought' : ''}">
                <input type="checkbox" data-buy="${esc(i.key)}"${i.bought ? ' checked' : ''}>
                <span class="mv-buy-name">${esc(i.item || i.key)}</span>
                ${i.short
                  ? `<span class="mv-buy-amt is-short" title="The plan wants ${Math.round(i.short.needG)} g and the kitchen holds ${Math.round(i.short.haveG)} g">
                       ${esc(shortLabel(i))} more</span>`
                  : i.grams && !i.unmeasured
                    ? `<span class="mv-buy-amt">${esc(bulkLabel(i.grams))}</span>` : ''}
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
    const stock = Pantry.stock();
    const m     = Recipes.against(r, stock);
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
            <h3>Ingredients <span class="chip${m.need ? ' warn' : ' ok'}">${m.need ? `${m.need} to buy` : 'all in'}</span>${
              m.short.length ? `<span class="chip warn">${m.short.length} short</span>` : ''}${
              m.assumed ? `<span class="chip" title="On the shelf, but with no amount recorded — nothing could be measured">${m.assumed} unmeasured</span>` : ''}</h3>
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

  /* The cook dialog.

     It used to ask a yes/no question — did this run out — and answer it
     by deleting the row. Now it asks the real one: how much of it went
     in. Each line shows what the recipe wanted, scaled from its own yield
     to the servings actually cooked, and what will be left on the shelf
     afterwards. Untick a line and that ingredient is not touched, because
     you had your own onion and used that instead.

     Where an amount cannot be worked out on either side, the line says
     so and cooking empties that row rather than inventing a number.
     "Some spinach" minus "two cups" has no honest answer, and the wrong
     kind of confidence here is what makes a fridge stop being believed. */
  function openCook(dateKey, slot, entryId){
    const e = Menu.entries(new Date(dateKey + 'T00:00:00'), slot).find(x => x.id === entryId);
    if(!e) return;
    const r = recipeById(e.recipeId);
    if(!r) return;

    const stock = Pantry.stock();
    const spend = Recipes.toSpend(r, stock, e.servings);

    const line = sp => {
      const held  = sp.held;
      const after = (held && held.qty != null && sp.qty != null)
        ? Food.subtractFrom({qty: held.qty, unit: held.unit}, {qty: sp.qty, unit: sp.unit}, sp.key)
        : null;
      const wants = sp.qty != null ? Food.amount(sp.qty, sp.unit) : 'an unrecorded amount';
      const leaves = after
        ? (after.qty === 0 ? 'uses it up' : `leaves ${Food.amount(after.qty, after.unit)}`)
        : 'no amount on the shelf — ticking this empties it';
      /* Lines that can be measured are ticked, because taking the right
         amount out is the whole point. Lines that cannot are NOT, because
         the only thing this dialog can do with them is empty the shelf,
         and emptying a spice rack every time someone cooks is how you
         lose a cupboard you spent ten minutes typing in. Tick one
         deliberately and it means "that ran out" — which is the question
         this dialog used to ask about everything. */
      return `
        <label class="mv-cook-row${after ? '' : ' is-vague-row'}">
          <input type="checkbox" data-spend="${esc(sp.key)}"${after ? ' checked' : ''}>
          <span class="mv-cook-name">${esc(sp.label)}${sp.staple ? ' <i class="hint">spice rack</i>' : ''}</span>
          <span class="mv-cook-take">${esc(wants)}</span>
          <span class="mv-cook-left${after ? '' : ' is-vague'}">${esc(leaves)}</span>
        </label>`;
    };

    const host = document.getElementById('recipeModalBody');
    host.innerHTML = `
      <div class="rd">
        <h2>Cooked ${esc(r.title)}?</h2>
        <p class="empty">${spend.length
          ? `These come out of the kitchen, scaled to ${e.servings} ${e.servings === 1 ? 'serving' : 'servings'}.
             Untick anything you used your own of. The unticked ones are things with no amount recorded —
             tick one only if it actually ran out, because that is all this can do with them.`
          : 'None of its ingredients are in the kitchen right now — nothing to use up.'}</p>
        <div class="mv-cook">${spend.map(line).join('')}</div>
        <div class="modal-actions">
          <button class="ghost-btn sm" data-act="cookCancel">Not yet</button>
          <button class="ghost-btn sm primary" data-act="cookConfirm"
                  data-day="${esc(dateKey)}" data-slot="${esc(slot)}" data-entry="${esc(entryId)}">Cooked it</button>
        </div>
      </div>`;
    document.getElementById('recipeModal').hidden = false;
    cookPending = spend;
  }

  /* What openCook worked out, held for the confirm click so the amounts
     do not have to be recomputed from a DOM that only carries keys. */
  let cookPending = [];

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
    const shortOf = new Map(m.short.map(x => [x.key, x]));
    const gone = new Set([...m.missing, ...m.staples].map(x => x.key));
    return (r.ingredients || []).map((i, idx) => {
      const short = shortOf.get(i.key);
      /* Three states, not two: on the shelf, not on the shelf, and on
         the shelf but not enough of it — which is the one that used to
         be silently counted as having it. */
      const state = short ? 'short' : gone.has(i.key) ? 'missing' : 'have';
      const label = (lines && lines[idx]) || Food.pretty(i.item, i.key);
      const why = state === 'have'
            ? 'In the kitchen'
            : state === 'short'
              ? `Only ${Math.round(short.gotG)} g in the kitchen, this wants ${Math.round(short.wantG)} g`
              : i.staple ? 'Not in the kitchen — put it on the Spices shelf if you have it'
                         : 'Not in the kitchen';
      const tag = state === 'short' ? ' <i class="rd-short">not enough</i>' : '';
      return `<li class="is-${state}${i.staple ? ' is-rack' : ''}" title="${esc(why)}">${esc(label)}${tag}</li>`;
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
      if(sug){ stopDrift(true); return railTo(sug.dataset.suggest); }

      const arrow = t.closest('[data-rail]');
      if(arrow){
        stopDrift(true);
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

      const pick = t.closest('[data-pick]');
      if(pick){
        entry.text = pick.dataset.pick;
        entry.open = false; entry.hi = 0; entry.focus = true;
        return render();
      }

      const rc = t.closest('[data-recipe]');
      const act = t.closest('[data-act]');

      if(act){
        const a = act.dataset.act;

        if(a === 'putAway')      return putAway();
        if(a === 'addItems')     return putAwayMany();
        if(a === 'stockSpices')  return stockSpices();
        if(a === 'editAmount')   return editAmount(act.closest('[data-item]').dataset.item);
        if(a === 'dismissError'){ fridgeError = null; return render(); }
        if(a === 'bulkToggle'){ entry.bulk = !entry.bulk; return render(); }
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
          const ticked = new Set([...document.querySelectorAll('[data-spend]:checked')].map(b => b.dataset.spend));
          const spend  = cookPending.filter(sp => ticked.has(sp.key));
          const report = Menu.cook(new Date(act.dataset.day + 'T00:00:00'), act.dataset.slot, act.dataset.entry, spend);
          cookPending = [];
          closeModal();
          /* Say what came out. A fridge that silently changes under you is
             the thing people stop trusting first. */
          const emptied = report.filter(x => x.action === 'emptied');
          const reduced = report.filter(x => x.action === 'reduced');
          Store.toast(report.length
            ? [reduced.length ? `Took from ${reduced.length}` : '', emptied.length ? `used up ${emptied.length}` : '']
                .filter(Boolean).join(', ') + '.'
            : 'Marked as cooked.');
          return render();
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
             they stop being on the list at all. Each one can fail on its
             own — a unit that will not convert into what is already on
             the shelf — so they are put away one at a time and whatever
             would not go is named rather than lost. */
          const bought = Object.keys(Store.get('menu.bought', {}));
          const failed = [];
          let n = 0;
          for(const k of bought){
            try{ Pantry.add(k, Food.STAPLES.has(k) ? 'spices' : Food.aisleFor(k) === 'Frozen' ? 'freezer' : 'fridge'); n++; }
            catch(e){ failed.push(`${k} — ${e.message}`); }
          }
          Menu.clearBought();
          if(failed.length){
            fridgeError = {title:`${failed.length} could not be put away.`, lines:failed};
            Store.set('menu.mode', 'fridge');
          }
          Store.toast(`Put ${n} ${n === 1 ? 'thing' : 'things'} away.`);
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
      if(t.id === 'mvQty'){  entry.qty  = t.value; return; }
      if(t.id === 'mvUnit'){ entry.unit = t.value; return; }
      if(t.id === 'mvAddLoc'){ entry.loc = t.value; return; }
      if(t.id === 'mvCuisine'){ filters.cuisine = t.value; filters.limit = 60; return render(); }
      if(t.id === 'mvTime'){ filters.maxMin = +t.value; filters.limit = 60; return render(); }
      if(t.id === 'mvSort'){ filters.sort = t.value; return render(); }
      /* Same reasoning as the phone list (js/shop.js): a tick cannot
         reorder anything, so redrawing the screen only serves to destroy
         the box that was just clicked. */
      if(t.dataset.buy != null){
        Menu.setBought(t.dataset.buy, t.checked);
        const row = t.closest('.mv-buy');
        if(row) row.classList.toggle('is-bought', t.checked);
        const head = document.querySelector('.mv-grocery .mv-plan-head');
        if(head){
          const boxes = [...document.querySelectorAll('.mv-buy input[data-buy]')];
          const ticked = boxes.filter(b => b.checked).length;
          const chips = head.querySelectorAll('.chip');
          if(chips[0]) chips[0].textContent = `${boxes.length - ticked} to buy`;
          const ok = head.querySelector('.chip.ok');
          if(ok) ok.textContent = `${ticked} ticked`;
          const stow = head.querySelector('[data-act="stow"]');
          if(stow) stow.disabled = !ticked;
        }
        return;
      }
    });

    /* The combobox. Typing filters the library's own ingredient list and
       redraws only the list, so the caret never moves under the hand;
       Enter takes the highlighted row, or what was typed if none is. */
    host.addEventListener('keydown', e => {
      const box = e.target;
      if(box.id !== 'mvFood') return;
      const n = entryOptions().length;
      if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
        if(!n) return;
        e.preventDefault();
        entry.open = true;
        entry.hi = (entry.hi + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        entry.focus = true;
        return render();
      }
      if(e.key === 'Enter'){
        e.preventDefault();
        const opts = entryOptions();
        if(entry.open && opts[entry.hi]){
          entry.text = opts[entry.hi].key;
          entry.open = false; entry.hi = 0; entry.focus = true;
          return render();
        }
        return putAway();
      }
      if(e.key === 'Escape' && entry.open){ entry.open = false; entry.focus = true; return render(); }
    });

    host.addEventListener('input', e => {
      if(e.target.id !== 'mvFood') return;
      entry.text = e.target.value;
      entry.open = true; entry.hi = 0;
      /* Redraw the list in place: a full render would rebuild the input
         and lose the caret mid-word. */
      const list = document.getElementById('mvFoodList');
      const combo = document.querySelector('.mv-combo');
      const opts = entryOptions();
      if(!list || !combo) return;
      combo.classList.toggle('is-open', !!opts.length);
      list.innerHTML = opts.map((o, i) => `
        <li role="option" class="${i === entry.hi ? 'is-hi' : ''}" data-pick="${esc(o.key)}"
            aria-selected="${i === entry.hi}">
          <span class="mv-combo-name">${esc(o.key)}</span>
          <span class="mv-combo-meta">${esc(o.staple ? 'spice rack' : o.aisle)} &middot; ${o.count.toLocaleString()} ${o.count === 1 ? 'recipe' : 'recipes'}</span>
        </li>`).join('');
    });

    /* Clicking away closes the list without stealing the click. */
    document.addEventListener('click', e => {
      if(!entry.open) return;
      if(e.target.closest && e.target.closest('.mv-combo')) return;
      entry.open = false;
      const combo = document.querySelector('.mv-combo');
      if(combo) combo.classList.remove('is-open');
    });

    /* The strip's ingredient filter. Debounced like the backlog search,
       and for the same reason: every keystroke re-scans the library. The
       caret is restored afterwards because the whole plan screen redraws.
       Scroll goes back to the left — a narrowed strip is a different
       strip, and holding the old offset would land you in the middle of
       nothing. */
    let narrowing = null;
    host.addEventListener('input', e => {
      if(e.target.id !== 'mvRailFind') return;
      stopDrift(false);
      clearTimeout(narrowing);
      const v = e.target.value;
      narrowing = setTimeout(() => {
        if(v.trim() === railFilter.trim()) return;
        railFilter = v;
        railScroll = 0;
        render();
        const box = document.getElementById('mvRailFind');
        if(box){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }, 260);
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
    /* The old strip is about to be thrown away; its animation frame must
       not outlive it, or two drifts end up racing on one screen. */
    stopDrift(false);
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
