/* ============================================================
   google.js — Gmail + Calendar via Google Identity Services.
   Read-only scopes. The token lives in memory only, never on disk.

   Token lifetime is the whole problem here. GIS hands out an access
   token that dies after roughly an hour and there is no refresh token
   in the implicit browser flow, so "staying connected" means silently
   asking for a new token before the old one expires. Three mechanisms
   cover that, in order of preference:

     1. A timer that re-requests a token shortly before it expires.
     2. A retry on the first 401/403, in case the timer was missed —
        a sleeping laptop suspends timers, so this catches the wake-up.
     3. A remembered "was connected" flag so a page reload re-arms the
        token silently instead of waiting for a click.

   Only the flag is persisted. The token itself never touches disk.
   ============================================================ */

const Google = (() => {
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly'
  ].join(' ');

  let token = null, client = null, ready = false;
  let expiresAt = 0;            // ms epoch when the current token dies
  let renewTimer = null;
  let waiting = null;           // in-flight token request, so callers can await one

  /* Ask for a new token this many ms before the old one expires. Google
     issues ~3600s tokens; five minutes of headroom is plenty and keeps
     the renewal well clear of the cliff. */
  const EARLY = 5 * 60 * 1000;

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

  function label(text){
    const b = document.getElementById('btnGoogle');
    if(b) b.textContent = text;
  }

  /* One token client for the life of the page. Its callback resolves
     whatever request is currently in flight, so both the interactive
     click and the silent renewal share the same plumbing. */
  async function ensureClient(){
    const id = Store.get('keys.gclient','');
    if(!id) throw new Error('no client id');
    await loadScript();

    if(!client){
      client = google.accounts.oauth2.initTokenClient({
        client_id: id, scope: SCOPES,
        callback: r => {
          if(r.access_token){
            token = r.access_token;
            /* expires_in is seconds; treat a missing value as one hour. */
            const secs = Number(r.expires_in) || 3600;
            expiresAt = Date.now() + secs * 1000;
            const first = !ready;
            ready = true;
            Store.set('google.connected', true);
            armRenew();
            label('Refresh Google');
            settle(true);
            if(first) onAuth();
          }else{
            settle(false);
          }
        },
        error_callback: err => {
          /* Fires when a silent request cannot be fulfilled without UI —
             consent revoked, third-party cookies blocked, popup closed. */
          console.warn('Google token request failed:', err?.type || err);
          settle(false);
        }
      });
    }
    return client;
  }

  function settle(result){
    const w = waiting;
    waiting = null;
    if(w) w.ok(result);
  }

  /* silent=true never shows UI. It succeeds only if the user has already
     granted consent in a live session; otherwise error_callback fires and
     we fall back to asking properly. */
  function request(silent){
    if(waiting) return waiting.promise;

    let ok;
    const promise = new Promise(res => { ok = res; });
    waiting = {promise, ok};

    ensureClient()
      .then(c => c.requestAccessToken(silent ? {prompt:'none'} : {prompt: token ? '' : 'consent'}))
      .catch(e => {
        console.warn('Google client unavailable:', e.message);
        settle(false);
      });

    /* A silent request that never calls back at all (some cookie-blocking
       setups drop it on the floor) must not wedge every later attempt. */
    setTimeout(() => { if(waiting && waiting.promise === promise) settle(false); }, 20000);

    return promise;
  }

  function armRenew(){
    clearTimeout(renewTimer);
    const wait = Math.max(30000, expiresAt - Date.now() - EARLY);
    renewTimer = setTimeout(() => { renew(); }, wait);
  }

  /* Silent renewal. If it fails the token is left alone — an expired token
     still triggers the 401 retry path, which gets one more chance at UI. */
  async function renew(){
    const got = await request(true);
    if(!got){
      console.warn('Silent Google renewal failed; will retry on next API call.');
      /* Try again in a few minutes rather than giving up until a reload. */
      clearTimeout(renewTimer);
      renewTimer = setTimeout(() => { renew(); }, 5 * 60 * 1000);
    }
  }

  const expired = () => !token || Date.now() >= expiresAt;

  async function connect(){
    const id = Store.get('keys.gclient','');
    if(!id){ Store.toast('Add your Google OAuth Client ID in Settings first.'); return false; }
    return request(false);
  }

  /* A remembered connection re-arms itself on boot without a click. Silent
     first; no toast if it fails, because an unattended dashboard failing to
     reconnect is not something to shout about — the button still works. */
  async function resume(){
    if(!Store.get('google.connected', false)) return false;
    if(!Store.get('keys.gclient','')) return false;
    label('Reconnecting…');
    const got = await request(true);
    label(got ? 'Refresh Google' : 'Connect Google');
    return got;
  }

  /* Every Google call goes through here, so every Google call gets the
     expiry check and the one-shot retry. */
  async function api(url){
    if(expired()) await request(true);
    if(!token) throw new Error('not connected to Google');

    try{
      return await getJSON(url, {headers:{Authorization:`Bearer ${token}`}});
    }catch(e){
      if(!/\b401\b|\b403\b|invalid credentials|invalid authentication/i.test(e.message)) throw e;

      /* Token was rejected. Ask for a fresh one and replay the call once. */
      const got = await request(true);
      if(!got){
        ready = false;
        label('Connect Google');
        throw new Error('Google sign-in expired — click Connect Google');
      }
      return getJSON(url, {headers:{Authorization:`Bearer ${token}`}});
    }
  }

  async function onAuth(){
    label('Refresh Google');
    await Promise.all([Calendar.load(), Mail.load()]);
    App.recheckTheme();
  }

  function disconnect(){
    clearTimeout(renewTimer);
    token = null; ready = false; expiresAt = 0;
    Store.set('google.connected', false);
    label('Connect Google');
  }

  return { connect, resume, disconnect, api, get ready(){ return ready; } };
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
