/* ============================================================
   sky.js — the ambient backdrop canvas.
   Themes name an effect; this draws it. Respects reduced motion.
   ============================================================ */

const Sky = (() => {
  const cv = document.getElementById('sky');
  const cx = cv.getContext('2d');
  let mode = 'none', bits = [], raf = null, flash = 0;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size(){
    cv.width  = cv.clientWidth  * devicePixelRatio;
    cv.height = cv.clientHeight * devicePixelRatio;
    cx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  }
  addEventListener('resize', () => { size(); seed(); });

  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  const rnd = (a,b) => a + Math.random()*(b-a);

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

  function accent(){
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#888';
  }

  function frame(){
    cx.clearRect(0,0,W(),H());

    if(mode==='rain'||mode==='storm'){
      cx.strokeStyle = 'rgba(150,190,230,.35)'; cx.lineWidth = 1;
      for(const b of bits){
        cx.beginPath(); cx.moveTo(b.x,b.y); cx.lineTo(b.x-1.5,b.y+b.l); cx.stroke();
        b.y += b.v; b.x -= .35;
        if(b.y > H()){ b.y = -20; b.x = rnd(0,W()); }
      }
      if(mode==='storm'){
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

    else if(mode==='clear'){
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

    raf = requestAnimationFrame(frame);
  }

  return {
    set(next){
      mode = next || 'none';
      size(); seed();
      if(raf) cancelAnimationFrame(raf);
      cx.clearRect(0,0,W(),H());
      if(mode === 'none') return;
      if(still){ frameOnce(); return; }
      frame();
    }
  };

  function frameOnce(){ // reduced motion: draw a single static pass
    const save = requestAnimationFrame; window.requestAnimationFrame = () => 0;
    frame(); window.requestAnimationFrame = save;
  }
})();
