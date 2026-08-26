#!/usr/bin/env node
/* ============================================================
   build-recipes.js — bakes the recipe backlog the Menu tab reads.

     data/recipes.json          the index: title, image, macros, times,
                                tags, and the normalised ingredient keys
     data/steps/NNN.json        the method and the ingredient lines as
                                written, 400 recipes to a shard, fetched
                                only when a card is opened

   Why split: the index is what every screen filters, searches and
   matches against, so all of it must be in memory. The method and the
   ingredient text as the author wrote it are what exactly one recipe at
   a time needs, and together they are three quarters of the bytes.
   Shipping the lot in one file means parsing seven megabytes to draw a
   grid of thumbnails; splitting it costs one small fetch when a card is
   actually opened.

   Where the recipes come from:

     1. TheMealDB — a free, unauthenticated JSON API, a few hundred
        recipes, every one with a photo. No scraping involved.

     2. Recipe blogs that publish schema.org Recipe as JSON-LD in the
        page — which is the same structured data they publish *for*
        machines, and how Google draws its recipe cards. Found through
        each site's own sitemap, one request at a time per host, with a
        real User-Agent and a delay between them.

   Sites that block automated readers (the Dotdash group — Allrecipes,
   Serious Eats, Simply Recipes) are deliberately not in the list. If a
   site starts refusing, drop it from SOURCES rather than working around
   it.

   Usage:
     node tools/build-recipes.js                 default: ~2,000 recipes
     node tools/build-recipes.js --limit 6000    a bigger backlog
     node tools/build-recipes.js --site budgetbytes.com
     node tools/build-recipes.js --fresh         ignore the cache

   Re-runnable: every fetched page is cached in tools/.recipe-cache.json
   (gitignored), so a second run only picks up what is new.
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const Food = require('../js/food.js');

const ROOT      = path.join(__dirname, '..');
const OUT_DIR   = path.join(ROOT, 'data');
const STEPS_DIR = path.join(OUT_DIR, 'steps');
const CACHE     = path.join(__dirname, '.recipe-cache.json');

const UA = 'Mozilla/5.0 (compatible; control-deck/1.0; personal meal planner)';
const SHARD = 400;

/* Hosts known to publish JSON-LD Recipe and to serve a plain sitemap.
   `pick` is how many of that site's URLs to try; the sitemaps are
   walked newest-first so a small pick still gets real recipes. */
const SOURCES = [
  { host:'www.budgetbytes.com',        sitemap:'https://www.budgetbytes.com/sitemap_index.xml',        pick:900 },
  { host:'www.recipetineats.com',      sitemap:'https://www.recipetineats.com/sitemap_index.xml',      pick:900 },
  { host:'cookieandkate.com',          sitemap:'https://cookieandkate.com/sitemap_index.xml',          pick:700 },
  { host:'www.gimmesomeoven.com',      sitemap:'https://www.gimmesomeoven.com/sitemap_index.xml',      pick:700 },
  { host:'damndelicious.net',          sitemap:'https://damndelicious.net/sitemap_index.xml',          pick:700 },
  { host:'minimalistbaker.com',        sitemap:'https://minimalistbaker.com/sitemap_index.xml',        pick:700 },
  { host:'www.loveandlemons.com',      sitemap:'https://www.loveandlemons.com/sitemap_index.xml',      pick:700 },
  { host:'pinchofyum.com',             sitemap:'https://pinchofyum.com/sitemap_index.xml',             pick:700 },
  { host:'www.skinnytaste.com',        sitemap:'https://www.skinnytaste.com/sitemap_index.xml',        pick:700 },
  { host:'natashaskitchen.com',        sitemap:'https://natashaskitchen.com/sitemap_index.xml',        pick:700 },
  { host:'www.spendwithpennies.com',   sitemap:'https://www.spendwithpennies.com/sitemap_index.xml',   pick:700 },
  { host:'thewoksoflife.com',          sitemap:'https://thewoksoflife.com/sitemap_index.xml',          pick:700 },
  { host:'cafedelites.com',            sitemap:'https://cafedelites.com/sitemap_index.xml',            pick:500 },
  { host:'www.halfbakedharvest.com',   sitemap:'https://www.halfbakedharvest.com/sitemap_index.xml',   pick:500 }
];

/* ---------- args ---------- */
const argv  = process.argv.slice(2);
const arg   = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : fallback;
};
const LIMIT = parseInt(arg('limit', '2000'), 10);
const ONLY  = arg('site', '');
const FRESH = argv.includes('--fresh');

/* ---------- cache ---------- */
let cache = {};
if(!FRESH && fs.existsSync(CACHE)){
  try{ cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); }
  catch{ cache = {}; }
}
let cacheDirty = 0;
function saveCache(){
  if(!cacheDirty) return;
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  cacheDirty = 0;
}

/* ---------- fetch ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, {json = false, tries = 2} = {}){
  for(let i = 0; i < tries; i++){
    try{
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': json ? 'application/json' : 'text/html,application/xhtml+xml,application/xml' },
        redirect: 'follow'
      });
      if(!res.ok) throw new Error(res.status + ' ' + res.statusText);
      return json ? res.json() : res.text();
    }catch(e){
      if(i === tries - 1) throw e;
      await sleep(700 * (i + 1));
    }
  }
}

/* ---------- schema.org helpers ---------- */

/* Recipe sites put their structured data behind three different shapes:
   a bare object, an array, or an @graph. All three arrive here. */
function findRecipeNode(parsed){
  const seen = [];
  const walk = n => {
    if(!n || typeof n !== 'object') return;
    if(Array.isArray(n)) return n.forEach(walk);
    const t = n['@type'];
    if(t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) seen.push(n);
    if(n['@graph']) walk(n['@graph']);
  };
  walk(parsed);
  return seen[0] || null;
}

function jsonLdRecipes(html){
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m = re.exec(html))){
    let text = m[1].trim().replace(/^\/\*[\s\S]*?\*\//,'');
    try{
      const node = findRecipeNode(JSON.parse(text));
      if(node) out.push(node);
    }catch{ /* a malformed block is not worth a stack trace, there are thousands */ }
  }
  return out;
}

const textOf = v => {
  if(v == null) return '';
  if(typeof v === 'string') return v;
  if(Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' ');
  if(typeof v === 'object') return textOf(v.text || v.name || v['@value'] || '');
  return String(v);
};

function stripTags(s){
  return String(s || '')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&rsquo;/g,"'")
    .replace(/&quot;|&ldquo;|&rdquo;/g,'"').replace(/&deg;/g,'°')
    .replace(/&frac12;/g,'½').replace(/&frac14;/g,'¼').replace(/&frac34;/g,'¾')
    .replace(/&[a-z]+;/gi,' ')
    .replace(/\s+/g,' ').trim();
}

/* Instructions come as a flat string, a list of HowToStep, or a list of
   HowToSection each holding its own steps. */
function stepsOf(v){
  const out = [];
  const push = s => { s = stripTags(s); if(s.length > 2) out.push(s); };
  const walk = n => {
    if(!n) return;
    if(typeof n === 'string') return n.split(/\n+|(?<=\.)\s{2,}/).forEach(push);
    if(Array.isArray(n)) return n.forEach(walk);
    if(n.itemListElement) return walk(n.itemListElement);
    push(n.text || n.name || '');
  };
  walk(v);
  return out;
}

function servingsOf(y){
  const s = textOf(Array.isArray(y) ? y[0] : y);
  const m = s.match(/\d+/);
  return m ? Math.min(24, Math.max(1, parseInt(m[0], 10))) : null;
}

/* The site's own nutrition block, when it publishes one. Always
   preferred over our estimate — it came from the person who wrote the
   recipe, and it covers ingredients our table has never heard of. */
function nutritionOf(n){
  if(!n || typeof n !== 'object') return null;
  const num = v => { const m = String(textOf(v)).match(/[\d.]+/); return m ? Math.round(parseFloat(m[0])) : null; };
  const kcal = num(n.calories);
  if(kcal == null) return null;
  return { kcal, protein: num(n.proteinContent), carbs: num(n.carbohydrateContent),
           fat: num(n.fatContent), fiber: num(n.fiberContent), sugar: num(n.sugarContent),
           sodium: num(n.sodiumContent), stated: true };
}

function imageOf(v){
  if(!v) return '';
  if(typeof v === 'string') return v;
  if(Array.isArray(v)) return imageOf(v[0]);
  return v.url || v.contentUrl || '';
}

function listOf(v){
  if(!v) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map(x => textOf(x).trim()).filter(Boolean);
}

/* ---------- the shape the dashboard reads ---------- */
function build(node, {url, source}){
  const title = stripTags(textOf(node.name));
  const rawIngredients = listOf(node.recipeIngredient || node.ingredients).map(stripTags);
  if(!title || rawIngredients.length < 2) return null;

  const ingredients = rawIngredients.map(Food.parseIngredient).filter(Boolean);
  const servings = servingsOf(node.recipeYield) || 4;
  const steps = stepsOf(node.recipeInstructions);

  const stated = nutritionOf(node.nutrition);
  const est    = Food.macros(ingredients, servings);
  const nutrition = stated || {
    kcal: est.kcal, protein: est.protein, carbs: est.carbs, fat: est.fat,
    stated: false, known: est.known, total: est.total
  };

  const tags = [...new Set([
    ...listOf(node.recipeCategory), ...listOf(node.recipeCuisine), ...listOf(node.keywords)
  ].map(t => t.toLowerCase()).filter(t => t.length > 2 && t.length < 24))].slice(0, 8);

  return {
    title,
    url: url || textOf(node.url) || '',
    image: imageOf(node.image),
    source,
    servings,
    minutes: Food.isoMinutes(node.totalTime)
          || (Food.isoMinutes(node.cookTime) || 0) + (Food.isoMinutes(node.prepTime) || 0) || null,
    category: (listOf(node.recipeCategory)[0] || '').toLowerCase(),
    cuisine:  (listOf(node.recipeCuisine)[0]  || '').toLowerCase(),
    tags,
    rating: node.aggregateRating ? Number(textOf(node.aggregateRating.ratingValue)) || null : null,
    ingredients,
    nutrition,
    steps
  };
}

/* Every cached recipe is re-parsed on the way out. The cache holds the
   ingredient lines exactly as the page published them, so improving
   js/food.js — a new alias, a descriptor it did not know — improves the
   whole backlog on the next run without re-fetching four thousand pages.
   A stated nutrition block is left alone; only our own estimate is
   recomputed. */
function reparse(rec){
  if(!rec || !Array.isArray(rec.ingredients)) return rec;
  const ingredients = rec.ingredients
    .map(i => Food.parseIngredient(i.raw))
    .filter(Boolean);
  if(!ingredients.length) return rec;

  const out = {...rec, ingredients};
  if(!rec.nutrition || !rec.nutrition.stated){
    const est = Food.macros(ingredients, rec.servings || 4);
    out.nutrition = {kcal:est.kcal, protein:est.protein, carbs:est.carbs, fat:est.fat,
                     stated:false, known:est.known, total:est.total};
  }
  return out;
}

/* ---------- TheMealDB ---------- */
/* Its shape is 20 flat strIngredientN / strMeasureN pairs rather than a
   list, so it gets its own reader. Free and unauthenticated; the '1'
   key is the published test key. */
async function fromMealDb(){
  const out = [];
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for(const L of letters){
    let j;
    try{ j = await get(`https://www.themealdb.com/api/json/v1/1/search.php?f=${L}`, {json:true}); }
    catch{ continue; }
    for(const m of (j.meals || [])){
      const raw = [];
      for(let i = 1; i <= 20; i++){
        const name = (m['strIngredient' + i] || '').trim();
        if(!name) continue;
        const measure = (m['strMeasure' + i] || '').trim();
        raw.push((measure && measure.toLowerCase() !== 'to taste' ? measure + ' ' : '') + name);
      }
      if(raw.length < 2) continue;
      const ingredients = raw.map(Food.parseIngredient).filter(Boolean);
      const est = Food.macros(ingredients, 4);
      out.push({
        title: m.strMeal,
        url: m.strSource || `https://www.themealdb.com/meal/${m.idMeal}`,
        image: m.strMealThumb || '',
        source: 'themealdb.com',
        servings: 4,
        minutes: null,
        category: (m.strCategory || '').toLowerCase(),
        cuisine:  (m.strArea || '').toLowerCase(),
        tags: (m.strTags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0,8),
        rating: null,
        ingredients,
        nutrition: { kcal: est.kcal, protein: est.protein, carbs: est.carbs, fat: est.fat,
                     stated: false, known: est.known, total: est.total },
        steps: String(m.strInstructions || '').split(/\r?\n+/).map(s => s.trim()).filter(s => s.length > 2)
      });
    }
    await sleep(120);
  }
  return out;
}

/* ---------- sitemaps ---------- */
const locsIn = xml => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);

async function urlsFor(src){
  let index;
  try{ index = await get(src.sitemap); }
  catch(e){ console.warn(`  ${src.host}: sitemap unreachable (${e.message})`); return []; }

  let maps = locsIn(index).filter(u => /\.xml/.test(u));
  /* Post sitemaps only — a page/category/author sitemap holds no recipes. */
  const posts = maps.filter(u => /post|recipe/i.test(u));
  if(posts.length) maps = posts;
  if(!maps.length) return locsIn(index);

  const urls = [];
  for(const m of maps.slice(0, 8)){
    try{
      const xml = await get(m);
      urls.push(...locsIn(xml).filter(u => !/\.(xml|jpg|png|webp)$/i.test(u)));
    }catch{ /* one bad shard should not lose the site */ }
    if(urls.length >= src.pick * 2) break;
    await sleep(200);
  }
  /* Newest last in a WordPress sitemap, and the newest posts are the
     ones with the fullest structured data. */
  return urls.reverse().slice(0, src.pick);
}

async function harvest(src, budget){
  const urls = await urlsFor(src);
  if(!urls.length) return [];
  const out = [];
  let tried = 0, skipped = 0;

  for(const url of urls){
    if(out.length >= budget) break;
    tried++;

    if(Object.prototype.hasOwnProperty.call(cache, url)){
      const hit = cache[url];
      if(hit) out.push(reparse(hit)); else skipped++;
      continue;
    }

    let html;
    try{ html = await get(url, {tries:1}); }
    catch{ cache[url] = null; cacheDirty++; skipped++; await sleep(250); continue; }

    const nodes = jsonLdRecipes(html);
    const rec = nodes.length ? build(nodes[0], {url, source: src.host}) : null;
    cache[url] = rec; cacheDirty++;
    if(rec) out.push(rec); else skipped++;

    if(cacheDirty >= 100) saveCache();
    await sleep(260);                 // one page a quarter-second, per host
  }

  console.log(`  ${src.host}: ${out.length} recipes from ${tried} pages (${skipped} without recipe data)`);
  return out;
}

/* ---------- write ---------- */
function writeOut(recipes){
  fs.mkdirSync(OUT_DIR, {recursive:true});
  fs.rmSync(STEPS_DIR, {recursive:true, force:true});
  fs.mkdirSync(STEPS_DIR, {recursive:true});

  const index = [];
  let shard = [], shardNo = 0;

  const flush = () => {
    if(!shard.length) return;
    fs.writeFileSync(path.join(STEPS_DIR, `${String(shardNo).padStart(3,'0')}.json`),
                     JSON.stringify(Object.fromEntries(shard)));
    shard = []; shardNo++;
  };

  recipes.forEach((r, i) => {
    const id = 'r' + i;
    index.push({
      id, title: r.title, url: r.url, image: r.image, source: r.source,
      servings: r.servings, minutes: r.minutes, category: r.category,
      cuisine: r.cuisine, tags: r.tags, rating: r.rating,
      nutrition: r.nutrition,
      /* Ingredients in the index, but reduced to what the matcher needs:
         the normalised key, how much, and the two flags. Every screen in
         the tab — what can I cook, what am I missing, have I got enough,
         what reuses tonight's chicken — asks about these, and none of
         them should have to fetch a shard to answer. The line as the
         author wrote it is only ever read on an open card, so it travels
         with the method.

         The quantity is here rather than in the shard because "do I have
         enough cumin" is a question the whole-library filters ask, and
         they cannot fetch three thousand shards to find out. `ea` is
         left off: it is what a bare number means anyway. */
      ingredients: r.ingredients.map(i => {
        const out = {key: i.key};
        if(i.qty != null)             out.qty = Math.round(i.qty * 1000) / 1000;
        if(i.unit && i.unit !== 'ea') out.unit = i.unit;
        if(i.staple)   out.staple = true;
        if(i.optional) out.optional = true;
        return out;
      })
    });
    shard.push([id, {steps: r.steps, lines: r.ingredients.map(i => i.raw)}]);
    if(shard.length >= SHARD) flush();
  });
  flush();

  const out = { built: new Date().toISOString(), count: index.length,
                shardSize: SHARD, shards: shardNo, recipes: index };
  fs.writeFileSync(path.join(OUT_DIR, 'recipes.json'), JSON.stringify(out));

  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  console.log(`\ndata/recipes.json  ${index.length} recipes, ${mb(fs.statSync(path.join(OUT_DIR,'recipes.json')).size)}`);
  const shardBytes = fs.readdirSync(STEPS_DIR)
    .reduce((n, f) => n + fs.statSync(path.join(STEPS_DIR, f)).size, 0);
  console.log(`data/steps/        ${shardNo} shards, ${mb(shardBytes)}`);
}

/* ---------- run ---------- */
(async () => {
  const all = [];
  const seen = new Set();
  const add = list => {
    for(const r of list){
      const k = r.title.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(!k || seen.has(k)) continue;
      seen.add(k); all.push(r);
    }
  };

  if(!ONLY){
    console.log('TheMealDB…');
    try{ const m = await fromMealDb(); add(m); console.log(`  ${m.length} recipes`); }
    catch(e){ console.warn('  TheMealDB failed:', e.message); }
  }

  const sites = ONLY ? SOURCES.filter(s => s.host.includes(ONLY)) : SOURCES;
  if(ONLY && !sites.length){ console.error(`No source matches "${ONLY}".`); process.exit(1); }

  console.log(`\nRecipe blogs (JSON-LD), target ${LIMIT} total…`);

  /* Hosts in parallel, pages within a host one at a time — the delay
     that matters is the one between two hits on the same server. */
  const per = Math.ceil((LIMIT - all.length) / sites.length) + 50;
  const results = await Promise.all(sites.map(s =>
    harvest(s, per).catch(e => { console.warn(`  ${s.host}: ${e.message}`); return []; })));

  /* Round-robin the sites into the final list rather than concatenating,
     so a `--limit` that cuts short still leaves a mixed backlog instead
     of nine hundred recipes from whichever site sorted first. */
  const maxLen = Math.max(0, ...results.map(r => r.length));
  for(let i = 0; i < maxLen; i++)
    for(const r of results) if(r[i]) add([r[i]]);

  saveCache();

  if(!all.length){ console.error('\nNothing was collected — not writing an empty corpus.'); process.exit(1); }
  writeOut(all.slice(0, LIMIT));
})();
