/* ============================================================
   store.js — everything that must survive a page reload.

   localStorage is still the source of truth on each device: every read
   is synchronous, every write lands immediately, and the deck works with
   no network and no account exactly as it always did. What is new is
   that SOME of it is also pushed to Supabase, so the phone in the shop
   and the display on the wall are looking at the same meal plan.

   Three tiers, and the split is the whole point:

     SECRET   API keys. Never synced, never queued, not in SYNCED below.
              The list is an ALLOWLIST rather than a blocklist so that a
              path added next year has to be deliberately opted in. A
              mistake should read "my todos did not sync", never "my
              Finnhub key is in a database".

     DEVICE   Things that are true of this screen rather than of you:
              which tab is open, whether kiosk is running, whether snow
              is switched on, and every cache that can be refetched.
              Syncing these would have the phone yank the wall display's
              tab and push megabytes of poster art around for nothing.

     SYNCED   The data you would be upset to lose: the plan, the kitchen,
              the shopping, notes, todos, holdings, followed teams, the
              draft board.

   Sync itself lives in cloud.js. This file only decides what is
   eligible and tells it when something changed.
   ============================================================ */

const Store = (() => {
  const KEY = 'controldeck.v1';

  const DEFAULTS = {
    keys:    { owm:'', finnhub:'', tmdb:'', gclient:'' },
    zip:     '',
    theme:   { mode:'auto', pick:'nightops' },
    fantasy: { league:'', season:String(new Date().getFullYear()), team:'', proxy:'' },
    holdings:[],            // [{symbol, shares, cost}]
    teams:   [],            // [{league, id, name, abbr}]
    todos:   [],            // [{id, text, done}]
    notes:   []             // [{id, text, color, tilt}]
  };

  /* ---------- what travels ----------
     One row per entry. The granularity matters: two devices editing
     different paths never collide, so the phone ticking menu.bought
     while the desktop edits menu.plan is not a conflict at all. Keeping
     menu.plan and menu.pantry apart rather than syncing "menu" whole is
     what buys that. */
  const SYNCED = [
    'zip',
    'holdings',
    'teams',
    'todos',
    'notes',

    /* the Menu tab: the plan, the kitchen, and the shopping */
    'menu.plan',
    'menu.pantry',
    'menu.bought',
    'menu.custom',
    'menu.people',
    'menu.servings',
    'menu.start',
    'menu.proxy',

    /* the draft board */
    'draft.names', 'draft.picks', 'draft.rounds',
    'draft.slot',  'draft.targets', 'draft.teams',

    /* which league, not how to reach it */
    'fantasy.league', 'fantasy.season', 'fantasy.team',

    /* who you are on Letterboxd, and the library it produced — slow to
       rebuild and identical on every device, so worth carrying */
    'movies.lbUser', 'movies.watchlist', 'movies.diary', 'movies.following',

    /* a palette is a preference, not a property of a screen */
    'theme.mode', 'theme.pick'
  ];

  const SYNCED_SET = new Set(SYNCED);

  /* Named only so the reasoning is somewhere other than a commit
     message. Nothing reads this; the allowlist above is what decides. */
  const SECRET = ['keys.*', 'fantasy.proxy', 'movies.lbProxy'];

  /* The longest synced path that owns this one, so setting
     'menu.plan' and setting 'menu.plan.2026-08-26' both dirty the row
     'menu.plan'. Anything with no owner is local and silently stays so. */
  function ownerOf(path){
    if(SYNCED_SET.has(path)) return path;
    for(const p of SYNCED) if(path.startsWith(p + '.')) return p;
    return null;
  }

  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return structuredClone(DEFAULTS);
      const saved = JSON.parse(raw);
      // shallow merge so new fields in future versions don't break old saves
      return {
        ...structuredClone(DEFAULTS), ...saved,
        keys:   {...DEFAULTS.keys,    ...(saved.keys||{})},
        theme:  {...DEFAULTS.theme,   ...(saved.theme||{})},
        fantasy:{...DEFAULTS.fantasy, ...(saved.fantasy||{})}
      };
    }catch(e){
      console.warn('Saved data was unreadable, starting fresh.', e);
      return structuredClone(DEFAULTS);
    }
  }

  let state = load();

  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }
    catch(e){ toast('Could not save — browser storage is full or blocked.'); }
  }

  function toast(msg){
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function put(path, value){
    const parts = path.split('.');
    const last  = parts.pop();
    let node = state;
    for(const p of parts){ node[p] = node[p] ?? {}; node = node[p]; }
    node[last] = value;
  }

  /* ---------- telling the screen something moved underneath it ----------
     A pull can land while you are looking at the very screen it changes.
     Views subscribe and redraw; nothing polls. */
  const listeners = new Set();
  function announce(paths){
    if(!paths.length) return;
    for(const fn of listeners){
      try{ fn(paths); }catch(e){ console.error('Store listener failed:', e); }
    }
  }

  return {
    SYNCED, SECRET,
    get state(){ return state; },

    get(path, fallback){
      return path.split('.').reduce((o,k) => (o==null?undefined:o[k]), state) ?? fallback;
    },

    set(path, value){
      put(path, value);
      save();
      /* Local first, always. The queue is a note to push later, not a
         thing this write waits on — which is why the deck stays usable
         with no signal at all. */
      const owner = ownerOf(path);
      if(owner && window.Cloud) Cloud.markDirty(owner);
    },

    /* Rows arriving from another device. Applied straight to state and
       saved, then announced so whatever is on screen can redraw. Returns
       how many actually changed anything, so the status line can say
       "got 3" rather than claiming work it did not do. */
    applyRemote(rows){
      const changed = [];
      for(const r of (rows || [])){
        if(!r || !r.path) continue;
        /* The allowlist guards the way in as well as the way out. A row
           for 'keys.finnhub' — however it got into the table — is not
           something an incoming sync gets to write. */
        if(!SYNCED_SET.has(r.path)) continue;
        const now = this.get(r.path, undefined);
        if(JSON.stringify(now) === JSON.stringify(r.value)) continue;
        put(r.path, r.value);
        changed.push(r.path);
      }
      if(changed.length){ save(); announce(changed); }
      return changed.length;
    },

    onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },

    save,
    toast,

    export(){
      const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'control-deck-backup.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    wipe(){
      localStorage.removeItem(KEY);
      state = structuredClone(DEFAULTS);
    },

    uid(){ return Math.random().toString(36).slice(2,10); }
  };
})();

/* Small shared helper every module uses for network calls.

   On failure it digs the provider's own message out of the body. A bare
   "403" tells you nothing; Google's actual text ("Google Calendar API has
   not been used in project 123 before or it is disabled") tells you
   exactly what to go and fix. */
async function getJSON(url, opts){
  const res = await fetch(url, opts);
  if(!res.ok){
    let detail = '';
    try{
      const text = await res.text();
      try{
        const j = JSON.parse(text);
        detail = j.error?.message || j.error_description || j.message
              || j.status_message || j.reason || (typeof j.error === 'string' ? j.error : '');
      }catch{
        if(!/^\s*</.test(text)) detail = text.slice(0, 160);   // not an HTML error page
      }
    }catch{ /* body already consumed or unreadable */ }
    throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  }
  return res.json();
}

/* Render an error inside a tile without killing the rest of the page. */
function tileError(el, msg){
  el.innerHTML = `<p class="empty">${msg}</p>`;
}
