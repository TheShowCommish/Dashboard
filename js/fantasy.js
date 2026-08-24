/* ============================================================
   fantasy.js — ESPN fantasy football.

   A PUBLIC league works straight from the browser.
   A PRIVATE league needs the little proxy in /proxy (see README step 6)
   because ESPN requires two cookies the browser will not send
   cross-origin. Set the proxy URL in Settings and it is used instead.
   ============================================================ */

const Fantasy = (() => {
  const body = document.getElementById('ffBody');
  const weekChip = document.getElementById('ffWeek');

  const POS = {1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
  const PRO = {1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',
    11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',
    21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',
    33:'BAL',34:'HOU'};

  const HURT = ['OUT','DOUBTFUL','INJURY_RESERVE','SUSPENSION','QUESTIONABLE'];
  const SIDELINED = ['OUT','DOUBTFUL','INJURY_RESERVE','SUSPENSION'];

  /* Which teammate injuries actually move the needle for a given position. */
  const IMPACT = [
    {hurt:'QB', affects:['WR','TE','RB'], note:'QB is down — passing volume and efficiency take a hit'},
    {hurt:'RB', affects:['RB'],           note:'Backfield mate is down — more touches available'},
    {hurt:'WR', affects:['WR','TE'],      note:'Target competition is down — target share should rise'},
    {hurt:'TE', affects:['WR','TE'],      note:'Target competition is down — target share should rise'}
  ];

  const base = () => {
    const p = Store.get('fantasy.proxy','').replace(/\/$/,'');
    return p || 'https://lm-api-reads.fantasy.espn.com';
  };

  async function load(){
    const league = Store.get('fantasy.league','');
    const season = Store.get('fantasy.season', String(new Date().getFullYear()));
    const myTeam = Number(Store.get('fantasy.team',''));
    if(!league) return tileError(body,'Add your league ID in Settings.');

    body.innerHTML = '<p class="empty">Loading roster…</p>';

    try{
      const url = `${base()}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${league}` +
                  '?view=mRoster&view=mTeam&view=mSettings';
      const lg = await getJSON(url, {credentials:'omit'});

      const week = lg.status?.currentMatchupPeriod ?? lg.scoringPeriodId ?? 1;
      weekChip.textContent = `Week ${week}`;

      const team = lg.teams.find(t => t.id === myTeam) || lg.teams[0];
      if(!team) throw new Error('team not found in that league');

      const roster = (team.roster?.entries||[]).map(e => {
        const p = e.playerPoolEntry.player;
        return {
          id: p.id,
          name: p.fullName,
          pos: POS[p.defaultPositionId] || '?',
          proId: p.proTeamId,
          pro: PRO[p.proTeamId] || 'FA',
          status: p.injuryStatus || 'ACTIVE'
        };
      });

      const [byes, leagueInjuries] = await Promise.all([
        byeWeeks(season).catch(() => ({})),
        nflInjuries().catch(() => [])
      ]);

      render({team, roster, week, byes, leagueInjuries, lg, season, league});
    }catch(e){
      tileError(body, `Fantasy failed to load (${e.message}). ` +
        (Store.get('fantasy.proxy','')
          ? 'Check the proxy URL and that your ESPN cookies are still valid.'
          : 'If your league is private you need the proxy — see README step 6.'));
    }
  }

  async function byeWeeks(season){
    const d = await getJSON(`${base()}/apis/v3/games/ffl/seasons/${season}?view=proTeamSchedules_wl`);
    const out = {};
    for(const t of (d.settings?.proTeams || d.proTeams || []))
      if(t.byeWeek) out[t.id] = t.byeWeek;
    return out;
  }

  /* League-wide NFL injury report — public ESPN endpoint, no auth. */
  async function nflInjuries(){
    const d = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
    const out = [];
    for(const team of (d.injuries||[]))
      for(const it of (team.injuries||[]))
        out.push({
          team: (team.displayName||'').toUpperCase(),
          teamAbbr: (team.abbreviation||'').toUpperCase(),
          name: it.athlete?.displayName || '',
          pos: it.athlete?.position?.abbreviation || '',
          status:(it.status||'').toUpperCase(),
          detail: it.details?.type || it.shortComment || ''
        });
    return out;
  }

  function render({team, roster, week, byes, leagueInjuries, season, league}){
    const hurt = roster.filter(p => HURT.includes(p.status));
    const onBye = roster.filter(p => byes[p.proId] === week);

    /* teammate-impact alerts */
    const myProTeams = new Set(roster.map(p => p.pro));
    const alerts = [];
    for(const inj of leagueInjuries){
      if(!myProTeams.has(inj.teamAbbr) || !SIDELINED.includes(inj.status)) continue;
      for(const rule of IMPACT){
        if(inj.pos !== rule.hurt) continue;
        for(const mine of roster){
          if(mine.pro !== inj.teamAbbr) continue;
          if(!rule.affects.includes(mine.pos)) continue;
          if(mine.name === inj.name) continue;
          alerts.push({mine, inj, note: rule.note});
        }
      }
    }

    const sec = (title, inner) => inner ? `<div class="group-label">${title}</div>${inner}` : '';

    body.innerHTML =
      `<div class="group-label">${esc(team.name || team.location+' '+team.nickname)} · ${roster.length} players</div>` +

      sec('Injuries on your roster', hurt.map(p => {
        const cls = SIDELINED.includes(p.status) ? 'hot' : 'warn';
        return `<div class="row"><span class="row-main">
          <span class="row-title">${esc(p.name)}</span>
          <span class="row-sub">${p.pos} · ${p.pro}</span></span>
          <span class="chip ${cls}">${p.status.replace('INJURY_RESERVE','IR')}</span></div>`;
      }).join('')) +

      sec(`On bye this week`, onBye.map(p =>
        `<div class="row"><span class="row-main">
          <span class="row-title">${esc(p.name)}</span>
          <span class="row-sub">${p.pos} · ${p.pro}</span></span>
          <span class="chip warn">BYE</span></div>`).join('')) +

      sec('Ripple effects', dedupe(alerts).slice(0,8).map(a =>
        `<div class="row"><span class="row-main">
          <span class="row-title">${esc(a.mine.name)} <span class="chip">${a.mine.pos}</span></span>
          <span class="row-sub">${esc(a.inj.name)} (${a.inj.pos}, ${a.inj.teamAbbr}) is ${a.inj.status.toLowerCase()} — ${a.note}</span>
        </span></div>`).join('')) +

      `<div class="group-label">Bye weeks ahead</div>` +
      byeTable(roster, byes, week) +
      `<div class="group-label">Free agents</div>
       <div id="ffFA"><p class="empty">Loading suggestions…</p></div>`;

    freeAgents(season, league, roster, byes, week);
  }

  function dedupe(list){
    const seen = new Set();
    return list.filter(a => {
      const k = a.mine.id + '|' + a.inj.name;
      if(seen.has(k)) return false; seen.add(k); return true;
    });
  }

  function byeTable(roster, byes, week){
    const map = {};
    for(const p of roster){
      const b = byes[p.proId];
      if(!b || b < week) continue;
      (map[b] = map[b] || []).push(p);
    }
    const weeks = Object.keys(map).sort((a,b) => a-b);
    if(!weeks.length) return '<p class="empty">No remaining byes on this roster.</p>';
    return weeks.map(w => `<div class="row">
      <span class="row-main">
        <span class="row-title">Week ${w}</span>
        <span class="row-sub">${map[w].map(p => `${esc(p.name)} (${p.pos})`).join(', ')}</span>
      </span>
      <span class="row-side"><span class="chip ${map[w].length>2?'hot':''}">${map[w].length}</span></span>
    </div>`).join('');
  }

  /* Suggestions: best available free agents at positions you are thin on. */
  async function freeAgents(season, league, roster, byes, week){
    const el = document.getElementById('ffFA');
    if(!el) return;

    // where you are exposed this week
    const gaps = {};
    for(const p of roster){
      if(SIDELINED.includes(p.status) || byes[p.proId] === week)
        gaps[p.pos] = (gaps[p.pos]||0) + 1;
    }
    const wanted = Object.keys(gaps).length ? Object.keys(gaps) : ['RB','WR'];

    const filter = {
      players:{
        filterStatus:{value:['FREEAGENT','WAIVERS']},
        limit:60, offset:0,
        sortPercOwned:{sortAsc:false, sortPriority:1}
      }
    };

    try{
      const d = await getJSON(
        `${base()}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${league}?view=kona_player_info`,
        {headers:{'X-Fantasy-Filter': JSON.stringify(filter)}, credentials:'omit'});

      const pool = (d.players||[]).map(x => x.player).map(p => ({
        name:p.fullName,
        pos:POS[p.defaultPositionId]||'?',
        pro:PRO[p.proTeamId]||'FA',
        owned:Math.round(p.ownership?.percentOwned||0),
        trend:Math.round(p.ownership?.percentChange||0),
        bye:byes[p.proTeamId]
      }));

      const picks = pool
        .filter(p => wanted.includes(p.pos) && p.bye !== week)
        .sort((a,b) => (b.trend - a.trend) || (b.owned - a.owned))
        .slice(0,6);

      if(!picks.length) return tileError(el,'No clear free agent targets right now.');

      el.innerHTML =
        `<p class="empty" style="margin-bottom:6px">Covering for ${wanted.join(', ')} this week.</p>` +
        picks.map(p => `<div class="row">
          <span class="row-main">
            <span class="row-title">${esc(p.name)}</span>
            <span class="row-sub">${p.pos} · ${p.pro} · ${p.owned}% rostered</span>
          </span>
          <span class="row-side ${p.trend>0?'up':''}">${p.trend>0?'+':''}${p.trend}%</span>
        </div>`).join('');
    }catch(e){
      tileError(el,'Free agent list needs the proxy — the browser cannot send ESPN the required header directly.');
    }
  }


  /* ---- weekly matchup ----
     The calendar strip wants the live score on Sundays and Mondays, which
     needs a different view set than the roster page: mMatchupScore carries
     the totals, mBoxscore the per-player applied points. */
  async function matchup(opts = {}){
    const league = Store.get('fantasy.league','');
    const season = Store.get('fantasy.season', String(new Date().getFullYear()));
    const myTeam = Number(Store.get('fantasy.team',''));
    if(!league) return null;

    const lg = await getJSON(
      `${base()}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${league}` +
      '?view=mMatchupScore&view=mBoxscore&view=mTeam', {credentials:'omit'});

    const cur = lg.status?.currentMatchupPeriod ?? lg.scoringPeriodId ?? 1;
    const week = cur + (opts.weekOffset || 0);
    const names = Object.fromEntries((lg.teams || []).map(t =>
      [t.id, t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${t.id}`]));
    /* ESPN carries a team logo per franchise; the AD uses it, the compact
       board in the calendar does not. */
    const logos = Object.fromEntries((lg.teams || []).map(t => [t.id, t.logo || '']));

    const bouts = (lg.schedule || []).filter(m => m.matchupPeriodId === week);
    const mine = bouts.find(m => m.home?.teamId === myTeam || m.away?.teamId === myTeam)
              || bouts[0];
    if(!mine) return null;

    /* Only starters count toward the score; the bench sits on slot 20/21.
       The whole starting lineup comes back — the calendar board takes the
       top three, the AD shows all of them. */
    const BENCH = new Set([20, 21]);
    const scorers = entry => (entry?.rosterForCurrentScoringPeriod?.entries || [])
      .filter(e => !BENCH.has(e.lineupSlotId))
      .map(e => ({
        name: e.playerPoolEntry?.player?.fullName || '—',
        pos: POS[e.playerPoolEntry?.player?.defaultPositionId] || '?',
        slot: e.lineupSlotId,
        points: e.playerPoolEntry?.player?.stats?.find(x => x.scoringPeriodId === week
                  && x.statSourceId === 0)?.appliedTotal ?? 0
      }))
      .sort((a,b) => b.points - a.points);

    const side = (e, which) => {
      const all = scorers(e);
      return {
        name: names[e?.teamId] || which,
        logo: logos[e?.teamId] || '',
        score: e?.totalPoints ?? 0,
        mine: e?.teamId === myTeam,
        starters: all,
        top: all.slice(0,3)
      };
    };

    return {week, home: side(mine.home,'Home'), away: side(mine.away,'Away')};
  }

  return { load, matchup };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Fantasy = Fantasy;
