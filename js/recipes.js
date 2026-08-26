/* ============================================================
   recipes.js — the recipe library.

   Three jobs:

     1. Load the baked backlog (data/recipes.json — thousands of
        recipes, built by tools/build-recipes.js) and merge in whatever
        has been added by hand since.
     2. Turn a URL into a recipe, by reading the schema.org JSON-LD the
        page already publishes. Same parser as the build script, because
        it IS the build script's parser — js/food.js.
     3. Answer the four questions the tab actually asks:
          what can I cook right now
          what am I one or two ingredients away from
          what reuses what I am already cooking this week
          what matches this search

   The method (the numbered steps) is deliberately NOT in the index. It
   is two thirds of the bytes and exactly one recipe needs it at a time,
   so it lives in data/steps/NNN.json and is fetched when a card opens.
   ============================================================ */

const Recipes = (() => {

  let corpus  = [];          // the baked backlog, exactly as built
  let dishes  = [];          // the part of it that is dinner (see Food.isComponent)
  let loaded  = false;
  let loading = null;
  let meta    = {shardSize: 400, built: null};
  const stepCache = new Map();   // shard number -> {id: [steps]}

  const custom = () => Store.get('menu.custom', []);

  /* Everything, baked and hand-added, newest hand-added first — a recipe
     you pasted in this afternoon should not be on page nine.

     Components are filtered out here rather than at each call site, so
     the whole tab — search, the rail, the counts — agrees on what a
     recipe is. A hand-added recipe is never filtered: you went and
     pasted that link, so you meant it. `everything()` still sees the
     unabridged library, which is what byId needs for a plan made before
     the filter existed. */
  function all(){
    return custom().concat(dishes);
  }
  function everything(){
    return custom().concat(corpus);
  }
  const componentCount = () => corpus.length - dishes.length;

  /* byId is called once per meal per day per repaint — a linear scan of
     four thousand recipes fourteen times over is the difference between
     a grid that draws instantly and one that stutters. */
  let idMap = null;
  function byId(id){
    if(!idMap){
      idMap = new Map();
      for(const r of corpus) idMap.set(r.id, r);   // the whole library, components included
    }
    return custom().find(r => r.id === id) || idMap.get(id) || null;
  }
  function forgetIds(){ idMap = null; }

  /* ---------- loading ---------- */

  async function load(){
    if(loaded) return corpus;
    if(loading) return loading;
    loading = (async () => {
      try{
        const data = await getJSON('data/recipes.json');
        corpus = data.recipes || [];
        dishes = corpus.filter(r => !Food.isComponent(r));
        forgetIds();
        meta = {shardSize: data.shardSize || 400, built: data.built, shards: data.shards};
        loaded = true;
      }catch(e){
        console.warn('Recipe backlog not loaded:', e.message);
        corpus = []; dishes = [];
        loaded = true;      // a missing corpus is a smaller tab, not a broken one
      }
      loading = null;
      return corpus;
    })();
    return loading;
  }

  /* The method and the ingredient lines as the author wrote them,
     fetched a shard at a time. The index carries only the normalised
     keys — enough to match against the kitchen, not enough to cook
     from — so an open card asks for the rest. A hand-added recipe keeps
     both inline and never touches a shard. */
  async function details(id){
    const own = custom().find(r => r.id === id);
    if(own) return {steps: own.steps || [], lines: (own.ingredients || []).map(i => i.raw)};

    const i = parseInt(String(id).slice(1), 10);
    if(!Number.isFinite(i)) return {steps: [], lines: []};
    const shard = Math.floor(i / meta.shardSize);

    if(!stepCache.has(shard)){
      try{
        stepCache.set(shard, await getJSON(`data/steps/${String(shard).padStart(3,'0')}.json`));
      }catch{
        stepCache.set(shard, {});
      }
    }
    const hit = stepCache.get(shard)[id];
    return {steps: (hit && hit.steps) || [], lines: (hit && hit.lines) || []};
  }

  const steps = async id => (await details(id)).steps;

  /* ---------- adding one by link ----------
     Recipe sites publish schema.org Recipe as JSON-LD for Google's sake;
     we read the same block. GitHub Pages cannot fetch a third-party page
     directly — the browser blocks it — so this goes through the same
     Cloudflare Worker the Letterboxd scrape uses. */

  function proxyBase(){
    return (Store.get('menu.proxy','') || Store.get('movies.lbProxy','') || '').replace(/\/+$/,'');
  }

  function findRecipeNode(parsed){
    const hits = [];
    const walk = n => {
      if(!n || typeof n !== 'object') return;
      if(Array.isArray(n)) return n.forEach(walk);
      const t = n['@type'];
      if(t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) hits.push(n);
      if(n['@graph']) walk(n['@graph']);
    };
    walk(parsed);
    return hits[0] || null;
  }

  const textOf = v => {
    if(v == null) return '';
    if(typeof v === 'string') return v;
    if(Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
    if(typeof v === 'object') return textOf(v.text || v.name || v['@value'] || '');
    return String(v);
  };

  function clean(s){
    const d = document.createElement('div');
    d.innerHTML = String(s || '');
    return (d.textContent || '').replace(/\s+/g,' ').trim();
  }

  function stepList(v){
    const out = [];
    const push = s => { s = clean(s); if(s.length > 2) out.push(s); };
    const walk = n => {
      if(!n) return;
      if(typeof n === 'string') return n.split(/\n+/).forEach(push);
      if(Array.isArray(n)) return n.forEach(walk);
      if(n.itemListElement) return walk(n.itemListElement);
      push(n.text || n.name || '');
    };
    walk(v);
    return out;
  }

  const listOf = v => !v ? []
    : (Array.isArray(v) ? v : String(v).split(',')).map(x => textOf(x).trim()).filter(Boolean);

  function imageOf(v){
    if(!v) return '';
    if(typeof v === 'string') return v;
    if(Array.isArray(v)) return imageOf(v[0]);
    return v.url || v.contentUrl || '';
  }

  function statedNutrition(n){
    if(!n || typeof n !== 'object') return null;
    const num = v => { const m = String(textOf(v)).match(/[\d.]+/); return m ? Math.round(parseFloat(m[0])) : null; };
    const kcal = num(n.calories);
    if(kcal == null) return null;
    return { kcal, protein:num(n.proteinContent), carbs:num(n.carbohydrateContent),
             fat:num(n.fatContent), sodium:num(n.sodiumContent), stated:true };
  }

  /* A schema.org node -> the same shape the baked corpus uses. Shared by
     the link importer and (in Node) the build script. */
  function fromNode(node, url){
    const title = clean(textOf(node.name));
    const raws  = listOf(node.recipeIngredient || node.ingredients).map(clean);
    if(!title || raws.length < 2) return null;

    const ingredients = raws.map(Food.parseIngredient).filter(Boolean);
    const yieldNum = String(textOf(Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield)).match(/\d+/);
    const servings = yieldNum ? Math.min(24, Math.max(1, +yieldNum[0])) : 4;
    const est = Food.macros(ingredients, servings);

    let host = '';
    try{ host = new URL(url).hostname.replace(/^www\./,''); }catch{}

    return {
      id: 'u' + Store.uid(),
      title,
      url,
      image: imageOf(node.image),
      source: host || 'added by hand',
      servings,
      minutes: Food.isoMinutes(node.totalTime)
            || (Food.isoMinutes(node.cookTime) || 0) + (Food.isoMinutes(node.prepTime) || 0) || null,
      category: (listOf(node.recipeCategory)[0] || '').toLowerCase(),
      cuisine:  (listOf(node.recipeCuisine)[0]  || '').toLowerCase(),
      tags: [...new Set(listOf(node.keywords).map(t => t.toLowerCase()))].slice(0,8),
      rating: node.aggregateRating ? Number(textOf(node.aggregateRating.ratingValue)) || null : null,
      ingredients: ingredients.map(i => ({raw:i.raw, qty:i.qty, unit:i.unit, item:i.item, key:i.key, staple:i.staple})),
      nutrition: statedNutrition(node.nutrition) || {
        kcal:est.kcal, protein:est.protein, carbs:est.carbs, fat:est.fat,
        stated:false, known:est.known, total:est.total
      },
      steps: stepList(node.recipeInstructions),
      added: new Date().toISOString()
    };
  }

  /* Fetch a page and pull the recipe out of it. Throws with something
     worth reading — "no recipe data on that page" is a different problem
     from "the proxy is not set up", and the two need different fixes. */
  async function fromUrl(url){
    const target = String(url || '').trim();
    if(!/^https?:\/\//i.test(target)) throw new Error('That does not look like a link.');

    const base = proxyBase();
    let html = null, lastError = '';

    /* Straight at the site first: a few publish CORS headers and it
       saves the round trip. Most will not, which is what the proxy is
       for. */
    for(const attempt of [target, base ? `${base}/recipe?url=${encodeURIComponent(target)}` : null]){
      if(!attempt) continue;
      try{
        const res = await fetch(attempt);
        if(!res.ok){ lastError = `${res.status} ${res.statusText}`; continue; }
        html = await res.text();
        break;
      }catch(e){ lastError = e.message; }
    }

    if(html == null){
      throw new Error(base
        ? `Could not read that page (${lastError}).`
        : 'Your browser cannot read another site directly. Set the scrape proxy in Settings → Menu, then try again.');
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    for(const el of doc.querySelectorAll('script[type="application/ld+json"]')){
      let node;
      try{ node = findRecipeNode(JSON.parse(el.textContent.trim())); }
      catch{ continue; }
      if(!node) continue;
      const rec = fromNode(node, target);
      if(rec) return rec;
    }
    throw new Error('That page does not publish recipe data a machine can read. Add it by hand instead.');
  }

  function addCustom(recipe){
    const list = custom();
    if(list.some(r => r.url && r.url === recipe.url))
      throw new Error('That recipe is already in the book.');
    Store.set('menu.custom', [recipe, ...list]);
    return recipe;
  }

  function removeCustom(id){
    Store.set('menu.custom', custom().filter(r => r.id !== id));
  }

  /* ---------- matching ---------- */

  /* A pantry key covers a recipe key when they are the same thing or one
     is the general case of the other: "chicken" in the fridge covers a
     recipe calling for "chicken breast", and the other way round. Never
     on a bare substring — "corn" must not satisfy "corned beef". */
  /* Words that name a product in their own right. A compound ending in
     one of them is a different thing from its first word: rice vinegar
     is not rice, peanut butter is not butter, chili garlic sauce is not
     garlic. Without this the "can make today" filter quietly assumes a
     bag of rice covers the rice vinegar, and the whole screen stops
     being true. */
  const PRODUCT = new Set([
    'vinegar','sauce','oil','powder','paste','stock','broth','juice','milk','butter',
    'flour','extract','syrup','sugar','salt','cheese','cream','wine','dressing',
    'vinaigrette','seed','water','soda','jam','jelly','curd','yogurt','yoghurt'
  ]);

  function covers(have, want){
    if(have === want) return true;
    const a = have.split(' '), b = want.split(' ');
    const longer = a.length > b.length ? a : b;
    if(a.length !== b.length && PRODUCT.has(longer[longer.length - 1])) return false;
    if(a.length === 1 && b.length > 1) return b.includes(have);
    if(b.length === 1 && a.length > 1) return a.includes(want);
    return false;
  }

  /* Which of a recipe's ingredients are covered by a set of keys.
     Staples never count as missing — see Food.STAPLES for why. */
  function against(recipe, haveKeys){
    const have = [], missing = [];
    let buyable = 0;                          // non-staple lines that mean a shopping trip
    for(const ing of recipe.ingredients || []){
      if(ing.staple) continue;
      if(!ing.key) continue;
      buyable++;
      if([...haveKeys].some(k => covers(k, ing.key))) have.push(ing);
      else if(ing.optional) continue;         // "chives, optional" is not a shopping trip
      else missing.push(ing);
    }
    /* `buyable` is what stops "0 missing" from meaning "you have it all"
       for a recipe that never asked for anything in the first place — a
       spice blend against an empty fridge is not dinner you can cook
       tonight, it is a recipe with nothing to check. */
    return {have, missing, need: missing.length, matched: have.length, buyable};
  }

  /* The whole library, scored against what is in the kitchen.
     `within` caps how many missing ingredients is still interesting. */
  function cookable(haveKeys, within = 0, list){
    const out = [];
    for(const r of (list || all())){
      const m = against(r, haveKeys);
      if(m.need > within) continue;
      /* Nothing of yours went into it, so it is not something the
         kitchen can make — it is something the kitchen was never asked
         about. An empty fridge cooks nothing. */
      if(!m.matched) continue;
      out.push({recipe:r, ...m});
    }
    /* Fewest missing first; then most of the fridge used, because the
       point of this screen is to eat what is already bought. */
    out.sort((a,b) => a.need - b.need || b.matched - a.matched
                   || (b.recipe.rating || 0) - (a.recipe.rating || 0));
    return out;
  }

  /* "More of what I am already cooking" — the calendar's suggestion rail.
     Scores every recipe on how much it shares with the recipes already on
     the plan, so a week built around one bunch of cilantro and one tub of
     yogurt stays a week that uses them up. */
  function reusing(seedRecipes, haveKeys, opts = {}){
    const {within = 2, limit = 24} = opts;
    const seedIds = new Set(seedRecipes.map(r => r.id));

    /* An ingredient is worth reusing in proportion to how awkward it is
       to have bought: half a bunch of lemongrass matters, butter does
       not. So each shared key is weighted by how rare it is across the
       whole backlog — otherwise every suggestion is whatever else uses
       butter, garlic and lemon, which is most of cooking. */
    const weight = new Map();     // ingredient key -> how much we care
    for(const r of seedRecipes)
      for(const ing of r.ingredients || []){
        if(ing.staple || !ing.key) continue;
        weight.set(ing.key, (weight.get(ing.key) || 0) + rarity(ing.key));
      }
    if(!weight.size) return [];

    const out = [];
    for(const r of all()){
      if(seedIds.has(r.id)) continue;
      const m = against(r, haveKeys);
      if(m.need > within) continue;

      let shared = 0, score = 0;
      for(const ing of r.ingredients || []){
        if(ing.staple || !ing.key) continue;
        for(const [k, w] of weight)
          if(covers(k, ing.key)){ shared++; score += w; break; }
      }
      if(!shared) continue;
      /* Every ingredient still to buy costs it — a recipe that shares
         three things but needs two more is worse than one that shares
         two and needs nothing. */
      out.push({recipe:r, ...m, shared, score: score - m.need * 0.9});
    }
    out.sort((a,b) => b.score - a.score || a.need - b.need);
    return out.slice(0, limit);
  }

  /* How unusual an ingredient is, on a scale where a one-off is about 4
     and something in a third of all recipes is near zero. Plain inverse
     document frequency; the floor keeps a universal ingredient from
     going negative and quietly subtracting from a score. */
  let freq = null;
  function rarity(key){
    if(!freq){
      freq = new Map();
      for(const r of all())
        for(const ing of r.ingredients || [])
          if(ing.key && !ing.staple) freq.set(ing.key, (freq.get(ing.key) || 0) + 1);
    }
    const n = Math.max(1, freq.size ? all().length : 1);
    return Math.max(0.15, Math.log(n / (1 + (freq.get(key) || 0))) / 3);
  }

  /* Called whenever the hand-added list changes: the rarity weights and
     the id lookup are both derived from the whole library, this one
     included. */
  function forgetIndex(){ freq = null; forgetIds(); }

  /* ---------- search ---------- */
  function search(query, list){
    const q = String(query || '').toLowerCase().trim();
    if(!q) return list || all();
    const terms = q.split(/\s+/);
    return (list || all()).filter(r => {
      const hay = (r.title + ' ' + r.cuisine + ' ' + r.category + ' ' + (r.tags||[]).join(' ')
                + ' ' + (r.ingredients||[]).map(i => i.key).join(' ')).toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }

  return { load, all, everything, byId, steps, details, search, cookable, reusing, against, covers,
           forgetIndex, fromUrl, fromNode, addCustom, removeCustom,
           get count(){ return all().length; },
           get hidden(){ return componentCount(); },
           get built(){ return meta.built; },
           get ready(){ return loaded; } };
})();

window.Recipes = Recipes;
