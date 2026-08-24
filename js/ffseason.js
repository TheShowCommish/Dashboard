/* ============================================================
   ffseason.js — the same data, after the draft.

   The draft board asks "who should I take". Once the league is set,
   the questions change and the data does not:

     · How does every roster in the league actually rank — all of it,
       and just the seven that start?
     · Where is my team the weakest relative to the other eleven?
     · Which free agent just had the man in front of him go down?
     · Which free agent is simply outscoring somebody I am starting?

   Roster data comes from ESPN through the proxy. Scoring, depth charts
   and injuries come from the same places the draft board uses, so a
   free agent and a rostered player are measured identically.
   ============================================================ */

const FFSeason = (() => {

  /* A 12-team PPR lineup: QB, two RB, two WR, TE, and a flex that takes
     the best remaining RB, WR or TE. Kickers and defences are not talent,
     they are noise, and including them would rank the league on coin
     flips — so they sit out of the starting score. */
  const LINEUP = [
    {pos: 'QB', n: 1},
    {pos: 'RB', n: 2},
    {pos: 'WR', n: 2},
    {pos: 'TE', n: 1}
  ];
  const FLEX = ['RB', 'WR', 'TE'];

  const one = n => (n == null || !isFinite(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);

  let league = null;          // {teams:[{id,name,logo,roster:[player]}], myId}
  let pending = null;

  const base = () => {
    const p = Store.get('fantasy.proxy', '').replace(/\/$/, '');
    return p || 'https://lm-api-reads.fantasy.espn.com';
  };

  /* ---- how good is a player, in one number ----
     Points per game: this season once he has played, last season before
     that. A player with neither is unmeasured, not bad — he returns null
     and every total that touches him says so. */
  function ppg(p){
    if(!p) return null;
    const stat = (p.now && p.now.g) ? p.now : (p.last && p.last.g ? p.last : null);
    return stat ? stat.avg : null;
  }

  /* ---- the league ---- */
  async function loadLeague(opts = {}){
    if(league && !opts.force) return league;
    if(pending && !opts.force) return pending;

    pending = (async () => {
      const id     = Store.get('fantasy.league', '');
      const season = Store.get('fantasy.season', String(new Date().getFullYear()));
      const myId   = Number(Store.get('fantasy.team', ''));
      if(!id) throw new Error('no league ID in Settings');

      const lg = await getJSON(
        `${base()}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}` +
        '?view=mRoster&view=mTeam', {credentials: 'omit'});

      const b = await FFData.load();

      const teams = (lg.teams || []).map(t => {
        const roster = (t.roster?.entries || []).map(e => {
          const raw = e.playerPoolEntry?.player;
          if(!raw) return null;
          const pos = FFData.ESPN_POS[raw.defaultPositionId] || '?';
          /* Join to the same index the draft board uses, so an owned player
             and a free agent are never scored by different rules. */
          const known = b.index.get(FFData.key(raw.fullName, pos));
          return known || {
            key: FFData.key(raw.fullName, pos),
            name: raw.fullName, pos,
            team: FFData.ESPN_TEAM[raw.proTeamId] || 'FA',
            adp: null, last: null, now: null, depth: null, injury: null
          };
        }).filter(Boolean);

        return {
          id: t.id,
          name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${t.id}`,
          logo: t.logo || '',
          mine: t.id === myId,
          roster
        };
      });

      league = {teams, myId, season: Number(season), leagueId: id};
      return league;
    })();

    try{ return await pending; }
    finally{ pending = null; }
  }

  /* ---- talent ----
     Total talent is every rostered player added up: depth, and what a
     roster is worth in trade. Starting talent is only the seven that
     score on Sunday, which is what actually wins weeks — a bench full
     of good players scores nothing. */
  function rate(team){
    const scored = team.roster
      .map(p => ({p, v: ppg(p)}))
      .filter(x => x.v != null);

    const total = scored.reduce((a, x) => a + x.v, 0);

    const byPos = {};
    for(const x of scored) (byPos[x.p.pos] = byPos[x.p.pos] || []).push(x);
    for(const list of Object.values(byPos)) list.sort((a, c) => c.v - a.v);

    const starters = [];
    const used = new Set();
    for(const slot of LINEUP)
      for(const x of (byPos[slot.pos] || []).slice(0, slot.n)){
        starters.push({slot: slot.pos, ...x});
        used.add(x.p.key);
      }

    /* Flex: the best RB, WR or TE not already starting. */
    const bench = FLEX.flatMap(pos => (byPos[pos] || []).filter(x => !used.has(x.p.key)))
                      .sort((a, c) => c.v - a.v);
    if(bench[0]){ starters.push({slot: 'FLEX', ...bench[0]}); used.add(bench[0].p.key); }

    const start = starters.reduce((a, x) => a + x.v, 0);
    const unmeasured = team.roster.length - scored.length;

    return {total, start, starters, byPos, unmeasured};
  }

  function rankings(){
    if(!league) return [];
    const rows = league.teams.map(t => ({team: t, ...rate(t)}));

    const order = (key) => {
      const sorted = [...rows].sort((a, b) => b[key] - a[key]);
      sorted.forEach((r, i) => { r[key + 'Rank'] = i + 1; });
    };
    order('total'); order('start');
    return rows.sort((a, b) => b.start - a.start);
  }

  /* ---- where am I thin ----
     A starting slot is only a weakness relative to what the other eleven
     put in the same slot. Being 9th of 12 at running back is a problem;
     scoring 11 a game at tight end is not, if everyone does. */
  function weaknesses(rows){
    const me = rows.find(r => r.team.mine);
    if(!me) return [];

    const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'];
    const seen = {};
    return slots.map((slot, i) => {
      seen[slot] = (seen[slot] || 0) + 1;
      const nth = seen[slot];
      const pick = r => r.starters.filter(s => s.slot === slot)[nth - 1];

      const mineSlot = pick(me);
      const all = rows.map(pick).filter(Boolean).map(s => s.v).sort((a, b) => b - a);
      if(!all.length) return null;

      const v = mineSlot ? mineSlot.v : 0;
      const rank = all.filter(x => x > v).length + 1;
      const median = all[Math.floor(all.length / 2)];

      return {
        label: slot + (['RB', 'WR'].includes(slot) ? nth : ''),
        player: mineSlot ? mineSlot.p : null,
        v, rank, of: all.length, median, gap: v - median
      };
    }).filter(Boolean).sort((a, b) => a.gap - b.gap);
  }

  /* ---- free agents ----
     ESPN's own pool, so it reflects what is genuinely available in this
     league rather than everyone in the NFL. Needs the proxy: the filter
     travels in a header the browser will not send cross-origin. */
  async function freeAgents(){
    const id     = Store.get('fantasy.league', '');
    const season = Store.get('fantasy.season', String(new Date().getFullYear()));

    const filter = {players: {
      filterStatus: {value: ['FREEAGENT', 'WAIVERS']},
      limit: 200, offset: 0,
      sortPercOwned: {sortAsc: false, sortPriority: 1}
    }};

    const d = await getJSON(
      `${base()}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}?view=kona_player_info`,
      {headers: {'X-Fantasy-Filter': JSON.stringify(filter)}, credentials: 'omit'});

    const b = FFData.bundle;
    return (d.players || []).map(x => x.player).map(raw => {
      const pos = FFData.ESPN_POS[raw.defaultPositionId] || '?';
      const known = b.index.get(FFData.key(raw.fullName, pos));
      return Object.assign({
        key: FFData.key(raw.fullName, pos),
        name: raw.fullName, pos,
        team: FFData.ESPN_TEAM[raw.proTeamId] || 'FA',
        adp: null, last: null, now: null, depth: null, injury: null
      }, known || {}, {
        owned: Math.round(raw.ownership?.percentOwned || 0),
        trend: Math.round(raw.ownership?.percentChange || 0)
      });
    }).filter(p => p.pos !== '?');
  }

  /* Injuries new enough to still be an opportunity. ESPN stamps each
     designation with a date; a week is the waiver cycle. */
  const RECENT_DAYS = 8;
  function isRecent(inj){
    if(!inj || !inj.date) return false;
    const t = new Date(inj.date).getTime();
    if(!isFinite(t)) return false;
    return (Date.now() - t) / 86400000 <= RECENT_DAYS;
  }

  /* The headline free-agency signal: somebody ahead of this man on his
     own depth chart, at his own position, just went down. */
  function openings(fas){
    const out = [];
    for(const fa of fas){
      if(!fa.team || fa.team === 'FA') continue;
      const ahead = FFData.group(fa.team, fa.pos)
        .filter(m => m.key !== fa.key)
        .filter(m => (m.depth ?? 99) < (fa.depth ?? 99))
        .filter(m => m.injury && FFData.statusRank(m.injury.status) >= 3);
      if(!ahead.length) continue;
      const fresh = ahead.some(m => isRecent(m.injury));
      out.push({fa, ahead, fresh});
    }
    /* Fresh news first, then the man closest to the front of the queue. */
    return out.sort((a, b) =>
      (b.fresh - a.fresh) || ((a.fa.depth ?? 99) - (b.fa.depth ?? 99)));
  }

  /* A free agent worth more than somebody currently in my lineup. */
  function upgrades(fas, rows){
    const me = rows.find(r => r.team.mine);
    if(!me) return [];

    const worst = {};
    for(const s of me.starters){
      const pos = s.p.pos;
      if(!(pos in worst) || s.v < worst[pos].v) worst[pos] = s;
    }

    const out = [];
    for(const fa of fas){
      const v = ppg(fa);
      const mine = worst[fa.pos];
      if(v == null || !mine) continue;
      if(v <= mine.v) continue;
      out.push({fa, v, over: mine, gain: v - mine.v});
    }
    return out.sort((a, b) => b.gain - a.gain);
  }

  return {loadLeague, rankings, weaknesses, freeAgents, openings, upgrades,
          rate, ppg, one, isRecent,
          get league(){ return league; }};
})();

window.FFSeason = FFSeason;
