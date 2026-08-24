/* ============================================================
   ffdata.js — the fantasy draft/season model. No DOM in here.

   Four sources, each chosen because it is the one that can actually
   be read from a browser on GitHub Pages:

     data/season-YYYY.json   baked from nflverse; true PPR scoring,
                             week by week, so high/low/average/median
                             are the real thing rather than a guess
                             at a scoring rule
     data/depth-YYYY.json    baked from nflverse; the current offensive
                             depth chart with a real rank per position
     FFC /ffc/adp            via the proxy: the consensus of every
                             12-team PPR mock draft run in the last
                             seven days — thousands of them, with the
                             high pick, low pick and spread per player
     ESPN site API           the live injury report; browser-direct,
                             because ESPN answers 403 to datacentre IPs
                             and routing it through the Worker breaks it

   Everything is joined on a normalised name plus position.
   ============================================================ */

const FFData = (() => {

  /* ---- small cache on its own localStorage keys ----
     Deliberately NOT inside Store: this is disposable derived data, it
     would bloat the settings backup, and it wants its own expiry. */
  const CACHE = 'ffcache.';

  function cached(key, maxAgeMs){
    try{
      const raw = localStorage.getItem(CACHE + key);
      if(!raw) return null;
      const box = JSON.parse(raw);
      if(Date.now() - box.at > maxAgeMs) return null;
      return box.data;
    }catch{ return null; }
  }

  function keep(key, data){
    try{ localStorage.setItem(CACHE + key, JSON.stringify({at: Date.now(), data})); }
    catch{ /* quota — the fetch still worked, it just will not survive a reload */ }
  }

  /* ---- name matching ----
     FFC writes "Marvin Harrison Jr.", nflverse writes "Marvin Harrison".
     Suffixes, punctuation and accents all have to come off before any of
     the three sources will line up. */
  function norm(name){
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents off
      .replace(/[^a-z ]/g, '')                            // apostrophes, periods, hyphens
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')            // generational suffixes
      .replace(/\s+/g, ' ')
      .trim();
  }

  const key = (name, pos) => norm(name) + '|' + pos;

  /* nflverse and FFC both say WAS; ESPN says WSH. nflverse says LA for the
     Rams. Everything is normalised to ESPN's spelling, because the league
     is on ESPN and that is where the roster data comes from. */
  const TEAM_FIX = {WAS:'WSH', LA:'LAR', JAC:'JAX', OAK:'LV', SD:'LAC', STL:'LAR'};
  const team = t => TEAM_FIX[String(t || '').toUpperCase()] || String(t || '').toUpperCase();

  /* ESPN speaks in numbers. These two maps are the whole translation
     layer between a fantasy roster entry and a real football player;
     fantasy.js and ffseason.js both read them from here rather than
     each keeping its own copy to drift out of step. */
  const ESPN_POS = {1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DEF'};
  const ESPN_TEAM = {
    1:'ATL',  2:'BUF',  3:'CHI',  4:'CIN',  5:'CLE',  6:'DAL',  7:'DEN',  8:'DET',
    9:'GB',  10:'TEN', 11:'IND', 12:'KC',  13:'LV',  14:'LAR', 15:'MIA', 16:'MIN',
    17:'NE', 18:'NO',  19:'NYG', 20:'NYJ', 21:'PHI', 22:'ARI', 23:'PIT', 24:'LAC',
    25:'SF', 26:'SEA', 27:'TB',  28:'WSH', 29:'CAR', 30:'JAX', 33:'BAL', 34:'HOU'
  };

  const LEAGUE_SIZE = 12;

  /* ---- config ---- */
  const season = () => Number(Store.get('fantasy.season', String(new Date().getFullYear())));
  const proxy  = () => Store.get('fantasy.proxy', '').replace(/\/$/, '');
  /* The season whose finished scoring is the baseline. Before September the
     current year has not been played, so it is last year; once games exist
     the current year takes over and last year becomes the fallback. */
  const priorSeason = () => season() - 1;

  /* ---- raw loaders ---- */

  async function localJSON(path){
    const res = await fetch(path, {cache: 'default'});
    if(res.status === 404) return null;           // a season not baked yet
    if(!res.ok) throw new Error(path + ': ' + res.status);
    return res.json();
  }

  /* Mock-draft ADP.

     Live through the proxy, because FFC sends no CORS header and no browser
     can read it from any origin. Cached for six hours — the feed is a
     rolling seven-day window and does not move faster than that.

     If the proxy is missing or not answering, the baked snapshot in data/
     stands in. That is not a nicety: on draft night a board that opens on
     last night's consensus beats a board that does not open, and the view
     says which one it is showing. */
  const shape = raw => ({
    name: raw.name,
    pos:  raw.position === 'PK' ? 'K' : raw.position,
    team: team(raw.team),
    adp:  raw.adp,
    slot: raw.adp_formatted,
    high: raw.high,
    low:  raw.low,
    sd:   raw.stdev,
    n:    raw.times_drafted,
    bye:  raw.bye
  });

  async function loadAdp(){
    const yr = season();
    const ck = 'adp.' + yr;
    const hit = cached(ck, 6 * 60 * 60 * 1000);
    if(hit) return hit;

    const p = proxy();
    if(p){
      try{
        const d = await getJSON(p + '/ffc/adp?teams=' + LEAGUE_SIZE + '&year=' + yr + '&format=ppr');
        if(d.status !== 'Success' || !Array.isArray(d.players))
          throw new Error('the ADP feed returned an unexpected shape');
        const out = {live: true, meta: d.meta || {}, players: d.players.map(shape)};
        keep(ck, out);
        return out;
      }catch(e){ adpNote = 'Live ADP failed (' + e.message + ') — showing the baked snapshot.'; }
    }else{
      adpNote = 'No proxy set, so ADP is the baked snapshot rather than the live feed.';
    }

    const baked = await localJSON('data/adp-' + yr + '.json');
    if(!baked || !Array.isArray(baked.players)) throw new Error('no-adp');
    return {live: false, built: baked.built, meta: baked.meta || {},
            players: baked.players.map(shape)};
  }

  /* Why the board is showing what it is showing, if it is not the live feed. */
  let adpNote = '';

  /* The live injury report. Public, CORS-open, no key. */
  async function loadInjuries(){
    const hit = cached('injuries', 15 * 60 * 1000);
    if(hit) return hit;

    const d = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
    const out = [];
    for(const t of (d.injuries || []))
      for(const it of (t.injuries || []))
        out.push({
          team:   team(t.abbreviation),
          name:   it.athlete?.displayName || '',
          pos:    it.athlete?.position?.abbreviation || '',
          status: (it.status || '').toUpperCase().replace(/\s+/g, '_'),
          detail: it.details?.type || it.shortComment || it.longComment || '',
          date:   it.date || ''
        });
    keep('injuries', out);
    return out;
  }

  /* ---- injury severity ---- */
  const OUT    = ['OUT', 'DOUBTFUL', 'INJURY_RESERVE', 'SUSPENSION', 'PUP', 'NFI'];
  const DINGED = OUT.concat(['QUESTIONABLE']);

  function statusRank(s){
    s = String(s || '').toUpperCase();
    if(s.includes('INJURY_RESERVE') || s === 'IR' || s === 'PUP' || s === 'NFI') return 4;
    if(s === 'OUT' || s === 'SUSPENSION') return 3;
    if(s === 'DOUBTFUL') return 2;
    if(s === 'QUESTIONABLE') return 1;
    return 0;
  }

  /* ---- the joined index ---- */

  let index  = null;         // Map: "name|POS" → player
  let bundle = null;         // everything the views need
  let pending = null;

  async function load(opts = {}){
    if(bundle && !opts.force) return bundle;
    if(pending && !opts.force) return pending;

    pending = (async () => {
      const yr = season(), prior = priorSeason();

      /* Every source is allowed to fail on its own. A missing ADP feed
         should cost the ADP column, not the whole tab. */
      const [adpRes, curRes, priorRes, depthRes, injRes] = await Promise.allSettled([
        loadAdp(),
        localJSON('data/season-' + yr + '.json'),
        localJSON('data/season-' + prior + '.json'),
        localJSON('data/depth-' + yr + '.json'),
        loadInjuries()
      ]);

      const val = r => r.status === 'fulfilled' ? r.value : null;
      const adp      = val(adpRes);
      const current  = val(curRes);
      const past     = val(priorRes);
      const depth    = val(depthRes);
      const injuries = val(injRes) || [];

      const problems = [];
      if(!adp) problems.push(adpRes.reason?.message === 'no-adp'
        ? 'No ADP at all — the proxy is unreachable and data/adp-' + yr + '.json is missing. Run "node tools/build-season.js".'
        : 'Mock-draft ADP unavailable (' + (adpRes.reason?.message || 'unknown') + ').');
      else if(!adp.live) problems.push(adpNote || 'Showing the baked ADP snapshot, not the live feed.');
      if(!past && !current)
        problems.push('No baked season data — run "node tools/build-season.js" and commit data/.');
      if(injRes.status === 'rejected') problems.push('The injury report would not load right now.');

      /* The season in play: the current one once anyone has taken a snap,
         otherwise last year. Both are kept — the season view wants "this
         year so far", the draft board wants "last year". */
      const live = current && current.players && current.players.length ? current : null;

      index = new Map();

      const touch = (name, pos, teamAbbr) => {
        const k = key(name, pos);
        let p = index.get(k);
        if(!p){
          p = {key: k, name, pos, team: team(teamAbbr), bye: null,
               adp: null, last: null, now: null, depth: null, injury: null};
          index.set(k, p);
        }
        return p;
      };

      /* ADP first: it is the only source that knows a player's team for the
         season about to be played, and it is the spine of the draft board. */
      if(adp) for(const a of adp.players){
        const p = touch(a.name, a.pos, a.team);
        p.adp  = a;
        p.bye  = a.bye;
        p.team = a.team;
      }

      const statLine = (src, s) => ({
        g: s.g, tot: s.tot, avg: s.avg, med: s.med, hi: s.hi, lo: s.lo,
        weeks: s.w, scores: s.s, opps: s.o || [], season: src.season
      });

      if(past) for(const s of past.players){
        const p = touch(s.n, s.p, s.t);
        p.last = statLine(past, s);
      }

      if(live) for(const s of live.players){
        const p = touch(s.n, s.p, s.t);
        p.now  = statLine(live, s);
        p.team = team(s.t);                       // in-season this is authoritative
      }

      /* Depth chart rank. */
      if(depth) for(const [abbr, slots] of Object.entries(depth.teams || {}))
        for(const [pos, list] of Object.entries(slots))
          for(const entry of list){
            const p = touch(entry.n, pos, abbr);
            p.depth = entry.r;
            if(!p.adp) p.team = team(abbr);
          }

      /* Injuries last, so they land on players the other sources created.
         Worst designation wins if a player somehow appears twice. */
      for(const inj of injuries){
        const p = index.get(key(inj.name, inj.pos));
        if(p && statusRank(inj.status) >= statusRank(p.injury && p.injury.status)) p.injury = inj;
      }

      const players = [...index.values()];
      const liveDef = live && live.defence && Object.keys(live.defence).length ? live : null;

      bundle = {
        season: yr,
        priorSeason: prior,
        adpMeta: adp ? adp.meta : null,
        adpLive: adp ? !!adp.live : false,
        adpBuilt: adp && adp.built ? adp.built : null,
        depthAsOf: depth ? depth.asOf : null,
        statSeason: live ? live.season : (past ? past.season : null),
        hasLive: !!live,
        players, index, injuries,
        defence: (liveDef || past || {}).defence || {},
        defenceSeason: (liveDef || past || {}).season || null,
        problems
      };

      buildGroups(bundle);
      return bundle;
    })();

    try{ return await pending; }
    finally{ pending = null; }
  }

  /* ---- position groups ----
     "Everyone else who plays his position on his team", ordered by the real
     depth chart where there is one and by scoring where there is not. This
     is what makes an injury actionable: the man who gains is the next name
     on this list, not just "somebody on that team". */
  function buildGroups(b){
    const groups = new Map();                       // "TEAM|POS" → [player]
    for(const p of b.players){
      if(!p.team || !p.pos) continue;
      const k = p.team + '|' + p.pos;
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const ppg = p => (p.now && p.now.avg) ?? (p.last && p.last.avg) ?? -1;
    for(const list of groups.values())
      list.sort((a, c) =>
        (a.depth ?? 99) - (c.depth ?? 99) ||
        ppg(c) - ppg(a) ||
        ((a.adp && a.adp.adp) ?? 999) - ((c.adp && c.adp.adp) ?? 999));
    b.groups = groups;
  }

  /* Every other player at this player's position on his NFL team. */
  function mates(player){
    if(!bundle || !player || !player.team) return [];
    return (bundle.groups.get(player.team + '|' + player.pos) || [])
      .filter(p => p.key !== player.key);
  }

  /* The whole position group including the player, in depth order. */
  function group(teamAbbr, pos){
    if(!bundle) return [];
    return bundle.groups.get(team(teamAbbr) + '|' + pos) || [];
  }

  /* ---- replacement level ----
     A 12-team league starting QB/RB/RB/WR/WR/TE/FLEX drafts roughly 12 QBs,
     30 RBs, 36 WRs and 12 TEs before the position stops mattering. The
     player at that rank is the one available for nothing, so only the points
     above him are worth spending a pick on. */
  const REPLACEMENT = {QB: 12, RB: 30, WR: 36, TE: 12, K: 12, DEF: 12};
  const MIN_GAMES = 6;      // a two-game cameo must not set the baseline

  function replacementLevels(field){
    const out = {};
    for(const [pos, rank] of Object.entries(REPLACEMENT)){
      const pool = (bundle ? bundle.players : [])
        .filter(p => p.pos === pos && p[field] && p[field].g >= MIN_GAMES)
        .map(p => p[field].avg)
        .sort((a, b) => b - a);
      out[pos] = pool.length ? (pool[Math.min(rank, pool.length) - 1] || 0) : 0;
    }
    return out;
  }

  /* ---- will he last? ----
     FFC reports a standard deviation per player, so the pick a player goes
     at can be treated as roughly normal around his ADP. That turns "is he
     going to be there at 32?" into a number instead of a feeling. */
  function erf(x){
    /* Abramowitz & Stegun 7.1.26 — ample for a percentage on a screen. */
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                  - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }
  const normalCdf = (x, mu, sd) =>
    sd > 0 ? 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2))) : (x >= mu ? 1 : 0);

  /* Probability a player is still on the board when pick `at` comes round. */
  function survival(player, at){
    const a = player && player.adp;
    if(!a || !at) return null;
    const sd = a.sd && a.sd > 0.3 ? a.sd : 1.5;    // FFC reports 0 for near-locks
    return 1 - normalCdf(at, a.adp, sd);
  }

  /* ---- defence: fantasy points allowed ----
     Every point a player scores is a point the defence he faced gave up, so
     the same weekly file yields both sides of it. Rank 1 is the softest —
     the matchup you want your man to be walking into. */
  function defenceRanks(pos){
    const d = (bundle && bundle.defence) || {};
    const rows = Object.entries(d)
      .filter(([, slots]) => slots[pos])
      .map(([abbr, slots]) => ({team: abbr, avg: slots[pos].avg}))
      .sort((a, b) => b.avg - a.avg);              // most points allowed first
    const out = {};
    rows.forEach((r, i) => { out[r.team] = {rank: i + 1, of: rows.length, avg: r.avg}; });
    return out;
  }

  /* ---- snake draft arithmetic ---- */
  const pickOf = (round, slot, teams = LEAGUE_SIZE) =>
    round % 2 ? (round - 1) * teams + slot : round * teams - slot + 1;

  function myPicks(slot, teams = LEAGUE_SIZE, rounds = 16){
    const out = [];
    for(let r = 1; r <= rounds; r++) out.push({round: r, pick: pickOf(r, slot, teams)});
    return out;
  }

  function onClock(pickNo, teams = LEAGUE_SIZE){
    const round = Math.floor((pickNo - 1) / teams) + 1;
    const i = (pickNo - 1) % teams;
    return {round, slot: round % 2 ? i + 1 : teams - i};
  }

  function clearCache(){
    for(const k of Object.keys(localStorage))
      if(k.startsWith(CACHE)) localStorage.removeItem(k);
    bundle = null; index = null;
  }

  return {
    load, mates, group, replacementLevels, survival, defenceRanks,
    pickOf, myPicks, onClock, clearCache, norm, key, team, statusRank,
    LEAGUE_SIZE, REPLACEMENT, OUT, DINGED, ESPN_POS, ESPN_TEAM,
    get bundle(){ return bundle; }
  };
})();

window.FFData = FFData;
