/* ============================================================
   google.js — Gmail + Calendar via Google Identity Services.
   Read-only scopes. The token lives in memory only, never on disk.
   ============================================================ */

const Google = (() => {
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly'
  ].join(' ');

  let token = null, client = null, ready = false;

  function loadScript(){
    return new Promise((ok, fail) => {
      if(window.google?.accounts?.oauth2) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = ok;
      s.onerror = () => fail(new Error('Google script blocked'));
      document.head.appendChild(s);
    });
  }

  async function connect(){
    const id = Store.get('keys.gclient','');
    if(!id){ Store.toast('Add your Google OAuth Client ID in Settings first.'); return false; }
    await loadScript();

    if(!client){
      client = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: SCOPES,
        callback: r => {
          if(r.access_token){ token = r.access_token; ready = true; onAuth(); }
        }
      });
    }
    client.requestAccessToken({prompt: token ? '' : 'consent'});
    return true;
  }

  function api(url){
    return getJSON(url, {headers:{Authorization:`Bearer ${token}`}});
  }

  async function onAuth(){
    document.getElementById('btnGoogle').textContent = 'Refresh Google';
    await Promise.all([Calendar.load(), Mail.load()]);
    App.recheckTheme();
  }

  return { connect, api, get ready(){ return ready; } };
})();


/* ---------------- Calendar ---------------- */
const Calendar = (() => {
  const body = document.getElementById('calBody');
  let events = [];   // google events, normalised

  async function load(){
    if(!Google.ready) return;
    const now = new Date();
    const end = new Date(Date.now() + 7*864e5);
    try{
      const data = await Google.api(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
        `?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}` +
        '&singleEvents=true&orderBy=startTime&maxResults=25');

      events = (data.items||[]).map(e => ({
        title: e.summary || '(no title)',
        start: new Date(e.start.dateTime || e.start.date + 'T09:00:00'),
        allDay: !e.start.dateTime,
        where: e.location || '',
        source:'google'
      }));
    }catch(e){
      return tileError(body, `Calendar failed to load (${e.message}).`);
    }
    render();
  }

  /* Merged view: Google events + followed-team games, weather attached. */
  function render(){
    const games = (window.Teams ? Teams.games : []).map(g => ({
      title:`${g.name} ${g.home ? 'vs' : '@'} ${g.opponent}`,
      start:new Date(g.kickoff), allDay:false, where:g.venue||'', source:'sport'
    }));

    const all = [...events, ...games]
      .filter(e => e.start >= new Date(Date.now() - 36e5))
      .sort((a,b) => a.start - b.start).slice(0,14);

    if(!all.length) return tileError(body, Google.ready
      ? 'Nothing on the calendar for the next seven days.'
      : 'Connect Google to pull events. Favorite-team games show up here too.');

    let day = '';
    body.innerHTML = all.map(e => {
      const label = e.start.toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
      const head  = label !== day ? (day = label, `<div class="group-label">${label}</div>`) : '';
      const wx    = Weather.forecastFor(e.start);
      const tag   = wx ? `<span class="wx-tag">${Weather.glyph(wx.main)} ${wx.temp}°${wx.pop>25?` · ${wx.pop}% rain`:''}</span>` : '';
      const time  = e.allDay ? 'All day'
                  : e.start.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
      return `${head}
        <div class="row">
          <span class="row-main">
            <span class="row-title">${esc(e.title)}</span>
            <span class="row-sub">${e.source==='sport'?'🏟️ ':''}${esc(e.where) || (e.source==='sport'?'Game':'')} ${tag}</span>
          </span>
          <span class="row-side">${time}</span>
        </div>`;
    }).join('');
  }

  return { load, render, get events(){ return events; } };
})();


/* ---------------- Gmail ---------------- */
const Mail = (() => {
  const body  = document.getElementById('mailBody');
  const count = document.getElementById('mailCount');

  /* Buckets, checked in order. First match wins. */
  const BUCKETS = [
    { key:'Needs you',  test:m => m.important || /urgent|asap|action required|overdue|past due|final notice|deadline/i.test(m.subject) },
    { key:'People',     test:m => !m.categories.length || m.categories.includes('CATEGORY_PERSONAL') },
    { key:'Updates',    test:m => m.categories.includes('CATEGORY_UPDATES') || m.categories.includes('CATEGORY_FORUMS') },
    { key:'Promotions', test:m => m.categories.includes('CATEGORY_PROMOTIONS') || m.categories.includes('CATEGORY_SOCIAL') },
    { key:'Everything else', test:() => true }
  ];

  async function load(){
    if(!Google.ready) return;
    try{
      const list = await Google.api(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=25');
      const ids = (list.messages||[]).map(m => m.id);
      count.textContent = `${ids.length}${ids.length===25?'+':''} unread`;

      if(!ids.length) return tileError(body,'Inbox is clear.');

      const msgs = await Promise.all(ids.map(id => Google.api(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
        '?format=metadata&metadataHeaders=Subject&metadataHeaders=From')));

      const parsed = msgs.map(m => {
        const h = Object.fromEntries((m.payload.headers||[]).map(x => [x.name, x.value]));
        return {
          subject: h.Subject || '(no subject)',
          from: (h.From||'').replace(/<.*>/,'').replace(/"/g,'').trim() || h.From,
          important: (m.labelIds||[]).includes('IMPORTANT'),
          categories: (m.labelIds||[]).filter(l => l.startsWith('CATEGORY_'))
        };
      });

      const groups = new Map(BUCKETS.map(b => [b.key, []]));
      for(const m of parsed) groups.get(BUCKETS.find(b => b.test(m)).key).push(m);

      body.innerHTML = [...groups].filter(([,v]) => v.length).map(([k,v]) => `
        <div class="group-label">${k} · ${v.length}</div>
        ${v.slice(0,6).map(m => `
          <div class="row">
            <span class="row-main">
              <span class="row-title">${esc(m.subject)}</span>
              <span class="row-sub">${esc(m.from)}</span>
            </span>
            ${m.important ? '<span class="chip hot">!</span>' : ''}
          </div>`).join('')}
      `).join('');
    }catch(e){
      tileError(body, `Mail failed to load (${e.message}).`);
    }
  }

  return { load };
})();

function esc(s){
  return String(s??'').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
