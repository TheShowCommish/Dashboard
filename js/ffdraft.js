/* ============================================================
   ffdraft.js — the live draft board.

   Four things a spreadsheet cannot do on draft night:

   1. It knows whose turn it is. Picks go in as they happen, the snake
      order advances itself, and the board only ever shows who is left.
   2. It answers "can I wait?" with a number. FFC reports a standard
      deviation per player, so the pick he goes at is roughly normal
      around his ADP — which turns "will he last until 32?" into a
      percentage instead of a feeling.
   3. It separates price from value. ADP is what the room will pay.
      Points over replacement is what the player is worth. The gap
      between those two rankings is the only edge a draft board has.
   4. It watches your targets for you. Name the tight end you want in
      August and it will tell you on the night that taking him here is
      a round early — and tell you when it stops being early.

   Everything measured here is last season's real PPR scoring, labelled
   with its year everywhere it appears, because a backward-looking
   number dressed up as a projection is worse than no number.
   ============================================================ */

const FFDraft = (() => {

  const RUN_WINDOW = 12;          // a "run" is judged over the last round of picks
  const LIKELY = 0.5;             // "more likely than not still there"

  /* ---- persisted draft state ---- */
  const teamCount = () => Math.max(4, Math.min(16, Number(Store.get('draft.teams', 12)) || 12));
  const rounds    = () => Math.max(1, Math.min(30, Number(Store.get('draft.rounds', 16)) || 16));
  const slot      = () => Math.min(teamCount(), Math.max(1, Number(Store.get('draft.slot', 1)) || 1));
  const picks     = () => Store.get('draft.picks', []) || [];
  const targets   = () => Store.get('draft.targets', []) || [];

  const setPicks   = list => Store.set('draft.picks', list);
  const setTargets = list => Store.set('draft.targets', list);

  /* Team names, so the board reads "Kyle took Bijan" rather than "team 7 did". */
  function names(){
    const saved = Store.get('draft.names', null);
    const out = [];
    for(let i = 0; i < teamCount(); i++)
      out.push((saved && saved[i]) || (i + 1 === slot() ? 'You' : 'Team ' + (i + 1)));
    return out;
  }
  const teamName = s => names()[s - 1] || ('Team ' + s);

  /* ---- view state (not worth persisting) ---- */
  let filterPos = 'ALL';
  let search    = '';
  let hideTaken = true;
  let sortKey   = 'adp';
  let sortDir   = 1;              // 1 ascending, -1 descending

  const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const one = n => (n == null || !isFinite(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);
  const pct = n => n == null ? '—' : Math.round(n * 100) + '%';

  /* ---- columns ----
     One definition drives the header, the sort and the tooltip, so a column
     cannot end up labelled one thing and sorted by another. */
  const COLUMNS = [
    {key:'adp',  label:'ADP',    num:true,
     title:'Average draft position across the mock drafts, as round.pick. Lowest goes first.',
     get:p => p.adp ? p.adp.adp : Infinity},
    {key:'name', label:'Player',
     title:'Name, position, NFL team, bye week and depth-chart rank',
     get:p => p.name.toLowerCase()},
    {key:'sup',  label:'Support', num:true,
     title:'What he is walking into. RB: his offensive line, graded on last season’s charting. WR and TE: his quarterback. QB: his top two receivers. The scales differ by position, so sort this with a position filter on.',
     get:p => p._supportScore == null ? -1 : p._supportScore},
    {key:'avg',  label:'PPG',    num:true,
     title:'Points per game last season, in true PPR scoring',
     get:p => p._stat ? p._stat.avg : -1},
    {key:'med',  label:'MED',    num:true,
     title:'His median week — half his games beat this, half did not. Far below the average means boom and bust.',
     get:p => p._stat ? p._stat.med : -1},
    {key:'hilo', label:'HI/LO',  num:true,
     title:'His best week and his worst week',
     get:p => p._stat ? p._stat.hi : -1},
    {key:'vor',  label:'VOR',    num:true,
     title:'Points per game above the last startable player at his position (QB12, RB30, WR36, TE12 in a 12-team league). What he is worth, as against what he costs.',
     get:p => p._vor == null ? -999 : p._vor},
    {key:'last', label:'LASTS',  num:true,
     title:'The chance he is still on the board at your next pick, from his ADP and how tightly the mock drafts agree on it',
     get:p => p._surv == null ? -1 : p._surv},
    {key:'act',  label:'', title:'', sortable:false}
  ];

  /* ---- derived board ---- */

  /* Which stat line stands in for "what this player is worth": this season
     once it exists, last season before that. */
  const field = () => (FFData.bundle && FFData.bundle.hasLive) ? 'now' : 'last';

  /* Support quality as one number, so the column can be sorted. The scales are
     per-position and deliberately not comparable across them — an offensive
     line rank and a quarterback's scoring average do not share a unit — which
     is why the header says to sort it with a position filter on. */
  function supportScore(sup){
    if(!sup) return null;
    const ppg = pl => {
      const st = (pl.now && pl.now.g) ? pl.now : (pl.last && pl.last.g ? pl.last : null);
      return st ? st.avg : null;
    };
    if(sup.kind === 'ol') return (33 - sup.rank) / 32;
    if(sup.kind === 'qb'){
      const v = ppg(sup.player);
      return v == null ? null : Math.min(v / 25, 1);
    }
    if(sup.kind === 'wr'){
      const vals = sup.players.map(w => ppg(w) || 0);
      return Math.min((vals.reduce((a, b) => a + b, 0) / vals.length) / 20, 1);
    }
    return null;
  }

  let cache = null;               // rebuilt on every render; cheap at 267 players

  function board(){
    const b = FFData.bundle;
    if(!b) return null;

    const f = field();
    const repl = FFData.replacementLevels(f);
    const taken = new Map();
    picks().forEach((k, i) => { if(k) taken.set(k, i + 1); });
    const target = new Set(targets());
    const c = clock();

    const pool = b.players.filter(p => p.adp);
    pool.sort((x, y) => x.adp.adp - y.adp.adp);

    pool.forEach((p, i) => {
      p._adpRank = i + 1;
      const stat = p[f];
      p._stat = stat || null;
      p._vor = stat && stat.g >= 1 ? stat.avg - (repl[p.pos] || 0) : null;
      p._support = FFData.support(p);
      p._supportScore = supportScore(p._support);
      p._takenAt = taken.get(p.key) || null;
      p._taken = !!p._takenAt;
      p._target = target.has(p.key);
      p._surv = (c.done || !c.myNext) ? null : FFData.survival(p, c.myNext.pick);
    });

    /* Value ranking, nulls last: a rookie with no NFL snap is not "worth
       zero", he is unmeasured, and sorting him alongside a measured zero
       would be a lie the board tells every year. */
    const measured = pool.filter(p => p._vor != null).sort((x, y) => y._vor - x._vor);
    measured.forEach((p, i) => { p._vorRank = i + 1; });
    pool.filter(p => p._vor == null).forEach(p => { p._vorRank = null; });
    pool.forEach(p => { p._edge = p._vorRank == null ? null : p._adpRank - p._vorRank; });

    cache = {pool, repl, taken, clock: c};
    return cache;
  }

  /* ---- draft position arithmetic ---- */

  /* The next unfilled pick. Editing the grid can leave a hole behind, and the
     clock belongs at the hole rather than at the end of the list. */
  function nextEmpty(){
    const list = picks();
    const total = teamCount() * rounds();
    for(let i = 0; i < Math.min(list.length, total); i++) if(!list[i]) return i + 1;
    return Math.min(list.length + 1, total + 1);
  }

  function clock(){
    const total = teamCount() * rounds();
    const next = nextEmpty();
    const done = next > total;
    const at = FFData.onClock(Math.min(next, total), teamCount());
    const mine = FFData.myPicks(slot(), teamCount(), rounds());
    const upcoming = mine.filter(m => m.pick >= next);
    return {
      next, done, total,
      round: at.round, slotOnClock: at.slot,
      isMine: !done && at.slot === slot(),
      myNext: upcoming[0] || null,
      myAfter: upcoming[1] || null,
      upcoming, mine
    };
  }

  /* Every pick a given seat has made. */
  function rosterOf(seat){
    const b = FFData.bundle;
    if(!b) return [];
    return picks()
      .map((k, i) => ({key: k, pick: i + 1}))
      .filter(x => x.key && FFData.onClock(x.pick, teamCount()).slot === seat)
      .map(x => {
        const p = b.index.get(x.key);
        return p ? Object.assign({}, p, {pick: x.pick}) : null;
      })
      .filter(Boolean);
  }
  const myRoster = () => rosterOf(slot());

  /* A positional run: how the last round of picks was spent. Five running
     backs in nine picks is the whole reason to break your own board. */
  function runs(){
    const b = FFData.bundle;
    if(!b) return [];
    const recent = picks().filter(Boolean).slice(-RUN_WINDOW);
    const count = {};
    for(const k of recent){
      const p = b.index.get(k);
      if(p) count[p.pos] = (count[p.pos] || 0) + 1;
    }
    return Object.entries(count).sort((a, c) => c[1] - a[1]);
  }

  /* ---- needs ----
     What the lineup still wants. An empty starting slot is worth far more
     than a fifth running back, and a kicker is worth nothing at all until
     the end of the draft. */
  const STARTERS = {QB: 1, RB: 2, WR: 2, TE: 1};
  const FLEX = ['RB', 'WR', 'TE'];

  function needs(){
    const mine = myRoster();
    const have = {};
    for(const p of mine) have[p.pos] = (have[p.pos] || 0) + 1;

    const flexUsed = FLEX.reduce((a, pos) =>
      a + Math.max(0, (have[pos] || 0) - (STARTERS[pos] || 0)), 0);

    const weights = {};
    for(const pos of ['QB', 'RB', 'WR', 'TE']){
      const got = have[pos] || 0;
      if(got < STARTERS[pos]) weights[pos] = 1;                      // an empty starting slot
      else if(FLEX.includes(pos) && flexUsed < 1) weights[pos] = 0.7; // the flex
      else weights[pos] = 0.25;                                      // depth
    }
    /* Kickers and defences are last-two-rounds business and nothing else. */
    const late = clock().round >= rounds() - 2;
    for(const pos of ['K', 'DEF'])
      weights[pos] = (have[pos] || 0) ? 0.05 : (late ? 0.8 : 0.02);

    return {weights, have, flexUsed};
  }

  /* ---- what to take next ----
     Value alone says take the best player; need alone says fill the hole.
     Neither is right by itself, and what reconciles them is the drop-off:
     how much worse the best man at a position will be by the time your pick
     comes round again. A position with a cliff behind it is worth reaching
     for. One with ten interchangeable players is not. */
  function suggestions(limit = 4){
    const data = cache || board();
    if(!data) return [];
    const c = data.clock;
    if(c.done) return [];

    const {weights} = needs();
    const avail = data.pool.filter(p => !p._taken && p._vor != null);
    const after = c.myAfter ? c.myAfter.pick : null;

    const byPos = {};
    for(const p of avail) (byPos[p.pos] = byPos[p.pos] || []).push(p);

    const out = [];
    for(const [pos, list] of Object.entries(byPos)){
      list.sort((a, b) => b._vor - a._vor);
      const best = list[0];
      if(!best) continue;

      /* The best man here who is more likely than not to still be around at
         the pick after this one. */
      const survivor = after
        ? list.find(p => (FFData.survival(p, after) ?? 0) >= LIKELY)
        : null;
      const dropoff = survivor ? Math.max(0, best._vor - survivor._vor) : best._vor;
      const weight = weights[pos] ?? 0.25;

      out.push({player: best, pos, vor: best._vor, dropoff, weight, survivor,
                score: best._vor * weight + dropoff});
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /* ---- target advice ----
     The question a target list has to answer is not "is he any good" but "is
     now the moment". Three facts settle it: whether he is already gone, how
     likely he is to survive each of your remaining picks, and how far past
     his usual spot the draft has already run. */
  function advise(player){
    const c = cache ? cache.clock : clock();

    if(player._taken)
      return {state:'gone', short:'GONE',
              text:'Taken at pick ' + player._takenAt + ' by ' +
                   teamName(FFData.onClock(player._takenAt, teamCount()).slot) + '.'};

    if(c.done)      return {state:'done', short:'—', text:'The draft is over.'};
    if(!player.adp) return {state:'unknown', short:'—', text:'No ADP, so there is nothing to time.'};
    if(!c.myNext)   return {state:'done', short:'—', text:'You have no picks left.'};

    const a = player.adp;
    const sd = a.sd && a.sd > 0.3 ? a.sd : 1.5;
    const steal = c.next > a.adp + 1.5 * sd;      // lasted well past his usual spot

    /* The latest of your remaining picks where he is still more likely than
       not to be on the board. */
    let lastSafe = null;
    for(const p of c.upcoming)
      if((FFData.survival(player, p.pick) ?? 0) >= LIKELY) lastSafe = p;

    const survNext = FFData.survival(player, c.myNext.pick) ?? 0;

    /* A steal is checked before anything else on your own pick. A player who
       has slid well past where the room takes him is the same decision as a
       player who will not last — take him — but it is worth saying WHY, and
       "he has fallen a round and a half" is the more useful sentence. */
    if(steal && c.isMine)
      return {state:'steal', short:'STEAL',
              text:'He has slid ' + Math.round(c.next - a.adp) + ' picks past his usual spot (' +
                   a.slot + '). Take him.'};

    if(!lastSafe)
      return c.isMine
        ? {state:'now', short:'TAKE NOW',
           text:'Only ' + pct(FFData.survival(player, c.myAfter ? c.myAfter.pick : c.myNext.pick) ?? 0) +
                ' to last to your pick after this. If you want him, this is the pick.'}
        : {state:'slipping', short:'SLIPPING',
           text:'Only ' + pct(survNext) + ' to reach your pick at ' + c.myNext.pick + '.'};

    if(steal)
      return {state:'steal', short:'STEAL',
              text:'The draft is ' + Math.round(c.next - a.adp) + ' picks past his usual spot (' +
                   a.slot + ') and he is still sitting there — ' +
                   pct(survNext) + ' to reach your pick at ' + c.myNext.pick + '.'};

    if(c.isMine && lastSafe.pick > c.myNext.pick)
      return {state:'early', short:'TOO EARLY',
              text:'A round early — he is ' + pct(FFData.survival(player, lastSafe.pick) ?? 0) +
                   ' to still be there at pick ' + lastSafe.pick + ' (round ' + lastSafe.round + ').'};

    if(c.isMine)
      return {state:'now', short:'NOW',
              text:'This is his spot — only ' + pct(FFData.survival(player, c.myAfter ? c.myAfter.pick : c.myNext.pick) ?? 0) +
                   ' to last to your next one.'};

    return {state:'wait', short:'WAIT',
            text:'Wait for pick ' + lastSafe.pick + ' (round ' + lastSafe.round + ') — ' +
                 pct(FFData.survival(player, lastSafe.pick) ?? 0) + ' to still be there.'};
  }

  /* ---- actions ---- */
  function take(key, atPick){
    const total = teamCount() * rounds();
    const at = atPick || nextEmpty();
    if(at > total) return;
    const list = picks().slice();
    for(const [i, k] of list.entries()) if(k === key) list[i] = null;   // never drafted twice
    while(list.length < at) list.push(null);
    list[at - 1] = key;
    setPicks(list);
    render();
  }

  function clearPick(at){
    const list = picks().slice();
    if(at - 1 < list.length){ list[at - 1] = null; setPicks(list); render(); }
  }

  function undo(){
    const list = picks().slice();
    for(let i = list.length - 1; i >= 0; i--)
      if(list[i]){ list[i] = null; break; }
    while(list.length && !list[list.length - 1]) list.pop();
    setPicks(list);
    render();
  }

  function reset(){
    if(!confirm('Clear every pick and start the draft over?')) return;
    setPicks([]);
    render();
  }

  function toggleTarget(key){
    const list = targets().slice();
    const i = list.indexOf(key);
    if(i >= 0) list.splice(i, 1); else list.push(key);
    setTargets(list);
    render();
  }

  function sortBy(key){
    const col = COLUMNS.find(c => c.key === key);
    if(!col || col.sortable === false) return;
    if(sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = (key === 'adp' || key === 'name') ? 1 : -1; }
    render();
  }

  /* ---- render ---- */

  function render(){
    const host = document.getElementById('ffDraft');
    if(!host) return;

    const b = FFData.bundle;
    if(!b) return tileError(host, 'Draft data has not loaded yet.');

    const data = board();
    if(!data || !data.pool.length)
      return tileError(host, 'No mock-draft ADP loaded, so there is no board to build. ' +
        ((b.problems && b.problems[0]) || 'Check the proxy URL in Settings → Fantasy.'));

    const c = data.clock;
    host.innerHTML =
      '<div class="ff-draft">' +
        '<div class="fdb-col">' + filterBar(data) + headerRow() +
          '<div class="fdb-list" id="ffBoard">' + rows(data) + '</div>' +
        '</div>' +
        '<div class="fdb-side">' + clockPanel(c, data) + suggestPanel() + targetPanel(data) +
          rosterPanel() + runPanel() + sourcePanel(b) + '</div>' +
      '</div>';

    wire(host);
  }

  function filterBar(data){
    const counts = {};
    for(const p of data.pool) if(!p._taken) counts[p.pos] = (counts[p.pos] || 0) + 1;
    const left = data.pool.filter(p => !p._taken).length;

    return '<div class="ff-filters">' +
      POSITIONS.map(pos => {
        const n = pos === 'ALL' ? left : (counts[pos] || 0);
        return '<button class="ghost-btn sm ff-pos' + (filterPos === pos ? ' is-on' : '') +
               '" data-pos="' + pos + '">' + pos + '<i>' + n + '</i></button>';
      }).join('') +
      '<input id="ffSearch" class="td-input ff-search" type="search" placeholder="Find a player…" ' +
      'value="' + esc(search) + '" autocomplete="off">' +
      '<label class="ff-toggle"><input type="checkbox" id="ffHideTaken"' +
      (hideTaken ? ' checked' : '') + '> Hide drafted</label>' +
      '<button class="ghost-btn sm" id="ffOpenBoard" title="Every pick in the draft, and edit any of them">' +
      'Draft board</button></div>';
  }

  function headerRow(){
    return '<div class="fdb-head">' + COLUMNS.map(col => {
      if(col.sortable === false) return '<span class="fdb-h c-' + col.key + '"></span>';
      const on = sortKey === col.key;
      const arrow = on ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
      return '<button class="fdb-h c-' + col.key + (on ? ' is-on' : '') + (col.num ? ' num' : '') +
             '" data-sort="' + col.key + '" title="' + esc(col.title) + '">' +
             esc(col.label) + arrow + '</button>';
    }).join('') + '</div>';
  }

  function rows(data){
    const q = FFData.norm(search);
    let list = data.pool;
    if(hideTaken) list = list.filter(p => !p._taken);
    if(filterPos !== 'ALL') list = list.filter(p => p.pos === filterPos);
    if(q) list = list.filter(p =>
      FFData.norm(p.name).includes(q) || p.team.toLowerCase() === search.trim().toLowerCase());

    const col = COLUMNS.find(x => x.key === sortKey) || COLUMNS[0];
    list = [...list].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if(x === y) return (a.adp ? a.adp.adp : 0) - (b.adp ? b.adp.adp : 0);
      return (x > y ? 1 : -1) * sortDir;
    });

    if(!list.length) return '<p class="empty">Nobody left matching that.</p>';

    const c = data.clock;
    const going = c.done ? null : teamName(c.slotOnClock);

    return list.slice(0, 240).map(p => {
      const s = p._stat;
      const edgeChip =
        p._edge == null ? '' :
        p._edge >= teamCount()  ? '<span class="chip ok" title="Going ' + p._edge + ' picks later than his scoring rank">VALUE</span>' :
        p._edge <= -teamCount() ? '<span class="chip hot" title="Going ' + (-p._edge) + ' picks earlier than his scoring rank">REACH</span>' : '';

      /* A player who changed teams carries last season's numbers from a
         different line, with a different quarterback throwing. Worth saying
         out loud rather than leaving the reader to notice. */
      const moved = p.movedFrom
        ? '<span class="chip warn ff-moved" title="New team — everything in the columns to the right was earned for ' +
          esc(p.movedFrom) + '">' + esc(p.movedFrom) + ' → ' + esc(p.team) + '</span>'
        : '';

      const sup = p._support;
      const label = p._taken
        ? teamName(FFData.onClock(p._takenAt, teamCount()).slot)
        : (going ? '→ ' + going : 'take');

      return '<div class="ff-row' + (p._taken ? ' is-taken' : '') + (p._target ? ' is-target' : '') +
             '" data-key="' + esc(p.key) + '">' +
        '<span class="ff-adp" title="Goes at pick ' + one(p.adp.adp) + ' on average · range ' +
          p.adp.high + '–' + p.adp.low + ' · ' + p.adp.n.toLocaleString() + ' drafts">' +
          esc(p.adp.slot) + '</span>' +
        '<span class="ff-who">' +
          '<span class="ff-name">' + esc(p.name) +
            (p._target ? ' <b class="ff-star" title="On your target list">★</b>' : '') + '</span>' +
          '<span class="ff-meta">' + esc(p.pos) + ' · ' + esc(p.team) +
            (p.bye ? ' · bye ' + p.bye : '') + (p.depth ? ' · ' + esc(p.pos) + p.depth : '') + '</span>' +
          '<span class="ff-tags">' + FFPlayer.chipFor(p.injury) + edgeChip + moved + matesHurt(p) + '</span>' +
        '</span>' +
        '<span class="ff-sup" title="' + (sup ? esc(sup.detail) : 'Nothing on record') + '">' +
          (sup ? esc(sup.label) : '<i class="dim">—</i>') + '</span>' +
        '<span class="ff-num ff-avg" title="' + (s ? s.season + ' points per game' : 'no NFL scoring on record') +
          '">' + (s ? one(s.avg) : '—') + '</span>' +
        '<span class="ff-num dim ff-med" title="Median week">' + (s ? one(s.med) : '—') + '</span>' +
        '<span class="ff-num dim ff-hilo" title="Best and worst week">' +
          (s ? one(s.hi) + '/' + one(s.lo) : '—') + '</span>' +
        '<span class="ff-num ff-vor" title="Points per game over the last startable player at this position">' +
          (p._vor == null ? '—' : (p._vor > 0 ? '+' : '') + one(p._vor)) + '</span>' +
        '<span class="ff-num ff-surv ' + (p._surv != null && p._surv < 0.35 ? 'down' : '') +
          '" title="' + (c.myNext ? 'Chance he is still there at pick ' + c.myNext.pick : 'Draft complete') +
          '">' + (p._surv == null ? '—' : pct(p._surv)) + '</span>' +
        '<span class="ff-act">' +
          '<button class="ff-tgt' + (p._target ? ' is-on' : '') + '" data-target="' + esc(p.key) +
            '" title="' + (p._target ? 'Remove from targets' : 'Add to your target list') + '">★</button>' +
          '<button class="ghost-btn sm ff-take" data-take="' + esc(p.key) + '" title="' +
            (p._taken ? 'Drafted — click to undo this pick' : 'Give this pick to ' + esc(going || '')) +
            '">' + esc(label) + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  /* Only a man AHEAD of him counts. A starter whose backup is hurt gains
     nothing — he was already taking the touches. */
  function matesHurt(p){
    const mine = p.depth ?? 99;
    const hurt = FFData.mates(p).filter(m =>
      m.injury && FFData.statusRank(m.injury.status) >= 3 && (m.depth ?? 99) < mine);
    if(!hurt.length) return '';
    return '<span class="chip warn" title="' +
      esc(hurt.map(h => h.name + ' (' + h.pos + (h.depth || '') + ') — ' + h.injury.status).join('; ')) +
      '">' + (hurt.length === 1 ? esc(hurt[0].name.split(' ').pop()) : hurt.length + ' AHEAD') +
      ' OUT</span>';
  }

  /* ---- side panels ---- */

  function clockPanel(c, data){
    if(c.done) return '<div class="ff-panel"><div class="group-label">Draft</div>' +
      '<p class="empty">All ' + c.total + ' picks are in.</p>' +
      '<div class="ff-panel-acts"><button class="ghost-btn sm" id="ffUndo">Undo</button>' +
      '<button class="ghost-btn sm" id="ffOpenBoard">Draft board</button>' +
      '<button class="ghost-btn sm" id="ffReset">Reset</button></div></div>';

    const best = data.pool.filter(p => !p._taken)[0];
    const opt = (n, cur) => '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + n + '</option>';

    return '<div class="ff-panel' + (c.isMine ? ' is-mine' : '') + '">' +
      '<div class="group-label">On the clock</div>' +
      '<div class="ff-clock"><b>Pick ' + c.next + '</b>' +
        '<span>Round ' + c.round + ' · ' + esc(teamName(c.slotOnClock)) +
        (c.isMine ? ' — <b>your pick</b>' : '') + '</span></div>' +
      '<div class="ff-setup">' +
        '<label>Slot<select id="ffSlot">' +
          Array.from({length: teamCount()}, (_, i) => opt(i + 1, slot())).join('') + '</select></label>' +
        '<label>Teams<select id="ffTeams">' +
          [8, 10, 12, 14, 16].map(n => opt(n, teamCount())).join('') + '</select></label>' +
        '<label>Rounds<select id="ffRounds">' +
          [12, 13, 14, 15, 16, 17, 18, 20].map(n => opt(n, rounds())).join('') + '</select></label>' +
      '</div>' +
      '<div class="row"><span class="row-main">' +
        '<span class="row-title">Your next pick: ' + (c.myNext ? c.myNext.pick : '—') + '</span>' +
        '<span class="row-sub">' + (c.myAfter
          ? 'then ' + c.myAfter.pick + ' — ' + (c.myAfter.pick - c.myNext.pick - 1) + ' picks of wait'
          : 'last pick of the draft') + '</span></span></div>' +
      (best ? '<div class="row ff-click" data-key="' + esc(best.key) + '"><span class="row-main">' +
        '<span class="row-title">Best available</span>' +
        '<span class="row-sub">' + esc(best.name) + ' · ' + esc(best.pos) + ' ' + esc(best.team) +
        ' · ADP ' + esc(best.adp.slot) + '</span></span></div>' : '') +
      '<div class="ff-panel-acts">' +
        '<button class="ghost-btn sm" id="ffUndo">Undo</button>' +
        '<button class="ghost-btn sm" id="ffReset">Reset</button>' +
      '</div></div>';
  }

  function suggestPanel(){
    const list = suggestions();
    if(!list.length) return '';
    const {have} = needs();
    const shape = ['QB', 'RB', 'WR', 'TE'].map(pos => {
      const got = have[pos] || 0;
      const cls = got >= STARTERS[pos] ? 'ok' : got ? 'warn' : 'hot';
      return '<span class="chip ' + cls + '">' + pos + ' ' + got + '/' + STARTERS[pos] + '</span>';
    }).join(' ');

    return '<div class="ff-panel"><div class="group-label">Take one of these</div>' +
      '<div class="ff-shape">' + shape + '</div>' +
      list.map((s, i) => '<div class="row ff-click" data-key="' + esc(s.player.key) + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + (i + 1) + '. ' + esc(s.player.name) +
            ' <span class="chip">' + esc(s.pos) + '</span></span>' +
          '<span class="row-sub">' + (
            s.weight >= 1    ? 'fills an empty ' + esc(s.pos) + ' slot' :
            s.weight >= 0.7  ? 'fills your flex' :
            s.weight <= 0.1  ? esc(s.pos) + ' can wait' : 'depth at ' + esc(s.pos)
          ) + ' · ' + one(s.vor) + ' over replacement' + (
            s.dropoff > 0.5 ? ' · ' + one(s.dropoff) + ' drop-off if you wait' : ' · no drop-off behind him'
          ) + '</span>' +
        '</span></div>').join('') + '</div>';
  }

  function targetPanel(data){
    const keys = targets();
    if(!keys.length) return '<div class="ff-panel"><div class="group-label">Targets</div>' +
      '<p class="empty">Star anyone on the board and this panel will tell you when to take him — ' +
      'whether you are a round early, when his spot actually is, and when he has lasted long enough ' +
      'to be a steal.</p></div>';

    const list = keys.map(k => data.pool.find(p => p.key === k) || FFData.bundle.index.get(k))
                     .filter(Boolean);
    const order = {now:0, slipping:1, steal:2, early:3, wait:4, gone:5, done:6, unknown:7};
    const rows = list.map(p => ({p, a: advise(p)}))
                     .sort((x, y) => (order[x.a.state] ?? 9) - (order[y.a.state] ?? 9));

    return '<div class="ff-panel"><div class="group-label">Targets (' + list.length + ')</div>' +
      rows.map(({p, a}) => '<div class="row ff-click ff-advice is-' + a.state +
        '" data-key="' + esc(p.key) + '"><span class="row-main">' +
        '<span class="row-title">' + esc(p.name) + ' <span class="chip">' + esc(p.pos) + '</span>' +
          (p.adp ? ' <span class="chip">ADP ' + esc(p.adp.slot) + '</span>' : '') + '</span>' +
        '<span class="row-sub">' + esc(a.text) + '</span></span>' +
        '<span class="row-side"><span class="chip ' + (
          a.state === 'now' || a.state === 'slipping' ? 'hot' :
          a.state === 'steal' ? 'ok' :
          a.state === 'early' ? 'warn' : '') + '">' + esc(a.short) + '</span></span></div>').join('') +
      '</div>';
  }

  function rosterPanel(){
    const mine = myRoster();
    const need = {QB:1, RB:2, WR:2, TE:1, K:1, DEF:1};
    const have = {};
    for(const p of mine) have[p.pos] = (have[p.pos] || 0) + 1;

    const shape = Object.entries(need).map(([pos, n]) => {
      const got = have[pos] || 0;
      const cls = got >= n ? 'ok' : (got ? 'warn' : 'hot');
      return '<span class="chip ' + cls + '" title="' + got + ' of ' + n + ' starters">' +
             pos + ' ' + got + '/' + n + '</span>';
    }).join(' ');

    return '<div class="ff-panel"><div class="group-label">Your picks (' + mine.length + ')</div>' +
      '<div class="ff-shape">' + shape + '</div>' +
      (mine.length
        ? mine.map(p => '<div class="row ff-click" data-key="' + esc(p.key) + '"><span class="row-main">' +
            '<span class="row-title">' + esc(p.name) + ' <span class="chip">' + esc(p.pos) + '</span></span>' +
            '<span class="row-sub">pick ' + p.pick + ' · ' + esc(p.team) +
            (p.bye ? ' · bye ' + p.bye : '') + '</span></span></div>').join('')
        : '<p class="empty">Nothing yet. Hit the button on the right of a row as each pick goes in — ' +
          'it goes to whoever is on the clock, you or anyone else.</p>') + '</div>';
  }

  function runPanel(){
    const r = runs();
    if(!r.length) return '';
    const total = r.reduce((a, x) => a + x[1], 0);
    return '<div class="ff-panel"><div class="group-label">Last ' + total + ' picks</div>' +
      '<div class="ff-shape">' + r.map(([pos, n]) => {
        const hot = n >= Math.max(4, total / 2);
        return '<span class="chip ' + (hot ? 'hot' : '') + '" title="' + n + ' of the last ' +
               total + ' picks">' + pos + ' ' + n + '</span>';
      }).join(' ') + '</div>' +
      (r[0][1] >= 4 ? '<p class="empty">A run is on at ' + r[0][0] + ' — ' + r[0][1] +
                      ' of the last ' + total + '.</p>' : '') + '</div>';
  }

  function sourcePanel(b){
    const m = b.adpMeta || {};
    return '<div class="ff-panel ff-source"><div class="group-label">Where this comes from</div>' +
      '<p class="empty">ADP: <b>' + (m.total_drafts || 0).toLocaleString() + '</b> ' +
        (m.teams || 12) + '-team ' + (m.type || 'PPR') + ' mock drafts, ' +
        esc(m.start_date || '') + ' to ' + esc(m.end_date || '') + ' — ' +
        (b.adpLive ? 'live' : 'baked snapshot' + (b.adpBuilt ? ' from ' + esc(b.adpBuilt.slice(0, 10)) : '')) + '.<br>' +
        'Scoring: every ' + b.priorSeason + ' game, true PPR, from nflverse play-by-play.<br>' +
        'Line grades: ' + (b.lineSeason || '—') + ' charting — yards before contact, and pressure allowed.<br>' +
        'Depth charts as of ' + esc((b.depthAsOf || '').slice(0, 10) || '—') + '.<br>' +
        'Injuries: ESPN, refreshed every 15 minutes.</p>' +
      ((b.problems || []).map(p => '<p class="empty"><b>' + esc(p) + '</b></p>').join('')) +
      '</div>';
  }

  /* ---- events ----
     Delegated from the host, because every panel is rebuilt on each render
     and a direct listener would only ever see the first set. */
  function wire(host){
    host.onclick = e => {
      const tgt = e.target.closest('[data-target]');
      if(tgt){ e.stopPropagation(); return toggleTarget(tgt.dataset.target); }

      const takeBtn = e.target.closest('[data-take]');
      if(takeBtn){
        e.stopPropagation();
        const key = takeBtn.dataset.take;
        const p = FFData.bundle.index.get(key);
        return (p && p._taken) ? clearPick(p._takenAt) : take(key);
      }

      const sortBtn = e.target.closest('[data-sort]');
      if(sortBtn) return sortBy(sortBtn.dataset.sort);

      const posBtn = e.target.closest('[data-pos]');
      if(posBtn){ filterPos = posBtn.dataset.pos; return render(); }

      if(e.target.closest('#ffUndo'))      return undo();
      if(e.target.closest('#ffReset'))     return reset();
      if(e.target.closest('#ffOpenBoard')) return window.FFBoard && FFBoard.open();

      const row = e.target.closest('.ff-row, .ff-click');
      if(row && row.dataset.key){
        const p = FFData.bundle.index.get(row.dataset.key);
        if(p) FFPlayer.open(p);
      }
    };

    const box = host.querySelector('#ffSearch');
    if(box) box.oninput = () => {
      search = box.value;
      const list = host.querySelector('#ffBoard');
      if(list) list.innerHTML = rows(board());
    };

    const hide = host.querySelector('#ffHideTaken');
    if(hide) hide.onchange = () => { hideTaken = hide.checked; render(); };

    const bind = (id, path) => {
      const el = host.querySelector(id);
      if(el) el.onchange = () => { Store.set(path, Number(el.value)); render(); };
    };
    bind('#ffSlot', 'draft.slot');
    bind('#ffTeams', 'draft.teams');
    bind('#ffRounds', 'draft.rounds');
  }

  const isComplete = () => nextEmpty() > teamCount() * rounds();

  return {render, take, clearPick, undo, reset, board, clock, myRoster, rosterOf,
          suggestions, advise, needs, toggleTarget, isComplete,
          teamCount, rounds, slot, names, teamName, picks, sortBy};
})();

window.FFDraft = FFDraft;
