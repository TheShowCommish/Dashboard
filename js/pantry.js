/* ============================================================
   pantry.js — what is actually in the kitchen.

   One flat list of things, each with the same normalised key the
   recipes use (Food.normalize), which is the only reason "2 chicken
   breasts" in the fridge can answer "1 lb boneless skinless chicken
   breast" in a recipe.

   Quantities are kept and shown, but matching is on presence, not
   amount. That is a deliberate limit: a recipe asking for 400 g of
   chicken and a fridge holding "some chicken" cannot be reconciled
   honestly, and a planner that refuses to suggest a stir fry because it
   is 40 g short is a planner nobody uses. So the fridge answers "do we
   have this", the grocery list answers "what do we not have", and the
   quantity is there for you to read, not for the matcher to enforce.
   ============================================================ */

const Pantry = (() => {

  const KEY = 'menu.pantry';
  const LOCATIONS = ['fridge','freezer','pantry'];

  const items = () => Store.get(KEY, []);
  const write = list => Store.set(KEY, list);

  /* One line of shopping -> one item. "2 lbs chicken thighs" and
     "chicken thighs" both work; the first keeps its quantity. */
  function parse(text, loc){
    const p = Food.parseIngredient(text);
    if(!p || !p.key) return null;
    return {
      id: Store.uid(),
      key: p.key,
      label: Food.pretty(p.item, p.key),
      qty: p.qty,
      unit: p.qty != null && p.unit !== 'ea' ? p.unit : null,
      loc: LOCATIONS.includes(loc) ? loc : 'fridge',
      added: new Date().toISOString()
    };
  }

  /* Adding something already on the list tops it up rather than making a
     second row — two entries for "onion" would both have to be shopped
     for and neither would be right. */
  function add(text, loc){
    const item = parse(text, loc);
    if(!item) return null;
    const list = items();
    const existing = list.find(i => i.key === item.key && i.loc === item.loc);
    if(existing){
      if(item.qty != null && existing.qty != null && existing.unit === item.unit)
        existing.qty = Math.round((existing.qty + item.qty) * 100) / 100;
      else if(item.qty != null && existing.qty == null){ existing.qty = item.qty; existing.unit = item.unit; }
      write(list);
      return existing;
    }
    write([item, ...list]);
    return item;
  }

  /* A whole shopping trip at once — one item per line, which is what a
     receipt or a copy-pasted delivery order looks like. */
  function addMany(text, loc){
    const lines = String(text || '').split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    let n = 0;
    for(const line of lines) if(add(line, loc)) n++;
    return n;
  }

  function remove(id){ write(items().filter(i => i.id !== id)); }

  /* Cooking a meal eats its ingredients. Only the keys handed in — the
     cook dialog lets you keep whatever was not used up, because half an
     onion is still an onion. */
  function consume(keys){
    const gone = new Set(keys);
    write(items().filter(i => !gone.has(i.key)));
  }

  const keys = () => new Set(items().map(i => i.key));

  /* Everything in one place in the kitchen. The Up Next advert asks the
     freezer this, because a chicken you have is not a chicken you can
     cook at six o'clock. */
  const inLocation = loc => items().filter(i => i.loc === loc);

  /* Grouped for the fridge view, in a fixed order so the columns do not
     dance around as things are added. */
  function grouped(){
    const out = {fridge:[], freezer:[], pantry:[]};
    for(const i of items()) (out[i.loc] || out.fridge).push(i);
    for(const k of LOCATIONS) out[k].sort((a,b) => a.label.localeCompare(b.label));
    return out;
  }

  return { LOCATIONS, items, add, addMany, remove, consume, keys, grouped, inLocation,
           get count(){ return items().length; } };
})();

window.Pantry = Pantry;
