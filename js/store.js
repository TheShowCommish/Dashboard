/* ============================================================
   store.js — everything that must survive a page reload.
   Uses localStorage. Nothing leaves this browser.
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

  return {
    get state(){ return state; },
    get(path, fallback){
      return path.split('.').reduce((o,k) => (o==null?undefined:o[k]), state) ?? fallback;
    },
    set(path, value){
      const parts = path.split('.');
      const last  = parts.pop();
      let node = state;
      for(const p of parts){ node[p] = node[p] ?? {}; node = node[p]; }
      node[last] = value;
      save();
    },
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

/* Small shared helper every module uses for network calls. */
async function getJSON(url, opts){
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* Render an error inside a tile without killing the rest of the page. */
function tileError(el, msg){
  el.innerHTML = `<p class="empty">${msg}</p>`;
}
