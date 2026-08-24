/* ============================================================
   stocks.js — portfolio, deliberately vague.

   Import a positions CSV once to learn WHAT you hold; Finnhub prices it
   daily and Twelve Data supplies the history behind the weekly, monthly,
   6-month and 1-year windows (Finnhub's free tier gives today only).

   House rule: no total portfolio value is ever rendered. Percentages are
   exact; dollar amounts are described by order of magnitude and nothing
   more. Everything money-shaped goes through vague().

   Schwab's "Cost Basis" column is the TOTAL dollars in a position, not a
   per-share price — cost is stored as a total throughout.
   ============================================================ */

const Stocks = (() => {
  const body  = document.getElementById('pfBody');
  const stamp = document.getElementById('pfUpdated');

  let quotes   = {};      // { SYMBOL: {c, d, dp} }
  let anchors  = {};      // { SYMBOL: {d1, w1, m1, m6, y1} }
  let earnings = [];      // [{symbol, date, hour, epsEstimate}]
  let quotedAt = null;

  const WINDOWS = [
    {id:'d1', label:'Today',      days:1},
    {id:'w1', label:'This week',  days:7},
    {id:'m1', label:'This month', days:30},
    {id:'m6', label:'Six months', days:182},
    {id:'y1', label:'One year',   days:365}
  ];

  /* ---- CSV helpers ---- */
  function splitRow(line){
    const out = []; let cur = '', q = false;
    for(const ch of line){
      if(ch === '"') q = !q;
      else if(ch === ',' && !q){ out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  const clean = v => String(v ?? '').replace(/^"|"$/g,'').trim();

  /* "$1,983.28" → 1983.28 · "-$4.16" → -4.16 · "--" → null */
  function money(v){
    const s = clean(v);
    if(!s || s === '--' || s === 'N/A') return null;
    const neg = /^[-(]/.test(s) || s.includes('-$');
    const n = parseFloat(s.replace(/[^0-9.]/g,''));
    return Number.isNaN(n) ? null : (neg ? -n : n);
  }

  /* Data providers want a dot, Schwab writes a slash: BRK/B → BRK.B */
  const tickerFor = s => s.replace(/\//g,'.');

  const isSchwab = text => /"?Symbol"?\s*,\s*"?Description"?/i.test(text)
                        && /Mkt Val|Qty \(Quantity\)/i.test(text);

  function parseSchwab(text){
    const rows = [], accounts = [];
    let account = 'Portfolio', head = null, asOf = '';

    const idx = cells => {
      const h = cells.map(c => clean(c).toLowerCase());
      const find = re => h.findIndex(x => re.test(x));
      return {
        sym:find(/^symbol$/), desc:find(/^description$/), qty:find(/^qty/),
        price:find(/^price$/), val:find(/^mkt val/), cost:find(/^cost basis/),
        type:find(/^asset type/)
      };
    };

    for(const raw of text.split(/\r?\n/)){
      const line = raw.trim();
      if(!line) continue;

      /* The title line is quoted and holds a comma, so it splits to a
         single cell exactly like an account header — test it first. */
      const title = line.match(/Positions for .*? as of (.+?)"?$/i);
      if(title){ asOf = title[1].trim(); continue; }

      const cells = splitRow(line);
      if(cells.length === 1){ account = clean(cells[0]); continue; }
      if(/^symbol$/i.test(clean(cells[0]))){ head = idx(cells); continue; }
      if(!head) continue;

      const symbol = clean(cells[head.sym]);
      if(!symbol || /^positions total/i.test(symbol)) continue;

      const value = money(cells[head.val]);
      if(/^cash/i.test(symbol)){ accounts.push({name:account, cash:value || 0}); continue; }

      const shares = money(cells[head.qty]);
      if(!shares) continue;

      rows.push({
        symbol, ticker:tickerFor(symbol), name:clean(cells[head.desc]), shares,
        cost: money(cells[head.cost]) || 0,          // total dollars, not per share
        csvPrice: money(cells[head.price]), csvValue: value,
        type: clean(cells[head.type]), account
      });
    }
    if(!rows.length) throw new Error('no positions found in that export');
    return {rows, accounts, asOf};
  }

  function parsePlain(text){
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2) throw new Error('needs a header row and at least one holding');

    const head = splitRow(lines[0]).map(h => clean(h).toLowerCase());
    const iSym = head.findIndex(h => /^(symbol|ticker|stock)$/.test(h));
    const iSh  = head.findIndex(h => /^(shares|qty|quantity|units)$/.test(h));
    const iCo  = head.findIndex(h => /(cost|basis|price paid|avg)/.test(h));
    if(iSym < 0 || iSh < 0) throw new Error('needs columns named "symbol" and "shares"');

    const rows = lines.slice(1).map(splitRow).map(c => {
      const symbol = clean(c[iSym]).toUpperCase();
      const shares = money(c[iSh]) || 0;
      /* Here "cost" is per share by convention, so scale it to a total to
         match the Schwab path. */
      const per = iCo >= 0 ? (money(c[iCo]) || 0) : 0;
      return {symbol, ticker:tickerFor(symbol), name:'', shares, cost:per*shares,
              csvPrice:null, csvValue:null, type:'', account:'Portfolio'};
    }).filter(h => h.symbol && h.shares > 0);

    if(!rows.length) throw new Error('no valid rows found');
    return {rows, accounts:[], asOf:''};
  }

  /* One position per symbol: the same holding in two accounts is one
     quote lookup, not two. */
  function merge(rows){
    const by = new Map();
    for(const r of rows){
      if(!by.has(r.symbol)) by.set(r.symbol, {...r, accounts:[r.account]});
      else{
        const m = by.get(r.symbol);
        m.shares += r.shares;
        m.cost   += r.cost;
        if(m.csvValue != null && r.csvValue != null) m.csvValue += r.csvValue;
        if(!m.accounts.includes(r.account)) m.accounts.push(r.account);
      }
    }
    return [...by.values()].map(({account, ...keep}) => keep);
  }

  function parse(text){
    const {rows, accounts, asOf} = isSchwab(text) ? parseSchwab(text) : parsePlain(text);
    return {holdings: merge(rows), accounts, asOf, positions: rows.length};
  }

  function ingest(file){
    const r = new FileReader();
    r.onload = async () => {
      try{
        const {holdings, accounts, asOf, positions} = parse(r.result);
        Store.set('holdings', holdings);
        Store.set('portfolio.meta', {asOf, accounts,
          cash: accounts.reduce((s,a) => s + (a.cash||0), 0),
          importedAt: new Date().toISOString()});
        Store.set('portfolio.quotes', null);
        Store.set('portfolio.history', null);
        quotes = {}; anchors = {}; quotedAt = null;
        Store.toast(`Imported ${holdings.length} holdings from ${positions} positions` +
                    `${accounts.length ? ` across ${accounts.length} accounts` : ''}.`);
        await load(true);
      }catch(e){
        Store.toast(`CSV problem: ${e.message}.`);
      }
    };
    r.readAsText(file);
  }

  /* ---- pricing ---- */
  const sameDay = (a,b) => a && b && a.toDateString() === b.toDateString();

  function restore(){
    const q = Store.get('portfolio.quotes', null);
    if(q && q.quotes){ quotes = q.quotes; quotedAt = q.at ? new Date(q.at) : null; }
    const h = Store.get('portfolio.history', null);
    if(h && h.anchors) anchors = h.anchors;
    return !!(q && q.quotes);
  }

  async function load(force = false){
    const hold = Store.get('holdings',[]);
    if(!hold.length){
      body.innerHTML = '<p class="empty">Import your positions CSV to get started — ' +
        'a Schwab All-Accounts export, or any sheet with symbol and shares columns.</p>';
      return;
    }

    restore();
    if(!force && quotedAt && sameDay(quotedAt, new Date())){ render(); return; }
    if(Object.keys(quotes).length) render();      // yesterday's numbers while refreshing

    await Promise.all([loadQuotes(hold), loadHistory(hold, force)]);
    render();
    loadEarnings();
    if(window.Ticker) Ticker.render();
  }

  async function loadQuotes(hold){
    const key = Store.get('keys.finnhub','');
    if(!key) return;

    const fresh = {};
    /* Finnhub's free tier allows 60 calls a minute; batches of 8 stay well
       inside that without taking 40 seconds serially. */
    for(let i = 0; i < hold.length; i += 8){
      await Promise.all(hold.slice(i, i+8).map(async h => {
        try{
          const q = await getJSON(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(h.ticker)}&token=${key}`);
          if(q && q.c) fresh[h.symbol] = {c:q.c, d:q.d||0, dp:q.dp||0};
        }catch(e){ console.error('Quote failed for', h.symbol, e.message); }
      }));
    }

    if(Object.keys(fresh).length){
      quotes = fresh;
      quotedAt = new Date();
      Store.set('portfolio.quotes', {at:quotedAt.toISOString(), quotes});
    }else if(!Object.keys(quotes).length){
      Store.toast('No quotes came back from Finnhub — check the key in Settings.');
    }
  }

  /* ---- history (Twelve Data) ----
     Only six prices per symbol are ever needed, so the year of daily bars
     is reduced to anchors on arrival and the rest thrown away — that keeps
     41 symbols of history well inside localStorage. */
  async function loadHistory(hold, force){
    const key = Store.get('keys.twelve','');
    if(!key) return;

    const cached = Store.get('portfolio.history', null);
    if(!force && cached && cached.at && sameDay(new Date(cached.at), new Date())){
      anchors = cached.anchors || {};
      return;
    }

    const bySym = new Map(hold.map(h => [h.ticker, h.symbol]));
    const tickers = [...bySym.keys()];
    const next = {};
    let requests = 0;

    for(let i = 0; i < tickers.length; i += 8){
      const batch = tickers.slice(i, i+8);

      /* Free tier allows 8 requests a minute. Batching 8 symbols per
         request keeps 41 holdings to ~6 requests, but pause if a larger
         portfolio would push past the limit. */
      if(requests >= 7){ await new Promise(r => setTimeout(r, 61000)); requests = 0; }

      try{
        const d = await getJSON('https://api.twelvedata.com/time_series' +
          `?symbol=${encodeURIComponent(batch.join(','))}` +
          `&interval=1day&outputsize=300&apikey=${key}`);
        requests++;

        if(d && d.code && d.code !== 200) throw new Error(d.message || `Twelve Data error ${d.code}`);

        /* One symbol returns the series directly; several return a map
           keyed by symbol. */
        const series = batch.length === 1 ? {[batch[0]]: d} : d;
        for(const t of batch){
          const s = series[t];
          if(!s || !s.values) continue;
          const a = toAnchors(s.values);
          if(a) next[bySym.get(t)] = a;
        }
      }catch(e){
        console.error('History failed for', batch.join(','), e.message);
        if(/api key|401|403/i.test(e.message)){
          Store.toast(`Twelve Data rejected the key: ${e.message}`);
          return;
        }
      }
    }

    if(Object.keys(next).length){
      anchors = next;
      Store.set('portfolio.history', {at:new Date().toISOString(), anchors});
    }
  }

  /* values arrive newest-first; pick the last close at or before each mark. */
  function toAnchors(values){
    const rows = values
      .map(v => ({t: v.datetime, c: parseFloat(v.close)}))
      .filter(v => v.t && !Number.isNaN(v.c));
    if(rows.length < 2) return null;

    const at = daysBack => {
      const target = new Date();
      target.setDate(target.getDate() - daysBack);
      const iso = target.toISOString().slice(0,10);
      const hit = rows.find(r => r.t <= iso);
      return hit ? hit.c : null;
    };

    return {
      d1: rows[1].c,                    // previous close
      w1: at(7), m1: at(30), m6: at(182), y1: at(365)
    };
  }

  /* ---- language ----
     Order-of-magnitude only. Never an exact figure. */
  function vague(d){
    const a = Math.abs(d);
    const dir = d >= 0 ? 'up' : 'down';
    if(a < 1)      return 'dead flat';
    if(a < 10)     return `${dir} a few bucks`;
    if(a < 50)     return `${dir} beer money`;
    if(a < 100)    return `${dir} a nice dinner`;
    if(a < 250)    return `${dir} a couple hundred`;
    if(a < 500)    return `${dir} a few hundred`;
    if(a < 1000)   return `${dir} most of a grand`;
    if(a < 2500)   return `${dir} a couple grand`;
    if(a < 5000)   return `${dir} a few grand`;
    if(a < 10000)  return `${dir} several grand`;
    if(a < 25000)  return `${dir} a serious chunk`;
    if(a < 50000)  return `${dir} tens of thousands`;
    if(a < 100000) return `${dir} an uncomfortable number of thousands`;
    return `${dir} six figures`;
  }

  function quip(pct){
    if(pct >=  10) return 'Absolute heater. Do not touch anything.';
    if(pct >=   5) return 'Feeling smug about this one.';
    if(pct >=   2) return 'Quietly pleased.';
    if(pct >= 0.5) return 'Nudging the right way.';
    if(pct >  -0.5) return 'Basically flat. Riveting.';
    if(pct >    -2) return 'A light flesh wound.';
    if(pct >    -5) return "Some red. Don't zoom in.";
    if(pct >   -10) return 'Ouch. Rude.';
    return 'Maybe check back tomorrow.';
  }

  const BUCKETS = [
    {min:20,  name:'Big Dog',            note:'carries the whole thing'},
    {min:10,  name:'Heavy Hitter',       note:'seriously invested here'},
    {min:5,   name:'A Good Chunk',       note:'meaningful money'},
    {min:2,   name:'Pulling Its Weight', note:'earns its spot'},
    {min:0.5, name:'A Light Sprinkle',   note:'seasoning, mostly'},
    {min:0,   name:'Rounding Error',     note:'why do you even own this'}
  ];

  /* ---- maths ---- */
  function priceNow(h){
    const q = quotes[h.symbol];
    return q ? q.c : h.csvPrice;
  }

  function windowStats(win){
    const hold = Store.get('holdings',[]);
    let nowVal = 0, thenVal = 0;
    const movers = [];

    for(const h of hold){
      const now = priceNow(h);
      const a = anchors[h.symbol];
      const then = win.id === 'd1' && quotes[h.symbol]
        ? quotes[h.symbol].c - quotes[h.symbol].d     // Finnhub gives today live
        : (a ? a[win.id] : null);
      if(now == null || then == null || !then) continue;

      nowVal  += now * h.shares;
      thenVal += then * h.shares;
      movers.push({symbol:h.symbol, pct:(now/then - 1) * 100});
    }

    if(!thenVal) return null;
    movers.sort((a,b) => b.pct - a.pct);
    /* With fewer than ten holdings a plain slice(-5) would overlap the top
       five, listing the same names as both best and worst -- and filing
       gainers under "Worst". Start the tail after whatever the head took. */
    const top = movers.slice(0, 5);
    const bottom = movers.slice(Math.max(top.length, movers.length - 5)).reverse();
    return {
      pct: (nowVal/thenVal - 1) * 100,
      dollars: nowVal - thenVal,
      counted: movers.length,
      top, bottom
    };
  }

  function weights(){
    const hold = Store.get('holdings',[]);
    const vals = hold.map(h => {
      const p = priceNow(h);
      return {symbol:h.symbol, val: p != null ? p * h.shares : (h.csvValue || 0)};
    });
    const total = vals.reduce((s,v) => s + v.val, 0);
    if(!total) return [];
    return vals.map(v => ({...v, pct: v.val/total * 100}))
               .sort((a,b) => b.pct - a.pct);
  }

  /* ---- render ---- */
  function stampText(){
    if(!quotedAt) return 'not priced';
    return sameDay(quotedAt, new Date())
      ? quotedAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
      : quotedAt.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }

  const pctText = p => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}%`;

  function moverList(list, label){
    if(!list.length) return '';
    return `<div class="mv-col">
      <span class="mv-label">${label}</span>
      ${list.map(m => `<span class="mv-row ${m.pct >= 0 ? 'up' : 'down'}">
        <b>${esc(m.symbol)}</b><i>${pctText(m.pct)}</i></span>`).join('')}
    </div>`;
  }

  function render(){
    const hold = Store.get('holdings',[]);
    if(!hold.length) return;

    const hasHistory = Object.keys(anchors).length > 0;
    const needKey = !Store.get('keys.twelve','');

    const cards = WINDOWS.map(w => {
      const s = windowStats(w);
      if(!s){
        return `<div class="pf-card is-empty">
          <span class="pf-when">${w.label}</span>
          <span class="pf-none">${w.id === 'd1'
            ? 'Needs a Finnhub key.'
            : needKey ? 'Add a Twelve Data key in Settings.'
                      : 'No history for this window yet.'}</span>
        </div>`;
      }
      const cls = s.pct >= 0 ? 'up' : 'down';
      return `<div class="pf-card">
        <span class="pf-when">${w.label}</span>
        <span class="pf-pct ${cls}">${pctText(s.pct)}</span>
        <span class="pf-vague">${esc(vague(s.dollars))}</span>
        <span class="pf-quip">${esc(quip(s.pct))}</span>
        <div class="pf-movers">
          ${moverList(s.top,'Best')}
          ${moverList(s.bottom,'Worst')}
        </div>
        <span class="pf-count">${s.counted} of ${hold.length} counted</span>
      </div>`;
    }).join('');

    const w = weights();
    const grouped = BUCKETS.map(b => ({
      ...b, items: w.filter(x => x.pct >= b.min &&
        !BUCKETS.some(o => o.min > b.min && x.pct >= o.min))
    })).filter(g => g.items.length);

    const bucketHtml = grouped.map(g => `
      <div class="bk">
        <div class="bk-head"><b>${g.name}</b><span>${esc(g.note)}</span></div>
        <div class="bk-items">${g.items.map(i =>
          `<span class="bk-chip">${esc(i.symbol)}<i>${(i.pct < 0.1 ? i.pct.toFixed(2) : i.pct.toFixed(1))}%</i></span>`).join('')}</div>
      </div>`).join('');

    body.innerHTML = `
      <div class="pf-grid">${cards}</div>
      <h3 class="pf-h3">How much of the pie</h3>
      <div class="bk-wrap">${bucketHtml || '<p class="empty">Nothing priced yet.</p>'}</div>
      <p class="pf-foot">${hold.length} holdings · quotes ${stampText()}${
        hasHistory ? ' · history current' : ''} · exact percentages, deliberately fuzzy dollars</p>`;

    if(stamp){
      stamp.textContent = stampText();
      stamp.title = quotedAt ? `Quotes last refreshed ${quotedAt.toLocaleString()}`
                             : 'Add a Finnhub key in Settings to price these daily';
    }
  }

  /* ---- earnings ---- */
  async function loadEarnings(){
    const key = Store.get('keys.finnhub','');
    /* Funds do not report earnings, so only real companies are worth
       matching against the calendar. */
    const syms = new Set(Store.get('holdings',[])
      .filter(h => !/etf|fund|money market/i.test(h.type || ''))
      .map(h => h.ticker));
    if(!key || !syms.size) return;

    const from = new Date().toISOString().slice(0,10);
    const to   = new Date(Date.now() + 45*864e5).toISOString().slice(0,10);

    try{
      const d = await getJSON(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`);
      earnings = (d.earningsCalendar||[]).filter(e => syms.has(e.symbol));
      if(window.CalendarView) CalendarView.render();
    }catch(e){
      console.error('Earnings calendar unavailable:', e.message);
    }
  }

  return {
    load, ingest, parse, refresh: () => load(true),
    get earnings(){ return earnings; },
    /* Biggest absolute movers today, for the ticker. */
    get movers(){
      return Store.get('holdings',[])
        .map(h => ({symbol:h.symbol, dp: quotes[h.symbol] ? quotes[h.symbol].dp : null}))
        .filter(m => m.dp != null)
        .sort((a,b) => Math.abs(b.dp) - Math.abs(a.dp))
        .slice(0,15);
    }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Stocks = Stocks;
