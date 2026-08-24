/* ============================================================
   ticker.js — the news crawl along the bottom.

   Carries unread mail and the day's movers. Deliberately shows no
   portfolio total: percentages and headlines only.

   The track holds two identical copies of the content and slides by
   exactly half its width, so the loop is seamless without measuring
   anything or reflowing mid-animation.
   ============================================================ */

const Ticker = (() => {
  const bar   = document.getElementById('ticker');
  const track = document.getElementById('tickerTrack');
  const tag   = document.getElementById('tickerTag');

  function items(){
    const out = [];

    /* --- mail --- */
    try{
      if(window.Mail && Mail.count){
        out.push({cls:'t-head', text:`${Mail.count} unread`});
        for(const m of Mail.unread.slice(0,12)){
          out.push({
            cls: m.important ? 't-mail t-hot' : 't-mail',
            text: `${m.important ? '❗ ' : ''}${m.from} — ${m.subject}`
          });
        }
      }
    }catch(e){ console.error('Ticker mail failed:', e); }

    /* --- movers --- */
    try{
      const movers = window.Stocks ? Stocks.movers : [];
      if(movers.length){
        out.push({cls:'t-head', text:'TODAY'});
        for(const m of movers){
          const up = m.dp >= 0;
          out.push({
            cls: up ? 't-up' : 't-down',
            text: `${m.symbol} ${up ? '▲' : '▼'} ${Math.abs(m.dp).toFixed(2)}%`
          });
        }
      }
    }catch(e){ console.error('Ticker movers failed:', e); }

    return out;
  }

  function render(){
    if(!track) return;
    const list = items();

    if(!list.length){
      track.innerHTML = '<span class="t-item t-idle">Connect Google and import a portfolio to fill this bar.</span>';
      track.style.animation = 'none';
      if(bar) bar.classList.remove('is-live');
      return;
    }

    const html = list.map(i => `<span class="t-item ${i.cls}">${esc(i.text)}</span>`).join('');
    track.innerHTML = html + html;          // two copies → seamless wrap

    /* Pace the scroll by content length so a short bar does not race. */
    const secs = Math.max(24, list.length * 4);
    track.style.animation = `crawl ${secs}s linear infinite`;
    if(bar) bar.classList.add('is-live');
    if(tag) tag.textContent = window.Mail && Mail.count ? 'INBOX · MARKETS' : 'MARKETS';
  }

  return { render };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Ticker = Ticker;
