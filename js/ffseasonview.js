/* ============================================================
   ffseasonview.js — the three post-draft screens.

     Team     my starting seven, each slot ranked against the same
              slot on the other eleven rosters
     Waivers  free agents, led by the ones who just had the man in
              front of them go down
     League   every roster ranked on total and on starting talent

   No numbers are invented here. Everything traces back to a real PPR
   box score, and anything unmeasured says so rather than being
   quietly counted as zero.
   ============================================================ */

const FFSeasonView = (() => {

  const one = FFSeason.one;
  const chip = p => FFPlayer.chipFor(p.injury);

  const ord = n => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* A clickable player row that opens the shared card. */
  const openable = (p, title, sub, side) =>
    `<div class="row ff-click" data-key="${esc(p.key)}">
       <span class="row-main">
         <span class="row-title">${title}</span>
         <span class="row-sub">${sub}</span>
       </span>
       ${side ? `<span class="row-side">${side}</span>` : ''}
     </div>`;

  /* ---------------- Team ---------------- */

  async function team(host){
    host.innerHTML = '<p class="empty">Reading the league…</p>';
    await FFSeason.loadLeague();
    const rows = FFSeason.rankings();
    const me = rows.find(r => r.team.mine);
    if(!me) return tileError(host,
      'Could not find your team in that league — check the team ID in Settings.');

    const weak = FFSeason.weaknesses(rows);

    const lineup = me.starters.map(s => {
      const w = weak.find(x => x.player && x.player.key === s.p.key);
      const cls = !w ? '' : w.rank <= 4 ? 'ok' : w.rank >= 9 ? 'hot' : 'warn';
      return openable(s.p,
        `${esc(s.p.name)} <span class="chip">${esc(s.slot)}</span> ${chip(s.p)}`,
        `${esc(s.p.team)}${s.p.depth ? ' · ' + esc(s.p.pos) + s.p.depth : ''} · ${one(s.v)} pts/game`,
        w ? `<span class="chip ${cls}">${ord(w.rank)} of ${w.of}</span>` : '');
    }).join('');

    /* The weakest slots, framed against the league median rather than in
       the abstract — being below average is only worth acting on when the
       gap is big enough to be worth a roster move. */
    const soft = weak.filter(w => w.gap < 0).slice(0, 4);

    host.innerHTML =
      `<div class="group-label">${esc(me.team.name)} — starting lineup</div>
       <div class="ff-shape">
         <span class="chip">${one(me.start)} starting</span>
         <span class="chip">${one(me.total)} total</span>
         <span class="chip ${me.startRank <= 4 ? 'ok' : me.startRank >= 9 ? 'hot' : 'warn'}">
           ${ord(me.startRank)} of ${rows.length} on starters</span>
         <span class="chip">${ord(me.totalRank)} on depth</span>
       </div>
       ${lineup}

       <div class="group-label">Where you are thin</div>
       ${soft.length ? soft.map(w => `<div class="row">
           <span class="row-main">
             <span class="row-title">${esc(w.label)} — ${ord(w.rank)} of ${w.of}</span>
             <span class="row-sub">${w.player ? esc(w.player.name) : '<i>empty slot</i>'} at ${one(w.v)} a game ·
               league median ${one(w.median)}</span>
           </span>
           <span class="row-side down">${one(w.gap)}</span>
         </div>`).join('')
        : '<p class="empty">Every starting slot is at or above the league median. Nothing to fix.</p>'}

       ${me.unmeasured ? `<p class="empty">${me.unmeasured} player${me.unmeasured > 1 ? 's' : ''} on your
          roster ${me.unmeasured > 1 ? 'have' : 'has'} no NFL scoring on record — rookies, or nobody who has
          played. They are left out of both totals rather than counted as zero.</p>` : ''}`;

    clicks(host);
  }

  /* ---------------- Waivers ---------------- */

  async function waivers(host){
    host.innerHTML = '<p class="empty">Reading the free agent pool…</p>';

    /* The league has to be in hand before it can be ranked — rankings() on an
       unloaded league returns nothing, which would silently empty the whole
       "better than somebody you are starting" block rather than fail. */
    await FFSeason.loadLeague();
    const rows = FFSeason.rankings();
    let fas;
    try{ fas = await FFSeason.freeAgents(); }
    catch(e){
      return tileError(host, 'The free agent pool needs the proxy — ESPN will not accept the ' +
        `filter header straight from a browser. (${esc(e.message)})`);
    }

    const opens = FFSeason.openings(fas);
    const ups   = FFSeason.upgrades(fas, rows);

    const b = FFData.bundle;

    /* The last game a player actually played, and how good the defence he
       played it against has been all year. Thirty points against the
       softest defence in the league is a different fact from thirty
       against the stiffest. */
    function lastLine(p){
      if(!p.now || !p.now.scores.length) return '';
      const wk  = p.now.weeks[p.now.weeks.length - 1];
      const pts = p.now.scores[p.now.scores.length - 1];
      return ` · wk ${wk}: ${one(pts)}`;
    }

    const openBlock = opens.length
      ? opens.slice(0, 10).map(o => {
          const names = o.ahead.map(m =>
            `${esc(m.name)} (${esc(m.pos)}${m.depth || ''}, ${esc(m.injury.status.toLowerCase())})`).join(', ');
          return openable(o.fa,
            `${esc(o.fa.name)} <span class="chip">${esc(o.fa.pos)}</span>
             <span class="chip">${esc(o.fa.team)}</span>
             ${o.fresh ? '<span class="chip hot">NEW</span>' : ''} ${chip(o.fa)}`,
            `${names} ahead of him ${o.ahead.length > 1 ? 'are' : 'is'} out` +
            `${o.fa.depth ? ' · he is ' + esc(o.fa.pos) + o.fa.depth : ''}` +
            `${lastLine(o.fa)} · ${o.fa.owned}% rostered`,
            FFSeason.ppg(o.fa) != null ? one(FFSeason.ppg(o.fa)) : '—');
        }).join('')
      : `<p class="empty">Nobody in the pool has a same-position team-mate ahead of him on the
          depth chart who is currently out.</p>`;

    const upBlock = ups.length
      ? ups.slice(0, 10).map(u => openable(u.fa,
          `${esc(u.fa.name)} <span class="chip">${esc(u.fa.pos)}</span>
           <span class="chip">${esc(u.fa.team)}</span> ${chip(u.fa)}`,
          `${one(u.v)} a game against ${esc(u.over.p.name)} at ${one(u.over.v)}` +
          `${lastLine(u.fa)} · ${u.fa.owned}% rostered`,
          `<span class="up">+${one(u.gain)}</span>`)).join('')
      : '<p class="empty">Nothing in the pool is outscoring anyone in your lineup.</p>';

    /* Defence faced, per position, for the players actually shown. */
    const shown = [...opens.slice(0, 10).map(o => o.fa), ...ups.slice(0, 10).map(u => u.fa)];
    const matchupBlock = defenceBlock(shown);

    host.innerHTML =
      `<div class="group-label">An injury just opened a door</div>${openBlock}
       <div class="group-label">Better than somebody you are starting</div>${upBlock}
       ${matchupBlock}
       <p class="empty">Pool is ESPN's own free agents and waivers for your league,
          scored on ${b.hasLive ? b.season + ' games so far' : b.priorSeason + ' — no ' + b.season + ' games have been played yet'}.</p>`;

    clicks(host);
  }

  /* Fantasy points allowed by the defence each shown player last faced.
     Rank 1 is the softest in the league. */
  function defenceBlock(players){
    const b = FFData.bundle;
    if(!b || !b.defence || !Object.keys(b.defence).length) return '';

    const cache = {};
    const rows = [];
    for(const p of players){
      if(!p.now || !p.now.scores.length) continue;
      const opp = (p.now.opps || [])[p.now.opps.length - 1];
      if(!opp) continue;
      const ranks = cache[p.pos] || (cache[p.pos] = FFData.defenceRanks(p.pos));
      const r = ranks[opp];
      if(!r) continue;
      rows.push(`<div class="row"><span class="row-main">
          <span class="row-title">${esc(p.name)} vs ${esc(opp)}</span>
          <span class="row-sub">${esc(opp)} gives up ${one(r.avg)} a game to ${esc(p.pos)}s —
            ${ord(r.rank)} softest of ${r.of}</span>
        </span></div>`);
    }
    if(!rows.length) return '';
    return `<div class="group-label">The defence they just played (${b.defenceSeason})</div>` + rows.join('');
  }

  /* ---------------- League ---------------- */

  async function league(host){
    host.innerHTML = '<p class="empty">Reading every roster…</p>';
    await FFSeason.loadLeague();
    const rows = FFSeason.rankings();
    if(!rows.length) return tileError(host, 'No teams came back from that league.');

    const top = Math.max(...rows.map(r => r.start)) || 1;

    const table = rows.map(r => {
      const w = (r.start / top) * 100;
      const best = [...r.starters].sort((a, b) => b.v - a.v)[0];
      return `<div class="row ff-team${r.team.mine ? ' is-mine' : ''}">
        <span class="row-main">
          <span class="row-title">${r.startRank}. ${esc(r.team.name)}${
            r.team.mine ? ' <span class="chip warn">YOU</span>' : ''}</span>
          <span class="row-sub">best: ${best ? esc(best.p.name) + ' ' + one(best.v) : '—'} ·
            depth ${ord(r.totalRank)} at ${one(r.total)}${
            r.unmeasured ? ' · ' + r.unmeasured + ' unmeasured' : ''}</span>
          <span class="ff-bar"><i style="width:${w.toFixed(1)}%"></i></span>
        </span>
        <span class="row-side"><b>${one(r.start)}</b></span>
      </div>`;
    }).join('');

    const byTotal = [...rows].sort((a, b) => b.total - a.total);
    const movers = byTotal
      .map(r => ({name: r.team.name, mine: r.team.mine, d: r.totalRank - r.startRank}))
      .filter(x => Math.abs(x.d) >= 3);

    host.innerHTML =
      `<div class="group-label">Starting talent — QB, 2 RB, 2 WR, TE, FLEX</div>${table}
       <div class="group-label">Total talent — every player on the roster</div>
       ${byTotal.map(r => `<div class="row${r.team.mine ? ' is-mine' : ''}">
          <span class="row-main">
            <span class="row-title">${r.totalRank}. ${esc(r.team.name)}${
              r.team.mine ? ' <span class="chip warn">YOU</span>' : ''}</span>
            <span class="row-sub">${r.team.roster.length} rostered · ${one(r.start)} of it starts</span>
          </span>
          <span class="row-side"><b>${one(r.total)}</b></span>
        </div>`).join('')}
       ${movers.length ? `<div class="group-label">Depth that is not starting</div>` +
          movers.map(m => `<div class="row"><span class="row-main">
            <span class="row-title">${esc(m.name)}${m.mine ? ' <span class="chip warn">YOU</span>' : ''}</span>
            <span class="row-sub">${m.d > 0
              ? `starts ${m.d} places better than the roster ranks — a strong seven, thin behind it`
              : `${-m.d} places better on depth than on starters — talent stuck on the bench`}</span>
          </span></div>`).join('') : ''}
       <p class="empty">Kickers and defences are left out: they swing week to week on nothing a roster
          controls, and counting them would rank the league on coin flips.</p>`;

    clicks(host);
  }

  function clicks(host){
    host.onclick = e => {
      const row = e.target.closest('[data-key]');
      if(!row) return;
      const p = FFData.bundle && FFData.bundle.index.get(row.dataset.key);
      if(p) FFPlayer.open(p);
    };
  }

  return {team, waivers, league};
})();

window.FFSeasonView = FFSeasonView;
