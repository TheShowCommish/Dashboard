/* ============================================================
   weather.js — OpenWeatherMap.
   Also exposes forecastFor(date) so the calendar can tag events.
   ============================================================ */

const Weather = (() => {
  const body = document.getElementById('weatherBody');
  let current = null;      // { main, desc, temp, isDay }
  let hourly  = [];        // [{ t:Date, temp, main, desc, icon }]

  const GLYPH = {
    Clear:'☀️', Clouds:'☁️', Rain:'🌧️', Drizzle:'🌦️', Thunderstorm:'⛈️',
    Snow:'🌨️', Mist:'🌫️', Fog:'🌫️', Haze:'🌫️', Smoke:'🌫️',
    Dust:'😷', Sand:'😷', Ash:'🌋', Squall:'💨', Tornado:'🌪️'
  };
  const glyph = m => GLYPH[m] || '🌡️';

  async function load(){
    const key = Store.get('keys.owm','');
    const zip = Store.get('zip','');
    if(!key) return tileError(body,'Add an OpenWeatherMap key in Settings.');
    if(!/^\d{5}$/.test(zip)) return tileError(body,'Enter a 5-digit ZIP code above.');

    try{
      const [now, fc] = await Promise.all([
        getJSON(`https://api.openweathermap.org/data/2.5/weather?zip=${zip},us&units=imperial&appid=${key}`),
        getJSON(`https://api.openweathermap.org/data/2.5/forecast?zip=${zip},us&units=imperial&appid=${key}`)
      ]);

      current = {
        main:  now.weather[0].main,
        desc:  now.weather[0].description,
        temp:  Math.round(now.main.temp),
        feels: Math.round(now.main.feels_like),
        wind:  Math.round(now.wind.speed),
        city:  now.name,
        isDay: Date.now()/1000 > now.sys.sunrise && Date.now()/1000 < now.sys.sunset
      };

      hourly = fc.list.map(s => ({
        t: new Date(s.dt*1000),
        temp: Math.round(s.main.temp),
        main: s.weather[0].main,
        desc: s.weather[0].description,
        pop:  Math.round((s.pop||0)*100)
      }));

      render(daily());
      document.getElementById('headSub').textContent =
        `${current.city} · ${current.temp}°F · ${current.desc}`;
    }catch(e){
      tileError(body, `Weather failed to load (${e.message}). Check the ZIP code and key.`);
    }
    return current;
  }

  /* Collapse 3-hour steps into 5 calendar days using the midday reading. */
  function daily(){
    const byDay = new Map();
    for(const h of hourly){
      const k = h.t.toDateString();
      if(!byDay.has(k)) byDay.set(k, {date:h.t, hi:-999, lo:999, noon:null});
      const d = byDay.get(k);
      d.hi = Math.max(d.hi, h.temp);
      d.lo = Math.min(d.lo, h.temp);
      if(h.t.getHours() >= 11 && h.t.getHours() <= 14) d.noon = d.noon || h;
    }
    return [...byDay.values()].slice(0,5).map(d => ({...d, noon: d.noon || hourly[0]}));
  }

  function render(days){
    if(!current) return;
    body.innerHTML = `
      <div class="wx-now">
        <span class="wx-glyph">${glyph(current.main)}</span>
        <span class="wx-temp">${current.temp}°</span>
        <span class="wx-meta">
          <strong>${current.desc}</strong>
          Feels ${current.feels}° · Wind ${current.wind} mph
        </span>
      </div>
      <div class="wx-days">
        ${days.map(d => `
          <div class="wx-day">
            <b>${d.date.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase()}</b>
            <span class="g">${glyph(d.noon.main)}</span>
            <span class="t">${d.hi}° <i>${d.lo}°</i></span>
          </div>`).join('')}
      </div>`;
  }

  return {
    load,
    get current(){ return current; },
    /* Nearest forecast slot to a given time — used to tag calendar events. */
    forecastFor(date){
      if(!hourly.length) return null;
      const t = date.getTime();
      if(t > hourly[hourly.length-1].t.getTime() + 3*36e5) return null; // beyond range
      let best = hourly[0], gap = Infinity;
      for(const h of hourly){
        const g = Math.abs(h.t.getTime() - t);
        if(g < gap){ gap = g; best = h; }
      }
      return best;
    },
    glyph
  };
})();
