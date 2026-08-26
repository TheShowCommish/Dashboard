/* ============================================================
   ticker.js — the two news crawls along the bottom.

   Markets and inbox are separate bars so one can be read without the
   other scrolling past. Deliberately shows no portfolio total in
   dollars: percentages and headlines only.

   Each bar has a fixed HEAD that never moves — today's portfolio move
   and its best and worst name; the three unread lamps — and a CRAWL
   that takes whatever width is left. The crawl holds two identical
   copies of its content and slides by exactly half its width, so the
   loop is seamless.

   Both crawls move at the same fixed speed in pixels per second — see
   SPEED. Matching their DURATIONS instead is the obvious thing and it is
   wrong: a mail line is roughly four times the width of a stock line, so
   equal durations mean the inbox travels four times as fast.
   ============================================================ */

const Ticker = (() => {
  const market = document.getElementById('trackMarket');
  const mail   = document.getElementById('trackMail');
  const mHead  = document.getElementById('headMarket');
  const iHead  = document.getElementById('headMail');

  /* How fast a crawl travels, in pixels a second. One number for both
     bars, which is the entire point.

     They used to be paced by ITEM COUNT — `items.length * 4` seconds —
     and that looks like it should give matching speeds because both bars
     ran the same formula. It does not, because the keyframe slides the
     track by half of ITS OWN width, and the two bars hold very different
     widths. "AAPL ▲ 1.23%" is about 110px; "❗ Priya Raghunathan — Re: Q3
     planning notes and the revised timeline" is nearer 450. Fifteen of
     each over the same sixty seconds put the inbox at 102px/s against
     the market's 27 — measurably, and visibly, close to four times
     faster.

     So: pace by the distance actually being travelled. Duration is
     width over speed, which makes speed the thing that stays fixed and
     the loop length the thing that varies — the right way round.

     27px/s is what the market bar was already doing, so that bar is
     unchanged and the inbox slows to meet it.

     No minimum duration any more. The old floor existed to stop a short
     bar racing, which was only a problem because duration was set
     without reference to width; a short bar now travels at the same
     speed as a long one and simply comes round sooner, which is what
     constant speed means. */
  const SPEED = 27;

  /* Set from the track's real width, so it must run after the content is
     in the DOM. Reading scrollWidth forces layout — twice per render, on
     two elements, which is nothing. */
  function pace(track){
    if(!track || !track.dataset.crawl) return;
    const half = track.scrollWidth / 2;       // one of the two copies
    if(!half) return;                         // not laid out yet; fonts.ready will retry
    track.style.animation = `crawl ${(half / SPEED).toFixed(1)}s linear infinite`;
  }

  function fill(track, items, idle){
    if(!track) return;
    if(!items.length){
      track.innerHTML = `<span class="t-item t-idle">${esc(idle)}</span>`;
      track.style.animation = 'none';
      delete track.dataset.crawl;
      return;
    }
    const html = items.map(i => `<span class="t-item ${i.cls}">${esc(i.text)}</span>`).join('');
    track.innerHTML = html + html;             // two copies → seamless wrap
    track.dataset.crawl = '1';
    pace(track);
  }

  const pct = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
  const dir = n => n >= 0 ? 't-up' : 't-down';

  /* ---- market ----
     The head answers the only three questions worth a fixed slot: how is
     the whole thing doing today, what is carrying it, what is dragging it. */
  function marketHead(){
    if(!mHead) return;
    const movers = (() => {
      try{ return (window.Stocks ? Stocks.movers : []) || []; }
      catch(e){ console.error('Ticker markets failed:', e); return []; }
    })();

    if(!movers.length){
      mHead.innerHTML = '';
      mHead.hidden = true;
      return;
    }
    mHead.hidden = false;

    const day = window.Stocks && Stocks.today ? Stocks.today() : null;
    const best  = movers.reduce((a,b) => b.dp > a.dp ? b : a);
    const worst = movers.reduce((a,b) => b.dp < a.dp ? b : a);

    mHead.innerHTML = `
      ${day != null ? `<span class="t-total ${dir(day)}">
        <i>TODAY</i><b>${pct(day)}</b></span>` : ''}
      <span class="t-pick t-up"><i>BEST</i><b>${esc(best.symbol)}</b><em>${pct(best.dp)}</em></span>
      <span class="t-pick t-down"><i>WORST</i><b>${esc(worst.symbol)}</b><em>${pct(worst.dp)}</em></span>`;
  }

  function marketItems(){
    try{
      return (window.Stocks ? Stocks.movers : []).map(m => ({
        cls: dir(m.dp),
        text: `${m.symbol} ${m.dp >= 0 ? '▲' : '▼'} ${Math.abs(m.dp).toFixed(2)}%`
      }));
    }catch(e){ console.error('Ticker markets failed:', e); return []; }
  }

  /* ---- inbox ----
     Three lamps: needs-you, ordinary, spam. Unlit is an outline and a
     zero; anything unread lights it. */
  const ICONS = {
    important: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.6 2.4 20.4h19.2L12 3.6Z"/>
        <path class="mk" d="M12 9.6v4.6" stroke-linecap="round"/>
        <circle class="mk dot" cx="12" cy="17" r="1.05"/>
      </svg>`,
    normal: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.6" y="5.2" width="18.8" height="13.6" rx="2.2"/>
        <path class="mk" d="m3.4 7 8.6 6.2L20.6 7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    spam: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5.2" y="7.4" width="13.6" height="12.4" rx="1.6"/>
        <path class="mk" d="M5.2 10.6h13.6"/>
        <path d="M8.4 7.4V5.6a1.2 1.2 0 0 1 1.2-1.2h4.8a1.2 1.2 0 0 1 1.2 1.2v1.8"/>
        <path class="mk" d="M9.6 14h4.8" stroke-linecap="round"/>
      </svg>`
  };

  function inboxHead(){
    if(!iHead) return;
    const c = (window.Mail && Mail.counts) || {important:0, normal:0, spam:0};

    const lamp = (key, label, n) => `
      <span class="t-lamp t-${key}${n > 0 ? ' is-lit' : ''}" title="${label}: ${n} unread">
        ${ICONS[key]}<b>${n}</b>
      </span>`;

    iHead.innerHTML =
      lamp('important','Important', c.important) +
      lamp('normal','Normal', c.normal) +
      lamp('spam','Spam', c.spam);
  }

  function mailItems(){
    try{
      if(!window.Mail || !Mail.count) return [];
      return Mail.unread.slice(0,15).map(m => ({
        cls: m.important ? 't-mail t-hot' : 't-mail',
        text: `${m.important ? '❗ ' : ''}${m.from} — ${m.subject}`
      }));
    }catch(e){ console.error('Ticker mail failed:', e); return []; }
  }

  function render(){
    marketHead();
    inboxHead();
    fill(market, marketItems(), 'Import a portfolio to fill this bar.');
    fill(mail,   mailItems(),   'Connect Google to see unread mail here.');
  }

  /* The bars are usually filled before the mono webfont has arrived, and
     a fallback face measures differently — enough to have one bar
     noticeably off the other, which is the bug this whole thing is
     about. So measure again once the real font is in. */
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => { pace(market); pace(mail); }).catch(() => {});
  }

  return { render };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Ticker = Ticker;
