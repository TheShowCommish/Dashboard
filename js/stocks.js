/* ============================================================
   stocks.js — portfolio value + earnings dates.

   The CSV is an occasional import, not a live feed. It is read once to
   learn *what you hold* — symbol, share count, cost basis — and then
   thrown away; Finnhub prices those holdings daily from then on. Re-import
   only when your positions actually change.

   Understands two shapes:
     1. A Schwab "All-Accounts Positions" export (multiple account
        sections, $ and % formatting, a Positions Total row).
     2. A plain sheet with symbol / shares / cost columns.

   Schwab's "Cost Basis" column is the TOTAL dollars in a position, not a
   per-share price — mixing those up inflates cost by the share count, so
   cost is stored as a total throughout.
   ============================================================ */

const Stocks = (() => {
  const body     = document.getElementById('portBody');
  const earnBody = document.getElementById('earnBody');
  const stamp    = document.getElementById('pfUpdated');

  let quotes = {};        // { SYMBOL: {c, d, dp} }
  let quotedAt = null;    // Date of the last successful pricing run

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

  /* Finnhub wants a dot, Schwab writes a slash: BRK/B → BRK.B */
  const tickerFor = s => s.replace(/\//g,'.');

  const isSchwab = text => /"?Symbol"?\s*,\s*"?Description"?/i.test(text)
                        && /Mkt Val|Qty \(Quantity\)/i.test(text);

  /* ---- Schwab export ---- */
  function parseSchwab(text){
    const lines = text.split(/\r?\n/);
    const rows = [];
    const accounts = [];
    let account = 'Portfolio', head = null, asOf = '';

    const idx = cells => {
      const h = cells.map(c => clean(c).toLowerCase());
      const find = re => h.findIndex(x => re.test(x));
      return {
        sym:  find(/^symbol$/),
        desc: find(/^description$/),
        qty:  find(/^qty/),
        price:find(/^price$/),
        val:  find(/^mkt val/),
        dayD: find(/^day chng \$/),
        cost: find(/^cost basis/),
        type: find(/^asset type/)
      };
    };

    for(const raw of lines){
      const line = raw.trim();
      if(!line) continue;

      /* Title line, quoted and containing a comma, so it splits to one cell
         exactly like an account header does — test it first. */
      const title = line.match(/Positions for .*? as of (.+?)"?$/i);
      if(title){ asOf = title[1].trim(); continue; }

      const cells = splitRow(line);

      if(cells.length === 1){ account = clean(cells[0]); continue; }
      if(/^symbol$/i.test(clean(cells[0]))){ head = idx(cells); continue; }
      if(!head) continue;

      const symbol = clean(cells[head.sym]);
      if(!symbol || /^positions total/i.test(symbol)) continue;

      const value = money(cells[head.val]);

      if(/^cash/i.test(symbol)){
        accounts.push({name:account, cash:value || 0});
        continue;
      }

      const shares = money(cells[head.qty]);
      if(!shares) continue;

      rows.push({
        symbol,
        ticker: tickerFor(symbol),
        name:   clean(cells[head.desc]),
        shares,
        cost:   money(cells[head.cost]) || 0,     // total dollars, not per share
        csvPrice: money(cells[head.price]),
        csvValue: value,
        type:   clean(cells[head.type]),
        account
      });
    }

    if(!rows.length) throw new Error('no positions found in that export');
    return {rows, accounts, asOf};
  }

  /* ---- plain sheet ---- */
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
      /* Here "cost" is conventionally per-share, so scale it to a total to
         match the Schwab path. */
      const per = iCo >= 0 ? (money(c[iCo]) || 0) : 0;
      return {symbol, ticker:tickerFor(symbol), name:'', shares,
              cost: per * shares, csvPrice:null, csvValue:null, type:'', account:'Portfolio'};
    }).filter(h => h.symbol && h.shares > 0);

    if(!rows.length) throw new Error('no valid rows found');
    return {rows, accounts:[], asOf:''};
  }

  /* One position per symbol. The same holding across two accounts is one
     quote lookup, not two. */
  function merge(rows){
    const by = new Map();
    for(const r of rows){
      const k = r.symbol;
      if(!by.has(k)) by.set(k, {...r, accounts:[r.account]});
      else{
        const m = by.get(k);
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
        Store.set('portfolio.meta', {
          asOf, accounts,
          cash: accounts.reduce((s,a) => s + (a.cash||0), 0),
          importedAt: new Date().toISOString()
        });
        Store.set('portfolio.quotes', null);          // force a fresh pricing run
        quotes = {}; quotedAt = null;
        Store.toast(`Imported ${holdings.length} holdings from ${positions} positions` +
                    `${accounts.length ? ` across ${accounts.length} accounts` : ''}.`);
        await load(true);
      }catch(e){
        Store.toast(`CSV problem: ${e.message}.`);
      }
    };
    r.readAsText(file);
  }

  /* ---- daily pricing ---- */
  function restore(){
    const c = Store.get('portfolio.quotes', null);
    if(!c || !c.quotes) return false;
    quotes = c.quotes;
    quotedAt = c.at ? new Date(c.at) : null;
    return true;
  }

  const sameDay = (a,b) => a && b && a.toDateString() === b.toDateString();

  async function load(force = false){
    const hold = Store.get('holdings',[]);
    if(!hold.length){
      return tileError(body,'Upload your positions CSV to get started — ' +
        'a Schwab All-Accounts export, or any sheet with symbol and shares columns.');
    }

    const key = Store.get('keys.finnhub','');
    if(!force){
      restore();
      if(quotedAt && sameDay(quotedAt, new Date())){
        render();                       // already priced today
        loadEarnings();
        return;
      }
      if(Object.keys(quotes).length) render();   // show yesterday while refreshing
    }

    if(!key){
      render();                         // falls back to import-time values
      return;
    }

    if(!Object.keys(quotes).length) body.innerHTML = '<p class="empty">Pricing holdings…</p>';

    /* Finnhub's free tier allows 60 calls a minute. Small parallel batches
       stay under that while not taking 40 seconds serially. */
    const fresh = {};
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
      Store.set('portfolio.quotes', {at: quotedAt.toISOString(), quotes});
    }else if(!Object.keys(quotes).length){
      Store.toast('No quotes came back from Finnhub — check the key in Settings.');
    }

    render();
    loadEarnings();
  }

  /* ---- render ---- */
  function stampText(){
    if(!quotedAt) return 'not priced';
    return sameDay(quotedAt, new Date())
      ? quotedAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
      : quotedAt.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }

  const usd = (n, dp = 0) =>
    `$${Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:dp, maximumFractionDigits:dp})}`;
  const signed = (n, dp = 0) => `${n >= 0 ? '+' : '−'}${usd(n, dp)}`;

  function render(){
    const hold = Store.get('holdings',[]);
    const meta = Store.get('portfolio.meta',{}) || {};
    if(!hold.length) return;

    let value = 0, dayPL = 0, cost = 0, live = 0;

    const priced = hold.map(h => {
      const q = quotes[h.symbol];
      const price = q ? q.c : h.csvPrice;
      const val   = price != null ? price * h.shares
                  : (h.csvValue != null ? h.csvValue : 0);
      if(q) live++;
      value += val;
      cost  += h.cost || 0;
      if(q) dayPL += (q.d || 0) * h.shares;
      return {...h, price, val, dp: q ? q.dp : null, isLive: !!q};
    }).sort((a,b) => b.val - a.val);

    const cash = meta.cash || 0;
    const total = value + cash;
    const gain = cost > 0 ? value - cost : null;
    const gainPct = cost > 0 ? (value - cost) / cost * 100 : null;

    const rows = priced.map(h => {
      const cls = h.dp == null ? '' : h.dp >= 0 ? 'up' : 'down';
      const move = h.dp == null ? '<span class="row-sub">stale</span>'
                 : `<span class="${cls}">${h.dp >= 0 ? '+' : ''}${h.dp.toFixed(2)}%</span>`;
      const sh = h.shares % 1 === 0 ? h.shares : h.shares.toFixed(3);
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${esc(h.symbol)}${
            h.accounts && h.accounts.length > 1
              ? ` <span class="row-sub">×${h.accounts.length} accts</span>` : ''}</span>
          <span class="row-sub">${sh} sh${h.price != null ? ` @ ${usd(h.price,2)}` : ''}</span>
        </span>
        <span class="row-side">${usd(h.val)}<br>${move}</span>
      </div>`;
    }).join('');

    const dCls = dayPL >= 0 ? 'up' : 'down';
    const gCls = (gain ?? 0) >= 0 ? 'up' : 'down';

    body.innerHTML = `
      <div class="wx-now" style="align-items:baseline">
        <span class="wx-temp">${usd(total)}</span>
        <span class="wx-meta">
          <strong class="${dCls}">${signed(dayPL)} today</strong>
          ${gain != null
            ? `<span class="${gCls}">${signed(gain)} all time (${gainPct >= 0 ? '+' : '−'}${Math.abs(gainPct).toFixed(1)}%)</span>`
            : ''}
        </span>
      </div>
      <p class="pf-foot">${live} of ${hold.length} priced ${
        quotedAt ? `· quotes ${stampText()}` : '· using import-time prices'}${
        cash ? ` · ${usd(cash)} cash` : ''}${
        meta.asOf ? ` · imported ${esc(meta.asOf)}` : ''}</p>
      ${rows}`;

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
      const mine = (d.earningsCalendar||[])
        .filter(e => syms.has(e.symbol))
        .sort((a,b) => a.date.localeCompare(b.date));

      if(!mine.length) return tileError(earnBody,'No earnings dates in the next 45 days for your holdings.');

      earnBody.innerHTML = mine.slice(0,12).map(e => {
        const days = Math.round((new Date(e.date+'T12:00:00') - Date.now())/864e5);
        const cls = days <= 3 ? 'hot' : days <= 10 ? 'warn' : '';
        return `<div class="row">
          <span class="row-main">
            <span class="row-title">${esc(e.symbol)}</span>
            <span class="row-sub">${new Date(e.date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}
              ${e.hour==='bmo'?'· before open':e.hour==='amc'?'· after close':''}</span>
          </span>
          <span class="row-side">
            ${e.epsEstimate!=null?`est ${e.epsEstimate}`:''}
            <span class="chip ${cls}">${days}d</span>
          </span></div>`;
      }).join('');
    }catch(e){
      tileError(earnBody,`Earnings calendar unavailable (${esc(e.message)}). Some Finnhub plans restrict this endpoint.`);
    }
  }

  return { load, ingest, parse, refresh: () => load(true) };
})();
