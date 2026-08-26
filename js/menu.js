/* ============================================================
   menu.js — the plan itself: what is being eaten on which day, what
   that costs in macros, and what still has to be bought.

   The plan is a map of ISO date -> slot -> entries, which is the shape
   the two-week grid draws directly and the shape a day's macros sum
   over. An entry is a recipe id, a serving count and whether it has
   been cooked yet.

   Planning a meal does not empty the fridge — cooking it does. In
   between, an ingredient is *committed*: the fridge still shows it, the
   grocery list does not ask you to buy it again, and a second recipe on
   another night knows it is spoken for. That distinction is the whole
   difference between a plan you can trust and a list that quietly
   double-spends the same chicken.
   ============================================================ */

const Menu = (() => {

  const KEY   = 'menu.plan';
  const SLOTS = [
    {id:'breakfast', label:'Breakfast'},
    {id:'lunch',     label:'Lunch'},
    {id:'dinner',    label:'Dinner'}
  ];

  const plan = () => Store.get(KEY, {});
  const write = p => Store.set(KEY, p);

  const iso = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };

  /* The fortnight the grid draws, starting on the Sunday of the week
     that contains `from` — a menu that starts mid-week reads as a
     mistake even when it is not. */
  function fortnight(from){
    const start = new Date(from || Date.now());
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({length:14}, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }

  function entries(date, slot){
    const day = plan()[iso(date)];
    if(!day) return [];
    if(slot) return day[slot] || [];
    return SLOTS.flatMap(s => (day[s.id] || []).map(e => ({...e, slot: s.id})));
  }

  function add(date, slot, recipeId, servings){
    const p = plan();
    const key = iso(date);
    p[key] = p[key] || {};
    p[key][slot] = p[key][slot] || [];
    p[key][slot].push({
      id: Store.uid(), recipeId,
      servings: servings || Store.get('menu.servings', 2),
      cooked: false
    });
    write(p);
  }

  function remove(date, slot, entryId){
    const p = plan();
    const key = iso(date);
    if(!p[key] || !p[key][slot]) return;
    p[key][slot] = p[key][slot].filter(e => e.id !== entryId);
    if(!p[key][slot].length) delete p[key][slot];
    if(!Object.keys(p[key]).length) delete p[key];
    write(p);
  }

  function update(date, slot, entryId, patch){
    const p = plan();
    const list = (p[iso(date)] || {})[slot];
    if(!list) return;
    const e = list.find(x => x.id === entryId);
    if(!e) return;
    Object.assign(e, patch);
    write(p);
  }

  /* The next thing to cook: the earliest meal from today forward that
     has not been cooked yet, in slot order within a day. This is what
     the Up Next screen is an advert for. */
  function nextMeal(from){
    const start = new Date(from || Date.now());
    start.setHours(0,0,0,0);
    for(let i = 0; i < 30; i++){
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      for(const s of SLOTS){
        const hit = entries(d, s.id).find(e => !e.cooked);
        if(hit) return {date: d, dateKey: iso(d), slot: s.id, slotLabel: s.label, entry: hit};
      }
    }
    return null;
  }

  /* Moving a meal from one slot to another — what dragging a chip across
     the fortnight does. Kept here rather than as a remove + add in the
     view so the entry keeps its id, its servings and its cooked flag. */
  function move(fromDate, fromSlot, entryId, toDate, toSlot){
    const p = plan();
    const src = (p[iso(fromDate)] || {})[fromSlot];
    if(!src) return false;
    const e = src.find(x => x.id === entryId);
    if(!e) return false;
    if(iso(fromDate) === iso(toDate) && fromSlot === toSlot) return false;

    const fk = iso(fromDate);
    p[fk][fromSlot] = src.filter(x => x.id !== entryId);
    if(!p[fk][fromSlot].length) delete p[fk][fromSlot];
    if(!Object.keys(p[fk]).length) delete p[fk];

    const tk = iso(toDate);
    p[tk] = p[tk] || {};
    p[tk][toSlot] = p[tk][toSlot] || [];
    p[tk][toSlot].push(e);
    write(p);
    return true;
  }

  /* ---------- what the plan is made of ---------- */

  /* Every recipe on the plan across a set of days, deduplicated. This is
     the seed for "suggest something that reuses these". */
  function recipesIn(days){
    const out = [], seen = new Set();
    for(const d of days)
      for(const e of entries(d)){
        if(seen.has(e.recipeId)) continue;
        const r = Recipes.byId(e.recipeId);
        if(!r) continue;
        seen.add(e.recipeId); out.push(r);
      }
    return out;
  }

  /* Ingredients spoken for by meals that are planned but not yet cooked.
     A key appears once however many meals want it: two recipes both
     wanting onions is one line on the shopping list. */
  function committed(days){
    const out = new Map();
    for(const d of days)
      for(const e of entries(d)){
        if(e.cooked) continue;
        const r = Recipes.byId(e.recipeId);
        if(!r) continue;
        for(const ing of r.ingredients || []){
          if(ing.staple || !ing.key) continue;
          const at = out.get(ing.key) || {key: ing.key, item: Food.pretty(ing.item, ing.key), recipes: []};
          if(!at.recipes.includes(r.title)) at.recipes.push(r.title);
          out.set(ing.key, at);
        }
      }
    return out;
  }

  /* ---------- macros ---------- */

  /* A day's totals: every planned serving, added up. `partial` is set
     when at least one recipe had no usable nutrition, so the number can
     be shown as a floor rather than a fact. */
  function macrosFor(date){
    let kcal = 0, protein = 0, carbs = 0, fat = 0, counted = 0, total = 0, estimated = 0;
    for(const e of entries(date)){
      total++;
      const r = Recipes.byId(e.recipeId);
      const n = r && r.nutrition;
      if(!n || !n.kcal){ continue; }
      const mult = e.servings || 1;
      kcal += (n.kcal || 0) * mult;
      protein += (n.protein || 0) * mult;
      carbs   += (n.carbs   || 0) * mult;
      fat     += (n.fat     || 0) * mult;
      counted++;
      if(!n.stated) estimated++;
    }
    return {
      kcal: Math.round(kcal), protein: Math.round(protein),
      carbs: Math.round(carbs), fat: Math.round(fat),
      meals: total, counted, estimated,
      partial: counted < total
    };
  }

  /* Per person, which is what anyone actually wants to know. */
  function macrosPerPerson(date){
    const m = macrosFor(date);
    const people = Math.max(1, Store.get('menu.people', 2));
    return {...m, kcal: Math.round(m.kcal/people), protein: Math.round(m.protein/people),
            carbs: Math.round(m.carbs/people), fat: Math.round(m.fat/people), people};
  }

  /* ---------- the grocery list ----------
     Everything the plan needs that the kitchen does not have, grouped by
     aisle, each line carrying the meals that asked for it. Things
     already ticked off stay ticked until the plan changes under them. */
  function grocery(days){
    const have = Pantry.keys();
    const need = committed(days);
    const bought = Store.get('menu.bought', {});
    const aisles = new Map();

    for(const [key, entry] of need){
      if([...have].some(k => Recipes.covers(k, key))) continue;
      const aisle = Food.aisleFor(key);
      if(!aisles.has(aisle)) aisles.set(aisle, []);
      aisles.get(aisle).push({...entry, bought: !!bought[key]});
    }

    const order = ['Produce','Meat & fish','Dairy & eggs','Bakery','Frozen','Pantry','Other'];
    return order
      .filter(a => aisles.has(a))
      .map(a => ({aisle: a, items: aisles.get(a).sort((x,y) => x.key.localeCompare(y.key))}));
  }

  function setBought(key, on){
    const b = Store.get('menu.bought', {});
    if(on) b[key] = true; else delete b[key];
    Store.set('menu.bought', b);
  }

  function clearBought(){ Store.set('menu.bought', {}); }

  /* ---------- cooking ----------
     Marks the meal cooked and takes the named ingredients out of the
     kitchen. The caller decides which ones actually ran out — see the
     cook dialog in menuview.js. */
  function cook(date, slot, entryId, usedKeys){
    update(date, slot, entryId, {cooked: true, cookedAt: new Date().toISOString()});
    if(usedKeys && usedKeys.length) Pantry.consume(usedKeys);
  }

  function uncook(date, slot, entryId){
    update(date, slot, entryId, {cooked: false, cookedAt: null});
  }

  return { SLOTS, iso, fortnight, entries, add, remove, update, move, nextMeal,
           recipesIn, committed, macrosFor, macrosPerPerson,
           grocery, setBought, clearBought, cook, uncook,
           get plan(){ return plan(); } };
})();

window.Menu = Menu;
