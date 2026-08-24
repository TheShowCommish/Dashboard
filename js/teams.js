/* ============================================================
   teams.js — followed teams from ESPN's public site API.
   Feeds the calendar tile and the theme engine (game day/win/loss).

   If the live team list will not load, an offline NFL list keeps the
   picker usable, and the real error is surfaced instead of guessed at.
   ============================================================ */

const Teams = (() => {
  const body  = document.getElementById('teamsBody');
  const modal = document.getElementById('teamModal');
  const selLg = document.getElementById('tmLeague');
  const selTm = document.getElementById('tmTeam');
  const btnSave = document.getElementById('tmSave');

  const PATH = {
    'nfl':'football/nfl',
    'nba':'basketball/nba',
    'mlb':'baseball/mlb',
    'nhl':'hockey/nhl',
    'college-football':'football/college-football',
    'mens-college-basketball':'basketball/mens-college-basketball'
  };

  /* Offline safety net.
     ESPN's /teams list endpoint sends no Access-Control-Allow-Origin
     header, so a browser cannot read it from any origin — it fails with
     "Failed to fetch" for every league. (Schedules and scoreboards on the
     same host DO allow CORS, so only the picker is affected.) These
     built-in rosters carry ESPN's own team IDs, which is all the schedule
     calls need. The two college leagues are far too large to ship here and
     a proxy does not rescue them either — ESPN answers 403 to datacenter
     IPs — so they need a different data source entirely. */
  const NFL_FALLBACK = [
    [22,'ARI','Arizona Cardinals'],[1,'ATL','Atlanta Falcons'],[33,'BAL','Baltimore Ravens'],
    [2,'BUF','Buffalo Bills'],[29,'CAR','Carolina Panthers'],[3,'CHI','Chicago Bears'],
    [4,'CIN','Cincinnati Bengals'],[5,'CLE','Cleveland Browns'],[6,'DAL','Dallas Cowboys'],
    [7,'DEN','Denver Broncos'],[8,'DET','Detroit Lions'],[9,'GB','Green Bay Packers'],
    [34,'HOU','Houston Texans'],[11,'IND','Indianapolis Colts'],[30,'JAX','Jacksonville Jaguars'],
    [12,'KC','Kansas City Chiefs'],[13,'LV','Las Vegas Raiders'],[24,'LAC','Los Angeles Chargers'],
    [14,'LAR','Los Angeles Rams'],[15,'MIA','Miami Dolphins'],[16,'MIN','Minnesota Vikings'],
    [17,'NE','New England Patriots'],[18,'NO','New Orleans Saints'],[19,'NYG','New York Giants'],
    [20,'NYJ','New York Jets'],[21,'PHI','Philadelphia Eagles'],[23,'PIT','Pittsburgh Steelers'],
    [25,'SF','San Francisco 49ers'],[26,'SEA','Seattle Seahawks'],[27,'TB','Tampa Bay Buccaneers'],
    [10,'TEN','Tennessee Titans'],[28,'WSH','Washington Commanders']
  ];

  const NBA_FALLBACK = [
    [1,'ATL','Atlanta Hawks'],[2,'BOS','Boston Celtics'],[17,'BKN','Brooklyn Nets'],
    [30,'CHA','Charlotte Hornets'],[4,'CHI','Chicago Bulls'],[5,'CLE','Cleveland Cavaliers'],
    [6,'DAL','Dallas Mavericks'],[7,'DEN','Denver Nuggets'],[8,'DET','Detroit Pistons'],
    [9,'GS','Golden State Warriors'],[10,'HOU','Houston Rockets'],[11,'IND','Indiana Pacers'],
    [12,'LAC','LA Clippers'],[13,'LAL','Los Angeles Lakers'],[29,'MEM','Memphis Grizzlies'],
    [14,'MIA','Miami Heat'],[15,'MIL','Milwaukee Bucks'],[16,'MIN','Minnesota Timberwolves'],
    [3,'NO','New Orleans Pelicans'],[18,'NY','New York Knicks'],[25,'OKC','Oklahoma City Thunder'],
    [19,'ORL','Orlando Magic'],[20,'PHI','Philadelphia 76ers'],[21,'PHX','Phoenix Suns'],
    [22,'POR','Portland Trail Blazers'],[23,'SAC','Sacramento Kings'],[24,'SA','San Antonio Spurs'],
    [28,'TOR','Toronto Raptors'],[26,'UTAH','Utah Jazz'],[27,'WSH','Washington Wizards']
  ];

  const MLB_FALLBACK = [
    [29,'ARI','Arizona Diamondbacks'],[15,'ATL','Atlanta Braves'],[1,'BAL','Baltimore Orioles'],
    [2,'BOS','Boston Red Sox'],[16,'CHC','Chicago Cubs'],[4,'CWS','Chicago White Sox'],
    [17,'CIN','Cincinnati Reds'],[5,'CLE','Cleveland Guardians'],[27,'COL','Colorado Rockies'],
    [6,'DET','Detroit Tigers'],[18,'HOU','Houston Astros'],[7,'KC','Kansas City Royals'],
    [3,'LAA','Los Angeles Angels'],[19,'LAD','Los Angeles Dodgers'],[28,'MIA','Miami Marlins'],
    [8,'MIL','Milwaukee Brewers'],[9,'MIN','Minnesota Twins'],[21,'NYM','New York Mets'],
    [10,'NYY','New York Yankees'],[11,'ATH','Athletics'],[22,'PHI','Philadelphia Phillies'],
    [23,'PIT','Pittsburgh Pirates'],[25,'SD','San Diego Padres'],[26,'SF','San Francisco Giants'],
    [12,'SEA','Seattle Mariners'],[24,'STL','St. Louis Cardinals'],[30,'TB','Tampa Bay Rays'],
    [13,'TEX','Texas Rangers'],[14,'TOR','Toronto Blue Jays'],[20,'WSH','Washington Nationals']
  ];

  const NHL_FALLBACK = [
    [25,'ANA','Anaheim Ducks'],[24,'UTAH','Utah Mammoth'],[1,'BOS','Boston Bruins'],
    [2,'BUF','Buffalo Sabres'],[3,'CGY','Calgary Flames'],[7,'CAR','Carolina Hurricanes'],
    [4,'CHI','Chicago Blackhawks'],[17,'COL','Colorado Avalanche'],[29,'CBJ','Columbus Blue Jackets'],
    [9,'DAL','Dallas Stars'],[5,'DET','Detroit Red Wings'],[6,'EDM','Edmonton Oilers'],
    [26,'FLA','Florida Panthers'],[8,'LA','Los Angeles Kings'],[30,'MIN','Minnesota Wild'],
    [10,'MTL','Montreal Canadiens'],[27,'NSH','Nashville Predators'],[11,'NJ','New Jersey Devils'],
    [12,'NYI','New York Islanders'],[13,'NYR','New York Rangers'],[14,'OTT','Ottawa Senators'],
    [15,'PHI','Philadelphia Flyers'],[16,'PIT','Pittsburgh Penguins'],[18,'SJ','San Jose Sharks'],
    [124292,'SEA','Seattle Kraken'],[19,'STL','St. Louis Blues'],[20,'TB','Tampa Bay Lightning'],
    [21,'TOR','Toronto Maple Leafs'],[22,'VAN','Vancouver Canucks'],[37,'VGK','Vegas Golden Knights'],
    [23,'WSH','Washington Capitals'],[28,'WPG','Winnipeg Jets']
  ];

  const asTeams = rows =>
    rows.map(([id,abbr,name]) => ({id:String(id), abbreviation:abbr, displayName:name}));

  /* ESPN's /teams list endpoint sends no CORS header for any league, and
     the college lists are far too large to bundle in full. These are the
     ACC plus the usual suspects, which covers the common case; Georgia
     Tech is followed out of the box. */
  const CFB_FALLBACK = [
    [59,'GT','Georgia Tech Yellow Jackets'],[52,'FSU','Florida State Seminoles'],
    [228,'CLEM','Clemson Tigers'],[152,'NCST','NC State Wolfpack'],
    [153,'DUKE','Duke Blue Devils'],[97,'LOU','Louisville Cardinals'],
    [154,'WAKE','Wake Forest Demon Deacons'],[103,'BC','Boston College Eagles'],
    [259,'VT','Virginia Tech Hokies'],[258,'UVA','Virginia Cavaliers'],
    [221,'PITT','Pittsburgh Panthers'],[150,'MIA','Miami Hurricanes'],
    [153,'UNC','North Carolina Tar Heels'],[2567,'SMU','SMU Mustangs'],
    [25,'CAL','California Golden Bears'],[24,'STAN','Stanford Cardinal'],
    [61,'UGA','Georgia Bulldogs'],[333,'ALA','Alabama Crimson Tide'],
    [2,'AUB','Auburn Tigers'],[57,'FLA','Florida Gators'],
    [99,'LSU','LSU Tigers'],[245,'TAMU','Texas A&M Aggies'],
    [251,'TEX','Texas Longhorns'],[201,'OU','Oklahoma Sooners'],
    [194,'OSU','Ohio State Buckeyes'],[130,'MICH','Michigan Wolverines'],
    [213,'PSU','Penn State Nittany Lions'],[275,'WIS','Wisconsin Badgers'],
    [2294,'IOWA','Iowa Hawkeyes'],[135,'ND','Notre Dame Fighting Irish'],
    [38,'COLO','Colorado Buffaloes'],[264,'WASH','Washington Huskies'],
    [30,'USC','USC Trojans'],[26,'UCLA','UCLA Bruins'],
    [12,'ARIZ','Arizona Wildcats'],[9,'ASU','Arizona State Sun Devils'],
    [2633,'TENN','Tennessee Volunteers'],[142,'MIZZ','Missouri Tigers'],
    [8,'ARK','Arkansas Razorbacks'],[344,'MSST','Mississippi State Bulldogs'],
    [145,'MISS','Ole Miss Rebels'],[2579,'SCAR','South Carolina Gamecocks'],
    [96,'UK','Kentucky Wildcats'],[238,'VAN','Vanderbilt Commodores'],
    [2306,'KU','Kansas Jayhawks'],[2305,'KSU','Kansas State Wildcats'],
    [239,'BAY','Baylor Bears'],[2628,'TCU','TCU Horned Frogs'],
    [197,'OKST','Oklahoma State Cowboys'],[2641,'TTU','Texas Tech Red Raiders'],
    [66,'ISU','Iowa State Cyclones'],[2226,'BYU','BYU Cougars'],
    [254,'UTAH','Utah Utes'],[21,'SDSU','San Diego State Aztecs'],
    [68,'NEB','Nebraska Cornhuskers'],[356,'ILL','Illinois Fighting Illini'],
    [2509,'PUR','Purdue Boilermakers'],[84,'IND','Indiana Hoosiers'],
    [127,'MSU','Michigan State Spartans'],[164,'RUTG','Rutgers Scarlet Knights'],
    [120,'MD','Maryland Terrapins'],[77,'NW','Northwestern Wildcats'],
    [135,'MINN','Minnesota Golden Gophers'],[2483,'ORE','Oregon Ducks'],
    [204,'ORST','Oregon State Beavers'],[265,'WSU','Washington State Cougars']
  ];

  const FALLBACK = {
    'nfl': asTeams(NFL_FALLBACK),
    'nba': asTeams(NBA_FALLBACK),
    'mlb': asTeams(MLB_FALLBACK),
    'nhl': asTeams(NHL_FALLBACK),
    'college-football': asTeams(CFB_FALLBACK)
  };

  let games = [];
  let listOK = false;      // true only when the dropdown holds real teams

  /* Always call ESPN directly. Routing this through the fantasy proxy
     looks tempting but makes things strictly worse: ESPN answers 403
     Access Denied to datacenter IPs, so every schedule that works fine
     from the browser starts failing the moment a proxy URL is saved. */
  function espn(path){
    return 'https://site.api.espn.com' + path;
  }

  /* ---- picker ---- */
  async function fillTeams(){
    listOK = false;
    btnSave.disabled = true;
    selTm.innerHTML = '<option value="">Loading…</option>';

    const lg = selLg.value;
    const qs = lg === 'college-football' ? '?groups=80&limit=400'
             : lg === 'mens-college-basketball' ? '?groups=50&limit=400'
             : '?limit=400';

    try{
      const d = await getJSON(espn(`/apis/site/v2/sports/${PATH[lg]}/teams${qs}`));
      const list = (d.sports?.[0]?.leagues?.[0]?.teams || []).map(t => t.team);
      if(!list.length) throw new Error('ESPN returned an empty team list');
      paint(list);
    }catch(e){
      console.error('Team list failed:', e);
      const blocked = /failed to fetch|networkerror|load failed/i.test(e.message);
      if(FALLBACK[lg]){
        paint(FALLBACK[lg]);
        Store.toast(blocked
          ? `Using the built-in ${lg.toUpperCase()} roster — ESPN's team-list endpoint sends no ` +
            'CORS header. Schedules and scores still load normally.'
          : `Using the built-in ${lg.toUpperCase()} list — live list failed: ${e.message}`);
      }else{
        selTm.innerHTML = `<option value="">Unavailable — ${esc(e.message)}</option>`;
        Store.toast(blocked
          ? 'College team lists are unavailable — ESPN blocks this endpoint from ' +
            'browsers and from proxies alike. The other four leagues still work.'
          : `Could not load ${lg.toUpperCase()} teams: ${e.message}`);
      }
    }
  }

  function paint(list){
    list.sort((a,b) => a.displayName.localeCompare(b.displayName));
    selTm.innerHTML = list.map(t =>
      `<option value="${esc(t.id)}" data-abbr="${esc(t.abbreviation||'')}">${esc(t.displayName)}</option>`
    ).join('');
    listOK = true;
    btnSave.disabled = false;
  }

  function openPicker(){ modal.hidden = false; fillTeams(); }
  function closePicker(){ modal.hidden = true; }

  function saveTeam(){
    if(!listOK) return Store.toast('No team list loaded — nothing to follow yet.');
    const opt = selTm.selectedOptions[0];
    if(!opt || !opt.value) return Store.toast('Pick a team first.');

    const teams = Sports.teams();
    if(teams.some(t => t.league === selLg.value && t.id === opt.value)){
      closePicker();
      return Store.toast('Already following that team.');
    }
    teams.push({league:selLg.value, id:opt.value, name:opt.textContent, abbr:opt.dataset.abbr||''});
    Store.set('teams', teams);
    closePicker();
    changed();
  }

  function remove(league, id){
    Store.set('teams', Sports.teams().filter(t => !(t.league===league && t.id===id)));
    changed();
  }

  /* The followed set feeds three views; repaint all of them. */
  function changed(){
    Sports.clearCache();
    load();
    if(window.SportsView)   SportsView.render();
    if(window.CalendarView) CalendarView.loadGames();
  }

  /* ---- schedules ---- */
  async function load(){
    const teams = Sports.teams();
    games = [];
    if(!teams.length){
      tileError(body,'No teams followed yet.');
      Calendar.render();
      return;
    }
    body.innerHTML = '<p class="empty">Loading schedules…</p>';

    let failed = 0, lastErr = '';
    for(const t of teams){
      try{
        const d = await getJSON(espn(`/apis/site/v2/sports/${PATH[t.league]}/teams/${t.id}/schedule`));
        /* The schedule payload carries no team colours, and the game-day
           theme is painted in them, so they are looked up once per team
           and cached — Sports.info is memoised on the URL. */
        const colour = await teamColour(t);
        const evs = (d.events||[]).map(e => normalise(e, t, colour)).filter(Boolean);
        const now = Date.now();
        const next = evs.filter(g => new Date(g.kickoff).getTime() > now - 4*36e5)
                        .sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
        const last = evs.filter(g => g.state === 'post')
                        .sort((a,b) => new Date(b.kickoff) - new Date(a.kickoff))[0];
        if(next) games.push(next);
        if(last && isToday(new Date(last.kickoff))) games.push(last);
      }catch(e){ failed++; lastErr = e.message; console.error('Schedule failed for', t.name, e); }
    }

    if(teams.length && failed === teams.length){
      tileError(body, `Schedules unavailable (${esc(lastErr)}). ` +
        'If that reads &quot;Failed to fetch&quot;, ESPN is refusing the browser request — ' +
        'it sends no CORS header. Set a Proxy URL in Settings and traffic routes through it instead.');
      return;
    }
    render();
    Calendar.render();
    App.recheckTheme();
  }

  /* The followed team's own colour, cached in storage so a reload does not
     spend a request on something that changes once a decade. */
  async function teamColour(t){
    const key = `${t.league}|${t.id}`;
    const saved = Store.get('teams.colors', {});
    if(saved[key] !== undefined) return saved[key];
    try{
      const info = await Sports.info(t);
      saved[key] = info.color || '';
      Store.set('teams.colors', saved);
      return saved[key];
    }catch(e){
      console.error('Team colour lookup failed for', t.name, e.message);
      return '';
    }
  }

  function normalise(e, t, colour){
    const comp = e.competitions?.[0];
    if(!comp) return null;
    const me  = comp.competitors.find(c => String(c.id) === String(t.id));
    const opp = comp.competitors.find(c => String(c.id) !== String(t.id));
    if(!me || !opp) return null;

    const state = comp.status?.type?.state || 'pre';
    let result = null;
    if(state === 'post' && isToday(new Date(e.date)))
      result = me.winner === true ? 'win' : me.winner === false ? 'loss' : null;

    /* Both sides in full, and the event id: the kiosk's sports AD fetches
       the summary for this game, and a tile row that only knows "us and a
       name" cannot ask for it or draw the other team's logo. */
    const hex = v => {
      const x = String(v || '').replace(/^#/,'').trim();
      return /^[0-9a-f]{6}$/i.test(x) ? `#${x}` : '';
    };

    const side = c => ({
      id: c.team?.id,
      name: c.team?.displayName || c.team?.name || 'TBD',
      abbr: c.team?.abbreviation || '',
      logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
      color: hex(c.team?.color),
      altColor: hex(c.team?.alternateColor),
      record: c.records?.find(r => /total|overall/i.test(r.name || r.type || ''))?.summary
           || c.records?.[0]?.summary || '',
      score: c.score?.displayValue ?? c.score ?? '',
      home: c.homeAway === 'home'
    });

    return {
      eventId: e.id,
      league:t.league, name:t.name, abbr:t.abbr,
      opponent: opp.team?.displayName || opp.team?.name || 'TBD',
      home: me.homeAway === 'home',
      kickoff: e.date,
      venue: comp.venue?.fullName || '',
      broadcast: (comp.broadcasts || []).flatMap(b => b.names || [b.media?.shortName]).filter(Boolean),
      state, result,
      score: state !== 'pre'
        ? `${me.score?.displayValue ?? me.score ?? ''}–${opp.score?.displayValue ?? opp.score ?? ''}` : '',
      /* The schedule gives no colours, so the followed team's own is
         patched in from the teams endpoint — the game-day theme reads it. */
      me: {...side(me), color: side(me).color || colour || ''},
      opp: side(opp),
      id: String(t.id)
    };
  }

  const isToday = d => d.toDateString() === new Date().toDateString();

  function render(){
    const teams = Sports.teams();
    body.innerHTML = teams.map(t => {
      /* Match on league too: ESPN numbers each league from 1, so NFL 16
         (Vikings) and NBA 16 (Timberwolves) would otherwise collide. */
      const mine = g => g.league === t.league && g.id === String(t.id);
      const g = games.find(x => mine(x) && x.state !== 'post') || games.find(mine);
      let side = '<span class="row-sub">No games scheduled</span>';
      if(g){
        const when = new Date(g.kickoff);
        if(g.state === 'in')        side = `<span class="chip hot">LIVE ${g.score}</span>`;
        else if(g.state === 'post') side = `<span class="chip ${g.result==='win'?'ok':'hot'}">${g.result==='win'?'W':'L'} ${g.score}</span>`;
        else side = `<span class="row-side">${when.toLocaleDateString(undefined,{month:'short',day:'numeric'})}<br>
                     <span class="row-sub">${when.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</span></span>`;
      }
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${esc(t.name)}</span>
          <span class="row-sub">${g ? `${g.home?'vs':'@'} ${esc(g.opponent)}` : t.league.toUpperCase()}</span>
        </span>
        ${side}
        <button class="x-btn" data-rm="${esc(t.league)}|${esc(t.id)}" aria-label="Stop following ${esc(t.name)}">×</button>
      </div>`;
    }).join('');

    body.querySelectorAll('[data-rm]').forEach(b =>
      b.onclick = () => { const [l,i] = b.dataset.rm.split('|'); remove(l,i); });
  }

  return {
    load, openPicker, closePicker, saveTeam, fillTeams,
    get games(){ return games; }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Teams = Teams;
