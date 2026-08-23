/* ============================================================
   stocks.js — portfolio value + earnings dates, via Finnhub.
   CSV columns accepted (header row required, order flexible):
     symbol | shares | cost        (cost = per-share cost basis, optional)
   ============================================================ */

const Stocks = (() => {
  const body     = document.getElementById('portBody');
  const earnBody = document.getElementById('earnBody');
  let quotes = {};

  /* ---- CSV ---- */
  function parseCSV(text){
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2) throw new Error('needs a header row and at least one holding');

    const head = splitRow(lines[0]).map(h => h.toLowerCase().trim());
    const iSym = head.findIndex(h => /^(symbol|ticker|stock)$/.test(h));
    const iSh  = head.findIndex(h => /^(shares|qty|quantity|units)$/.test(h));
    const iCo  = head.findIndex(h => /(cost|basis|price paid|avg)/.test(h));
    if(iSym < 0 || iSh < 0) throw new Error('needs columns named "symbol" and "shares"');

    return lines.slice(1).map(splitRow).map(c => ({
      symbol: (c[iSym]||'').toUpperCase().trim(),
      shares: num(c[iSh]),
      cost:   iCo >= 0 ? num(c[iCo]) : 0
    })).filter(h => h.symbol && h.shares > 0);
  }

  function splitRow(line){
    // handles quoted fields containing commas
    const out = []; let cur = '', q = false;
    for(const ch of line){
      if(ch === '"') q = !q;
      else if(ch === ',' && !q){ out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  const num = v => parseFloat(String(v??'').replace(/[$,\s]/g,'')) || 0;

  function ingest(file){
    const r = new FileReader();
    r.onload = () => {
      try{
        const rows = parseCSV(r.result);
        if(!rows.length) throw new Error('no valid rows found');
        Store.set('holdings', rows);
        Store.toast(`Loaded ${rows.length} holdings.`);
        load();
      }catch(e){
        Store.toast(`CSV problem: ${e.message}.`);
      }
    };
    r.readAsText(file);
  }

  /* ---- quotes ---- */
  async function load(){
    const key = Store.get('keys.finnhub','');
    const hold = Store.get('holdings',[]);
    if(!hold.length) return tileError(body,'Upload a CSV with columns: symbol, shares, cost.');
    if(!key) return tileError(body,'Add a Finnhub key in Settings to price these holdings.');

    body.innerHTML = '<p class="empty">Pricing holdings…</p>';
    quotes = {};

    // Finnhub free tier is 60 calls/min — request in small batches.
    for(const h of hold){
      try{
        quotes[h.symbol] = await getJSON(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(h.symbol)}&token=${key}`);
      }catch{ quotes[h.symbol] = null; }
    }
    render();
    loadEarnings();
  }

  function render(){
    const hold = Store.get('holdings',[]);
    let value = 0, dayPL = 0, costTotal = 0, priced = 0;

    const rows = hold.map(h => {
      const q = quotes[h.symbol];
      if(!q || !q.c) return `<div class="row"><span class="row-main">
        <span class="row-title">${esc(h.symbol)}</span>
        <span class="row-sub">${h.shares} sh · no quote</span></span></div>`;

      priced++;
      const val = q.c * h.shares;
      value    += val;
      dayPL    += (q.d||0) * h.shares;
      costTotal += h.cost * h.shares;

      const cls = (q.dp||0) >= 0 ? 'up' : 'down';
      const sign = (q.dp||0) >= 0 ? '+' : '';
      return `<div class="row">
        <span class="row-main">
          <span class="row-title">${esc(h.symbol)}</span>
          <span class="row-sub">${h.shares} sh @ $${q.c.toFixed(2)}</span>
        </span>
        <span class="row-side">
          $${val.toLocaleString(undefined,{maximumFractionDigits:0})}<br>
          <span class="${cls}">${sign}${(q.dp||0).toFixed(2)}%</span>
        </span></div>`;
    }).join('');

    const dCls = dayPL >= 0 ? 'up' : 'down';
    const totCls = value - costTotal >= 0 ? 'up' : 'down';
    const totalLine = costTotal > 0
      ? `<span class="row-sub ${totCls}">Total ${value-costTotal >= 0?'+':''}$${Math.abs(value-costTotal).toLocaleString(undefined,{maximumFractionDigits:0})}</span>`
      : '';

    body.innerHTML = `
      <div class="wx-now" style="align-items:baseline">
        <span class="wx-temp">$${value.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
        <span class="wx-meta">
          <strong class="${dCls}">${dayPL>=0?'+':'−'}$${Math.abs(dayPL).toLocaleString(undefined,{maximumFractionDigits:0})} today</strong>
          ${priced} of ${hold.length} priced
          ${totalLine}
        </span>
      </div>${rows}`;
  }

  /* ---- earnings ---- */
  async function loadEarnings(){
    const key = Store.get('keys.finnhub','');
    const syms = new Set(Store.get('holdings',[]).map(h => h.symbol));
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
      tileError(earnBody,`Earnings calendar unavailable (${e.message}). Some Finnhub plans restrict this endpoint.`);
    }
  }

  return { load, ingest };
})();
