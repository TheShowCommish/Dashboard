/* ============================================================
   cloud.js — the deck's data, on more than one device.

   THE PROBLEM IT SOLVES: localStorage is per-browser. A meal plan built
   on the wall display is invisible to the phone standing in the shop,
   which is exactly where the grocery list is needed.

   THE SHAPE: local-first, sync second. Every write still lands in
   localStorage immediately and the screen never waits for the network —
   a supermarket is the last place to assume a good connection. What
   changes is that a written path is also marked dirty, and a background
   flush pushes it to Supabase when there is a network to push it to.
   Come back into signal and the queue drains on its own.

   WHAT NEVER LEAVES THE DEVICE: see Store.SECRET. API keys are not in
   the synced set and cannot be — the allowlist in store.js is an
   allowlist precisely so that a path added later has to be opted in
   rather than opted out. A mistake there should mean "my todos did not
   sync", never "my Finnhub key is in a database".

   AUTH: Supabase magic link, over plain REST rather than the SDK — the
   rest of this codebase is script tags and IIFEs with no build step, and
   a hundred kilobytes of bundle to send one email and refresh one token
   would be the only dependency in the project.

     1. POST /auth/v1/otp             sends the email
     2. the link hits /auth/v1/verify, which bounces back here with the
        session in the URL fragment
     3. we read the fragment, store the tokens, and scrub the URL so the
        session is not sitting in the address bar or the history

   Tokens live in localStorage. That is the same exposure as every other
   SPA that stays signed in between visits, and the alternative — asking
   for an email round trip at the shop door — is the thing this feature
   exists to avoid.

   CONFLICTS: one row per synced path, last write wins. Two devices
   editing DIFFERENT paths never collide, which covers almost everything
   real: the phone ticks menu.bought while the desktop edits menu.plan.
   Two devices editing the SAME path within one poll interval will keep
   the later one. For a single person with a phone and a wall display
   that is an honest trade; anything stronger means CRDTs, and a grocery
   list does not need a CRDT.
   ============================================================ */

const Cloud = (() => {

  /* Config lives outside the synced state — it is how you reach the
     sync, so it cannot itself be synced. */
  const CFG = 'controldeck.sync';

  const cfg = () => {
    try{ return JSON.parse(localStorage.getItem(CFG) || '{}'); }
    catch{ return {}; }
  };
  const writeCfg = patch => {
    const next = {...cfg(), ...patch};
    try{ localStorage.setItem(CFG, JSON.stringify(next)); }catch{}
    return next;
  };

  /* The committed project (js/sync-config.js) is the default; anything
     typed into Settings on this device overrides it. That order is what
     lets a brand new phone open the page and already know where to sign
     in, while still leaving one browser pointable at somewhere else. */
  const baked = () => (window.DECK_SYNC || {});
  const url  = () => String(cfg().url  || baked().url  || '').replace(/\/+$/, '');
  const anon = () => String(cfg().anon || baked().anon || '');
  const configured = () => !!(url() && anon());

  /* ---- status, for the settings panel and the little rail chip ---- */
  let status = {state:'off', detail:'', at:0, pending:0};
  const watchers = new Set();

  function setStatus(state, detail){
    status = {...status, state, detail: detail || '', at: Date.now(), pending: queue().size};
    for(const fn of watchers) { try{ fn(status); }catch(e){ console.error(e); } }
  }

  /* ---- the outgoing queue ----
     Only path NAMES are queued, never values. A path dirtied five times
     between flushes is one row to push, carrying whatever it holds when
     the flush actually happens — which is also what makes the queue
     self-healing after a crash. */
  const QKEY = 'controldeck.sync.queue';
  const queue = () => {
    try{ return new Set(JSON.parse(localStorage.getItem(QKEY) || '[]')); }
    catch{ return new Set(); }
  };
  const writeQueue = set => {
    try{ localStorage.setItem(QKEY, JSON.stringify([...set])); }catch{}
  };

  function markDirty(path){
    if(!configured()) return;
    const q = queue(); q.add(path); writeQueue(q);
    status.pending = q.size;
    schedule();
  }

  /* ---- session ---- */
  const session = () => cfg().session || null;
  const signedIn = () => !!(session() && session().refresh_token);

  function saveSession(s){
    if(!s) return writeCfg({session: null});
    writeCfg({session: {
      access_token:  s.access_token,
      refresh_token: s.refresh_token,
      /* A minute of slack: a token that expires while the request is in
         flight is a 401 the user did not need to see. */
      expires_at: Date.now() + Math.max(0, (Number(s.expires_in) || 3600) - 60) * 1000,
      user: s.user ? {id: s.user.id, email: s.user.email} : (session() || {}).user || null
    }});
  }

  async function api(path, opts = {}){
    const res = await fetch(url() + path, {
      ...opts,
      headers: {
        apikey: anon(),
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    return res;
  }

  /* A valid access token, refreshing if the one we have has aged out.
     Returns null when there is no way to get one, which the callers
     treat as "signed out" rather than as an error to retry. */
  let refreshing = null;
  async function token(){
    const s = session();
    if(!s || !s.refresh_token) return null;
    if(s.access_token && Date.now() < (s.expires_at || 0)) return s.access_token;

    /* One refresh at a time. Supabase rotates refresh tokens, so two
       concurrent refreshes race and the loser's token is already spent —
       which logs you out for no reason. */
    if(refreshing) return refreshing;
    refreshing = (async () => {
      try{
        const res = await api('/auth/v1/token?grant_type=refresh_token', {
          method:'POST',
          body: JSON.stringify({refresh_token: s.refresh_token})
        });
        if(!res.ok){
          /* A refused refresh token is not a network problem — it is
             gone. Anything else might just be a bad minute. */
          if(res.status >= 400 && res.status < 500){
            saveSession(null);
            setStatus('signed-out', 'The sign-in expired. Send yourself a new link.');
          }
          return null;
        }
        const next = await res.json();
        saveSession(next);
        return next.access_token;
      }catch{
        return null;                     // offline: keep the session, try later
      }finally{
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /* ---- signing in ---- */
  async function signIn(email){
    if(!configured()) throw new Error('Set the Supabase URL and anon key first.');
    const addr = String(email || '').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new Error('That does not look like an email address.');

    /* Come back to the page you left from, so signing in from the phone
       list does not dump you on the wall dashboard. */
    const back = location.origin + location.pathname;
    const res = await api(`/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, {
      method:'POST',
      body: JSON.stringify({email: addr, create_user: true})
    });
    if(!res.ok){
      let why = `${res.status}`;
      try{ const j = await res.json(); why = j.error_description || j.msg || j.message || why; }catch{}
      throw new Error(why);
    }
    writeCfg({lastEmail: addr});
    setStatus('sent', `Check ${addr} for the link.`);
    return true;
  }

  async function signOut(){
    const t = await token();
    if(t){ try{ await api('/auth/v1/logout', {method:'POST', headers:{Authorization:`Bearer ${t}`}}); }catch{} }
    saveSession(null);
    writeQueue(new Set());
    writeCfg({since: null});
    setStatus('signed-out', '');
  }

  /* The emailed link lands back here with the session in the fragment.
     Read it, keep it, and take it straight back out of the URL: a
     history entry or a shared screenshot should not carry a live token. */
  function catchCallback(){
    const h = location.hash || '';
    if(!h.includes('access_token=') && !h.includes('error=')) return false;
    const p = new URLSearchParams(h.replace(/^#/, ''));

    const clean = () => history.replaceState(null, '', location.pathname + location.search);

    if(p.get('error')){
      clean();
      setStatus('signed-out', (p.get('error_description') || p.get('error')).replace(/\+/g, ' '));
      return true;
    }
    saveSession({
      access_token:  p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_in:    p.get('expires_in')
    });
    clean();
    return true;
  }

  /* Who is signed in. Cheap enough to confirm once at boot, and it is
     also the first real proof the URL and key are right. */
  async function whoAmI(){
    const t = await token();
    if(!t) return null;
    try{
      const res = await api('/auth/v1/user', {headers:{Authorization:`Bearer ${t}`}});
      if(!res.ok) return null;
      const u = await res.json();
      const cur = session();
      if(cur) writeCfg({session: {...cur, user: {id:u.id, email:u.email}}});
      return u;
    }catch{ return null; }
  }

  /* ---- pulling ----
     Only rows that changed since the last successful pull. The watermark
     is the newest updated_at we have actually seen, not the clock on
     this device — a phone with a wrong clock would otherwise silently
     skip everything. */
  async function pull(){
    const t = await token();
    /* No usable token is not "nothing to do" — reporting it as success
       is how a screen ends up quietly a week stale while claiming to be
       in sync. Say so and let the caller show it. */
    if(!t) return {applied:0, noAuth:true};

    const since = cfg().since;
    const q = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
    const res = await api(`/rest/v1/deck_state?select=path,value,updated_at${q}`, {
      headers:{Authorization:`Bearer ${t}`}
    });
    if(!res.ok) throw new Error(await describe(res));

    const rows = await res.json();
    if(!Array.isArray(rows)) return {applied:0};

    /* A path with an unflushed local edit is not overwritten: you are
       looking at your own change and having it blink back to the old
       value mid-shop is the worst thing this could do. It will win the
       next flush anyway. */
    const dirty = queue();
    const usable = rows.filter(r => !dirty.has(r.path));

    const applied = Store.applyRemote(usable);
    let newest = since || '';
    for(const r of rows) if(r.updated_at > newest) newest = r.updated_at;
    if(newest) writeCfg({since: newest});
    return {applied, seen: rows.length};
  }

  async function describe(res){
    let detail = '';
    try{
      const j = await res.json();
      detail = j.message || j.error_description || j.msg || j.hint || '';
    }catch{}
    return `${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`;
  }

  /* ---- pushing ---- */
  async function flush(){
    const q = queue();
    if(!q.size) return {pushed:0};
    const t = await token();
    if(!t) return {pushed:0, noAuth:true};

    const body = [...q].map(path => ({path, value: Store.get(path, null)}));

    /* Upsert. The conflict target is named explicitly rather than left
       to PostgREST's default of "the primary key": the key here is the
       composite (user_id, path) and the client deliberately does not
       send user_id — the column default (auth.uid()) fills it, which is
       what stops a browser writing a row onto somebody else's account.
       Being explicit means the upsert does not depend on how PostgREST
       infers a target for a key it was only sent half of. */
    const res = await api('/rest/v1/deck_state?on_conflict=user_id,path', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${t}`,
        Prefer:'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(body)
    });
    if(!res.ok) throw new Error(await describe(res));

    /* Clear exactly what was sent. Anything dirtied while the request
       was in flight stays queued for the next pass rather than being
       dropped on the floor. */
    const after = queue();
    for(const p of q) after.delete(p);
    writeQueue(after);

    try{
      const saved = await res.json();
      let newest = cfg().since || '';
      for(const r of (saved || [])) if(r.updated_at > newest) newest = r.updated_at;
      if(newest) writeCfg({since: newest});
    }catch{}

    return {pushed: body.length};
  }

  /* ---- the loop ----
     One timer, rescheduled at the end of each pass, so a slow network
     cannot stack passes on top of each other. Only while the page is
     visible: a phone in a pocket has nothing to show and no reason to
     spend the battery. */
  let timer = null, running = false;
  const IDLE_MS = 20000;
  const SOON_MS = 900;

  function schedule(ms){
    clearTimeout(timer);
    if(!configured() || !signedIn()) return;
    if(ms === null) return;                     // park until something wakes us
    timer = setTimeout(() => cycle(false), ms === undefined ? SOON_MS : ms);
  }

  async function cycle(force){
    if(running) return;
    running = true;

    /* Hidden pages do not POLL — a phone in a pocket has nothing to show
       and no reason to spend the battery on it.

       They do still PUSH. Ticking the last item off the list and putting
       the phone straight in your pocket is the single most likely way
       this feature gets used, and holding those ticks hostage until the
       screen comes back on would lose them for the whole walk home. So
       an outstanding queue flushes whatever the page is doing; only the
       pull waits to be looked at. */
    /* `force` is the first pass after boot or after a sign-in. You have
       just clicked a link and are waiting to see your data; deferring
       that until the page reports itself visible means a deck that sat
       there empty on a screen you were looking at, because a browser
       pane or a background restore can call itself hidden while very
       much on show. */
    const visible = force || document.visibilityState !== 'hidden';

    try{
      setStatus('syncing');
      const out = await flush();
      const inn = visible ? await pull() : {applied:0};
      if(out.noAuth || inn.noAuth){
        setStatus(signedIn() ? 'offline' : 'signed-out',
                  signedIn() ? '' : 'The sign-in expired. Send yourself a new link.');
      }else{
        setStatus('ok', out.pushed || inn.applied
          ? `${out.pushed ? `sent ${out.pushed}` : ''}${out.pushed && inn.applied ? ', ' : ''}${inn.applied ? `got ${inn.applied}` : ''}`
          : '');
      }
    }catch(e){
      /* Offline is the expected case, not a failure worth shouting
         about. Anything else keeps its message so the settings panel can
         show what the server actually said. */
      const offline = !navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(e.message || '');
      setStatus(offline ? 'offline' : 'error', offline ? '' : e.message);
    }finally{
      running = false;
      /* Nothing to say and nobody looking: wait for a visibilitychange
         or a fresh write rather than waking up every twenty seconds. */
      schedule(visible || queue().size ? IDLE_MS : null);
    }
  }

  /* ---- wiring ---- */
  async function boot(){
    catchCallback();
    if(!configured()){ setStatus('off', ''); return; }
    if(!signedIn()){ setStatus('signed-out', ''); return; }

    setStatus('syncing');
    /* Confirms the URL and key are right, and puts an email on screen so
       "signed in" is something you can actually verify rather than take
       on trust. */
    await whoAmI();
    /* A first pull with no watermark takes the lot, which is what a
       newly signed-in phone needs — so it is forced. */
    await cycle(true);

    addEventListener('online',  () => schedule(SOON_MS));
    addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible') schedule(SOON_MS);
    });
    addEventListener('focus', () => schedule(SOON_MS));
  }

  /* Everything local, pushed up as a first upload. Used once, when a
     device that already has a deck's worth of data signs in for the
     first time and the table is empty. */
  function pushEverything(){
    const q = queue();
    for(const p of Store.SYNCED){
      /* Only what this device actually HAS. Queueing every path would
         push a null for each empty one, and "upload this device" pressed
         on a freshly signed-in phone would then null out the plan on the
         wall display — a button meant to rescue data destroying it
         instead. An empty path here means "nothing to say", not
         "delete what is up there". */
      const v = Store.get(p, undefined);
      if(v === undefined || v === null) continue;
      if(Array.isArray(v) && !v.length) continue;
      if(typeof v === 'object' && !Object.keys(v).length) continue;
      if(v === '') continue;
      q.add(p);
    }
    writeQueue(q);
    schedule(SOON_MS);
    return q.size;
  }

  return {
    boot, signIn, signOut, markDirty, pushEverything,
    sync: () => cycle(true),
    onStatus(fn){ watchers.add(fn); fn(status); return () => watchers.delete(fn); },
    get status(){ return {...status, pending: queue().size}; },
    get configured(){ return configured(); },
    get signedIn(){ return signedIn(); },
    get user(){ return (session() || {}).user || null; },
    get settings(){ return {url: url(), anon: anon(), lastEmail: cfg().lastEmail || ''}; },
    configure(next){
      writeCfg({url: String(next.url || '').replace(/\/+$/, ''), anon: String(next.anon || '')});
      setStatus(configured() ? (signedIn() ? 'ok' : 'signed-out') : 'off', '');
    },
    whoAmI
  };
})();

window.Cloud = Cloud;
