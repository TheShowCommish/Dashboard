/* ============================================================
   themes.js — the theme engine.

   TO ADD A THEME: copy any block below, change the values, done.
   Nothing else in the codebase needs to be touched.

     id       unique string
     label    what shows on the status rail
     priority higher number wins when two themes both match
     sky      backdrop effect: rain | snow | clear | clouds | storm
              | fog | stars | confetti | none
     when(ctx) return true to activate. ctx is:
                ctx.weather  { main, desc, temp, isDay }  (may be null)
                ctx.games    [{ league, name, abbr, state, result, kickoff }]
                ctx.hour     0-23
                ctx.month    1-12
     tokens   any CSS custom property from style.css
     dynamic  optional (ctx) => extra tokens, merged over `tokens`.
              Used by game day, which paints itself in the colours of
              whichever followed team is actually playing.
   ============================================================ */

const THEMES = [

  /* ---------- baseline ---------- */
  {
    id:'nightops', label:'Standard', priority:0, sky:'stars',
    when: () => true,
    tokens:{
      '--ink':'#0E1116','--panel':'#161B23','--panel-2':'#1C222C','--edge':'#262F3C',
      '--text':'#E4E9F0','--muted':'#7D8A9C','--accent':'#F2B705','--accent-ink':'#0E1116',
      '--good':'#4CC9A7','--bad':'#E5484D','--rail':'#F2B705'
    }
  },
  {
    id:'daylight', label:'Daylight', priority:5, sky:'clear',
    when: c => c.weather && c.weather.isDay && ['Clear'].includes(c.weather.main),
    tokens:{
      '--ink':'#EEF1F5','--panel':'#FFFFFF','--panel-2':'#F3F6FA','--edge':'#D5DCE6',
      '--text':'#141A22','--muted':'#5D6B7C','--accent':'#1F6FEB','--accent-ink':'#FFFFFF',
      '--good':'#12855F','--bad':'#C42B31','--rail':'#1F6FEB'
    }
  },

  /* ---------- weather ---------- */
  {
    id:'rain', label:'Rain', priority:20, sky:'rain',
    when: c => c.weather && ['Rain','Drizzle'].includes(c.weather.main),
    tokens:{
      '--ink':'#0B1017','--panel':'#121A24','--panel-2':'#17212D','--edge':'#22303F',
      '--text':'#DCE6F0','--muted':'#6F8398','--accent':'#5AA9E6','--accent-ink':'#08111A',
      '--good':'#48BFA0','--bad':'#E0575C','--rail':'#5AA9E6'
    }
  },
  {
    id:'storm', label:'Storm', priority:30, sky:'storm',
    when: c => c.weather && c.weather.main === 'Thunderstorm',
    tokens:{
      '--ink':'#08090D','--panel':'#101319','--panel-2':'#161A22','--edge':'#242A36',
      '--text':'#E8EAF0','--muted':'#77808F','--accent':'#B98BFF','--accent-ink':'#08090D',
      '--good':'#4CC9A7','--bad':'#FF5A5F','--rail':'#B98BFF'
    }
  },
  {
    id:'snow', label:'Snow', priority:25, sky:'snow',
    when: c => c.weather && c.weather.main === 'Snow',
    tokens:{
      '--ink':'#F2F5F8','--panel':'#FFFFFF','--panel-2':'#E9EFF5','--edge':'#CBD7E3',
      '--text':'#16202B','--muted':'#5E7183','--accent':'#2E7FA8','--accent-ink':'#FFFFFF',
      '--good':'#177F63','--bad':'#BE3238','--rail':'#8FC7E0'
    }
  },
  {
    id:'fog', label:'Fog', priority:18, sky:'fog',
    when: c => c.weather && ['Mist','Fog','Haze','Smoke'].includes(c.weather.main),
    tokens:{
      '--ink':'#1A1D21','--panel':'#22262B','--panel-2':'#282D33','--edge':'#343A42',
      '--text':'#DDE1E6','--muted':'#828A94','--accent':'#A8B5A0','--accent-ink':'#1A1D21',
      '--good':'#7FB89C','--bad':'#C97A7D','--rail':'#A8B5A0'
    }
  },
  {
    id:'overcast', label:'Clouds', priority:15, sky:'clouds',
    when: c => c.weather && c.weather.main === 'Clouds',
    tokens:{
      '--ink':'#12161C','--panel':'#1A2029','--panel-2':'#202732','--edge':'#2C3541',
      '--text':'#DFE5ED','--muted':'#76839A','--accent':'#8FA3BF','--accent-ink':'#12161C',
      '--good':'#4CC9A7','--bad':'#E5484D','--rail':'#8FA3BF'
    }
  },
  {
    id:'heat', label:'Heat', priority:22, sky:'clear',
    when: c => c.weather && c.weather.temp >= 95,
    tokens:{
      '--ink':'#180E08','--panel':'#241510','--panel-2':'#2C1A13','--edge':'#3E251A',
      '--text':'#F5E7DC','--muted':'#A88872','--accent':'#FF8A3D','--accent-ink':'#180E08',
      '--good':'#5FC49A','--bad':'#FF4D4D','--rail':'#FF8A3D'
    }
  },

  /* ---------- sports (outrank weather on game day) ---------- */
  {
    id:'gameday', label:'Game day', priority:60, sky:'none',
    when: c => c.games.some(g => isToday(g.kickoff) && (g.state === 'pre' || g.state === 'in')),
    tokens:{
      '--ink':'#0C0E13','--panel':'#151922','--panel-2':'#1B212C','--edge':'#2A3340',
      '--text':'#F0F3F8','--muted':'#828FA3','--accent':'#00E08A','--accent-ink':'#0C0E13',
      '--good':'#00E08A','--bad':'#FF4D4D','--rail':'#00E08A'
    },
    /* The team playing today owns the deck: its primary colour becomes the
       accent, and the panels take a wash of it. A colour too dark to read
       against falls back to the alternate, then to the static accent. */
    dynamic(c){
      const g = c.games.find(x => isToday(x.kickoff) && (x.state === 'pre' || x.state === 'in'));
      const col = pickReadable(g?.me?.color, g?.me?.altColor);
      if(!col) return null;
      return {
        '--accent': col,
        '--accent-ink': inkFor(col),
        '--rail': col,
        '--panel':   mix(col, '#151922', .10),
        '--panel-2': mix(col, '#1B212C', .13),
        '--edge':    mix(col, '#2A3340', .22),
        '--ink':     mix(col, '#0C0E13', .06)
      };
    },
    labelFor(c){
      const g = c.games.find(x => isToday(x.kickoff) && (x.state === 'pre' || x.state === 'in'));
      return g ? `${g.abbr || g.name} day` : 'Game day';
    }
  },
  {
    id:'won', label:'They won', priority:70, sky:'confetti',
    when: c => c.games.some(g => g.result === 'win'),
    tokens:{
      '--ink':'#0A1410','--panel':'#122019','--panel-2':'#16281F','--edge':'#20372A',
      '--text':'#E8F7EE','--muted':'#7DA38C','--accent':'#37E27C','--accent-ink':'#0A1410',
      '--good':'#37E27C','--bad':'#E5484D','--rail':'#37E27C'
    }
  },
  {
    id:'lost', label:'Tough loss', priority:65, sky:'none',
    when: c => c.games.some(g => g.result === 'loss'),
    tokens:{
      '--ink':'#0D0B0E','--panel':'#161318','--panel-2':'#1C181E','--edge':'#2A252C',
      '--text':'#D7D2DA','--muted':'#6E6774','--accent':'#8A8194','--accent-ink':'#0D0B0E',
      '--good':'#6FA98F','--bad':'#B04A4E','--rail':'#8A8194'
    }
  },

  /* ---------- time / season ---------- */
  {
    id:'latenight', label:'Late', priority:8, sky:'stars',
    when: c => c.hour >= 23 || c.hour < 5,
    tokens:{
      '--ink':'#07080C','--panel':'#0E1016','--panel-2':'#12151C','--edge':'#1E2229',
      '--text':'#C9CFDA','--muted':'#5F6875','--accent':'#6C7FE0','--accent-ink':'#07080C',
      '--good':'#3FA98C','--bad':'#C0484D','--rail':'#6C7FE0'
    }
  },
  {
    id:'autumn', label:'Autumn', priority:6, sky:'clouds',
    when: c => [10,11].includes(c.month),
    tokens:{
      '--ink':'#12100C','--panel':'#1C1812','--panel-2':'#231D16','--edge':'#332A20',
      '--text':'#EDE4D6','--muted':'#998A73','--accent':'#C9762F','--accent-ink':'#12100C',
      '--good':'#7FA85F','--bad':'#C64B3F','--rail':'#C9762F'
    }
  }
];

/* ---- helpers the dynamic themes need ---- */
const isToday = d => {
  if(!d) return false;
  const x = new Date(d);
  return x.toDateString() === new Date().toDateString();
};

const hexBits = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if(!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* Relative luminance, the same measure the WCAG contrast ratio uses. */
const lum = rgb => {
  const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
  return .2126*f(rgb[0]) + .7152*f(rgb[1]) + .0722*f(rgb[2]);
};

/* A team's primary is sometimes near-black (navy, midnight) and would
   vanish as an accent on a dark deck. Take the alternate when that
   happens, and give up rather than ship something unreadable. */
function pickReadable(primary, alt){
  for(const c of [primary, alt]){
    const bits = hexBits(c);
    if(bits && lum(bits) > .06) return c.startsWith('#') ? c : `#${c}`;
  }
  return null;
}

const inkFor = c => {
  const bits = hexBits(c);
  return bits && lum(bits) > .45 ? '#0C0E13' : '#FFFFFF';
};

/* k parts colour into a base, as a hex string. */
function mix(colour, base, k){
  const a = hexBits(colour), b = hexBits(base);
  if(!a || !b) return base;
  const out = a.map((v,i) => Math.round(b[i] + (v - b[i]) * k));
  return `#${out.map(v => v.toString(16).padStart(2,'0')).join('')}`;
}

const Themes = (() => {
  let current = null;
  let signature = '';

  function pickAuto(ctx){
    return THEMES
      .filter(t => { try { return t.when(ctx); } catch { return false; } })
      .sort((a,b) => b.priority - a.priority)[0] || THEMES[0];
  }

  function apply(theme, ctx){
    if(!theme) return;

    /* A dynamic theme can change without its id changing — game day
       repaints when a different team is playing — so the guard compares
       the tokens actually about to be set, not just the name. */
    let tokens = theme.tokens;
    if(theme.dynamic && ctx){
      const extra = (() => { try { return theme.dynamic(ctx); } catch { return null; } })();
      if(extra) tokens = {...tokens, ...extra};
    }
    const sig = theme.id + JSON.stringify(tokens);
    if(sig === signature) return;
    signature = sig;
    current = theme;

    const root = document.documentElement;
    for(const [prop,val] of Object.entries(tokens)) root.style.setProperty(prop,val);

    const label = document.getElementById('railLabel');
    if(label) label.textContent =
      (theme.labelFor && ctx ? theme.labelFor(ctx) : theme.label) || theme.label;
    if(window.Sky) Sky.set(theme.sky);
  }

  return {
    all: THEMES,
    get current(){ return current; },
    /* Called whenever weather or game state changes. */
    refresh(ctx){
      const mode = Store.get('theme.mode','auto');
      if(mode === 'manual'){
        const id = Store.get('theme.pick','nightops');
        apply(THEMES.find(t => t.id === id) || THEMES[0], ctx);
      }else{
        apply(pickAuto(ctx), ctx);
      }
      /* The screen effects follow the same weather this theme was picked
         from, plus whatever is forced on in Settings. */
      if(window.Sky) Sky.fx(ctx);
    }
  };
})();
