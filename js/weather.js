/* ============================================================
   weather.js — Open-Meteo.

   No API key exists for this service and none is needed; the free
   endpoint is unauthenticated. What varies is the request URL itself
   (latitude, longitude, which fields to return), so the whole URL is
   editable in Settings. Build a replacement at open-meteo.com/en/docs.

   Refreshes on a fixed daily schedule — 6am, noon, 3pm, 6pm, 10pm —
   rather than on a rolling interval, and caches the last good payload
   so a reload between those times costs nothing.

   Also exposes forecastFor(date) so the calendar can tag events.
   ============================================================ */

const Weather = (() => {
  /* The tile under the calendar grid renders into #weatherBody, and the
     header button opens the same data at full size in #wxModal. body stays
     optional so the module keeps working if either is absent. */
  const body  = document.getElementById('weatherBody');
  const stamp = document.getElementById('wxUpdated');
  const modal = document.getElementById('wxModal');
  const mBody = document.getElementById('wxModalBody');

  let current = null;      // { main, desc, temp, feels, wind, isDay }
  let hourly  = [];        // [{ t:Date, temp, main, desc, pop }]
  let fetchedAt = null;    // Date of the last successful fetch

  const DEFAULT_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=39.97282&longitude=-75.14446' +
    '&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,' +
    'precipitation,rain,showers,snowfall,visibility,wind_speed_10m' +
    '&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code' +
    '&timezone=America%2FNew_York&forecast_days=14' +
    '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch';

  /* The hours at which the tile refreshes, local time. */
  const SLOTS = [6, 12, 15, 18, 22];

  /* WMO weather codes to the same condition names the theme engine
     already keys off, so themes.js needs no changes. */
  const WMO = {
    0:['Clear','clear sky'], 1:['Clear','mainly clear'],
    2:['Clouds','partly cloudy'], 3:['Clouds','overcast'],
    45:['Fog','fog'], 48:['Fog','depositing rime fog'],
    51:['Drizzle','light drizzle'], 53:['Drizzle','drizzle'], 55:['Drizzle','dense drizzle'],
    56:['Drizzle','freezing drizzle'], 57:['Drizzle','dense freezing drizzle'],
    61:['Rain','light rain'], 63:['Rain','rain'], 65:['Rain','heavy rain'],
    66:['Rain','freezing rain'], 67:['Rain','heavy freezing rain'],
    71:['Snow','light snow'], 73:['Snow','snow'], 75:['Snow','heavy snow'],
    77:['Snow','snow grains'],
    80:['Rain','light showers'], 81:['Rain','showers'], 82:['Rain','violent showers'],
    85:['Snow','light snow showers'], 86:['Snow','heavy snow showers'],
    95:['Thunderstorm','thunderstorm'],
    96:['Thunderstorm','thunderstorm with hail'], 99:['Thunderstorm','thunderstorm with heavy hail']
  };
  const decode = code => WMO[code] || ['Clear','—'];

  const GLYPH = {
    Clear:'☀️', Clouds:'☁️', Rain:'🌧️', Drizzle:'🌦️', Thunderstorm:'⛈️',
    Snow:'🌨️', Fog:'🌫️'
  };
  const glyph = m => GLYPH[m] || '🌡️';

  function nearest(date){
    if(!hourly.length) return null;
    const t = date.getTime();
    let best = hourly[0], gap = Infinity;
    for(const h of hourly){
      const g = Math.abs(h.t.getTime() - t);
      if(g < gap){ gap = g; best = h; }
    }
    return best;
  }

  /* ---- schedule ----
     The most recent slot that has already passed. Anything cached from
     before that instant is stale and earns a fetch. */
  function lastSlotBefore(now){
    for(let back = 0; back < 2; back++){
      const day = new Date(now); day.setDate(now.getDate() - back);
      for(const h of [...SLOTS].reverse()){
        const slot = new Date(day); slot.setHours(h, 0, 0, 0);
        if(slot <= now) return slot;
      }
    }
    return new Date(0);
  }

  function msUntilNextSlot(now = new Date()){
    for(let ahead = 0; ahead < 2; ahead++){
      const day = new Date(now); day.setDate(now.getDate() + ahead);
      for(const h of SLOTS){
        const slot = new Date(day); slot.setHours(h, 0, 0, 0);
        if(slot > now) return slot - now;
      }
    }
    return 60 * 60 * 1000;
  }

  /* Self-rescheduling timer. A setInterval would drift off the wall clock
     and survives neither a laptop sleep nor a DST change; this recomputes
     the next slot from the real time after every run. */
  function scheduleNext(){
    setTimeout(async () => {
      await load(true);
      scheduleNext();
    }, msUntilNextSlot() + 1000);
  }

  /* ---- fetch ---- */
  function parse(d){
    const [main, desc] = decode(d.current?.weather_code);
    const hrs = d.hourly || {};
    const times = hrs.time || [];

    hourly = times.map((t, i) => {
      const code = hrs.weather_code?.[i];
      const [m, ds] = code == null ? [main, desc] : decode(code);
      return {
        t: new Date(t),
        temp:  Math.round(hrs.temperature_2m?.[i] ?? 0),
        feels: Math.round(hrs.apparent_temperature?.[i] ?? hrs.temperature_2m?.[i] ?? 0),
        wind:  Math.round(hrs.wind_speed_10m?.[i] ?? 0),
        pop:   Math.round(hrs.precipitation_probability?.[i] ?? 0),
        main: m, desc: ds
      };
    });

    /* The current block carries no "feels like" or wind, so borrow them
       from the hourly row nearest to now. */
    const nowRow = nearest(new Date());
    const hour = new Date().getHours();

    current = {
      main, desc,
      temp:  Math.round(d.current?.temperature_2m ?? nowRow?.temp ?? 0),
      feels: nowRow ? nowRow.feels : Math.round(d.current?.temperature_2m ?? 0),
      wind:  nowRow ? nowRow.wind : 0,
      humidity: d.current?.relative_humidity_2m ?? null,
      place: `${(+d.latitude).toFixed(2)}, ${(+d.longitude).toFixed(2)}`,
      isDay: d.current?.is_day != null ? !!d.current.is_day : (hour >= 7 && hour < 20)
    };
  }

  function cache(){
    Store.set('weather.cache', {
      at: fetchedAt ? fetchedAt.toISOString() : null,
      current,
      hourly: hourly.map(h => [h.t.toISOString(), h.temp, h.feels, h.wind, h.pop, h.main, h.desc])
    });
  }

  function restore(){
    const c = Store.get('weather.cache', null);
    if(!c || !c.current) return false;
    current   = c.current;
    fetchedAt = c.at ? new Date(c.at) : null;
    hourly    = (c.hourly || []).map(([t, temp, feels, wind, pop, main, desc]) =>
      ({t:new Date(t), temp, feels, wind, pop, main, desc}));
    return true;
  }

  /* The daily strip needs a condition per hour, and the hourly field list
     is whatever the user pasted — the docs builder does not include
     weather_code by default, which would leave every forecast day showing
     today's icon. Add the fields the tile depends on if they are missing,
     leaving everything else in the URL untouched. */
  function ensureFields(raw){
    let u;
    try{ u = new URL(raw); }catch{ return raw; }
    for(const [param, needed] of [['hourly', ['temperature_2m','weather_code']],
                                  ['current', ['temperature_2m','weather_code']]]){
      const have = (u.searchParams.get(param) || '').split(',').map(v => v.trim()).filter(Boolean);
      if(!have.length) continue;                       // user dropped the block entirely
      const missing = needed.filter(f => !have.includes(f));
      if(missing.length) u.searchParams.set(param, [...have, ...missing].join(','));
    }
    return u.toString();
  }

  /* force=true ignores the schedule — a manual refresh, or a slot firing. */
  async function load(force = false){
    const url = ensureFields(Store.get('weather.url','') || DEFAULT_URL);

    if(!force){
      const hadCache = restore();
      if(hadCache && fetchedAt && fetchedAt >= lastSlotBefore(new Date())){
        paint();                       // still fresh for this slot
        return current;
      }
      if(hadCache) paint();            // show stale data while refetching
    }

    try{
      const d = await getJSON(url);
      if(d.error) throw new Error(d.reason || 'Open-Meteo rejected the request');
      parse(d);
      fetchedAt = new Date();
      cache();
      paint();
    }catch(e){
      if(current){
        paint();                       // keep the last good reading on screen
        Store.toast(`Weather refresh failed (${e.message}) — showing the last reading.`);
      }else{
        console.error('Weather failed to load:', e);
        Store.toast(`Weather failed to load (${e.message}). Check the URL in Settings.`);
        if(stamp) stamp.textContent = 'failed';
      }
    }
    return current;
  }

  /* ---- render ---- */
  /* The request asks for 14 forecast days; how many get rendered is the
     caller's business — the tile wants a week, the modal wants the lot. */
  function daily(count = 5){
    const byDay = new Map();
    for(const h of hourly){
      const k = h.t.toDateString();
      if(!byDay.has(k)) byDay.set(k, {date:h.t, hi:-999, lo:999, noon:null, pop:0});
      const d = byDay.get(k);
      d.hi = Math.max(d.hi, h.temp);
      d.lo = Math.min(d.lo, h.temp);
      d.pop = Math.max(d.pop, h.pop || 0);
      if(h.t.getHours() >= 11 && h.t.getHours() <= 14) d.noon = d.noon || h;
    }
    return [...byDay.values()].slice(0, count).map(d => ({...d, noon: d.noon || hourly[0]}));
  }

  /* The next N forecast hours from now, for the hour-by-hour strip. This is
     the part of the payload that was already being fetched and thrown away. */
  function nextHours(count = 12){
    const now = Date.now() - 30*60*1000;      // keep the hour just gone
    return hourly.filter(h => h.t.getTime() >= now).slice(0, count);
  }

  const hourLabel = t =>
    t.toLocaleTimeString(undefined,{hour:'numeric'}).replace(/\s/g,'').toLowerCase();

  function hourStripHtml(count){
    const hrs = nextHours(count);
    if(!hrs.length) return '';
    const temps = hrs.map(h => h.temp);
    const lo = Math.min(...temps), hi = Math.max(...temps);
    const span = Math.max(1, hi - lo);
    return `<div class="wx-hours">${hrs.map((h,i) => `
      <div class="wx-hour">
        <span class="wx-h-time">${i === 0 ? 'now' : esc(hourLabel(h.t))}</span>
        <span class="wx-h-glyph">${glyph(h.main)}</span>
        <span class="wx-h-bar"><i style="height:${(12 + (h.temp - lo) / span * 26).toFixed(0)}px"></i></span>
        <span class="wx-h-temp">${h.temp}°</span>
        <span class="wx-h-pop${h.pop >= 30 ? ' is-wet' : ''}">${h.pop ? h.pop + '%' : '—'}</span>
      </div>`).join('')}</div>`;
  }

  function nowHtml(){
    return `<div class="wx-now">
        <span class="wx-glyph">${glyph(current.main)}</span>
        <span class="wx-temp">${current.temp}°</span>
        <span class="wx-meta">
          <strong>${esc(current.desc)}</strong>
          Feels ${current.feels}° · Wind ${current.wind} mph${
            current.humidity != null ? ` · ${current.humidity}% hum` : ''}
        </span>
      </div>`;
  }

  function daysHtml(count){
    return `<div class="wx-days">
        ${daily(count).map(d => `
          <div class="wx-day">
            <b>${d.date.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase()}</b>
            <span class="g">${glyph(d.noon.main)}</span>
            <span class="t">${d.hi}° <i>${d.lo}°</i></span>
            <span class="p${d.pop >= 30 ? ' is-wet' : ''}">${d.pop ? d.pop + '%' : ''}</span>
          </div>`).join('')}
      </div>`;
  }

  function stampText(){
    if(!fetchedAt) return '—';
    const sameDay = fetchedAt.toDateString() === new Date().toDateString();
    const time = fetchedAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    return sameDay ? time
                   : `${fetchedAt.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${time}`;
  }

  function paint(){
    if(!current) return;

    if(body) body.innerHTML = `
      <div class="wx-tile-grid">
        <div class="wx-tile-now">
          ${nowHtml()}
          ${hourStripHtml(10)}
        </div>
        ${daysHtml(7)}
      </div>
      <p class="wx-foot">${esc(current.place)} · updated ${stampText()}</p>`;

    if(modal && !modal.hidden) paintModal();

    if(stamp){
      stamp.textContent = stampText();
      stamp.title = fetchedAt
        ? `Last updated ${fetchedAt.toLocaleString()} — refreshes at 6am, noon, 3pm, 6pm and 10pm`
        : 'Not loaded yet';
    }

    /* The header carries a compact glyph + temperature pill. */
    const icon = document.getElementById('wxIcon');
    const temp = document.getElementById('wxTemp');
    if(icon) icon.textContent = glyph(current.main);
    if(temp) temp.textContent = `${current.temp}°`;
    const pill = document.getElementById('headSub');
    if(pill) pill.title = `${current.desc} · feels ${current.feels}° · wind ${current.wind} mph — click to refresh`;

    if(window.CalendarView) CalendarView.render();
  }

  /* ---- detail modal ---- */
  function paintModal(){
    if(!mBody) return;
    if(!current){
      mBody.innerHTML = '<h2>Weather</h2><p class="empty">No reading yet — check the URL in Settings.</p>';
      return;
    }
    const rain = daily(14).filter(d => d.pop >= 30);
    mBody.innerHTML = `
      <h2>Weather · ${esc(current.place)}</h2>
      ${nowHtml()}
      <h3 class="pf-h3">Next 24 hours</h3>
      ${hourStripHtml(24) || '<p class="empty">No hourly detail in this payload.</p>'}
      <h3 class="pf-h3">Two weeks out</h3>
      ${daysHtml(14)}
      ${rain.length ? `<p class="wx-foot">Wet days ahead: ${rain.map(d =>
          `${d.date.toLocaleDateString(undefined,{weekday:'short'})} ${d.pop}%`).join(' · ')}</p>` : ''}
      <p class="wx-foot">Open-Meteo · updated ${stampText()} · refreshes at 6am, noon, 3pm, 6pm and 10pm</p>`;
  }

  function openModal(){
    if(!modal) return;
    modal.hidden = false;
    paintModal();
    /* An open popup on a stale slot is worth a quiet refresh. */
    if(!current) load(true);
  }

  const closeModal = () => { if(modal) modal.hidden = true; };

  return {
    load,
    refresh: () => load(true),
    scheduleNext,
    openModal,
    closeModal,
    DEFAULT_URL,
    get current(){ return current; },
    get updatedAt(){ return fetchedAt; },
    /* Per-day summary for a calendar cell: hi/lo, the midday condition and
       the worst rain chance that day. Returns null outside the forecast. */
    forDay(date){
      const k = new Date(date).toDateString();
      const rows = hourly.filter(h => h.t.toDateString() === k);
      if(!rows.length) return null;
      const noon = rows.find(h => h.t.getHours() >= 11 && h.t.getHours() <= 14) || rows[0];
      return {
        main: noon.main, desc: noon.desc,
        hi: Math.max(...rows.map(h => h.temp)),
        lo: Math.min(...rows.map(h => h.temp)),
        pop: Math.max(...rows.map(h => h.pop || 0))
      };
    },
    /* Nearest forecast hour to a given time — used to tag calendar events. */
    forecastFor(date){
      if(!hourly.length) return null;
      const t = date.getTime();
      if(t > hourly[hourly.length-1].t.getTime() + 36e5) return null; // beyond range
      return nearest(date);
    },
    glyph
  };
})();

/* module export: a top-level const does not become a window property in a
   classic script, so the window.X guards other modules use would all read
   undefined without this. */
window.Weather = Weather;
