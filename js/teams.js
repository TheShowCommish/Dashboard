/* ============================================================
   teams.js — followed teams from ESPN's public site API.
   Feeds two things: the calendar tile, and the theme engine
   (game day / win / loss triggers).
   ============================================================ */

const Teams = (() => {
  const body   = document.getElementById('teamsBody');
  const modal  = document.getElementById('teamModal');
  const selLg  = document.getElementById('tmLeague');
  const selTm  = document.getElementById('tmTeam');

  const PATH = {
    'nfl':'football/nfl',
    'nba':'basketball/nba',
    'mlb':'baseball/mlb',
    'nhl':'hockey/nhl',
    'college-football':'football/college-football',
    'mens-college-basketball':'basketball/mens-college-basketball'
  };

  let games = [];   // normalised, next + most recent per team

  /* ---- picker ---- */
  async function fillTeams(){
    selTm.innerHTML = '<option>Loading…</option>';
    try{
      const d = await getJSON(
        `https://site.api.espn.com/apis/site/v2/sports/${PATH[selLg.value]}/teams?limit=400`);
      const list = d.sports[0].leagues[0].teams.map(t => t.team)
        .sort((a,b) => a.displayName.localeCompare(b.displayName));
      selTm.innerHTML = list.map(t =>
        `<option value="${t.id}" data-abbr="${esc(t.abbreviation||'')}">${esc(t.displayName)}</option>`).join('');
    }catch(e){
      selTm.innerHTML = '<option>Could not load teams</option>';
    }
  }

  function openPicker(){ modal.hidden = false; fillTeams(); }
  function closePicker(){ modal.hidden = true; }

  function saveTeam(){
    const opt = selTm.selectedOptions[0];
    if(!opt || !opt.value) return closePicker();
    const teams = Store.get('teams',[]);
    if(teams.some(t => t.league === selLg.value && t.id === opt.value)){
      closePicker(); return Store.toast('Already following that team.');
    }
    teams.push({league:selLg.value, id:opt.value, name:opt.textContent, abbr:opt.dataset.abbr});
    Store.set('teams', teams);
    closePicker(); load();
  }

  function remove(league, id){
    Store.set('teams', Store.get('teams',[]).filter(t => !(t.league===league && t.id===id)));
    load();
  }

  /* ---- schedules ---- */
  async function load(){
    const teams = Store.get('teams',[]);
    games = [];
    if(!teams.length){
      tileError(body,'No teams followed yet.');
      Calendar.render();
      return;
    }
    body.innerHTML = '<p class="empty">Loading schedules…</p>';

    for(const t of teams){
      try{
        const d = await getJSON(
          `https://site.api.espn.com/apis/site/v2/sports/${PATH[t.league]}/teams/${t.id}/schedule`);
        const evs = (d.events||[]).map(e => normalise(e, t)).filter(Boolean);

        const now = Date.now();
        const next = evs.filter(g => new Date(g.kickoff).getTime() > now - 4*36e5)
                        .sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
        const last = evs.filter(g => g.state === 'post')
                        .sort((a,b) => new Date(b.kickoff) - new Date(a.kickoff))[0];
        if(next) games.push(next);
        if(last && isToday(new Date(last.kickoff))) games.push(last);
      }catch(e){ /* one bad team should not sink the tile */ }
    }
    render();
    Calendar.render();
    App.recheckTheme();
  }

  function normalise(e, t){
    const comp = e.competitions?.[0];
    if(!comp) return null;
    const me  = comp.competitors.find(c => c.id === t.id);
    const opp = comp.competitors.find(c => c.id !== t.id);
    if(!me || !opp) return null;

    const state = comp.status?.type?.state || 'pre';   // pre | in | post
    let result = null;
    if(state === 'post' && isToday(new Date(e.date)))
      result = me.winner === true ? 'win' : me.winner === false ? 'loss' : null;

    return {
      league:t.league, name:t.name, abbr:t.abbr,
      opponent: opp.team?.displayName || opp.team?.name || 'TBD',
      home: me.homeAway === 'home',
      kickoff: e.date,
      venue: comp.venue?.fullName || '',
      state, result,
      score: state !== 'pre' ? `${me.score?.displayValue ?? me.score ?? ''}–${opp.score?.displayValue ?? opp.score ?? ''}` : '',
      id:t.id
    };
  }

  const isToday = d => d.toDateString() === new Date().toDateString();

  function render(){
    const teams = Store.get('teams',[]);
    body.innerHTML = teams.map(t => {
      const g = games.find(x => x.id === t.id && x.state !== 'post')
             || games.find(x => x.id === t.id);
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
        <button class="x-btn" data-rm="${t.league}|${t.id}" aria-label="Stop following ${esc(t.name)}">×</button>
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
