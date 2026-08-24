/* ============================================================
   sky.js — the ambient backdrop canvas.

   Two layers, one animation loop:

     the AMBIENT, named by the active theme (stars, clouds, confetti…),
     and the WEATHER EFFECTS, derived from the actual forecast and
     overridable from Settings for testing.

   The effects are the reason the canvas sits behind everything: snow
   settles on the top edge of every panel on screen, rain leaves a puddle
   with a reflection along the bottom, sun throws a lens flare, wind leans
   the whole page (that part is CSS, switched from here), and a storm
   flashes.

   Respects prefers-reduced-motion: one static pass and no loop.
   ============================================================ */

const Sky = (() => {
  const cv = document.getElementById('sky');
  const cx = cv.getContext('2d');

  let mode = 'none';          // theme ambient
  let fx   = new Set();       // snow | rain | sun | wind | lightning
  let bits = [], drops = [], flakes = [], ripples = [], gusts = [];
  let raf = null, flash = 0, nextBolt = 0, bolt = null;
  let piles = [], pilesAt = 0;
  let t = 0;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size(){
    cv.width  = cv.clientWidth  * devicePixelRatio;
    cv.height = cv.clientHeight * devicePixelRatio;
    cx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
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
    if(!fx.has('rain')){ drops = []; ripples = []; }

    if(fx.has('snow') && flakes.length !== 170)
      flakes = Array.from({length:170}, () => ({x:rnd(0,W()), y:rnd(-H(),H()),
                                                r:rnd(1.1,3.4), v:rnd(.5,1.6), d:rnd(0,6.3)}));
    if(!fx.has('snow')) flakes = [];

    if(fx.has('wind') && gusts.length !== 26)
      gusts = Array.from({length:26}, () => ({x:rnd(0,W()), y:rnd(0,H()), l:rnd(40,160), v:rnd(4,11), a:rnd(.05,.18)}));
    if(!fx.has('wind')) gusts = [];
  }

  /* ---- where snow settles ----
     The top edge of everything that reads as a physical panel. Re-measured
     a couple of times a second rather than every frame: getBoundingClientRect
     over sixty elements is the one thing here that could cost a frame. */
  const PILE_ON = '.gc, .pf-card, .cal-day, .ff-board, .tm-hero, .mv-card, .note, .wx-now-card, .td-row';

  function measurePiles(){
    if(Date.now() - pilesAt < 700) return;
    pilesAt = Date.now();

    const seen = [];
    const els = document.querySelectorAll(PILE_ON);
    for(let i = 0; i < els.length && seen.length < 70; i++){
      const r = els[i].getBoundingClientRect();
      if(r.width < 40 || r.top < 0 || r.top > H()) continue;
      seen.push({x:r.left, y:r.top, w:r.width});
    }

    /* Depth carries across measurements by position, so a repaint of the
       page does not dump the snow that has already settled on it. */
    piles = seen.map(s => {
      const was = piles.find(p => Math.abs(p.x - s.x) < 6 && Math.abs(p.y - s.y) < 6);
      return {...s, d: was ? was.d : 0, seed: was ? was.seed : Math.random()*100};
    });
  }

  function drawPiles(){
    for(const p of piles){
      if(p.d < 7) p.d += 0.012;                 // settles over about ten minutes
      if(p.d < .4) continue;
      cx.fillStyle = 'rgba(255,255,255,.92)';
      cx.beginPath();
      cx.moveTo(p.x, p.y + 1);
      /* A lumpy top edge, with a fixed wobble per pile so it does not
         shimmer from frame to frame. */
      const steps = Math.max(4, Math.round(p.w / 26));
      for(let i = 0; i <= steps; i++){
        const f = i / steps;
        const wob = Math.sin(p.seed + f * 7.5) * (p.d * .45);
        cx.lineTo(p.x + p.w * f, p.y - p.d - wob);
      }
      cx.lineTo(p.x + p.w, p.y + 1);
      cx.closePath();
      cx.fill();
    }
  }

  /* ---- rain: drops, then a puddle along the floor ---- */
  const puddleH = () => Math.min(120, H() * .13);

  function drawRain(){
    cx.strokeStyle = 'rgba(170,205,240,.42)';
    cx.lineWidth = 1.1;
    for(const b of drops){
      cx.beginPath(); cx.moveTo(b.x, b.y); cx.lineTo(b.x - 2, b.y + b.l); cx.stroke();
      b.y += b.v; b.x -= .5;
      if(b.y > H() - puddleH()){
        if(ripples.length < 40 && Math.random() < .35)
          ripples.push({x:b.x, y:H() - rnd(0, puddleH()), r:1, a:.5});
        b.y = -20; b.x = rnd(0, W());
      }
    }
  }

  function drawPuddle(){
    const h = puddleH(), top = H() - h;

    /* A canvas cannot mirror live DOM, so the reflection is a gradient
       standing in for one — the ripples are what sell it as water. */
    const g = cx.createLinearGradient(0, top, 0, H());
    g.addColorStop(0, 'rgba(120,160,200,0)');
    g.addColorStop(.35, 'rgba(120,160,200,.10)');
    g.addColorStop(1, 'rgba(150,190,230,.22)');
    cx.fillStyle = g;
    cx.fillRect(0, top, W(), h);

    /* The deck's own glow, smeared across the wet floor. */
    const a = cx.createRadialGradient(W()*.5, H(), 4, W()*.5, H(), W()*.6);
    a.addColorStop(0, accent() + '3A');
    a.addColorStop(1, 'transparent');
    cx.fillStyle = a;
    cx.fillRect(0, top, W(), h);

    cx.strokeStyle = 'rgba(200,225,255,.35)';
    cx.lineWidth = 1;
    for(let i = ripples.length - 1; i >= 0; i--){
      const r = ripples[i];
      cx.globalAlpha = r.a;
      cx.beginPath();
      cx.ellipse(r.x, r.y, r.r, r.r * .28, 0, 0, 6.3);
      cx.stroke();
      r.r += .9; r.a -= .012;
      if(r.a <= 0) ripples.splice(i, 1);
    }
    cx.globalAlpha = 1;
  }

  /* ---- sun: a source off the top-right, and flares down the axis ---- */
  function drawFlare(){
    const sx = W() * .88, sy = H() * .12;
    const midX = W() / 2, midY = H() / 2;

    const core = cx.createRadialGradient(sx, sy, 6, sx, sy, Math.max(W(), H()) * .45);
    core.addColorStop(0, 'rgba(255,241,200,.55)');
    core.addColorStop(.15, 'rgba(255,226,150,.16)');
    core.addColorStop(1, 'transparent');
    cx.fillStyle = core;
    cx.fillRect(0, 0, W(), H());

    /* Ghosts march from the source through the centre and out the far
       side, which is what a real flare does. */
    const ghosts = [
      {t:-0.28, r:14, a:.16, c:'255,220,160'},
      {t: 0.30, r:34, a:.10, c:'160,220,255'},
      {t: 0.62, r:20, a:.13, c:'255,180,140'},
      {t: 0.95, r:58, a:.07, c:'190,255,210'},
      {t: 1.30, r:26, a:.10, c:'255,240,190'}
    ];
    const pulse = 1 + Math.sin(t / 42) * .06;
    for(const gh of ghosts){
      const gx = sx + (midX - sx) * gh.t * 2;
      const gy = sy + (midY - sy) * gh.t * 2;
      const rad = gh.r * pulse;
      const g = cx.createRadialGradient(gx, gy, 0, gx, gy, rad);
      g.addColorStop(0, `rgba(${gh.c},${gh.a})`);
      g.addColorStop(1, 'transparent');
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(gx, gy, rad, 0, 6.3); cx.fill();
    }

    /* The anamorphic streak. */
    const s = cx.createLinearGradient(0, sy, W(), sy);
    s.addColorStop(0, 'transparent');
    s.addColorStop(.5, 'rgba(255,235,190,.05)');
    s.addColorStop(1, 'transparent');
    cx.fillStyle = s;
    cx.fillRect(0, sy - 2.5, W(), 5);
  }

  /* ---- wind: streaks on the canvas, lean on the DOM ---- */
  function drawWind(){
    cx.strokeStyle = 'rgba(210,225,245,.13)';
    cx.lineWidth = 1;
    for(const g of gusts){
      cx.globalAlpha = g.a;
      cx.beginPath();
      cx.moveTo(g.x, g.y);
      cx.quadraticCurveTo(g.x + g.l * .5, g.y - 6, g.x + g.l, g.y);
      cx.stroke();
      g.x += g.v;
      if(g.x > W() + g.l){ g.x = -g.l; g.y = rnd(0, H()); }
    }
    cx.globalAlpha = 1;
  }

  /* ---- lightning ---- */
  function drawLightning(){
    if(flash > 0){
      cx.fillStyle = `rgba(226,232,255,${flash * .5})`;
      cx.fillRect(0, 0, W(), H());
      if(bolt){
        cx.strokeStyle = `rgba(255,255,255,${Math.min(1, flash * 1.6)})`;
        cx.lineWidth = 2.4;
        cx.beginPath();
        cx.moveTo(bolt[0].x, bolt[0].y);
        for(const p of bolt.slice(1)) cx.lineTo(p.x, p.y);
        cx.stroke();
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

  /* ---- ambient (unchanged behaviours) ---- */
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

  function drawSnowFx(){
    cx.fillStyle = 'rgba(255,255,255,.85)';
    for(const b of flakes){
      cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, 6.3); cx.fill();
      b.y += b.v; b.d += .014; b.x += Math.sin(b.d) * .7;
      if(b.y > H()){ b.y = -8; b.x = rnd(0, W()); }
    }
    measurePiles();
    drawPiles();
  }

  function frame(){
    t++;
    cx.clearRect(0,0,W(),H());

    /* An effect and the theme ambient can name the same weather; the
       effect is the better version, so the ambient stands down. */
    const muted = (fx.has('rain') && (mode==='rain' || mode==='storm')) ||
                  (fx.has('snow') &&  mode==='snow');
    if(!muted) drawAmbient();

    if(fx.has('sun'))       drawFlare();
    if(fx.has('wind'))      drawWind();
    if(fx.has('snow'))      drawSnowFx();
    if(fx.has('rain')){     drawRain(); drawPuddle(); }
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

      restart();
    },

    get active(){ return [...fx]; }
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script. */
window.Sky = Sky;
