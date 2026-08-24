/* ============================================================
   stocks.js — portfolio, deliberately vague.

   Import a positions CSV once to learn WHAT you hold; Finnhub prices it
   daily and Twelve Data supplies the history behind the weekly, monthly,
   6-month and 1-year windows (Finnhub's free tier gives today only).
   Twelve Data also covers the quotes Finnhub will not price — funds and
   money-market positions — and the CSV's own Price column is the last
   fallback, so a held position never silently disappears from the tab.

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

  /* Account names arrive with runs of padding spaces between the nickname
     and the masked number ("Roth Contributory IRA      ...790"). They are
     used as object keys, so they have to normalise identically every time
     or the filter cannot find its own holdings. */
  const cleanAccount = v => clean(v).replace(/\s+/g,' ').trim();

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

      /* Schwab writes its blank separator lines as a row of empty quoted
         cells ("" or "","",""), not as a truly empty line. Those survive the
         check above, and every one of them used to be mistaken for an
         account header — which silently reset the current account to the
         empty string and orphaned every holding that followed it. */
      if(!/[A-Za-z0-9]/.test(line)) continue;

      /* The title line is quoted and holds a comma, so it splits to a
         single cell exactly like an account header — test it first. */
      const title = line.match(/Positions for .*? as of (.+?)"?$/i);
      if(title){ asOf = title[1].trim(); continue; }

      const cells = splitRow(line);

      /* An account header is its name and nothing else. Schwab pads it out
         with empty cells to the width of the table in some exports and not
         in others, so both shapes have to count as a header — otherwise the
         name falls through to the holdings branch, gets dropped for having
         no share count, and every position lands under the previous
         account. */
      const isHeader = cells.length === 1 ||
                       (cells.length > 1 && cells.slice(1).every(c => !clean(c)));
      if(isHeader){ account = cleanAccount(cells[0]); continue; }

      if(/^symbol$/i.test(clean(cells[0]))){ head = idx(cells); continue; }
      if(!head) continue;

      const symbol = clean(cells[head.sym]);
      if(!symbol || /^(positions total|account total)/i.test(symbol)) continue;

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
     quote lookup, not two. byAccount keeps the split so the view can be
     filtered to a single account without re-importing. */
  function merge(rows){
    const by = new Map();
    for(const r of rows){
      if(!by.has(r.symbol)){
        by.set(r.symbol, {...r, accounts:[r.account],
                          byAccount:{[r.account]:{shares:r.shares, cost:r.cost}}});
      }else{
        const m = by.get(r.symbol);
        m.shares += r.shares;
        m.cost   += r.cost;
        /* Shares are summed, so a value that covers only one of the two
           lots would price the merged position too low. Either both rows
           carry a market value or the position has none. */
        m.csvValue = (m.csvValue != null && r.csvValue != null)
          ? m.csvValue + r.csvValue : null;
        if(m.csvPrice == null) m.csvPrice = r.csvPrice;
        if(!m.accounts.includes(r.account)) m.accounts.push(r.account);
        const a = m.byAccount[r.account] || (m.byAccount[r.account] = {shares:0, cost:0});
        a.shares += r.shares;
        a.cost   += r.cost;
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
    /* Runs after both, not alongside them: it shares Twelve Data's
       per-minute allowance with the history pull. */
    await fillQuoteGaps(hold);
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

  /* ---- Twelve Data credit budget ----
     The free tier is metered in CREDITS, not requests: a batch of eight
     symbols spends eight of the eight allowed in a minute. Counting
     requests instead of credits is why a 41-holding portfolio only ever
     got history for the first batch — everything after it came back
     rate-limited and was silently dropped. */
  const TD_PER_MIN = 8;
  let tdSpent = [];        // timestamps of credits spent in the last minute

  async function tdBudget(cost){
    for(;;){
      const cutoff = Date.now() - 61000;
      tdSpent = tdSpent.filter(t => t > cutoff);
      if(tdSpent.length + cost <= TD_PER_MIN) break;
      const wait = (tdSpent[0] + 61000) - Date.now();
      await new Promise(r => setTimeout(r, Math.max(1000, wait)));
    }
    const now = Date.now();
    for(let i = 0; i < cost; i++) tdSpent.push(now);
  }

  /* ---- quote gaps (Twelve Data) ----
     Finnhub's free tier has no quote for mutual funds, money-market funds
     and a fair few ETFs — it answers 200 with c:0. Twelve Data prices most
     of them, and the key is already here for the history, so the two
     sources are combined: Finnhub first, Twelve Data for whatever it left
     empty. Anything neither can price falls back to the CSV. */
  async function fillQuoteGaps(hold){
    const key = Store.get('keys.twelve','');
    if(!key) return;

    const gaps = hold.filter(h => !(quotes[h.symbol] && quotes[h.symbol].c));
    if(!gaps.length) return;

    const bySym = new Map(gaps.map(h => [h.ticker, h.symbol]));
    const tickers = [...bySym.keys()];
    let found = 0;

    for(let i = 0; i < tickers.length; i += 8){
      const batch = tickers.slice(i, i+8);
      await tdBudget(batch.length);
      try{
        const d = await getJSON('https://api.twelvedata.com/quote' +
          `?symbol=${encodeURIComponent(batch.join(','))}&apikey=${key}`);

        if(d && d.code && d.code !== 200) throw new Error(d.message || `Twelve Data error ${d.code}`);

        /* One symbol returns the quote directly; several return a map. */
        const series = batch.length === 1 ? {[batch[0]]: d} : d;
        for(const t of batch){
          const q = series[t];
          if(!q || q.status === 'error') continue;      // not covered there either
          const c = parseFloat(q.close);
          if(!Number.isFinite(c) || !c) continue;
          const prev = parseFloat(q.previous_close);
          const usable = Number.isFinite(prev) && prev > 0;
          quotes[bySym.get(t)] = {
            c,
            d:  usable ? c - prev : 0,
            dp: usable ? (c/prev - 1) * 100 : 0,
            src: 'twelve'
          };
          found++;
        }
      }catch(e){
        console.error('Twelve Data quote failed for', batch.join(','), e.message);
        /* A rejected key or a spent allowance will reject every remaining
           batch the same way — stop rather than burn the rest. */
        if(/api key|401|403|429|limit/i.test(e.message)) break;
      }
    }

    if(found){
      quotedAt = new Date();
      Store.set('portfolio.quotes', {at:quotedAt.toISOString(), quotes});
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
    let complete = true;

    for(let i = 0; i < tickers.length; i += 8){
      const batch = tickers.slice(i, i+8);
      await tdBudget(batch.length);

      try{
        const d = await getJSON('https://api.twelvedata.com/time_series' +
          `?symbol=${encodeURIComponent(batch.join(','))}` +
          `&interval=1day&outputsize=300&apikey=${key}`);

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
        complete = false;
        if(/api key|401|403/i.test(e.message)){
          Store.toast(`Twelve Data rejected the key: ${e.message}`);
          break;
        }
      }

      /* Merged and painted per batch: a full portfolio takes minutes to
         walk at eight credits a minute, and the windows should fill in as
         it goes rather than all at the end. Merging also means a batch
         that fails does not wipe the symbols that already worked. */
      if(Object.keys(next).length){
        anchors = {...anchors, ...next};
        /* No timestamp until the walk finishes: a reload part-way through
           keeps the anchors it already has and picks the walk back up,
           rather than treating a half-filled cache as today's answer. */
        Store.set('portfolio.history', {at:null, anchors});
        if(Store.get('holdings',[]).length) render();
      }
    }

    if(complete) Store.set('portfolio.history', {at:new Date().toISOString(), anchors});
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

  /* ---- account filter ----
     null means every account combined. */
  let account = null;

  /* Names come from the byAccount keys, not the accounts[] list, because
     byAccount is what sharesOf() actually looks in. Reading the tab labels
     from one place and the share counts from another is how a filter ends up
     offering an account it then reports as empty. */
  function accountNames(){
    const set = new Set();
    for(const h of Store.get('holdings',[])){
      const keys = Object.keys(h.byAccount || {});
      if(keys.length) keys.forEach(k => set.add(k));
      else for(const a of (h.accounts || [])) set.add(a);   // pre-byAccount saves
    }
    return [...set].filter(Boolean).sort();
  }

  /* Share count and cost for the active account, or the combined total.
     A holding saved before byAccount existed has no split to read, so it
     falls back to its whole position when it belongs to this account. */
  function slice(h){
    if(h.byAccount && account in h.byAccount) return h.byAccount[account];
    if(!h.byAccount && (h.accounts || []).includes(account))
      return {shares: h.shares, cost: h.cost || 0};
    return null;
  }
  function sharesOf(h){
    if(!account) return h.shares;
    return slice(h)?.shares ?? 0;
  }
  function costOf(h){
    if(!account) return h.cost || 0;
    return slice(h)?.cost ?? 0;
  }
  const inView = h => sharesOf(h) > 0;

  /* ---- maths ---- */
  /* Best available price, in order of freshness. The CSV fallbacks matter
     for the graph: Finnhub's free tier has no quote for mutual funds or
     money-market holdings, and without a price those positions have no
     value and used to vanish from the plot entirely. */
  function priceNow(h){
    const q = quotes[h.symbol];
    if(q && q.c) return q.c;
    if(h.csvPrice) return h.csvPrice;
    if(h.csvValue && h.shares) return h.csvValue / h.shares;
    return null;
  }

  function windowStats(win){
    const hold = Store.get('holdings',[]).filter(inView);
    let nowVal = 0, thenVal = 0;
    const movers = [];

    for(const h of hold){
      const now = priceNow(h);
      const a = anchors[h.symbol];
      const then = win.id === 'd1' && quotes[h.symbol]
        ? quotes[h.symbol].c - quotes[h.symbol].d     // Finnhub gives today live
        : (a ? a[win.id] : null);
      if(now == null || then == null || !then) continue;

      const sh = sharesOf(h);
      nowVal  += now * sh;
      thenVal += then * sh;
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

  /* Weight of each holding plus its return over the chosen window, which
     is exactly the pair the scatter plots. Every holding in view comes back,
     including those with no return for this window — ret is null there and
     the plot gives them their own lane rather than dropping them. */
  function weights(winId){
    const hold = Store.get('holdings',[]).filter(inView);
    const vals = hold.map(h => {
      const p = priceNow(h);
      const sh = sharesOf(h);
      const a = anchors[h.symbol];
      const then = winId === 'd1' && quotes[h.symbol]
        ? quotes[h.symbol].c - quotes[h.symbol].d
        : (a ? a[winId] : null);
      return {
        symbol: h.symbol,
        name: h.name || '',
        priced: p != null,
        val: p != null ? p * sh : 0,
        ret: (p != null && then) ? (p/then - 1) * 100 : null
      };
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

  /* Which window the scatter is plotting. */
  let plotWin = 'd1';

  /* ---- scatter: weight against return ----
     Weight on the vertical, return on the horizontal, bubble area by
     weight. Drawn as inline SVG rather than a chart library so the page
     stays dependency-free and themable through CSS variables. */
  function scatter(winId){
    const all = weights(winId).filter(p => p.val > 0);
    const pts  = all.filter(p => p.ret != null);
    /* Holdings with no return for this window still hold real money, so they
       get their own gutter on the left rather than being dropped or, worse,
       drawn at 0% as though they were flat. */
    const dark = all.filter(p => p.ret == null);

    const W = 720, H = 280, PADR = 16, PADT = 16, PADB = 42;
    const GUT  = dark.length ? 66 : 0;            // "no history" lane
    const PADL = 44 + GUT;

    if(!all.length){
      return `<div class="plot-empty"><p class="empty">Nothing priced in this account yet.</p></div>`;
    }

    const rets = pts.map(p => p.ret);
    let lo = pts.length ? Math.min(...rets, 0) : -1;
    let hi = pts.length ? Math.max(...rets, 0) :  1;
    const pad = Math.max(1, (hi - lo) * 0.12);
    lo -= pad; hi += pad;

    const maxW = Math.max(...all.map(p => p.pct));
    const x = v => PADL + (v - lo) / (hi - lo) * (W - PADL - PADR);
    const y = v => H - PADB - (v / maxW) * (H - PADT - PADB);
    const r = v => Math.max(4, Math.sqrt(v / maxW) * 22);

    /* Gridlines at round-ish return values. */
    const step = niceStep(hi - lo);
    const ticks = [];
    for(let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);

    /* Spread the no-history bubbles across the gutter so they do not stack
       into one blob when several share a weight. */
    const gutX = i => 46 + ((i % 2) ? GUT * 0.62 : GUT * 0.28);

    const bubble = (p, cx, cy, cls) => `
      <g class="plot-pt ${cls}" data-sym="${esc(p.symbol)}"
         data-pct="${p.pct.toFixed(2)}" data-ret="${p.ret == null ? '' : p.ret.toFixed(2)}"
         data-name="${esc(p.name)}" tabindex="0" role="listitem"
         aria-label="${esc(p.symbol)}, ${p.pct.toFixed(1)} percent of portfolio${
           p.ret == null ? ', no return data' : `, return ${p.ret.toFixed(2)} percent`}">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r(p.pct).toFixed(1)}"></circle>
        ${p.pct >= maxW * 0.28 ? `<text class="plot-lab" x="${cx.toFixed(1)}"
              y="${(cy + 3.5).toFixed(1)}" text-anchor="middle">${esc(p.symbol)}</text>` : ''}
      </g>`;

    return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="list"
                 aria-label="Portfolio weight against return">
      ${ticks.map(t => `
        <line class="plot-grid${Math.abs(t) < 1e-9 ? ' is-zero' : ''}"
              x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${PADT}" y2="${H - PADB}"></line>
        <text class="plot-tick" x="${x(t).toFixed(1)}" y="${H - PADB + 15}"
              text-anchor="middle">${t >= 0 ? '+' : ''}${t.toFixed(step < 1 ? 1 : 0)}%</text>`).join('')}
      ${dark.length ? `
        <line class="plot-axis is-dash" x1="${PADL - 12}" x2="${PADL - 12}"
              y1="${PADT}" y2="${H - PADB}"></line>
        <text class="plot-tick" x="${(46 + GUT/2).toFixed(0)}" y="${H - PADB + 15}"
              text-anchor="middle">no history</text>` : ''}
      <line class="plot-axis" x1="${PADL}" x2="${PADL}" y1="${PADT}" y2="${H - PADB}"></line>
      <text class="plot-tick" x="6" y="${PADT + 8}">${maxW.toFixed(0)}%</text>
      <text class="plot-tick" x="6" y="${H - PADB}">0%</text>
      <text class="plot-axlab" x="6" y="${H - 6}">weight ↑ / return →</text>
      ${dark.map((p,i) => bubble(p, gutX(i), y(p.pct), 'is-dark')).join('')}
      ${pts.map(p => bubble(p, x(p.ret), y(p.pct), p.ret >= 0 ? 'up' : 'down')).join('')}
    </svg>`;
  }

  /* ---- hover tooltip ----
     An SVG <title> only gives the browser's own delayed tooltip, which cannot
     be styled and reads poorly for a chart you are scanning. This is a real
     element positioned against the plot wrapper. */
  function wireTooltip(wrap){
    const tip = wrap.querySelector('.plot-tip');
    if(!tip) return;

    const show = g => {
      const ret = g.dataset.ret;
      tip.innerHTML =
        `<b>${esc(g.dataset.sym)}</b>` +
        (g.dataset.name ? `<span class="tip-name">${esc(g.dataset.name)}</span>` : '') +
        `<span class="tip-row"><i>Return</i><em class="${ret === '' ? '' : (+ret >= 0 ? 'up' : 'down')}">${
          ret === '' ? 'no history' : (+ret >= 0 ? '+' : '−') + Math.abs(+ret).toFixed(2) + '%'}</em></span>` +
        `<span class="tip-row"><i>Of portfolio</i><em>${(+g.dataset.pct).toFixed(2)}%</em></span>`;
      tip.hidden = false;

      /* Position from the circle's real on-screen box, so it tracks the SVG's
         responsive scaling instead of assuming viewBox units are pixels. */
      const box  = g.querySelector('circle').getBoundingClientRect();
      const host = wrap.getBoundingClientRect();
      const left = box.left - host.left + box.width/2;
      const top  = box.top  - host.top;
      tip.style.left = `${left}px`;
      tip.style.top  = `${Math.max(0, top)}px`;
      /* Flip to the right of the point when it would overflow the left edge. */
      tip.classList.toggle('flip-r', left < tip.offsetWidth/2 + 6);
      tip.classList.toggle('flip-l', left > host.width - tip.offsetWidth/2 - 6);
    };

    const hide = () => { tip.hidden = true; };

    wrap.querySelectorAll('.plot-pt').forEach(g => {
      g.addEventListener('mouseenter', () => show(g));
      g.addEventListener('focus',      () => show(g));
      g.addEventListener('mouseleave', hide);
      g.addEventListener('blur',       hide);
    });
    wrap.addEventListener('mouseleave', hide);
  }

  function niceStep(span){
    const raw = span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    const n = raw / mag;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
  }

  function render(){
    const all = Store.get('holdings',[]);
    const hold = all.filter(inView);
    if(!all.length) return;

    renderAccountTabs();

    if(!hold.length){
      /* Say why, not just that. An account offered as a tab but reporting
         nothing means the label and the share lookup disagree, which is a
         data problem worth naming rather than a genuinely empty account. */
      const known = new Set();
      for(const h of all) Object.keys(h.byAccount || {}).forEach(k => known.add(k));
      const mismatch = account && known.size && !known.has(account);

      body.innerHTML = `<p class="empty">Nothing held in ${esc(account || 'this account')}.${
        mismatch ? ` The import recorded positions under ${
          [...known].map(k => `<b>${esc(k)}</b>`).join(', ')
        } — re-import the CSV to rebuild the split.` : ''}</p>`;
      return;
    }

    const hasHistory = Object.keys(anchors).length > 0;
    const needKey = !Store.get('keys.twelve','');

    const cards = WINDOWS.map(w => {
      const st = windowStats(w);
      const on = w.id === plotWin;
      if(!st){
        return `<button class="pf-card is-empty${on ? ' is-on' : ''}" data-win="${w.id}">
          <span class="pf-when">${w.label}</span>
          <span class="pf-none">${w.id === 'd1'
            ? 'Needs a Finnhub or Twelve Data key.'
            : needKey ? 'Add a Twelve Data key in Settings.'
                      : 'No history yet.'}</span>
        </button>`;
      }
      return `<button class="pf-card${on ? ' is-on' : ''}" data-win="${w.id}">
        <span class="pf-when">${w.label}</span>
        <span class="pf-pct ${st.pct >= 0 ? 'up' : 'down'}">${pctText(st.pct)}</span>
        <span class="pf-vague">${esc(vague(st.dollars))}</span>
        <div class="pf-movers">
          ${moverList(st.top,'Best')}
          ${moverList(st.bottom,'Worst')}
        </div>
        <span class="pf-count">${st.counted} of ${hold.length} counted</span>
      </button>`;
    }).join('');

    const label = WINDOWS.find(w => w.id === plotWin)?.label || '';
    const rows = weights(plotWin);
    const plotted = rows.filter(p => p.val > 0).length;

    /* A holding with no price has no weight, so the scatter has nowhere to
       put it — but it is still money the user holds, and silently dropping
       it makes the tab look like it lost positions. Name them instead. */
    const unpriced = rows.filter(p => !p.priced);
    const unpricedStrip = unpriced.length ? `
      <div class="pf-unpriced">
        <span class="mv-label">Not priced</span>
        ${unpriced.map(p => `<span class="chip" title="${esc(p.name || p.symbol)}">${esc(p.symbol)}</span>`).join('')}
        <span class="plot-key">no quote from Finnhub or Twelve Data and no price column in the
          import — re-import the CSV to price these at their export-day value</span>
      </div>` : '';

    body.innerHTML = `
      <div class="pf-grid">${cards}</div>
      <div class="plot-head">
        <h3 class="pf-h3">Weight against return — ${esc(label.toLowerCase())}</h3>
        <span class="plot-key">bubble size = share of portfolio</span>
      </div>
      <div class="plot-wrap">
        ${scatter(plotWin)}
        <div class="plot-tip" hidden></div>
      </div>
      ${unpricedStrip}
      <p class="pf-foot">${hold.length} holdings${account ? ` in ${esc(account)}` : ' across all accounts'}
        · ${plotted} plotted${unpriced.length ? ` · ${unpriced.length} unpriced` : ''} · quotes ${stampText()}${hasHistory ? ' · history current' : ''}
        · exact percentages, deliberately fuzzy dollars</p>`;

    body.querySelectorAll('[data-win]').forEach(b => b.onclick = () => {
      plotWin = b.dataset.win;
      render();
    });

    const wrap = body.querySelector('.plot-wrap');
    if(wrap) wireTooltip(wrap);

    if(stamp){
      stamp.textContent = stampText();
      stamp.title = quotedAt ? `Quotes last refreshed ${quotedAt.toLocaleString()}`
                             : 'Add a Finnhub key in Settings to price these daily';
    }
  }

  /* ---- account sub-tabs ---- */
  function renderAccountTabs(){
    const el = document.getElementById('pfAccounts');
    if(!el) return;
    const names = accountNames();
    if(names.length < 2){ el.innerHTML = ''; return; }

    const tab = (val, text) =>
      `<button class="subtab sm${account === val ? ' is-on' : ''}" data-acct="${val === null ? '' : esc(val)}">${esc(text)}</button>`;

    el.innerHTML = tab(null,'All') + names.map(n => tab(n, shortName(n))).join('');
    el.querySelectorAll('[data-acct]').forEach(b => b.onclick = () => {
      account = b.dataset.acct || null;
      render();
    });
  }

  /* "Roth_Contributory_IRA ...640" reads better as "Roth IRA 640". */
  function shortName(n){
    return n.replace(/_/g,' ')
            .replace(/\.\.\.(\d+)/, '$1')
            .replace(/Contributory /i,'')
            .trim();
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

  /* ---- coverage ----
     Why a holding is or is not on the tab, per symbol. Console tool:
     Stocks.coverage() after a load, to see exactly which positions have
     no live quote, no CSV fallback, or no Twelve Data history. */
  function coverage(log = true){
    const rows = Store.get('holdings',[]).map(h => ({
      symbol: h.symbol,
      ticker: h.ticker,
      type: h.type || '',
      quote: quotes[h.symbol]?.c ?? null,
      quoteFrom: quotes[h.symbol] ? (quotes[h.symbol].src || 'finnhub') : null,
      csvPrice: h.csvPrice ?? null,
      csvValue: h.csvValue ?? null,
      price: priceNow(h),
      history: !!anchors[h.symbol]
    }));
    const out = {
      holdings: rows.length,
      priced: rows.filter(r => r.price != null).length,
      unpriced: rows.filter(r => r.price == null).map(r => r.symbol),
      noHistory: rows.filter(r => !r.history).map(r => r.symbol),
      rows
    };
    if(log){
      console.log(`${out.priced}/${out.holdings} priced · ` +
        `${out.unpriced.length} unpriced · ${out.noHistory.length} without history`);
      if(console.table) console.table(rows);
    }
    return out;
  }

  return {
    load, ingest, parse, coverage, refresh: () => load(true),
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
