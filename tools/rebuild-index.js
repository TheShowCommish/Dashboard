#!/usr/bin/env node
/* ============================================================
   rebuild-index.js — re-bakes data/recipes.json from what is already
   on disk. No network, no scraping.

   Two things the index was missing, both of which it can recover from
   data/steps/*.json, because the shards keep every ingredient line as
   the author wrote it and they are in the same order as the index's
   own ingredient list:

     1. HOW MUCH. The index carried only the normalised key, which
        answers "do I have any cumin" but not "do I have enough". A
        pantry that knows it holds 10 oz of cumin and a recipe that
        knows it wants one tablespoon can settle that between them —
        but only if the recipe wrote the tablespoon down.

     2. DUPLICATES. Three thousand recipes scraped from eight sites
        contain the same potato salad five times. Same URL is an
        outright duplicate; same title is a duplicate for the purpose
        of planning dinner, whoever published it. The richest copy of
        each wins — see score().

   Run after build-recipes.js, or on its own to upgrade an index built
   before quantities existed:

     node tools/rebuild-index.js
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const Food = require('../js/food.js');

const DATA  = path.join(__dirname, '..', 'data');
const STEPS = path.join(DATA, 'steps');

const src = JSON.parse(fs.readFileSync(path.join(DATA, 'recipes.json'), 'utf8'));
const shardSize = src.shardSize || 400;

/* ---------- the shards, once ---------- */
const shardCache = new Map();
function linesFor(id){
  const n = parseInt(String(id).slice(1), 10);
  if(!Number.isFinite(n)) return [];
  const sh = Math.floor(n / shardSize);
  if(!shardCache.has(sh)){
    const f = path.join(STEPS, `${String(sh).padStart(3,'0')}.json`);
    shardCache.set(sh, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
  }
  const hit = shardCache.get(sh)[id];
  return (hit && hit.lines) || [];
}

/* ---------- 1. put the quantities back ---------- */
let filled = 0, lineTotal = 0, disagreed = 0;

for(const r of src.recipes){
  const lines = linesFor(r.id);
  if(lines.length !== (r.ingredients || []).length) continue;

  r.ingredients.forEach((ing, i) => {
    lineTotal++;
    const p = Food.parseIngredient(lines[i]);
    if(!p) return;
    /* Only trust the re-parse when it lands on the same ingredient the
       index already named. A disagreement means the line is ambiguous,
       and a wrong quantity is worse than no quantity: it would let the
       fridge claim it has enough of something it does not. */
    if(p.key !== ing.key){ disagreed++; return; }
    if(p.qty == null) return;
    ing.qty = Math.round(p.qty * 1000) / 1000;
    if(p.unit && p.unit !== 'ea') ing.unit = p.unit;
    filled++;
  });
}

/* ---------- 2. drop the duplicates ---------- */

/* A recipe is worth keeping in proportion to how much of it there is:
   quantities first (they are the whole point of this pass), then the
   method, then a photo, then stated nutrition. */
function score(r){
  const ings = r.ingredients || [];
  const withQty = ings.filter(i => i.qty != null).length;
  return withQty * 4
       + linesFor(r.id).length
       + (r.image ? 6 : 0)
       + ((r.nutrition || {}).stated ? 4 : 0)
       + (r.minutes ? 2 : 0)
       + (r.rating ? 1 : 0);
}

const NOISE = /\b(recipe|recipes|the|a|an|easy|best|homemade|simple|quick|classic|authentic|perfect|ultimate|my|our|favorite|favourite|from scratch|copycat)\b/g;
const titleKey = t => String(t || '').toLowerCase()
  .replace(/\(.*?\)/g, ' ').replace(NOISE, ' ')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const urlKey = u => String(u || '').split('#')[0].replace(/\/+$/, '').toLowerCase();

function dedupe(list, keyOf, label){
  const best = new Map();
  const order = [];
  for(const r of list){
    const k = keyOf(r);
    if(!k){ order.push(r); continue; }
    const held = best.get(k);
    if(!held){ best.set(k, r); order.push(r); continue; }
    if(score(r) > score(held)){
      order[order.indexOf(held)] = r;
      best.set(k, r);
    }
  }
  console.log(`  ${label}: ${list.length - order.length} dropped`);
  return order;
}

let kept = src.recipes;
kept = dedupe(kept, r => urlKey(r.url), 'same link');
kept = dedupe(kept, r => titleKey(r.title), 'same dish');

/* ---------- write ---------- */
const out = {
  built: src.built, rebuilt: new Date().toISOString(),
  count: kept.length, shardSize, shards: src.shards, recipes: kept
};
fs.writeFileSync(path.join(DATA, 'recipes.json'), JSON.stringify(out));

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log(`\nquantities:  ${filled} of ${lineTotal} ingredient lines (${disagreed} lines the parser read differently, left alone)`);
console.log(`recipes:     ${src.recipes.length} → ${kept.length}`);
console.log(`data/recipes.json  ${mb(fs.statSync(path.join(DATA,'recipes.json')).size)}`);
