/* ============================================================
   ffplayer.js — the player card. Shared by the draft board and the
   season view, because the question is the same either way: who is
   this, what did he actually score, who else on his team plays his
   position, and is any of them hurt.

   Everything on this card is measured, not projected. Last season's
   line is last season's line; it is labelled with the year so it is
   never mistaken for a forecast.
   ============================================================ */

const FFPlayer = (() => {
  const modal = () => document.getElementById('ffPlayerModal');
  const body  = () => document.getElementById('ffPlayerBody');

  const one = n => (n == null || !isFinite(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);

  /* Injury designations worth a red chip rather than an amber one. */
  const chipFor = inj => {
    const rank = inj ? FFData.statusRank(inj.status) : 0;
    if(!rank) return '';                     // ACTIVE, or no designation at all
    return '<span class="chip ' + (rank >= 3 ? 'hot' : 'warn') + '">' + esc(inj.status) + '</span>';
  };

  /* The scoring line in play: this season once it exists, last season before. */
  const statOf = p => (p.now && p.now.g) ? p.now : (p.last && p.last.g ? p.last : null);

  /* Points per game of the last player at this position anybody would start
     in a 12-team league. It is the zero line for value: everything above it
     is what you are actually paying a pick for. */
  function replacement(pos){
    const field = (FFData.bundle && FFData.bundle.hasLive) ? 'now' : 'last';
    const levels = FFData.replacementLevels(field);
    return levels[pos] ?? null;
  }

  /* ---- weekly scoring, drawn ----
     A season average hides the shape of it: 17 points every week and a
     boom/bust alternating 3 and 31 average the same. Two dotted lines make
     the shape legible — his own average, and the last startable player at
     his position. Bars that clear the lower line were startable weeks; bars
     that did not were the weeks he cost you the matchup. */
  function sparkline(stat, pos){
    if(!stat || !stat.scores || !stat.scores.length) return '';

    const repl = replacement(pos);
    const peak = Math.max(stat.hi, stat.avg, repl || 0, 1);
    const y = v => 100 - (v / peak) * 100;
    const w = 100 / stat.scores.length;

    const bars = stat.scores.map((s, i) => {
      const h = Math.max((s / peak) * 100, 1.5);
      const startable = repl != null && s >= repl;
      const opp = (stat.opps || [])[i];
      return '<rect x="' + (i * w + w * 0.12).toFixed(2) + '" y="' + (100 - h).toFixed(2) +
             '" width="' + (w * 0.76).toFixed(2) + '" height="' + h.toFixed(2) +
             '" class="ffbar' + (startable ? ' is-hot' : '') + '">' +
             '<title>Week ' + stat.weeks[i] + (opp ? ' vs ' + opp : '') + ' — ' + one(s) + ' pts</title></rect>';
    }).join('');

    const line = (v, cls) => v == null ? '' :
      '<line x1="0" x2="100" y1="' + y(v).toFixed(2) + '" y2="' + y(v).toFixed(2) +
      '" class="' + cls + '"></line>';

    return '<div class="ff-spark">' +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Points by week">' +
        bars + line(repl, 'ffrepl') + line(stat.avg, 'ffavg') +
      '</svg>' +
      '<div class="ff-spark-x">' +
        '<span>Wk ' + stat.weeks[0] + '</span>' +
        '<span class="ff-key"><i class="k-avg"></i> his average ' + one(stat.avg) +
          (repl == null ? '' : ' <i class="k-repl"></i> last startable ' + pos + ' ' + one(repl)) + '</span>' +
        '<span>Wk ' + stat.weeks[stat.weeks.length - 1] + '</span>' +
      '</div></div>';
  }

  function statBlock(stat, label, pos){
    if(!stat) return '<p class="empty">No ' + esc(label) + ' scoring on record.</p>';
    const tiles = [['Avg', one(stat.avg)], ['Median', one(stat.med)], ['High', one(stat.hi)],
                   ['Low', one(stat.lo)], ['Total', one(stat.tot)], ['Games', stat.g]];
    return '<div class="ff-stats">' +
      tiles.map(([k, v]) => '<div class="ff-stat"><b>' + v + '</b><i>' + k + '</i></div>').join('') +
      '</div>' + sparkline(stat, pos);
  }

  /* ---- the position room ----
     Every player at his position on his NFL team, in depth-chart order, as a
     table — because the whole point is comparing one row against another, and
     prose does not compare. He is in it too, highlighted: a depth chart with
     the man you are looking at missing from it is half an answer. */
  function room(player){
    const group = FFData.group(player.team, player.pos);
    const list = group.length ? group : [player];
    const repl = replacement(player.pos);

    const rows = list.map(p => {
      const st = statOf(p);
      const vor = (st && repl != null) ? st.avg - repl : null;
      const isHim = p.key === player.key;
      return '<tr class="' + (isHim ? 'is-him' : '') + '">' +
        '<td class="ffd-name">' + (p.depth ? '<i class="ffd-rank">' + esc(p.pos) + p.depth + '</i> ' : '') +
          esc(p.name) + (isHim ? ' <span class="chip">this player</span>' : '') + '</td>' +
        '<td>' + (chipFor(p.injury) ||
          '<span class="ffd-ok" title="No designation on the injury report">healthy</span>') +
          (p.injury && p.injury.detail ? '<i class="ffd-det">' + esc(p.injury.detail) + '</i>' : '') + '</td>' +
        '<td class="num">' + (st ? one(st.avg) : '—') + '</td>' +
        '<td class="num">' + (st ? one(st.med) : '—') + '</td>' +
        '<td class="num">' + (st ? one(st.hi) : '—') + '</td>' +
        '<td class="num">' + (st ? one(st.lo) : '—') + '</td>' +
        '<td class="num ' + (vor == null ? '' : vor > 0 ? 'up' : 'down') + '">' +
          (vor == null ? '—' : (vor > 0 ? '+' : '') + one(vor)) + '</td>' +
      '</tr>';
    }).join('');

    const season = FFData.bundle
      ? (FFData.bundle.hasLive ? FFData.bundle.season : FFData.bundle.priorSeason) : '';

    return '<div class="ffd-wrap"><table class="ffd">' +
      '<thead><tr>' +
        '<th>Name</th>' +
        '<th>Injury status</th>' +
        '<th class="num" title="Points per game, true PPR">' + season + ' PPG</th>' +
        '<th class="num" title="His median week">Median</th>' +
        '<th class="num" title="His best week">High</th>' +
        '<th class="num" title="His worst week">Low</th>' +
        '<th class="num" title="Points per game over the last startable ' + esc(player.pos) +
          ' in a 12-team league' + (repl == null ? '' : ' — ' + one(repl) + ' a game') + '">Over last startable</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---- who got hurt in this room ----
     The table above carries the designations; this carries the news behind
     them, which is the part that decides whether a designation matters. */
  function roomInjuries(player){
    const hurt = [player, ...FFData.mates(player)]
      .filter(p => p.injury && FFData.statusRank(p.injury.status) > 0);
    if(!hurt.length) return '';

    return '<div class="group-label">Injury news at ' + esc(player.team) + ' ' + esc(player.pos) + '</div>' +
      hurt.map(p => {
        const when = p.injury.date ? new Date(p.injury.date) : null;
        const ago = when && !isNaN(when)
          ? Math.max(0, Math.round((Date.now() - when) / 86400000)) + 'd ago' : '';
        const isHim = p.key === player.key;
        return '<div class="row"><span class="row-main">' +
          '<span class="row-title">' + (isHim ? '<b>' : '') + esc(p.name) + (isHim ? '</b>' : '') +
            (p.depth ? ' <span class="chip">' + esc(p.pos) + p.depth + '</span>' : '') + ' ' +
            chipFor(p.injury) + '</span>' +
          '<span class="row-sub">' + esc(p.injury.detail || 'no detail given') +
            (ago ? ' · ' + ago : '') + '</span></span></div>';
      }).join('');
  }

  /* ---- last game, and who it came against ---- */
  function lastGame(player){
    const stat = player.now;
    if(!stat || !stat.scores.length) return '';
    const week = stat.weeks[stat.weeks.length - 1];
    const pts  = stat.scores[stat.scores.length - 1];
    const opp  = (stat.opps || [])[stat.opps.length - 1];
    return '<div class="group-label">Last game</div>' +
      '<div class="row"><span class="row-main">' +
        '<span class="row-title">Week ' + week + (opp ? ' vs ' + esc(opp) : '') + ' — ' + one(pts) + ' pts</span>' +
        '<span class="row-sub">' + (pts >= stat.med ? 'at or above' : 'below') +
          ' his median of ' + one(stat.med) + '</span>' +
      '</span></div>';
  }

  /* ---- what he is walking into ---- */
  function supportBlock(player){
    const sup = FFData.support(player);
    if(!sup) return '';
    const heading = sup.kind === 'ol' ? 'His offensive line'
                  : sup.kind === 'qb' ? 'Who is throwing to him'
                  : 'Who he is throwing to';
    return '<div class="group-label">' + heading + '</div>' +
      '<div class="row"><span class="row-main">' +
        '<span class="row-title">' + esc(sup.label) + '</span>' +
        '<span class="row-sub">' + esc(sup.detail) + '</span>' +
      '</span></div>';
  }

  function open(player){
    if(!player) return;
    const m = modal(), b = body();
    if(!m || !b) return;

    const a = player.adp;
    const prior = FFData.bundle ? FFData.bundle.priorSeason : '';
    const rookie = !player.last && !player.now;

    const moved = player.movedFrom
      ? '<span class="chip warn">was ' + esc(player.movedFrom) + '</span>' : '';

    const head =
      '<h2>' + esc(player.name) +
        ' <span class="chip">' + esc(player.pos) + '</span>' +
        ' <span class="chip">' + esc(player.team || 'FA') + '</span>' + moved +
        (player.depth ? ' <span class="chip">' + esc(player.pos) + player.depth + ' on the depth chart</span>' : '') +
        ' ' + chipFor(player.injury) +
      '</h2>' +
      '<div class="fdb-head-sub">' +
        (a ? 'Mock-draft ADP <b>' + esc(a.slot) + '</b> (pick ' + one(a.adp) + ') · range ' +
             a.high + '–' + a.low + ' · spread ±' + one(a.sd) + ' · ' + a.n.toLocaleString() + ' drafts'
           : 'Not being drafted in 12-team PPR mocks') +
        (player.bye ? ' · bye week ' + player.bye : '') +
        (player.movedFrom
          ? '<br><b>New team.</b> Everything below was earned playing for ' + esc(player.movedFrom) +
            ' — a different line, and a different quarterback.'
          : '') +
      '</div>';

    const nowBlock = player.now
      ? '<div class="group-label">' + FFData.bundle.season + ' so far</div>' +
        statBlock(player.now, 'this season', player.pos)
      : '';

    const lastBlock = rookie
      ? '<p class="empty">No NFL scoring on record — a rookie, or he did not play a snap in ' + prior +
        '. Everything on this card other than his ADP and the depth chart is therefore blank by fact, ' +
        'not by failure.</p>'
      : '<div class="group-label">' + prior + ' scoring, week by week</div>' +
        statBlock(player.last, prior + ' PPR', player.pos);

    b.innerHTML = head + supportBlock(player) + nowBlock + lastGame(player) + lastBlock +
      roomInjuries(player) +
      '<div class="group-label">' + esc(player.team) + ' ' + esc(player.pos) +
        ' depth chart</div>' + room(player);

    m.hidden = false;
  }

  function close(){ const m = modal(); if(m) m.hidden = true; }

  return {open, close, sparkline, statBlock, one, chipFor, statOf, replacement};
})();

window.FFPlayer = FFPlayer;
