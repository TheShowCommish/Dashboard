/* ============================================================
   pantry.js — what is actually in the kitchen.

   One flat list of things, each with the same normalised key the
   recipes use (Food.normalize), which is the only reason "2 chicken
   breasts" in the fridge can answer "1 lb boneless skinless chicken
   breast" in a recipe.

   Quantities are kept, shown, compared and spent. An amount and its
   unit go to grams through Food.toGrams, and grams are what the matcher
   and the cook both work in — so a jar labelled "10 oz" can answer a
   recipe asking for a tablespoon, and cooking that recipe takes the
   tablespoon back out of the jar.

   What has not changed is the honesty rule: an item with no recorded
   amount is *unknown*, not zero and not infinite. It still satisfies a
   recipe — a bag of spinach of unrecorded size should not stop you
   making the salad — but nothing claims to have checked it, and cooking
   empties it rather than inventing a number to subtract. That is the
   difference between a kitchen you can trust and one that quietly makes
   figures up.

   Four places, not three. Spices earn their own because the whole
   staples question turns on them: nothing is assumed to be in the
   cupboard any more, so the spice rack has to be somewhere you can
   actually type it in.
   ============================================================ */

const Pantry = (() => {

  const KEY = 'menu.pantry';
  const LOCATIONS = ['fridge','freezer','pantry','spices'];
  const LOCATION_LABELS = {fridge:'Fridge', freezer:'Freezer', pantry:'Pantry', spices:'Spices'};

  const items = () => Store.get(KEY, []);
  const write = list => Store.set(KEY, list);

  /* Anything that goes wrong putting food away is one of these, so the
     view can show the reason rather than a silent no-op. */
  class PantryError extends Error {
    constructor(message, input){ super(message); this.name = 'PantryError'; this.input = input; }
  }

  /* One line of shopping -> one item. "2 lbs chicken thighs" and
     "chicken thighs" both work; the first keeps its quantity. An
     explicit qty/unit from the form wins over anything in the text,
     because the person typing the number meant the number. */
  function parse(text, loc, explicit){
    const raw = String(text || '').trim();
    if(!raw) throw new PantryError('Nothing to put away — the name is empty.', raw);

    const p = Food.parseIngredient(raw);
    if(!p || !p.key)
      throw new PantryError(`Could not tell what food "${raw}" is. Try just the name, like "chicken thighs".`, raw);

    const qty  = explicit && explicit.qty  != null ? explicit.qty  : p.qty;
    const unit = explicit && explicit.unit ? explicit.unit : (p.qty != null ? p.unit : null);

    if(qty != null && !(qty > 0))
      throw new PantryError(`"${raw}" needs an amount above zero, or none at all.`, raw);
    if(unit && !Object.prototype.hasOwnProperty.call(Food.UNITS, unit))
      throw new PantryError(`"${unit}" is not a unit this kitchen knows.`, raw);

    /* Food the library has never once asked for cannot match a recipe,
       so putting it away would be filling a fridge with something no
       screen in this tab can ever see. Refuse it, and say what was
       nearly meant — a typo is the overwhelmingly likely cause, and the
       fix is one click away in the list. Only checked once the backlog
       is loaded: an empty library must not lock the fridge. */
    if(window.Recipes && Recipes.ready){
      const known = Recipes.vocabulary().some(v => v.key === p.key || Recipes.covers(v.key, p.key));
      if(!known){
        const near = Recipes.nearest(p.key, 3);
        throw new PantryError(
          `No recipe in the book has ever asked for "${p.key}", so nothing would ever match it.` +
          (near.length ? ` Did you mean ${near.join(', ')}?` : ' Try picking from the list as you type.'), raw);
      }
    }

    return {
      id: Store.uid(),
      key: p.key,
      label: Food.pretty(p.item, p.key),
      qty: qty != null ? Math.round(qty * 1000) / 1000 : null,
      unit: qty != null ? (unit || 'ea') : null,
      loc: LOCATIONS.includes(loc) ? loc : 'fridge',
      added: new Date().toISOString()
    };
  }

  /* Adding something already on the list tops it up rather than making a
     second row — two entries for "onion" would both have to be shopped
     for and neither would be right.

     Topping up goes through grams, so half a kilo of chicken added to a
     pack labelled in pounds lands in pounds and still adds up. Where the
     two units genuinely do not convert for that food, that is an error
     the person typing can fix, and they are told which two units and
     what to do about it — not left with a number that quietly means
     nothing.

     Throws PantryError. */
  function add(text, loc, explicit){
    const item = parse(text, loc, explicit);
    const list = items();
    const existing = list.find(i => i.key === item.key && i.loc === item.loc);
    if(!existing){
      write([item, ...list]);
      return {item, merged:false};
    }

    if(item.qty == null){
      return {item: existing, merged:true,
              note:`${existing.label} was already in the ${LOCATION_LABELS[existing.loc].toLowerCase()}.`};
    }

    if(existing.qty == null){
      existing.qty = item.qty; existing.unit = item.unit;
      write(list);
      return {item: existing, merged:true};
    }

    if(existing.unit === item.unit){
      existing.qty = Math.round((existing.qty + item.qty) * 1000) / 1000;
      write(list);
      return {item: existing, merged:true};
    }

    const a   = Food.toGrams(existing.qty, existing.unit, existing.key);
    const b   = Food.toGrams(item.qty, item.unit, item.key);
    const per = Food.toGrams(1, existing.unit, existing.key);
    if(a == null || b == null || !per){
      throw new PantryError(
        `Cannot add ${Food.amount(item.qty, item.unit)} to the ${Food.amount(existing.qty, existing.unit)} ` +
        `of ${existing.label} already in the ${LOCATION_LABELS[existing.loc].toLowerCase()} — ` +
        `${item.unit} and ${existing.unit} do not convert for this one. ` +
        `Use ${existing.unit}, or remove the old row first.`, text);
    }
    existing.qty = Math.round(((a + b) / per) * 1000) / 1000;
    write(list);
    return {item: existing, merged:true};
  }

  /* A whole shopping trip at once — one item per line, which is what a
     receipt or a copy-pasted delivery order looks like. Nothing is
     all-or-nothing: the lines that parse go in, and the ones that do not
     come back with their reasons, so the view can name every failure at
     once rather than stopping at the first. */
  function addMany(text, loc){
    const lines = String(text || '').split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    const added = [], failed = [], notes = [];
    for(const line of lines){
      try{
        const r = add(line, loc);
        added.push(r.item);
        if(r.note) notes.push(r.note);
      }catch(e){
        failed.push({line, why: e.message});
      }
    }
    return {added, failed, notes};
  }

  function remove(id){ write(items().filter(i => i.id !== id)); }

  function setAmount(id, qty, unit){
    const list = items();
    const it = list.find(i => i.id === id);
    if(!it) throw new PantryError('That item is no longer in the kitchen.');
    if(qty != null && !(qty > 0)) throw new PantryError('An amount has to be above zero.');
    it.qty  = qty == null ? null : Math.round(qty * 1000) / 1000;
    it.unit = qty == null ? null : (unit || it.unit || 'ea');
    write(list);
    return it;
  }

  /* ---------- what the kitchen holds ----------
     One row per ingredient, whatever it is spread across. The matcher
     asks this, not the raw list: two half-packs of chicken in the fridge
     and the freezer are one answer to "have I got chicken", and their
     amounts add up. */
  function stock(){
    const out = new Map();
    for(const i of items()){
      const at = out.get(i.key) ||
        {key:i.key, label:i.label, qty:null, unit:null, grams:null, unknown:false, locs:[], items:[]};
      at.items.push(i);
      if(!at.locs.includes(i.loc)) at.locs.push(i.loc);
      if(!at.label) at.label = i.label;

      const g = Food.toGrams(i.qty, i.unit, i.key);
      if(g != null) at.grams = (at.grams || 0) + g;
      else at.unknown = true;          // one unmeasured pack makes the row unmeasured
      if(at.unit == null && i.unit) at.unit = i.unit;
      out.set(i.key, at);
    }
    /* The row is labelled in the first unit that turned up, and its
       quantity is the grams converted back into it — so a row never
       reads "2 lb + 500 g", and never reads in grams when the kitchen
       does not. */
    for(const at of out.values()){
      if(at.grams == null || !at.unit){ at.qty = null; continue; }
      const per = Food.toGrams(1, at.unit, at.key);
      at.qty = per ? Math.round((at.grams / per) * 100) / 100 : null;
    }
    return out;
  }

  /* ---------- spending it ----------
     Cooking a meal eats its ingredients, by amount where both sides know
     one. `spend` is [{key, qty, unit}] — what the recipe actually used,
     already scaled to the servings that were cooked.

     An item with no recorded amount is emptied rather than reduced,
     because "some spinach" minus "two cups" has no honest answer and
     leaving it there would have the fridge claim spinach forever.

     Returns what happened, line by line, so the view can say "took 400 g
     of chicken, emptied the spinach" instead of just redrawing. */
  function consume(spend){
    const list = items();
    const report = [];

    for(const want of (spend || [])){
      /* Freezer last: if the same thing is in the fridge and the freezer,
         cook from the one that is already thawed. */
      const rows = list
        .filter(i => i.key === want.key && !i.__gone)
        .sort((a,b) => (a.loc === 'freezer' ? 1 : 0) - (b.loc === 'freezer' ? 1 : 0));
      if(!rows.length) continue;

      let owed = want.qty == null ? null : Food.toGrams(want.qty, want.unit, want.key);

      /* The recipe could not say how much in any weighable way. Emptying
         a shelf that DOES know what it holds would be the fridge
         inventing a number in the destructive direction — five pounds of
         chillies gone because two of them could not be weighed. So the
         asymmetry: an unmeasured shelf is emptied, because nothing can
         track it and it was probably used; a measured one is left exactly
         as it was, and the report says why nothing happened. */
      if(owed == null){
        for(const r of rows){
          if(r.qty == null){
            r.__gone = true;
            report.push({key:r.key, label:r.label, loc:r.loc, action:'emptied', why:'no amount was recorded'});
          }else{
            report.push({key:r.key, label:r.label, loc:r.loc, action:'left',
                         why: want.qty == null ? 'the recipe gave no amount'
                                               : `${Food.amount(want.qty, want.unit)} does not convert to a weight`});
          }
        }
        continue;
      }

      for(const r of rows){
        if(owed <= 0) break;
        if(r.qty == null){
          r.__gone = true; owed = 0;
          report.push({key:r.key, label:r.label, loc:r.loc, action:'emptied', why:'no amount was recorded'});
          break;
        }
        const had  = Food.toGrams(r.qty, r.unit, r.key);
        const left = had == null ? null : Food.subtractFrom({qty:r.qty, unit:r.unit}, {qty:owed, unit:'g'}, r.key);
        if(!left){
          r.__gone = true; owed = 0;
          report.push({key:r.key, label:r.label, loc:r.loc, action:'emptied', why:'the amounts do not convert'});
          break;
        }
        if(left.qty === 0 || left.grams <= 0){
          r.__gone = true;
          owed -= had;
          report.push({key:r.key, label:r.label, loc:r.loc, action:'emptied', took:had});
        }else{
          r.qty = left.qty;
          owed = 0;
          report.push({key:r.key, label:r.label, loc:r.loc, action:'reduced',
                       took: had - left.grams, left: left.qty, unit: r.unit});
        }
      }
    }

    write(list.filter(i => !i.__gone));
    return report;
  }

  const keys = () => new Set(items().map(i => i.key));

  /* Everything in one place in the kitchen. The Menu advert asks the
     freezer this, because a chicken you have is not a chicken you can
     cook at six o'clock. */
  const inLocation = loc => items().filter(i => i.loc === loc);

  /* Grouped for the fridge view, in a fixed order so the columns do not
     dance around as things are added. */
  function grouped(){
    const out = {fridge:[], freezer:[], pantry:[], spices:[]};
    for(const i of items()) (out[i.loc] || out.fridge).push(i);
    for(const k of LOCATIONS) out[k].sort((a,b) => a.label.localeCompare(b.label));
    return out;
  }

  return { LOCATIONS, LOCATION_LABELS, PantryError,
           items, add, addMany, remove, setAmount, consume,
           keys, stock, grouped, inLocation,
           get count(){ return items().length; } };
})();

window.Pantry = Pantry;
