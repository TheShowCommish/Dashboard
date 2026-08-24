/* ============================================================
   ticker.js — the two news crawls along the bottom.

   Markets and inbox are separate bars so one can be read without the
   other scrolling past. Deliberately shows no portfolio total:
   percentages and headlines only.

   Each track holds two identical copies of its content and slides by
   exactly half its width, so the loop is seamless without measuring
   anything or reflowing mid-animation.
   ============================================================ */

const Ticker = (() => {
  const market = document.getElementById('trackMarket');
  const mail   = document.getElementById('trackMail');

  function fill(track, items, idle){
    if(!track) return;
    if(!items.length){
      track.innerHTML = `<span class="t-item t-idle">${esc(idle)}</span>`;
      track.style.animation = 'none';
      return;
    }
    const html = items.map(i => `<span class="t-item ${i.cls}">${esc(i.text)}</span>`).join('');
    track.innerHTML = html + html;             // two copies → seamless wrap

    /* Pace by content length so a short bar does not race. */
    track.style.animation = `crawl ${Math.max(24, items.length * 4)}s linear infinite`;
  }

  function marketItems(){
    try{
      return (window.Stocks ? Stocks.movers : []).map(m => ({
        cls: m.dp >= 0 ? 't-up' : 't-down',
        text: `${m.symbol} ${m.dp >= 0 ? '▲' : '▼'} ${Math.abs(m.dp).toFixed(2)}%`
      }));
    }catch(e){ console.error('Ticker markets failed:', e); return []; }
  }

  function mailItems(){
    try{
      if(!window.Mail || !Mail.count) return [];
      return [{cls:'t-head', text:`${Mail.count} unread`}].concat(
        Mail.unread.slice(0,15).map(m => ({
          cls: m.important ? 't-mail t-hot' : 't-mail',
          text: `${m.important ? '❗ ' : ''}${m.from} — ${m.subject}`
        })));
    }catch(e){ console.error('Ticker mail failed:', e); return []; }
  }

  function render(){
    fill(market, marketItems(), 'Import a portfolio to fill this bar.');
    fill(mail,   mailItems(),   'Connect Google to see unread mail here.');
  }

  return { render };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Ticker = Ticker;
