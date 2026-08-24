/* ============================================================
   sky.js — the weather on screen.

   TWO canvases, one animation loop:

     #sky        sits BEHIND the deck and draws the theme's ambient —
                 stars, clouds, confetti and the rest.
     #skyFront   sits IN FRONT of it (under the popups) and draws the
                 things that have to be on top of the panels to read as
                 weather at all: falling snow and the drifts it leaves on
                 every card, rain and the drips running off their bottom
                 edges, the puddle, the lens flare, the lightning.

   Drawing the drifts behind the deck was the bug that made snow skip the
   calendar and the news list: a drift sitting on the top edge of one cell
   is behind the cell above it.

   Respects prefers-reduced-motion: one static pass and no loop.
   ============================================================ */

const Sky = (() => {
  const cv = document.getElementById('sky');
  const cx = cv.getContext('2d');

  /* The front canvas is created here rather than in the markup so this
     file owns both layers and nothing else has to know about the second. */
  const fv = (() => {
    let el = document.getElementById('skyFront');
    if(!el){
      el = document.createElement('canvas');
      el.id = 'skyFront';
      document.body.appendChild(el);
    }
    return el;
  })();
  const fx2 = fv.getContext('2d');

  let mode = 'none';          // theme ambient
  let fx   = new Set();       // snow | rain | sun | wind | lightning
  let bits = [], drops = [], flakes = [], ripples = [], gusts = [], drips = [];
  let raf = null, flash = 0, nextBolt = 0, bolt = null;
  let piles = [], pilesAt = 0;
  let t = 0;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size(){
    for(const [el, ctx] of [[cv, cx], [fv, fx2]]){
      el.width  = el.clientWidth  * devicePixelRatio;
      el.height = el.clientHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    }
  }
  addEventListener('resize', () => { size(); seed(); seedFx(); piles = []; });

  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  const rnd = (a,b) => a + Math.random()*(b-a);

  function accent(){
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#888';
  }

  /* ---- ambient seeding (theme-named) ---- */
  function seed(){
    bits = [];
    const n = { rain:190, storm:240, snow:130, stars:150, clouds:9, fog:7, clear:1, confetti:120 }[mode] || 0;
    for(let i=0;i<n;i++){
      if(mode==='rain'||mode==='storm')
        bits.push({x:rnd(0,W()),y:rnd(-H(),H()),l:rnd(9,20),v:rnd(7,13)});
      else if(mode==='snow')
        bits.push({x:rnd(0,W()),y:rnd(-H(),H()),r:rnd(1.2,3.2),v:rnd(.4,1.4),d:rnd(0,6.3)});
      else if(mode==='stars')
        bits.push({x:rnd(0,W()),y:rnd(0,H()),r:rnd(.4,1.5),p:rnd(0,6.3),s:rnd(.008,.03)});
      else if(mode==='clouds'||mode==='fog')
        bits.push({x:rnd(-200,W()),y:rnd(0,H()*.65),w:rnd(220,460),h:rnd(60,130),v:rnd(.05,.22)});
      else if(mode==='confetti')
        bits.push({x:rnd(0,W()),y:rnd(-H(),0),w:rnd(4,9),h:rnd(6,13),
                   v:rnd(1.5,4),a:rnd(0,6.3),s:rnd(-.08,.08),
                   c:['#37E27C','#F2B705','#5AA9E6','#FF6B6B','#FFFFFF'][i%5]});
    }
  }

  /* ---- effect seeding ---- */
  function seedFx(){
    if(fx.has('rain') && drops.length !== 220)
      drops = Array.from({length:220}, () => ({x:rnd(0,W()), y:rnd(-H(),H()), l:rnd(10,22), v:rnd(9,16)}));
    if(!fx.has('rain')){ drops = []; ripples = []; drips = []; }

    if(fx.has('snow') && flakes.length !== 170)
      flakes = Array.from({length:170}, () => ({x:rnd(0,W()), y:rnd(-H(),H()),
                                                r:rnd(1.1,3.4), v:rnd(.5,1.6), d:rnd(0,6.3)}));
    if(!fx.has('snow')) flakes = [];

    if(fx.has('wind') && gusts.length !== 26)
      gusts = Array.from({length:26}, () => ({x:rnd(0,W()), y:rnd(0,H()), l:rnd(40,160), v:rnd(4,11), a:rnd(.05,.18)}));
    if(!fx.has('wind')) gusts = [];
  }

  /* ---- what the weather lands on ----
     Everything that reads as a physical thing on the deck. Measured a
     couple of times a second rather than every frame: this is the one
     thing here that could cost a frame. */
  const LAND_ON = [
    '.gc', '.pf-card', '.cal-day', '.ff-board', '.tm-hero', '.note',
    '.wx-now-card', '.td-row', '.nw', '.row-btn', '.plot-wrap', '.mv-seen-row',
    '.subtab', '.ticker', '.wx-hour', '.mv-diary', '.tm-games', '.tm-news',
    /* The poster SHELF, not the posters: the cards inside are moving, and
       a drift measured off a moving card twitches every time it is
       re-measured. The shelf is the box they sit in, so the snow settles
       on its top edge above the heading, the way it would on a ledge. */
    '.mv-strip', '.sp-card', '.sp-mini', '.sp-panel'
  ].join(', ');

  function measurePiles(){
    if(Date.now() - pilesAt < 600) return;
    pilesAt = Date.now();

    const seen = [];
    const els = document.querySelectorAll(LAND_ON);
    for(let i = 0; i < els.length && seen.length < 110; i++){
      const el = els[i];
      const r = el.getBoundingClientRect();
      if(r.width < 36 || r.height < 14) continue;
      if(r.top < 0 || r.top > H() - 4) continue;
      /* Snow slides off a rounded corner rather than sitting out over the
         gap, so the drift starts and ends at the corner radius. */
      const rad = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 3);
      seen.push({x:r.left, y:r.top, w:r.width, b:r.bottom, rad});
    }

    /* Depth carries across measurements by position, so a repaint of the
       page does not dump the snow that has already settled on it. */
    piles = seen.map(s => {
      const was = piles.find(p => Math.abs(p.x - s.x) < 6 && Math.abs(p.y - s.y) < 6);
      return {...s, d: was ? was.d : 0, seed: was ? was.seed : Math.random()*100};
    });
  }

  /* A drift, not a plank: the depth tapers to nothing at both ends and the
     top is drawn as a run of curves rather than straight segments. */
  function drawPiles(){
    fx2.fillStyle = 'rgba(255,255,255,.94)';
    for(const p of piles){
      if(p.d < 8) p.d += 0.012;                // settles over about ten minutes
      if(p.d < .5) continue;

      /* Inset by the corner radius: past that point the surface is curving
         away underneath and the snow has nothing to sit on. */
      const rad = p.rad || 0;
      const x0 = p.x + rad * .55, x1 = p.x + p.w - rad * .55;
      const span = Math.max(8, x1 - x0);

      const steps = Math.max(8, Math.round(span / 16));
      const pts = [];
      for(let i = 0; i <= steps; i++){
        const f = i / steps;
        /* Flat across the middle, rolling off over the last eighth at each
           end — a drift, not a dome. */
        const edge = Math.min(1, Math.min(f, 1 - f) / .12);
        const taper = edge * edge * (3 - 2 * edge);          // smoothstep
        const lump  = (Math.sin(p.seed + f * 9) * .22 + Math.sin(p.seed * 1.7 + f * 21) * .12);
        pts.push({x: x0 + span * f, y: p.y + 1 - Math.max(0, p.d * taper * (1 + lump))});
      }

      fx2.beginPath();
      fx2.moveTo(pts[0].x, p.y + 1);
      for(let i = 0; i < pts.length - 1; i++){
        const a = pts[i], b = pts[i+1];
        fx2.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      fx2.lineTo(pts[pts.length-1].x, p.y + 1);
      fx2.closePath();
      fx2.fill();
    }
  }

  /* ---- rain ---- */
  const puddleH = () => Math.min(120, H() * .13);

  function drawRain(){
    fx2.strokeStyle = 'rgba(170,205,240,.45)';
    fx2.lineWidth = 1.1;
    for(const b of drops){
      fx2.beginPath(); fx2.moveTo(b.x, b.y); fx2.lineTo(b.x - 2, b.y + b.l); fx2.stroke();
      b.y += b.v; b.x -= .5;
      if(b.y > H() - puddleH()){
        if(ripples.length < 40 && Math.random() < .35)
          ripples.push({x:b.x, y:H() - rnd(0, puddleH()), r:1, a:.5});
        b.y = -20; b.x = rnd(0, W());
      }
    }
  }

  /* Water gathers on a panel and runs off its bottom edge. Spawned from
     the same rectangles the snow settles on. */
  function drawDrips(){
    if(piles.length && drips.length < 60 && Math.random() < .5){
      const p = piles[Math.floor(Math.random() * piles.length)];
      if(p.b < H() - 4)
        drips.push({x: p.x + rnd(6, Math.max(7, p.w - 6)), y: p.b, v: .4, r: rnd(1.3, 2.4), hang: rnd(10, 40)});
    }

    fx2.fillStyle = 'rgba(185,215,245,.75)';
    for(let i = drips.length - 1; i >= 0; i--){
      const d = drips[i];
      if(d.hang > 0){ d.hang--; }              // swells on the edge first
      else { d.v += .35; d.y += d.v; }

      fx2.beginPath();
      /* A teardrop: round at the bottom, drawn out at the top while falling. */
      fx2.ellipse(d.x, d.y, d.r, d.r * (d.hang > 0 ? 1 : 1.9), 0, 0, 6.3);
      fx2.fill();

      if(d.y > H() - puddleH() * .4){
        if(ripples.length < 40) ripples.push({x:d.x, y:d.y, r:1, a:.45});
        drips.splice(i, 1);
      }
    }
  }

  function drawPuddle(){
    const h = puddleH(), top = H() - h;

    /* A canvas cannot mirror live DOM, so the reflection is a gradient
       standing in for one — the ripples are what sell it as water. */
    const g = fx2.createLinearGradient(0, top, 0, H());
    g.addColorStop(0, 'rgba(120,160,200,0)');
    g.addColorStop(.35, 'rgba(120,160,200,.10)');
    g.addColorStop(1, 'rgba(150,190,230,.24)');
    fx2.fillStyle = g;
    fx2.fillRect(0, top, W(), h);

    const a = fx2.createRadialGradient(W()*.5, H(), 4, W()*.5, H(), W()*.6);
    a.addColorStop(0, accent() + '3A');
    a.addColorStop(1, 'transparent');
    fx2.fillStyle = a;
    fx2.fillRect(0, top, W(), h);

    fx2.strokeStyle = 'rgba(200,225,255,.35)';
    fx2.lineWidth = 1;
    for(let i = ripples.length - 1; i >= 0; i--){
      const r = ripples[i];
      fx2.globalAlpha = r.a;
      fx2.beginPath();
      fx2.ellipse(r.x, r.y, r.r, r.r * .28, 0, 0, 6.3);
      fx2.stroke();
      r.r += .9; r.a -= .012;
      if(r.a <= 0) ripples.splice(i, 1);
    }
    fx2.globalAlpha = 1;
  }

  /* ---- sun: a source off the top-right, and flares down the axis ---- */
  function drawFlare(){
    const sx = W() * .88, sy = H() * .10;
    const midX = W() / 2, midY = H() / 2;
    const pulse = 1 + Math.sin(t / 42) * .07;

    /* The wash goes behind the deck so it warms the whole page; the flare
       itself goes in front, which is the part that reads as glare. */
    const wash = cx.createRadialGradient(sx, sy, 8, sx, sy, Math.max(W(), H()) * .75);
    wash.addColorStop(0, 'rgba(255,238,190,.85)');
    wash.addColorStop(.18, 'rgba(255,224,150,.34)');
    wash.addColorStop(.55, 'rgba(255,214,140,.10)');
    wash.addColorStop(1, 'transparent');
    cx.fillStyle = wash;
    cx.fillRect(0, 0, W(), H());

    const core = fx2.createRadialGradient(sx, sy, 4, sx, sy, 190 * pulse);
    core.addColorStop(0, 'rgba(255,252,235,.75)');
    core.addColorStop(.35, 'rgba(255,231,160,.22)');
    core.addColorStop(1, 'transparent');
    fx2.fillStyle = core;
    fx2.beginPath(); fx2.arc(sx, sy, 190 * pulse, 0, 6.3); fx2.fill();

    /* Starburst spokes. */
    fx2.save();
    fx2.translate(sx, sy);
    fx2.strokeStyle = 'rgba(255,244,205,.30)';
    for(let i = 0; i < 12; i++){
      const len = (i % 2 ? 90 : 175) * pulse;
      fx2.lineWidth = i % 2 ? 1.2 : 2.4;
      fx2.rotate(Math.PI / 6);
      fx2.beginPath(); fx2.moveTo(0, 0); fx2.lineTo(len, 0); fx2.stroke();
    }
    fx2.restore();

    /* Ghosts march from the source through the centre and out the far
       side, which is what a real flare does. */
    const ghosts = [
      {t:-0.30, r:20, a:.22, c:'255,220,160'},
      {t: 0.30, r:44, a:.15, c:'160,220,255'},
      {t: 0.62, r:26, a:.20, c:'255,180,140'},
      {t: 0.95, r:74, a:.11, c:'190,255,210'},
      {t: 1.30, r:34, a:.16, c:'255,240,190'},
      {t: 1.60, r:16, a:.20, c:'255,255,240'}
    ];
    for(const gh of ghosts){
      const gx = sx + (midX - sx) * gh.t * 2;
      const gy = sy + (midY - sy) * gh.t * 2;
      const rad = gh.r * pulse;
      const g = fx2.createRadialGradient(gx, gy, 0, gx, gy, rad);
      g.addColorStop(0, `rgba(${gh.c},${gh.a})`);
      g.addColorStop(.7, `rgba(${gh.c},${gh.a * .35})`);
      g.addColorStop(1, 'transparent');
      fx2.fillStyle = g;
      fx2.beginPath(); fx2.arc(gx, gy, rad, 0, 6.3); fx2.fill();
    }

    /* The anamorphic streak. */
    const s = fx2.createLinearGradient(0, sy, W(), sy);
    s.addColorStop(0, 'transparent');
    s.addColorStop(.5, 'rgba(255,235,190,.13)');
    s.addColorStop(1, 'transparent');
    fx2.fillStyle = s;
    fx2.fillRect(0, sy - 4, W(), 8);
  }

  /* ---- wind ---- */
  function drawWind(){
    fx2.strokeStyle = 'rgba(210,225,245,.16)';
    fx2.lineWidth = 1;
    for(const g of gusts){
      fx2.globalAlpha = g.a;
      fx2.beginPath();
      fx2.moveTo(g.x, g.y);
      fx2.quadraticCurveTo(g.x + g.l * .5, g.y - 6, g.x + g.l, g.y);
      fx2.stroke();
      g.x += g.v;
      if(g.x > W() + g.l){ g.x = -g.l; g.y = rnd(0, H()); }
    }
    fx2.globalAlpha = 1;
  }

  /* ---- lightning ---- */
  function drawLightning(){
    if(flash > 0){
      fx2.fillStyle = `rgba(226,232,255,${flash * .5})`;
      fx2.fillRect(0, 0, W(), H());
      if(bolt){
        fx2.strokeStyle = `rgba(255,255,255,${Math.min(1, flash * 1.6)})`;
        fx2.lineWidth = 2.4;
        fx2.beginPath();
        fx2.moveTo(bolt[0].x, bolt[0].y);
        for(const p of bolt.slice(1)) fx2.lineTo(p.x, p.y);
        fx2.stroke();
      }
      flash -= .055;
      if(flash <= 0) bolt = null;
      return;
    }
    if(Date.now() > nextBolt){
      nextBolt = Date.now() + rnd(4000, 14000);
      flash = 1;
      const x = rnd(W() * .2, W() * .8);
      bolt = [{x, y:0}];
      let y = 0, bx = x;
      while(y < H() * .62){
        y += rnd(30, 70); bx += rnd(-34, 34);
        bolt.push({x:bx, y});
      }
    }
  }

  function drawSnowFx(){
    fx2.fillStyle = 'rgba(255,255,255,.88)';
    for(const b of flakes){
      fx2.beginPath(); fx2.arc(b.x, b.y, b.r, 0, 6.3); fx2.fill();
      b.y += b.v; b.d += .014; b.x += Math.sin(b.d) * .7;
      if(b.y > H()){ b.y = -8; b.x = rnd(0, W()); }
    }
    drawPiles();
  }

  /* ---- ambient (behind the deck) ---- */
  function drawAmbient(){
    if(mode==='rain'||mode==='storm'){
      cx.strokeStyle = 'rgba(150,190,230,.35)'; cx.lineWidth = 1;
      for(const b of bits){
        cx.beginPath(); cx.moveTo(b.x,b.y); cx.lineTo(b.x-1.5,b.y+b.l); cx.stroke();
        b.y += b.v; b.x -= .35;
        if(b.y > H()){ b.y = -20; b.x = rnd(0,W()); }
      }
      if(mode==='storm' && !fx.has('lightning')){
        if(flash > 0){ cx.fillStyle = `rgba(190,170,255,${flash*.16})`; cx.fillRect(0,0,W(),H()); flash -= .05; }
        else if(Math.random() < .0025) flash = 1;
      }
    }

    else if(mode==='snow'){
      cx.fillStyle = 'rgba(255,255,255,.75)';
      for(const b of bits){
        cx.beginPath(); cx.arc(b.x,b.y,b.r,0,6.3); cx.fill();
        b.y += b.v; b.d += .012; b.x += Math.sin(b.d)*.5;
        if(b.y > H()){ b.y = -8; b.x = rnd(0,W()); }
      }
    }

    else if(mode==='stars'){
      for(const b of bits){
        b.p += b.s;
        cx.fillStyle = `rgba(210,225,255,${.25+Math.abs(Math.sin(b.p))*.55})`;
        cx.beginPath(); cx.arc(b.x,b.y,b.r,0,6.3); cx.fill();
      }
    }

    else if(mode==='clouds'||mode==='fog'){
      cx.fillStyle = mode==='fog' ? 'rgba(190,200,210,.10)' : 'rgba(140,160,190,.07)';
      for(const b of bits){
        cx.beginPath();
        cx.ellipse(b.x,b.y,b.w/2,b.h/2,0,0,6.3); cx.fill();
        b.x += b.v;
        if(b.x - b.w > W()) b.x = -b.w;
      }
    }

    else if(mode==='clear' && !fx.has('sun')){
      const g = cx.createRadialGradient(W()*.82,H()*.14,10,W()*.82,H()*.14,Math.max(W(),H())*.55);
      g.addColorStop(0, accent()+'33'); g.addColorStop(1,'transparent');
      cx.fillStyle = g; cx.fillRect(0,0,W(),H());
    }

    else if(mode==='confetti'){
      let alive = false;
      for(const b of bits){
        if(b.y < H()+20) alive = true;
        cx.save(); cx.translate(b.x,b.y); cx.rotate(b.a);
        cx.fillStyle = b.c; cx.fillRect(-b.w/2,-b.h/2,b.w,b.h); cx.restore();
        b.y += b.v; b.a += b.s; b.x += Math.sin(b.a)*.6;
      }
      if(!alive){ mode = 'stars'; seed(); }
    }
  }

  function frame(){
    t++;
    cx.clearRect(0,0,W(),H());
    fx2.clearRect(0,0,W(),H());

    /* An effect and the theme ambient can name the same weather; the
       effect is the better version, so the ambient stands down. */
    const muted = (fx.has('rain') && (mode==='rain' || mode==='storm')) ||
                  (fx.has('snow') &&  mode==='snow');
    if(!muted) drawAmbient();

    if(fx.has('snow') || fx.has('rain')) measurePiles();

    if(fx.has('sun'))       drawFlare();
    if(fx.has('wind'))      drawWind();
    if(fx.has('snow'))      drawSnowFx();
    if(fx.has('rain')){     drawRain(); drawDrips(); drawPuddle(); }
    if(fx.has('lightning')) drawLightning();

    raf = requestAnimationFrame(frame);
  }

  function frameOnce(){ // reduced motion: draw a single static pass
    const save = requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    frame();
    window.requestAnimationFrame = save;
  }

  function restart(){
    size(); seed(); seedFx();
    if(raf) cancelAnimationFrame(raf);
    raf = null;
    cx.clearRect(0,0,W(),H());
    fx2.clearRect(0,0,W(),H());
    if(mode === 'none' && !fx.size) return;
    if(still){ frameOnce(); return; }
    frame();
  }

  /* ---- which effects are running ----
     Forced from Settings for testing, otherwise read off the same weather
     the theme was picked from. */
  function effectsFor(ctx){
    const on = new Set();
    if(!Store.get('fx.on', true)) return on;

    const w = ctx && ctx.weather;
    if(w){
      if(w.main === 'Snow') on.add('snow');
      if(['Rain','Drizzle','Thunderstorm'].includes(w.main)) on.add('rain');
      if(w.main === 'Thunderstorm') on.add('lightning');
      if(w.main === 'Clear' && w.isDay) on.add('sun');
      if((w.wind || 0) >= 18) on.add('wind');
    }

    for(const k of ['snow','rain','sun','wind','lightning'])
      if(Store.get(`fx.${k}`, false)) on.add(k);

    return on;
  }

  return {
    /* The theme ambient. */
    set(next){
      const m = next || 'none';
      if(m === mode) return;
      mode = m;
      restart();
    },

    /* The weather effects. Takes the same ctx the theme engine uses, or an
       explicit list from the console: Sky.fx(['snow','lightning']). */
    fx(ctx){
      const next = Array.isArray(ctx) ? new Set(ctx) : effectsFor(ctx);
      const same = next.size === fx.size && [...next].every(k => fx.has(k));
      if(same) return;
      fx = next;

      /* Wind is the one effect the canvas cannot do alone: it has to lean
         the actual page. */
      document.body.classList.toggle('fx-wind', fx.has('wind'));
      document.body.classList.toggle('fx-rain', fx.has('rain'));
      document.body.classList.toggle('fx-snow', fx.has('snow'));
      document.body.classList.toggle('fx-sun',  fx.has('sun'));

      restart();
    },

    get active(){ return [...fx]; }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Sky = Sky;
