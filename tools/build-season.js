#!/usr/bin/env node
/* ============================================================
   build-season.js — bakes the two heavy NFL datasets the fantasy
   tab needs into small JSON files the dashboard reads for free:

     data/season-YYYY.json   weekly PPR scoring, per player
     data/depth-YYYY.json    the current offensive depth charts
     data/adp-YYYY.json      a mock-draft ADP snapshot, as a fallback
                             for when the proxy is not answering
     data/line-YYYY.json     offensive line grades, per team

   Source: nflverse-data, the play-by-play-derived weekly player
   stats behind nflfastR. It carries fantasy_points_ppr already
   computed, so the dashboard never has to guess at a scoring
   rule — this is true PPR, not an approximation.

   Why bake instead of fetch live: the source CSV is ~8.6 MB and
   19,000 rows. Parsing that in a Cloudflare Worker blows past the
   free tier's 10 ms CPU ceiling, and parsing it in the browser on
   every page load costs a second of jank for data that, for a
   finished season, never changes again. So it is parsed once,
   here, and the result is a 120 KB file served from the repo.

   The depth chart is the answer to "who else plays his position on
   his team, and who is ahead of whom" — it carries a real pos_rank,
   so RB2 behind an injured RB1 is a fact from the source rather than
   a guess made from ADP.

   Usage:
     node tools/build-season.js 2025          one season
     node tools/build-season.js 2025 2026     several
     node tools/build-season.js               last season + this one

   Re-run it weekly during the season to refresh the current year.
   A season that has not started yet 404s upstream; that is not an
   error, it is just skipped.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const SRC = y => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${y}.csv`;

/* Positions worth carrying. Everything else in the file is defence at an
   individual level, which no fantasy league scores this way. FB is folded
   into RB.

   Kickers are deliberately NOT here. The upstream fantasy_points_ppr column
   does not include kicking at all — every kicker in the file scores a flat
   zero, which on a board reads as "measured, and he is worthless" rather
   than "not measured". Leaving them out makes the tab show them the way it
   shows team defences: em dashes, which is the truth. */
const KEEP = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);

/* nflverse and ESPN disagree on exactly two teams. Everything is
   normalised to ESPN's spelling, because the league is on ESPN and
   that is the side the roster data comes from. */
const TEAM_FIX = { LA: 'LAR', WAS: 'WSH' };
const team = t => TEAM_FIX[t] || t;

/* A real CSV parser, not a split on commas. The file quotes several
   late columns (fg_made_list and friends), and a naive split shifts
   every field after them — it silently corrupted 19,394 of 19,422
   rows in testing, which reads as plausible-looking garbage rather
   than as a crash. */
function parseCSV(text){
  const rows = [];
  let row = [], cell = '', quoted = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(quoted){
      if(c === '"'){
        if(text[i+1] === '"'){ cell += '"'; i++; }   // escaped quote
        else quoted = false;
      } else cell += c;
    }
    else if(c === '"') quoted = true;
    else if(c === ','){ row.push(cell); cell = ''; }
    else if(c === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
    else if(c !== '\r') cell += c;
  }
  if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;

function median(list){
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

async function build(season){
  process.stdout.write(`  ${season}: fetching… `);

  const res = await fetch(SRC(season), { redirect: 'follow' });
  if(res.status === 404){
    console.log('not published yet — skipped.');
    return null;
  }
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const text = await res.text();
  process.stdout.write(`${(text.length/1048576).toFixed(1)} MB, parsing… `);

  const rows = parseCSV(text);
  const head = rows[0];
  const at = name => {
    const i = head.indexOf(name);
    if(i < 0) throw new Error(`column "${name}" is gone from the upstream file`);
    return i;
  };
  const I = {
    id:  at('player_id'),   name: at('player_display_name'), pos: at('position'),
    team:at('team'),        opp:  at('opponent_team'),       week:at('week'),
    type:at('season_type'), ppr:  at('fantasy_points_ppr')
  };

  const players = new Map();
  const defence = new Map();
  let ragged = 0, weeks = 0;

  for(let i = 1; i < rows.length; i++){
    const f = rows[i];
    if(f.length !== head.length){ ragged++; continue; }
    if(f[I.type] !== 'REG') continue;                    // fantasy is regular season

    const raw = f[I.pos];
    if(!KEEP.has(raw)) continue;
    const pos = raw === 'FB' ? 'RB' : raw;

    const pts = parseFloat(f[I.ppr]);
    if(!Number.isFinite(pts)) continue;

    const week = Number(f[I.week]);
    weeks = Math.max(weeks, week);

    const id = f[I.id];
    let p = players.get(id);
    if(!p){ p = { name: f[I.name], pos, weeks: new Map(), opps: new Map() }; players.set(id, p); }
    /* Carry the last team seen, so a player traded mid-season is filed
       under the team he finished on rather than the one he left. */
    p.team = team(f[I.team]);
    p.weeks.set(week, (p.weeks.get(week) || 0) + pts);
    if(f[I.opp]) p.opps.set(week, team(f[I.opp]));

    /* Fantasy points allowed, the other way round: every point a player
       scores is a point his opponent's defence gave up at that position. */
    const opp = team(f[I.opp]);
    if(opp){
      if(!defence.has(opp)) defence.set(opp, {});
      const d = defence.get(opp);
      const slot = d[pos] || (d[pos] = { total: 0, weeks: new Set() });
      slot.total += pts;
      slot.weeks.add(week);
    }
  }

  if(ragged) console.warn(`\n     warning: ${ragged} rows had the wrong column count and were skipped`);

  const out = [];
  for(const p of players.values()){
    const played = [...p.weeks.keys()].sort((a, b) => a - b);
    const scores = played.map(w => p.weeks.get(w));
    if(!scores.length) continue;
    const total = scores.reduce((a, b) => a + b, 0);
    out.push({
      n: p.name, p: p.pos, t: p.team,
      g: scores.length,
      tot: round1(total),
      avg: round1(total / scores.length),
      med: round1(median(scores)),
      hi:  round1(Math.max(...scores)),
      lo:  round1(Math.min(...scores)),
      w: played,
      s: scores.map(round1),
      /* Who he played that week. A 30-point game against the softest
         defence in the league is a different fact from 30 against the
         stiffest, and the season view prints the difference. */
      o: played.map(w => p.opps.get(w) || '')
    });
  }
  out.sort((a, b) => b.tot - a.tot);

  const def = {};
  for(const [abbr, slots] of defence){
    def[abbr] = {};
    for(const [pos, slot] of Object.entries(slots))
      def[abbr][pos] = { avg: round1(slot.total / slot.weeks.size), g: slot.weeks.size };
  }

  const payload = {
    season, weeks,
    built: new Date().toISOString(),
    source: 'nflverse-data stats_player_week',
    players: out,
    defence: def
  };

  const file = path.join(OUT_DIR, `season-${season}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`${out.length} players, ${weeks} weeks → data/season-${season}.json (${kb} KB)`);
  return payload;
}

/* ------------------------------------------------------------
   Depth charts.

   The upstream file is a 44 MB append-only log: one snapshot of every
   team's chart per scrape, 157 of them so far this year. Only the most
   recent one is of any use, and collapsing to it takes 465,000 rows down
   to about a thousand. The offensive unit is filed under the group name
   "3WR 1TE"; the O-line is in there too and is dropped.
   ------------------------------------------------------------ */
const DEPTH_SRC = y => `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${y}.csv`;
const DEPTH_POS = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);

async function buildDepth(season){
  process.stdout.write(`  ${season} depth charts: fetching… `);

  const res = await fetch(DEPTH_SRC(season), { redirect: 'follow' });
  if(res.status === 404){
    console.log('not published yet — skipped.');
    return null;
  }
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const text = await res.text();
  process.stdout.write(`${(text.length/1048576).toFixed(1)} MB, collapsing… `);

  /* Two passes rather than parsing all 44 MB: find the newest timestamp by
     reading only the first field of each line, then parse properly just the
     lines that carry it. */
  const lines = text.split('\n');
  const head = parseCSV(lines[0] + '\n')[0];
  const at = name => {
    const i = head.indexOf(name);
    if(i < 0) throw new Error(`column "${name}" is gone from the upstream depth file`);
    return i;
  };
  const I = { dt: at('dt'), team: at('team'), name: at('player_name'),
              espn: at('espn_id'), group: at('pos_grp'),
              pos: at('pos_abb'), rank: at('pos_rank') };
  if(I.dt !== 0) throw new Error('depth file no longer leads with dt');

  let latest = '';
  for(let i = 1; i < lines.length; i++){
    const dt = lines[i].slice(0, lines[i].indexOf(','));
    if(dt > latest) latest = dt;
  }

  const rows = parseCSV(lines.filter((l, i) => i === 0 || l.startsWith(latest + ',')).join('\n'));

  const teams = {};
  for(let i = 1; i < rows.length; i++){
    const f = rows[i];
    if(f.length !== head.length) continue;
    if(f[I.group] !== '3WR 1TE') continue;           // the offensive unit
    const raw = f[I.pos];
    if(!DEPTH_POS.has(raw)) continue;                // drops the O-line
    const pos = raw === 'FB' ? 'RB' : raw;
    const abbr = team(f[I.team]);
    const rank = Number(f[I.rank]) || 99;
    ((teams[abbr] = teams[abbr] || {})[pos] = teams[abbr][pos] || []).push({
      n: f[I.name], r: rank, espn: f[I.espn] || ''
    });
  }
  for(const slots of Object.values(teams))
    for(const list of Object.values(slots)) list.sort((a, b) => a.r - b.r);

  const payload = { season, asOf: latest, built: new Date().toISOString(),
                    source: 'nflverse-data depth_charts', teams };

  const file = path.join(OUT_DIR, `depth-${season}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`${Object.keys(teams).length} teams as of ${latest.slice(0,10)} → data/depth-${season}.json (${kb} KB)`);
  return payload;
}

/* ------------------------------------------------------------
   Mock-draft ADP.

   The dashboard normally reads this live through the proxy, because FFC
   sends no CORS header and no browser can read it directly. A snapshot is
   baked anyway, for one reason: draft night. If the Worker is down, or a
   rate limit bites at pick 40, a board that still opens on last night's
   consensus is worth far more than a board that does not open. The view
   labels which one it is showing.
   ------------------------------------------------------------ */
const ADP_SRC = (year, teams, format) =>
  `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${year}`;

async function buildAdp(season, teams = 12, format = 'ppr'){
  process.stdout.write(`  ${season} ADP (${teams}-team ${format}): fetching… `);

  const res = await fetch(ADP_SRC(season, teams, format), {
    headers: {'Accept': 'application/json', 'User-Agent': 'control-deck (personal dashboard)'}
  });
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const d = await res.json();
  if(d.status !== 'Success' || !Array.isArray(d.players))
    throw new Error('the feed returned an unexpected shape');

  const payload = {season, built: new Date().toISOString(),
                   source: 'fantasyfootballcalculator.com', meta: d.meta || {},
                   players: d.players};

  const file = path.join(OUT_DIR, `adp-${season}.json`);
  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(file, JSON.stringify(payload));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`${d.players.length} players from ${(d.meta && d.meta.total_drafts || 0).toLocaleString()} drafts → data/adp-${season}.json (${kb} KB)`);
  return payload;
}

/* ------------------------------------------------------------
   Offensive line.

   Two measurements, both from Pro Football Reference's charting, and both
   chosen because they isolate the line from the man behind it:

     run block   yards before contact per carry. Yards BEFORE contact are
                 the line's doing; yards after are the back's. Team rushing
                 average cannot tell those apart, which is why it is a bad
                 line stat and this is a good one.
     pass block  pressure rate allowed. Sacks alone under-count it — a QB
                 who gets rid of it fast hides a leaky line — so the rate
                 at which the pocket breaks is the honest number.

   Note times_pressured_pct arrives as a fraction (0.182 = 18.2%), not as a
   percentage. Reading it as the latter yields 50,000 dropbacks a season.
   ------------------------------------------------------------ */
const RUSH_SRC = y => `https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_rush_${y}.csv`;
const PASS_SRC = y => `https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_pass_${y}.csv`;

async function grab(url){
  const res = await fetch(url, {redirect: 'follow'});
  if(res.status === 404) return null;
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const rows = parseCSV(await res.text());
  const head = rows[0];
  return rows.slice(1)
    .filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

async function buildLine(season){
  process.stdout.write(`  ${season} offensive line: fetching… `);

  const [rush, pass] = await Promise.all([grab(RUSH_SRC(season)), grab(PASS_SRC(season))]);
  if(!rush || !pass){ console.log('not published yet — skipped.'); return null; }

  const acc = {};
  const at = t => acc[t] || (acc[t] = {ybc: 0, carries: 0, pressured: 0, sacked: 0, dropbacks: 0});

  for(const r of rush){
    if(r.game_type !== 'REG') continue;
    const carries = Number(r.carries) || 0;
    if(!carries) continue;
    const x = at(team(r.team));
    x.carries += carries;
    x.ybc += Number(r.rushing_yards_before_contact) || 0;
  }

  for(const r of pass){
    if(r.game_type !== 'REG') continue;
    const pressured = Number(r.times_pressured) || 0;
    const pct = parseFloat(r.times_pressured_pct);
    if(!(pct > 0)) continue;                       // no dropbacks to divide by
    const x = at(team(r.team));
    x.pressured += pressured;
    x.sacked    += Number(r.times_sacked) || 0;
    x.dropbacks += Math.round(pressured / pct);
  }

  const rows = Object.entries(acc)
    .filter(([, x]) => x.carries && x.dropbacks)
    .map(([abbr, x]) => ({
      team: abbr,
      ybc:      round2(x.ybc / x.carries),
      pressure: round1(100 * x.pressured / x.dropbacks),
      sack:     round1(100 * x.sacked / x.dropbacks)
    }));

  /* Rank 1 is best at both, so pressure sorts the other way round. */
  [...rows].sort((a, b) => b.ybc - a.ybc).forEach((r, i) => { r.runRank = i + 1; });
  [...rows].sort((a, b) => a.pressure - b.pressure).forEach((r, i) => { r.passRank = i + 1; });

  /* One number for a running back, who cares about the run block roughly
     twice as much as he cares about the pocket. */
  for(const r of rows) r.blend = round1(r.runRank * 0.65 + r.passRank * 0.35);
  [...rows].sort((a, b) => a.blend - b.blend).forEach((r, i) => { r.rank = i + 1; });

  const teams = {};
  for(const r of rows){
    const {team: abbr, ...rest} = r;
    teams[abbr] = rest;
  }

  const file = path.join(OUT_DIR, `line-${season}.json`);
  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(file, JSON.stringify({season, built: new Date().toISOString(),
                                         source: 'nflverse pfr_advstats', teams}));
  const best = rows.find(r => r.rank === 1), worst = rows.find(r => r.rank === rows.length);
  console.log(`${rows.length} teams (best ${best.team}, worst ${worst.team}) → data/line-${season}.json`);
  return teams;
}
(async () => {
  let seasons = process.argv.slice(2).map(Number).filter(Boolean);
  if(!seasons.length){
    /* Before September the current year has no games, so "this season and
       last" means the year we are in and the one before it. */
    const now = new Date();
    const year = now.getFullYear();
    seasons = [year - 1, year];
  }
  console.log(`Baking season data for: ${seasons.join(', ')}`);
  for(const s of seasons){
    try{ await build(s); }
    catch(e){ console.error(`  ${s} weekly stats: FAILED — ${e.message}`); process.exitCode = 1; }
  }
  /* Depth charts only make sense for the season being played — last year's
     final chart is history nobody drafts against. */
  const current = Math.max(...seasons);
  try{ await buildDepth(current); }
  catch(e){ console.error(`  ${current} depth charts: FAILED — ${e.message}`); process.exitCode = 1; }
  try{ await buildLine(Math.min(...seasons)); }
  catch(e){ console.error(`  offensive line: FAILED — ${e.message}`); process.exitCode = 1; }
  try{ await buildAdp(current); }
  catch(e){ console.error(`  ${current} ADP: FAILED — ${e.message}`); process.exitCode = 1; }
})();
