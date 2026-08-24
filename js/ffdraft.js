/* ============================================================
   ffdraft.js — the live draft board.

   Three things a spreadsheet cannot do on draft night:

   1. It knows whose turn it is. Picks go in as they happen, the snake
      order advances itself, and the board only ever shows who is still
      actually on it.
   2. It answers "can I wait?" with a number. FFC reports a standard
      deviation per player, so the pick he goes at is roughly normal
      around his ADP — which turns "will he last until 32?" into a
      percentage instead of a feeling.
   3. It separates price from value. ADP is what the room will pay.
      Points over replacement is what the player is worth. The gap
      between those two rankings is the only edge a draft board has.

   Everything measured here is last season's real PPR scoring. It is
   labelled with its year everywhere it appears, because a backward
   -looking number dressed up as a projection is worse than no number.
   ============================================================ */

const FFDraft = (() => {

  const ROUNDS = 16;
  const RUN_WINDOW = 12;          // a "run" is judged over the last round of picks

  /* ---- persisted draft state ---- */
  const slot   = () => Math.min(FFData.LEAGUE_SIZE, Math.max(1, Number(Store.get('draft.slot', 1))));
  const picks  = () => Store.get('draft.picks', []) || [];
  const setPicks = list => Store.set('draft.picks', list);

  /* ---- view state (not worth persisting) ---- */
  let filterPos = 'ALL';
  let search    = '';
  let hideTaken = true;

  const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const one = n => (n == null || !isFinite(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);
  const pct = n => n == null ? '—' : Math.round(n * 100) + '%';

  /* ---- derived board ---- */

  /* Which stat line stands in for "what this player is worth": this season
     once it exists, last season before that. */
  const field = () => (FFData.bundle && FFData.bundle.hasLive) ? 'now' : 'last';

  function board(){
    const b = FFData.bundle;
    if(!b) return null;

    const f = field();
    const repl = FFData.replacementLevels(f);
    const taken = new Set(picks());

    const pool = b.players.filter(p => p.adp);
    pool.sort((x, y) => x.adp.adp - y.adp.adp);

    pool.forEach((p, i) => {
      p._adpRank = i + 1;
      const stat = p[f];
      p._stat = stat || null;
      p._vor = stat && stat.g >= 1 ? stat.avg - (repl[p.pos] || 0) : null;
    });

    /* Value ranking, nulls last: a rookie with no NFL snap is not "worth
       zero", he is unmeasured, and sorting him alongside a measured zero
       would be a lie the board tells every year. */
    const measured = pool.filter(p => p._vor != null).sort((x, y) => y._vor - x._vor);
    measured.forEach((p, i) => { p._vorRank = i + 1; });
    pool.filter(p => p._vor == null).forEach(p => { p._vorRank = null; });

    pool.forEach(p => {
      p._edge = p._vorRank == null ? null : p._adpRank - p._vorRank;
      p._taken = taken.has(p.key);
    });

    return {pool, repl, taken};
  }

  /* ---- draft position arithmetic ---- */
  function clock(){
    const list = picks();
    const next = list.length + 1;
    const total = FFData.LEAGUE_SIZE * ROUNDS;
    const done = next > total;
    const at = FFData.onClock(Math.min(next, total));
    const mine = FFData.myPicks(slot(), FFData.LEAGUE_SIZE, ROUNDS);
    const upcoming = mine.filter(m => m.pick >= next);
    return {
      next, done, round: at.round, slotOnClock: at.slot,
      isMine: !done && at.slot === slot(),
      myNext: upcoming[0] || null,
      myAfter: upcoming[1] || null,
      mine
    };
  }

  /* My roster so far, in pick order. */
  function myRoster(){
    const b = FFData.bundle;
    if(!b) return [];
    const me = slot();
    return picks()
      .map((k, i) => ({key: k, pick: i + 1}))
      .filter(x => FFData.onClock(x.pick).slot === me)
      .map(x => Object.assign({pick: x.pick}, b.index.get(x.key)))
      .filter(p => p.name);
  }

  /* A positional run: how the last round of picks was spent. Seeing five
     running backs go in nine picks is the whole reason to break your own
     board and take one early. */
  function runs(){
    const b = FFData.bundle;
    if(!b) return [];
    const recent = picks().slice(-RUN_WINDOW);
    const count = {};
    for(const k of recent){
      const p = b.index.get(k);
      if(p) count[p.pos] = (count[p.pos] || 0) + 1;
    }
    return Object.entries(count).sort((a, c) => c[1] - a[1]);
  }

  /* ---- actions ---- */
  function take(key){
    const list = picks().slice();
    if(list.includes(key)) return;
    list.push(key);
    setPicks(list);
    render();
  }

  function undo(){
    const list = picks().slice();
    list.pop();
    setPicks(list);
    render();
  }

  function reset(){
    if(!confirm('Clear every pick and start the draft over?')) return;
    setPicks([]);
    render();
  }

  /* ---- render ---- */

  function render(){
    const host = document.getElementById('ffDraft');
    if(!host) return;

    const b = FFData.bundle;
    if(!b) return tileError(host, 'Draft data has not loaded yet.');

    const data = board();
    if(!data || !data.pool.length){
      return tileError(host,
        'No mock-draft ADP loaded, so there is no board to build. ' +
        (b.problems[0] || 'Check the proxy URL in Settings → Fantasy.'));
    }

    const c = clock();
    host.innerHTML =
      `<div class="ff-draft">
         <div class="ff-board-col">${filterBar(data)}<div class="ff-board" id="ffBoard">${rows(data, c)}</div></div>
         <div class="ff-side">${clockPanel(c, data)}${rosterPanel()}${runPanel()}${sourcePanel(b)}</div>
       </div>`;

    wire(host, data);
  }

  function filterBar(data){
    const counts = {};
    for(const p of data.pool) if(!p._taken) counts[p.pos] = (counts[p.pos] || 0) + 1;
    const left = data.pool.filter(p => !p._taken).length;

    return `<div class="ff-filters">
      ${POSITIONS.map(pos => {
        const n = pos === 'ALL' ? left : (counts[pos] || 0);
        return `<button class="ghost-btn sm ff-pos${filterPos === pos ? ' is-on' : ''}" data-pos="${pos}">
                  ${pos}<i>${n}</i></button>`;
      }).join('')}
      <input id="ffSearch" class="td-input ff-search" type="search" placeholder="Find a player…"
             value="${esc(search)}" autocomplete="off">
      <label class="ff-toggle"><input type="checkbox" id="ffHideTaken"${hideTaken ? ' checked' : ''}> Hide drafted</label>
    </div>`;
  }

  function rows(data, c){
    const q = FFData.norm(search);
    let list = data.pool;
    if(hideTaken) list = list.filter(p => !p._taken);
    if(filterPos !== 'ALL') list = list.filter(p => p.pos === filterPos);
    if(q) list = list.filter(p => FFData.norm(p.name).includes(q) || p.team.toLowerCase() === search.trim().toLowerCase());

    if(!list.length) return '<p class="empty">Nobody left matching that.</p>';

    const target = c.myNext ? c.myNext.pick : null;

    return list.slice(0, 220).map(p => {
      const s = p._stat;
      const surv = c.done ? null : FFData.survival(p, target);
      const edgeChip =
        p._edge == null ? '' :
        p._edge >= FFData.LEAGUE_SIZE ? `<span class="chip ok" title="Going ${p._edge} picks later than his scoring rank">VALUE</span>` :
        p._edge <= -FFData.LEAGUE_SIZE ? `<span class="chip hot" title="Going ${-p._edge} picks earlier than his scoring rank">REACH</span>` : '';

      const inj = FFPlayer.chipFor(p.injury);
      const hurtMate = matesHurt(p);

      return `<div class="ff-row${p._taken ? ' is-taken' : ''}" data-key="${esc(p.key)}">
        <span class="ff-adp" title="Average draft position across ${(FFData.bundle.adpMeta || {}).total_drafts || 'many'} mock drafts">
          ${esc(p.adp.slot)}</span>
        <span class="ff-who">
          <span class="ff-name">${esc(p.name)}</span>
          <span class="ff-meta">${esc(p.pos)} · ${esc(p.team)}${p.bye ? ' · bye ' + p.bye : ''}${
            p.depth ? ' · ' + esc(p.pos) + p.depth : ''}</span>
        </span>
        <span class="ff-chips">${inj}${edgeChip}${hurtMate}</span>
        <span class="ff-num" title="${s ? s.season + ' points per game' : 'no NFL scoring on record'}">${s ? one(s.avg) : '—'}</span>
        <span class="ff-num dim" title="Median week">${s ? one(s.med) : '—'}</span>
        <span class="ff-num dim" title="Best and worst week">${s ? one(s.hi) + '/' + one(s.lo) : '—'}</span>
        <span class="ff-num" title="Points per game over the last startable player at this position">${
          p._vor == null ? '—' : (p._vor > 0 ? '+' : '') + one(p._vor)}</span>
        <span class="ff-num ${surv != null && surv < 0.35 ? 'down' : ''}"
              title="${target ? 'Chance he is still there at pick ' + target : 'Draft complete'}">${
          surv == null ? '—' : pct(surv)}</span>
        <button class="ghost-btn sm ff-take" data-take="${esc(p.key)}">${p._taken ? 'taken' : 'take'}</button>
      </div>`;
    }).join('');
  }

  /* A same-position team-mate being out is the cheapest edge on the board,
     so it earns a chip on the row rather than only living on the card. */
  function matesHurt(p){
    const hurt = FFData.mates(p).filter(m =>
      m.injury && FFData.statusRank(m.injury.status) >= 3 && (m.depth || 9) <= 3);
    if(!hurt.length) return '';
    return `<span class="chip warn" title="${esc(hurt.map(h => h.name + ' — ' + h.injury.status).join('; '))}">
              ${hurt.length === 1 ? esc(hurt[0].name.split(' ').pop()) : hurt.length + ' MATES'} OUT</span>`;
  }

  function clockPanel(c, data){
    if(c.done) return `<div class="ff-panel"><div class="group-label">Draft</div>
      <p class="empty">All ${FFData.LEAGUE_SIZE * ROUNDS} picks are in.</p>
      <div class="ff-panel-acts"><button class="ghost-btn sm" id="ffUndo">Undo</button>
      <button class="ghost-btn sm" id="ffReset">Reset</button></div></div>`;

    const best = data.pool.filter(p => !p._taken)[0];

    return `<div class="ff-panel${c.isMine ? ' is-mine' : ''}">
      <div class="group-label">On the clock</div>
      <div class="ff-clock">
        <b>Pick ${c.next}</b>
        <span>Round ${c.round} · team ${c.slotOnClock}${c.isMine ? ' — <b>you</b>' : ''}</span>
      </div>
      <label class="ff-slot">Your slot
        <select id="ffSlot">${Array.from({length: FFData.LEAGUE_SIZE}, (_, i) => i + 1)
          .map(n => `<option value="${n}"${n === slot() ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <div class="row"><span class="row-main">
        <span class="row-title">Your next pick: ${c.myNext ? c.myNext.pick : '—'}</span>
        <span class="row-sub">${c.myAfter
          ? `then ${c.myAfter.pick} — ${c.myAfter.pick - (c.myNext ? c.myNext.pick : 0)} picks of wait`
          : 'last pick of the draft'}</span>
      </span></div>
      ${best ? `<div class="row"><span class="row-main">
        <span class="row-title">Best available</span>
        <span class="row-sub">${esc(best.name)} · ${esc(best.pos)} ${esc(best.team)} · ADP ${esc(best.adp.slot)}</span>
      </span></div>` : ''}
      <div class="ff-panel-acts">
        <button class="ghost-btn sm" id="ffUndo">Undo</button>
        <button class="ghost-btn sm" id="ffReset">Reset</button>
      </div>
    </div>`;
  }

  function rosterPanel(){
    const mine = myRoster();
    const need = {QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1};
    const have = {};
    for(const p of mine) have[p.pos] = (have[p.pos] || 0) + 1;

    const shape = Object.entries(need).map(([pos, n]) => {
      const got = have[pos] || 0;
      const cls = got >= n ? 'ok' : (got ? 'warn' : 'hot');
      return `<span class="chip ${cls}" title="${got} of ${n} starters">${pos} ${got}/${n}</span>`;
    }).join(' ');

    return `<div class="ff-panel">
      <div class="group-label">Your picks (${mine.length})</div>
      <div class="ff-shape">${shape}</div>
      ${mine.length
        ? mine.map(p => `<div class="row"><span class="row-main">
            <span class="row-title">${esc(p.name)} <span class="chip">${esc(p.pos)}</span></span>
            <span class="row-sub">pick ${p.pick} · ${esc(p.team)}${p.bye ? ' · bye ' + p.bye : ''}</span>
          </span></div>`).join('')
        : '<p class="empty">Nothing yet. Hit <b>take</b> on a player as each pick goes in.</p>'}
    </div>`;
  }

  function runPanel(){
    const r = runs();
    if(!r.length) return '';
    const total = r.reduce((a, x) => a + x[1], 0);
    return `<div class="ff-panel">
      <div class="group-label">Last ${total} picks</div>
      <div class="ff-shape">${r.map(([pos, n]) => {
        const hot = n >= Math.max(4, total / 2);
        return `<span class="chip ${hot ? 'hot' : ''}" title="${n} of the last ${total} picks">${pos} ${n}</span>`;
      }).join(' ')}</div>
      ${r[0][1] >= 4 ? `<p class="empty">A run is on at ${r[0][0]} — ${r[0][1]} of the last ${total}.</p>` : ''}
    </div>`;
  }

  function sourcePanel(b){
    const m = b.adpMeta || {};
    return `<div class="ff-panel ff-source">
      <div class="group-label">Where this comes from</div>
      <p class="empty">
        ADP: <b>${(m.total_drafts || 0).toLocaleString()}</b> ${m.teams || 12}-team ${m.type || 'PPR'} mock drafts,
        ${esc(m.start_date || '')} to ${esc(m.end_date || '')}
        — ${b.adpLive ? 'live' : 'baked snapshot' + (b.adpBuilt ? ' from ' + esc(b.adpBuilt.slice(0, 10)) : '')}.<br>
        Scoring: every ${b.priorSeason} game, true PPR, from nflverse play-by-play.<br>
        Depth charts as of ${esc((b.depthAsOf || '').slice(0, 10) || '—')}.<br>
        Injuries: ESPN, refreshed every 15 minutes.
      </p>
      ${b.problems.length ? b.problems.map(p => `<p class="empty"><b>${esc(p)}</b></p>`).join('') : ''}
    </div>`;
  }

  /* ---- events ----
     Delegated from the host, because every panel is rebuilt on each
     render and a direct listener would only ever see the first set. */
  function wire(host, data){
    host.onclick = e => {
      const takeBtn = e.target.closest('[data-take]');
      if(takeBtn){ e.stopPropagation(); return take(takeBtn.dataset.take); }

      const posBtn = e.target.closest('[data-pos]');
      if(posBtn){ filterPos = posBtn.dataset.pos; return render(); }

      if(e.target.closest('#ffUndo'))  return undo();
      if(e.target.closest('#ffReset')) return reset();

      const row = e.target.closest('.ff-row');
      if(row){
        const p = FFData.bundle.index.get(row.dataset.key);
        if(p) FFPlayer.open(p);
      }
    };

    const box = host.querySelector('#ffSearch');
    if(box) box.oninput = () => {
      search = box.value;
      const list = host.querySelector('#ffBoard');
      if(list) list.innerHTML = rows(board(), clock());
    };

    const hide = host.querySelector('#ffHideTaken');
    if(hide) hide.onchange = () => { hideTaken = hide.checked; render(); };

    const sel = host.querySelector('#ffSlot');
    if(sel) sel.onchange = () => { Store.set('draft.slot', Number(sel.value)); render(); };
  }

  return {render, take, undo, reset, board, clock, myRoster};
})();

window.FFDraft = FFDraft;
