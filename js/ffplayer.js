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
    return `<span class="chip ${rank >= 3 ? 'hot' : 'warn'}">${esc(inj.status)}</span>`;
  };

  /* ---- weekly scoring, drawn ----
     A season average hides the shape of it: 17 points every week and a
     boom/bust that alternates 3 and 31 average the same. The bars are
     the argument for looking past the average, and the median line is
     drawn across them so the gap between the two is visible. */
  function sparkline(stat){
    if(!stat || !stat.scores || !stat.scores.length) return '';
    const w = 100 / stat.scores.length;
    const peak = Math.max(stat.hi, 1);
    const bars = stat.scores.map((s, i) => {
      const h = Math.max((s / peak) * 100, 1.5);
      const hot = s >= stat.med;
      return `<rect x="${(i * w + w * 0.12).toFixed(2)}" y="${(100 - h).toFixed(2)}"
                    width="${(w * 0.76).toFixed(2)}" height="${h.toFixed(2)}"
                    class="ffbar${hot ? ' is-hot' : ''}">
                <title>Week ${stat.weeks[i]} — ${one(s)} pts</title></rect>`;
    }).join('');
    const medY = 100 - (stat.med / peak) * 100;
    return `<div class="ff-spark">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Points by week">
        ${bars}
        <line x1="0" x2="100" y1="${medY.toFixed(2)}" y2="${medY.toFixed(2)}" class="ffmed"></line>
      </svg>
      <div class="ff-spark-x"><span>Wk ${stat.weeks[0]}</span><span>median ${one(stat.med)}</span><span>Wk ${stat.weeks[stat.weeks.length-1]}</span></div>
    </div>`;
  }

  function statBlock(stat, label){
    if(!stat) return `<p class="empty">No ${esc(label)} scoring on record.</p>`;
    return `<div class="ff-stats">
        ${[['Avg', one(stat.avg)], ['Median', one(stat.med)], ['High', one(stat.hi)],
           ['Low', one(stat.lo)], ['Total', one(stat.tot)], ['Games', stat.g]]
          .map(([k, v]) => `<div class="ff-stat"><b>${v}</b><i>${k}</i></div>`).join('')}
      </div>` + sparkline(stat);
  }

  /* ---- the position room ----
     Every other player at his position on his NFL team, in depth-chart
     order. This is the part that turns an injury into a decision: if the
     man above you goes down, you are the one who gets the touches. */
  function room(player){
    const mates = FFData.mates(player);
    if(!mates.length) return '<p class="empty">No one else at this position is on the roster feed.</p>';

    const line = p => {
      const stat = p.now || p.last;
      const rank = p.depth ? `<span class="chip">${p.pos}${p.depth}</span>` : '';
      const scored = stat ? `${one(stat.avg)} avg · ${stat.g}g (${stat.season})` : 'no NFL scoring yet';
      const adp = p.adp ? `ADP ${p.adp.slot}` : 'undrafted';
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${esc(p.name)} ${rank} ${chipFor(p.injury)}</span>
          <span class="row-sub">${esc(scored)} · ${esc(adp)}${
            p.injury && p.injury.detail ? ' · ' + esc(p.injury.detail) : ''}</span>
        </span>
      </div>`;
    };
    return mates.map(line).join('');
  }

  /* ---- who got hurt in this room ----
     The user's actual question: injury news about him, or about anyone
     else who plays his position on his team. A team-mate at the same
     position being out is the single most actionable thing on the card,
     so it is called out rather than left to be spotted in the list. */
  function roomInjuries(player){
    const hurt = [player, ...FFData.mates(player)]
      .filter(p => p.injury && FFData.statusRank(p.injury.status) > 0);
    if(!hurt.length) return '';

    return `<div class="group-label">Injury news at ${esc(player.team)} ${esc(player.pos)}</div>` +
      hurt.map(p => {
        const when = p.injury.date ? new Date(p.injury.date) : null;
        const ago = when && !isNaN(when)
          ? `${Math.max(0, Math.round((Date.now() - when) / 86400000))}d ago` : '';
        const mine = p.key === player.key;
        return `<div class="row">
          <span class="row-main">
            <span class="row-title">${mine ? '<b>' : ''}${esc(p.name)}${mine ? '</b>' : ''}
              ${p.depth ? `<span class="chip">${p.pos}${p.depth}</span>` : ''} ${chipFor(p.injury)}</span>
            <span class="row-sub">${esc(p.injury.detail || 'no detail given')}${ago ? ' · ' + ago : ''}</span>
          </span>
        </div>`;
      }).join('');
  }

  /* ---- last game, and who it came against ----
     In-season only. A big week against the softest defence in the league
     is a different fact from a big week against the stiffest, so the
     ranking of the defence he just played is printed next to the score. */
  function lastGame(player){
    const stat = player.now;
    if(!stat || !stat.scores.length) return '';
    const week = stat.weeks[stat.weeks.length - 1];
    const pts  = stat.scores[stat.scores.length - 1];
    return `<div class="group-label">Last game</div>
      <div class="row">
        <span class="row-main">
          <span class="row-title">Week ${week} — ${one(pts)} pts</span>
          <span class="row-sub">${pts >= stat.med ? 'at or above' : 'below'} his median of ${one(stat.med)}</span>
        </span>
      </div>`;
  }

  function open(player){
    if(!player) return;
    const m = modal(), b = body();
    if(!m || !b) return;

    const a = player.adp;
    const season = FFData.bundle ? FFData.bundle.priorSeason : '';
    const rookie = !player.last && !player.now;

    const head = `
      <h2>${esc(player.name)}
        <span class="chip">${esc(player.pos)}</span>
        <span class="chip">${esc(player.team || 'FA')}</span>
        ${player.depth ? `<span class="chip">${esc(player.pos)}${player.depth} on depth chart</span>` : ''}
        ${chipFor(player.injury)}
      </h2>
      <div class="ff-head-sub">
        ${a ? `Mock-draft ADP <b>${esc(a.slot)}</b> (pick ${one(a.adp)}) ·
               range ${a.high}–${a.low} · spread ±${one(a.sd)} · ${a.n.toLocaleString()} drafts`
            : 'Not being drafted in 12-team PPR mocks'}
        ${player.bye ? ` · bye week ${player.bye}` : ''}
      </div>`;

    const nowBlock = player.now
      ? `<div class="group-label">${FFData.bundle.season} so far</div>${statBlock(player.now, 'this season')}`
      : '';

    const lastBlock = rookie
      ? `<p class="empty">No NFL scoring on record — a rookie, or he did not play a snap in ${season}.
           Everything on this card other than ADP and the depth chart is therefore blank by fact, not by failure.</p>`
      : `<div class="group-label">${season} scoring, week by week</div>${statBlock(player.last, season + ' PPR')}`;

    b.innerHTML = head + nowBlock + lastGame(player) + lastBlock +
      roomInjuries(player) +
      `<div class="group-label">Everyone else at ${esc(player.team)} ${esc(player.pos)}</div>` + room(player);

    m.hidden = false;
  }

  function close(){ const m = modal(); if(m) m.hidden = true; }

  return {open, close, sparkline, statBlock, one, chipFor};
})();

window.FFPlayer = FFPlayer;
