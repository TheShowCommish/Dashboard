/* ============================================================
   sports.js — team data from ESPN's public site API.

   Called directly, never through the fantasy proxy: ESPN answers 403 to
   datacenter IPs, so routing these through a Worker breaks calls that
   work fine from the browser.

   Everything is cached in memory for the session and refreshed on demand,
   because a single team view touches four endpoints and the calendar asks
   for previews on every repaint.
   ============================================================ */

const Sports = (() => {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
  /* The gamelog lives on a different host; the site API has no equivalent
     and its own /athletes route is CORS-blocked. */
  const WEB  = 'https://site.web.api.espn.com/apis/common/v3/sports';

  const PATH = {
    'nfl':'football/nfl',
    'nba':'basketball/nba',
    'mlb':'baseball/mlb',
    'nhl':'hockey/nhl',
    'college-football':'football/college-football',
    'mens-college-basketball':'basketball/mens-college-basketball'
  };

  const LEAGUE_NAME = {
    'nfl':'NFL', 'nba':'NBA', 'mlb':'MLB', 'nhl':'NHL',
    'college-football':'NCAA Football', 'mens-college-basketball':'NCAA Basketball'
  };

  /* Georgia Tech football, followed out of the box. */
  const DEFAULT_TEAMS = [
    {league:'college-football', id:'59', name:'Georgia Tech Yellow Jackets', abbr:'GT'}
  ];

  const cache = new Map();          // url -> parsed json
  const pending = new Map();        // url -> promise, so a repaint storm makes one call

  function get(url){
    if(cache.has(url)) return Promise.resolve(cache.get(url));
    if(pending.has(url)) return pending.get(url);
    const p = getJSON(url)
      .then(d => { cache.set(url, d); pending.delete(url); return d; })
      .catch(e => { pending.delete(url); throw e; });
    pending.set(url, p);
    return p;
  }

  const clearCache = () => cache.clear();

  /* ---- followed teams ---- */
  /* Seed Georgia Tech once. Store defaults teams to [], not null, so an
     empty array cannot distinguish "never set up" from "removed them all" —
     hence the separate flag, which stops the default reappearing after a
     deliberate removal. */
  function teams(){
    const saved = Store.get('teams', []);
    if(!saved.length && !Store.get('teams.seeded', false)){
      Store.set('teams', DEFAULT_TEAMS);
      Store.set('teams.seeded', true);
      return DEFAULT_TEAMS;
    }
    return saved;
  }

  const leagueName = lg => LEAGUE_NAME[lg] || lg.toUpperCase();

  /* ---- per team ---- */
  async function info(t){
    const d = await get(`${BASE}/${PATH[t.league]}/teams/${t.id}`);
    const team = d.team || {};
    return {
      id: team.id, name: team.displayName || t.name,
      abbr: team.abbreviation || t.abbr,
      color: team.color ? `#${team.color}` : null,
      logo: team.logos?.[0]?.href || logoFor(t),
      record: team.record?.items?.find(i => /overall/i.test(i.description || ''))?.summary
           || team.record?.items?.[0]?.summary || '',
      standing: team.standingSummary || '',
      rank: team.rank || null
    };
  }

  /* ESPN serves logos off a predictable CDN path, which saves a lookup
     when only the id is known. */
  function logoFor(t){
    const sport = PATH[t.league].split('/')[0];
    const dir = t.league.includes('college') ? 'ncaa'
              : {football:'nfl', basketball:'nba', baseball:'mlb', hockey:'nhl'}[sport];
    return `https://a.espncdn.com/i/teamlogos/${dir}/500/${t.id}.png`;
  }

  async function schedule(t){
    const d = await get(`${BASE}/${PATH[t.league]}/teams/${t.id}/schedule`);
    return (d.events || []).map(e => normalise(e, t)).filter(Boolean);
  }

  async function news(t, limit = 6){
    const d = await get(`${BASE}/${PATH[t.league]}/news?team=${t.id}&limit=${limit}`);
    return (d.articles || []).slice(0, limit).map(a => ({
      headline: a.headline,
      description: a.description || '',
      published: a.published,
      link: a.links?.web?.href || '',
      image: a.images?.[0]?.url || ''
    }));
  }

  async function standings(league){
    const d = await get(`https://site.api.espn.com/apis/v2/sports/${PATH[league]}/standings`);
    return flattenStandings(d);
  }

  /* The payload nests groups inside groups (conference → division), and
     college adds a third level. Flatten to labelled tables. */
  function flattenStandings(node, out = [], label = ''){
    if(!node) return out;
    const name = node.shortName || node.name || label;

    if(node.standings?.entries?.length){
      out.push({
        name,
        rows: node.standings.entries.map(e => ({
          team: e.team?.displayName || e.team?.name || '',
          abbr: e.team?.abbreviation || '',
          id: e.team?.id,
          logo: e.team?.logos?.[0]?.href || '',
          stats: Object.fromEntries((e.stats || []).map(s => [s.name, s.displayValue]))
        }))
      });
    }
    for(const child of (node.children || [])) flattenStandings(child, out, name);
    return out;
  }

  /* ---- one game ---- */
  function normalise(e, t){
    const comp = e.competitions?.[0];
    if(!comp) return null;
    const me  = comp.competitors.find(c => String(c.id) === String(t.id));
    const opp = comp.competitors.find(c => String(c.id) !== String(t.id));
    if(!me || !opp) return null;

    const state = comp.status?.type?.state || 'pre';
    const side = c => ({
      id: c.team?.id,
      name: c.team?.displayName || c.team?.name || 'TBD',
      abbr: c.team?.abbreviation || '',
      logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
      record: c.records?.find(r => /total|overall/i.test(r.name || r.type || ''))?.summary
           || c.records?.[0]?.summary || '',
      score: c.score?.displayValue ?? c.score ?? '',
      home: c.homeAway === 'home',
      winner: c.winner === true
    });

    return {
      eventId: e.id,
      league: t.league,
      teamId: String(t.id),
      teamName: t.name,
      abbr: t.abbr,
      kickoff: e.date,
      state,
      status: comp.status?.type?.shortDetail || '',
      venue: comp.venue?.fullName || '',
      broadcast: (comp.broadcasts || []).flatMap(b => b.names || [b.media?.shortName]).filter(Boolean),
      me: side(me),
      opp: side(opp),
      home: me.homeAway === 'home',
      opponent: opp.team?.displayName || opp.team?.name || 'TBD',
      result: state === 'post' ? (me.winner === true ? 'win' : me.winner === false ? 'loss' : null) : null,
      score: state !== 'pre'
        ? `${me.score?.displayValue ?? me.score ?? ''}–${opp.score?.displayValue ?? opp.score ?? ''}` : ''
    };
  }

  /* Live detail. Cached like everything else, but a game in progress is
     re-fetched so the score is not frozen. */
  async function summary(league, eventId, live){
    const url = `${BASE}/${PATH[league]}/summary?event=${eventId}`;
    if(live) cache.delete(url);
    const d = await get(url);

    const comp = d.header?.competitions?.[0];
    const sides = (comp?.competitors || []).map(c => ({
      id: c.team?.id,
      name: c.team?.displayName || '',
      abbr: c.team?.abbreviation || '',
      logo: c.team?.logos?.[0]?.href || logoById(league, c.team?.id),
      record: c.record?.find(r => /total|overall/i.test(r.type || ''))?.displayValue
           || c.record?.[0]?.displayValue || '',
      score: c.score ?? '',
      home: c.homeAway === 'home'
    }));

    /* leaders[] is per team, each holding categories, each holding people. */
    const leaders = (d.leaders || []).flatMap(teamBlock =>
      (teamBlock.leaders || []).flatMap(cat =>
        (cat.leaders || []).slice(0,1).map(l => ({
          team: teamBlock.team?.abbreviation || '',
          category: cat.displayName || cat.name,
          athleteId: l.athlete?.id,
          athlete: l.athlete?.displayName || '',
          headshot: l.athlete?.headshot?.href || '',
          position: l.athlete?.position?.abbreviation || '',
          value: l.displayValue || ''
        }))));

    return {
      sides,
      leaders,
      status: comp?.status?.type?.shortDetail || '',
      state: comp?.status?.type?.state || 'pre',
      broadcast: (d.broadcasts || []).flatMap(b => b.media?.shortName || b.names || []).filter(Boolean),
      venue: d.gameInfo?.venue?.fullName || '',
      odds: d.pickcenter?.[0]?.details || d.odds?.[0]?.details || ''
    };
  }

  function logoById(league, id){
    if(!id) return '';
    const sport = PATH[league].split('/')[0];
    const dir = league.includes('college') ? 'ncaa'
              : {football:'nfl', basketball:'nba', baseball:'mlb', hockey:'nhl'}[sport];
    return `https://a.espncdn.com/i/teamlogos/${dir}/500/${id}.png`;
  }

  /* ---- player game log ---- */
  async function gamelog(league, athleteId){
    const d = await get(`${WEB}/${PATH[league]}/athletes/${athleteId}/gamelog`);
    const labels = {};
    for(const c of (d.categories || [])) labels[c.name] = c.labels || [];

    const events = d.events || {};
    const rows = [];
    for(const season of (d.seasonTypes || [])){
      for(const cat of (season.categories || [])){
        for(const ev of (cat.events || [])){
          const meta = events[ev.eventId] || {};
          rows.push({
            eventId: ev.eventId,
            date: meta.gameDate || '',
            opponent: meta.opponent?.abbreviation || meta.opponent?.displayName || '',
            homeAway: meta.homeTeamScore != null ? '' : '',
            result: meta.gameResult ? `${meta.gameResult} ${meta.homeTeamScore}-${meta.awayTeamScore}` : '',
            labels: labels[cat.name] || d.names || [],
            stats: ev.stats || []
          });
        }
      }
    }
    /* This endpoint returns stats only — no athlete block — so the name,
       position and headshot have to come from the caller, which already
       has them from the game leaders. */
    return {
      names: d.names || [],
      displayNames: d.displayNames || [],
      rows: rows.slice(0, 20)
    };
  }

  return {
    teams, info, schedule, news, standings, summary, gamelog,
    leagueName, logoFor, clearCache, normalise,
    PATH, DEFAULT_TEAMS
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Sports = Sports;
