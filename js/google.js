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


/* ---------------- Calendar ----------------
   A feed, not a view. CalendarView draws the grid; this only fetches. */
const Calendar = (() => {
  let events = [];

  async function load(){
    if(!Google.ready) return;
    const now = new Date();
    const end = new Date(Date.now() + 21*864e5);
    try{
      const data = await Google.api(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
        `?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}` +
        '&singleEvents=true&orderBy=startTime&maxResults=100');

      events = (data.items||[]).map(e => ({
        title: e.summary || '(no title)',
        start: new Date(e.start.dateTime || e.start.date + 'T09:00:00'),
        allDay: !e.start.dateTime,
        where: e.location || '',
        source:'google'
      }));
    }catch(e){
      console.error('Calendar failed to load:', e);
      Store.toast(`Calendar failed to load (${e.message}).`);
      return;
    }
    render();
  }

  function render(){ if(window.CalendarView) CalendarView.render(); }

  return { load, render, get events(){ return events; } };
})();


/* ---------------- Gmail ---------------- */
const Mail = (() => {
  let unread = [];        // [{subject, from, important, bucket}]

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
      if(!ids.length){ unread = []; push(); return; }

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

      unread = parsed.map(m => ({...m, bucket: BUCKETS.find(b => b.test(m)).key}));
      push();
    }catch(e){
      console.error('Mail failed to load:', e);
      Store.toast(`Mail failed to load (${e.message}).`);
    }
  }

  function push(){ if(window.Ticker) Ticker.render(); }

  return {
    load,
    get unread(){ return unread; },
    get count(){ return unread.length; }
  };
})();

function esc(s){
  return String(s??'').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Google = Google;
window.Calendar = Calendar;
window.Mail = Mail;
