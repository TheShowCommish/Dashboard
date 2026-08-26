/* ============================================================
   shop.js — the grocery list, on its own, on a phone.

   grocery.html is the same list the Menu tab's Grocery screen shows,
   built by the same Menu.grocery() from the same plan and the same
   kitchen. It is not a copy of the data — it is the same data, read
   out of the same localStorage, so a box ticked in the shop is ticked
   on the wall before you get home.

   What it deliberately does NOT have: the ticker, the sky canvas, the
   kiosk, the tabs, the theme engine's weather. A list you are reading
   one-handed next to a trolley wants one column of large targets and
   nothing moving. The palette is pinned to Daylight for the same
   reason — a phone in a bright shop is the one place the dark deck is
   genuinely hard to read.

   Pinning the palette must not touch Store: theme.mode and theme.pick
   are shared with the dashboard through the same origin, so writing
   them here would drag the wall display into daylight too. The tokens
   are read off the theme and applied straight to the document instead.
   ============================================================ */

const Shop = (() => {

  /* ---- the palette, borrowed rather than switched ---- */
  function paintDaylight(){
    const t = (window.THEMES || Themes.all || []).find(x => x.id === 'daylight');
    if(!t) return;
    const root = document.documentElement;
    for(const [prop, val] of Object.entries(t.tokens)) root.style.setProperty(prop, val);
  }

  const days = () => Menu.fortnight(new Date(Store.get('menu.start', Menu.iso(new Date())) + 'T00:00:00'));

  /* Grams are what the plan adds up in, but nobody shops in grams for
     everything. Same rounding the deck uses, so the two screens never
     disagree about how much to buy. */
  function bulkLabel(g){
    if(g >= 1000) return `${Math.round(g / 100) / 10} kg`;
    if(g >= 100)  return `${Math.round(g / 10) * 10} g`;
    return 'a little';
  }

  function render(){
    const groups = Menu.grocery(days());
    const count  = groups.reduce((n, g) => n + g.items.length, 0);
    const ticked = groups.reduce((n, g) => n + g.items.filter(i => i.bought).length, 0);
    const ds = days();

    const range = document.getElementById('shopRange');
    if(range){
      range.dataset.range =
        `${ds[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${ds[13].toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
      range.textContent = range.dataset.note || range.dataset.range;
    }

    const left = document.getElementById('shopLeft');
    if(left) left.textContent = `${count - ticked} to get`;

    const done = document.getElementById('shopDone');
    if(done){ done.hidden = !ticked; done.textContent = `${ticked} in the trolley`; }

    document.getElementById('shopBody').innerHTML = count ? groups.map(g => `
      <section class="shop-aisle">
        <h2>${esc(g.aisle)}</h2>
        ${g.items.map(i => `
          <label class="shop-row${i.bought ? ' is-bought' : ''}">
            <input type="checkbox" data-buy="${esc(i.key)}"${i.bought ? ' checked' : ''}>
            <span class="shop-name">${esc(i.item || i.key)}</span>
            ${i.short
              ? `<span class="shop-amt is-short">${esc(bulkLabel(i.short.gapG))} more</span>`
              : i.grams && !i.unmeasured
                ? `<span class="shop-amt">${esc(bulkLabel(i.grams))}</span>` : ''}
            <span class="shop-for">${esc(i.recipes.slice(0,2).join(' · '))}${i.recipes.length > 2 ? ' …' : ''}</span>
          </label>`).join('')}
      </section>`).join('')
      : `<p class="empty">Nothing to buy — either the plan is empty, or the kitchen already has all of it.</p>`;
  }

  /* The two counters in the header, off the boxes on screen rather than
     off a rebuilt list. */
  function recount(){
    const boxes  = [...document.querySelectorAll('.shop-row input[data-buy]')];
    const ticked = boxes.filter(b => b.checked).length;
    const left = document.getElementById('shopLeft');
    if(left) left.textContent = `${boxes.length - ticked} to get`;
    const done = document.getElementById('shopDone');
    if(done){ done.hidden = !ticked; done.textContent = `${ticked} in the trolley`; }
  }

  /* One delegated listener: rows come and go with the plan, and per-row
     handlers would be re-attached every time it changed. */
  function wire(){
    /* Ticking updates the row and the two counters, and nothing else.

       Rebuilding the list was the obvious thing and it is wrong here: it
       throws away the checkbox under the thumb, and on a phone halfway
       down the pantry aisle it also throws away the scroll position. The
       row order cannot change from a tick — only its look — so the only
       honest reason to redraw is a change to the plan, and that comes in
       through visibilitychange instead. */
    document.addEventListener('change', e => {
      const box = e.target.closest('[data-buy]');
      if(!box) return;
      Menu.setBought(box.dataset.buy, box.checked);
      const row = box.closest('.shop-row');
      if(row) row.classList.toggle('is-bought', box.checked);
      recount();
    });

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if(!b) return;
      const a = b.dataset.act;

      if(a === 'signIn'){
        const box = document.getElementById('shopEmail');
        if(!window.Cloud || !Cloud.configured)
          return Store.toast('Set the Supabase URL and key in the deck\u2019s Settings first.');
        Cloud.signIn(box.value)
          .then(() => Store.toast('Link sent. Open it on this phone.'))
          .catch(err => Store.toast(err.message));
        return;
      }

      if(a === 'clearTicks'){ Menu.clearBought(); return render(); }

      if(a === 'stow'){
        /* Same rules as the deck: each item goes away on its own, and
           anything that will not go is named rather than lost. */
        const bought = Object.keys(Store.get('menu.bought', {}));
        const failed = [];
        let n = 0;
        for(const k of bought){
          try{
            Pantry.add(k, Food.STAPLES.has(k) ? 'spices'
                        : Food.aisleFor(k) === 'Frozen' ? 'freezer' : 'fridge');
            n++;
          }catch(err){ failed.push(`${k} — ${err.message}`); }
        }
        Menu.clearBought();
        render();
        if(failed.length){
          const host = document.getElementById('shopBody');
          const box = document.createElement('div');
          box.className = 'mv-error';
          box.setAttribute('role','alert');
          box.innerHTML = `<b>${failed.length} could not be put away.</b>
                           <ul>${failed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
          host.prepend(box);
        }
        Store.toast(`Put ${n} ${n === 1 ? 'thing' : 'things'} away.`);
      }
    });

    /* Coming back to the tab after wandering the shop should show what
       the deck has done since, not a stale list. */
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible') render();
    });
    addEventListener('storage', render);   // another tab on the same device
  }

  /* ---- sync ----
     This page is the reason sync exists, so it says out loud where it
     stands. A list that is quietly a week stale is worse than one that
     admits it cannot reach the server. */
  const SYNC_WORDS = {
    off:          () => 'Not synced — set this up in the deck’s Settings first.',
    'signed-out': d  => d || 'Sign in to see the list from your other devices.',
    sent:         d  => d || 'Check your email for the link.',
    syncing:      () => 'Checking for changes…',
    ok:           () => '',
    offline:      () => 'Offline — ticks are saved here and go up when there is signal.',
    error:        d  => `Could not reach the server: ${d}`
  };

  function paintSync(st){
    const auth = document.getElementById('shopAuth');
    const why  = document.getElementById('shopAuthWhy');
    if(!auth) return;

    const needsAuth = st.state === 'off' || st.state === 'signed-out' || st.state === 'sent';
    auth.hidden = !needsAuth;
    if(why) why.textContent = (SYNC_WORDS[st.state] || (() => ''))(st.detail);

    /* The header carries the softer states so they do not push the list
       down the screen while you are reading it. */
    const range = document.getElementById('shopRange');
    if(!range) return;
    const note = needsAuth ? '' : (SYNC_WORDS[st.state] || (() => ''))(st.detail);
    range.dataset.note = note;
    if(note) range.textContent = note;
    else if(range.dataset.range) range.textContent = range.dataset.range;
  }

  async function boot(){
    paintDaylight();
    wire();
    render();                 // draw whatever can be drawn before the backlog lands

    if(window.Cloud){
      /* A pull that lands while you are mid-aisle redraws the list, but
         only if it touched something the list is made of. */
      Store.onChange(paths => {
        if(paths.some(p => p === 'menu.bought' || p.startsWith('menu.'))) render();
      });
      Cloud.onStatus(paintSync);
      await Cloud.boot();
    }

    await Recipes.load();
    render();
  }

  return { boot, render };
})();

/* style.css escapes with this; grocery.html does not load google.js, so
   it lives here too rather than pulling a whole module in for one
   four-line function. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.addEventListener('DOMContentLoaded', () => Shop.boot());
window.Shop = Shop;
