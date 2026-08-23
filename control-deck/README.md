# Control Deck

A personal dashboard: weather, calendar, mail, portfolio, fantasy football, followed teams, upcoming movies, a to-do list and a sticky-note board — on one page that themes itself based on the weather and on whether your teams are playing.

Plain HTML, CSS and JavaScript. No build step, no framework, no server. It runs on GitHub Pages for free.

---

## What's in here

```
index.html              the page
css/style.css           all styling; every colour is a CSS variable
js/store.js             localStorage layer + shared helpers
js/themes.js            the theme engine  ← add new themes here
js/sky.js               animated backdrop (rain, snow, stars, confetti)
js/weather.js           OpenWeatherMap
js/google.js            Gmail + Google Calendar
js/stocks.js            portfolio pricing + earnings dates
js/fantasy.js           ESPN fantasy football
js/teams.js             followed teams and their schedules
js/movies.js            upcoming theatrical releases
js/notes.js             to-do list + sticky notes
js/app.js               boot, clock, settings drawer, refresh timers
proxy/worker.js         optional ESPN proxy for private leagues
sample-holdings.csv     example portfolio file
```

---

## Step 1 — Put it on GitHub

If you've never done this, here's the whole thing.

1. On github.com, click **+** → **New repository**.
2. Name it `control-deck`. Set it to **Public**. Don't add a README — you have one. Click **Create repository**.
3. On the empty repo page click **uploading an existing file**.
4. Drag in every file and folder from this project. Click **Commit changes**.

## Step 2 — Turn on GitHub Pages

1. In your repo go to **Settings** → **Pages** (left sidebar).
2. Under *Source* pick **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Click **Save**.
4. Wait about a minute, then reload. Your URL appears at the top:
   `https://YOURNAME.github.io/control-deck/`

That URL is your live dashboard. Every time you commit a change, the site updates within a minute.

---

## Step 3 — Get your API keys

Open the dashboard, click **Settings**, and paste each key as you get it. Keys are stored in your browser's localStorage — they are **not** written into the repo, so your public repository stays clean.

Be aware of the tradeoff: a browser-only dashboard means any key it holds is visible to anyone who opens the developer tools **on your machine**. That's fine for these read-only, free-tier keys. Never put a key here that can move money or send mail.

| Service | Where to get it | Notes |
|---|---|---|
| **OpenWeatherMap** | openweathermap.org/api → sign up → *API keys* | Free tier. Takes up to an hour to activate. |
| **Finnhub** | finnhub.io → sign up → dashboard | Free tier. 60 calls/min. Powers quotes and earnings. |
| **TMDB** | themoviedb.org → Settings → API → request a key | Free. Choose "Developer", personal use. |
| **Google** | see Step 4 | Client ID, not a key. |

## Step 4 — Google (Gmail + Calendar)

1. Go to console.cloud.google.com and create a project.
2. **APIs & Services** → **Library** → enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services** → **OAuth consent screen** → External → fill in the app name and your email → save. Under **Audience**, add your own Google account as a **Test user**.
4. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
5. Under *Authorised JavaScript origins* add exactly:
   - `https://YOURNAME.github.io`
   - `http://localhost:8000` (only if you test locally)
6. Copy the **Client ID** into Settings → Google OAuth Client ID.
7. Click **Connect Google** on the calendar tile and approve.

Both scopes are read-only. The dashboard cannot send mail or change your calendar.

## Step 5 — Portfolio

Make a CSV with a header row. Column order doesn't matter; the names do.

```csv
symbol,shares,cost
AAPL,25,142.30
VTI,40,215.10
```

`symbol` and `shares` are required. `cost` is the per-share basis and is optional — include it and you get total gain/loss as well as the daily move.

Click **Upload CSV** on the Portfolio tile. It's stored in your browser, so you only do this once. `sample-holdings.csv` is included as a template.

This reads public market prices only. It never touches Schwab, Vanguard, or your bank — no login, no credentials, nothing to leak.

## Step 6 — Fantasy football

Find your league ID in the ESPN URL: `...leagueId=123456` → `123456`. Your team ID is `teamId=` in the same URL when your team is selected.

Put the league ID, season, and team ID in Settings.

**If your league is public, you're done.**

**If your league is private,** ESPN requires two cookies that a browser won't send cross-origin. Deploy the included proxy:

1. Get the cookies. In Chrome, log into ESPN → F12 → **Application** → **Cookies** → `espn.com`. Copy the values of `espn_s2` and `SWID` (keep the curly braces on SWID).
2. Install and deploy the worker:
   ```bash
   npm install -g wrangler
   wrangler login
   cd proxy
   wrangler deploy
   wrangler secret put ESPN_S2
   wrangler secret put ESPN_SWID
   wrangler secret put ALLOW_ORIGIN     # https://YOURNAME.github.io
   ```
3. Paste the worker URL into Settings → Fantasy → Proxy URL.

Cloudflare Workers has a free tier that covers this easily. The cookies live as Cloudflare secrets — never in your repo, never in your browser.

The proxy also unlocks free-agent suggestions, which need a request header ESPN won't accept directly from a browser.

## Step 7 — Followed teams

Click **Add team**, pick a league and a team. Their games appear in the Calendar tile alongside your Google events, and they drive the game-day, win, and loss themes.

---

## Adding a theme

`js/themes.js` is a plain array. Copy any entry, change the values, reload. Nothing else needs editing.

```js
{
  id:'holiday',
  label:'Holidays',        // shows on the left status rail
  priority:40,             // highest matching priority wins
  sky:'snow',              // rain | snow | clear | clouds | storm
                           // | fog | stars | confetti | none
  when: c => c.month === 12,
  tokens:{
    '--ink':'#0B1410', '--panel':'#122018', '--panel-2':'#16281E',
    '--edge':'#1F3A2A', '--text':'#EAF6EE', '--muted':'#7FA891',
    '--accent':'#D64545', '--accent-ink':'#FFFFFF',
    '--good':'#37E27C', '--bad':'#D64545', '--rail':'#D64545'
  }
}
```

`when(c)` receives:

| field | contents |
|---|---|
| `c.weather` | `{ main, desc, temp, feels, wind, city, isDay }`, or `null` before weather loads |
| `c.games` | followed-team games: `{ league, name, abbr, opponent, home, kickoff, state, result, score }` |
| `c.hour` | 0–23 |
| `c.month` | 1–12 |

`state` is `pre`, `in`, or `post`. `result` is `win`, `loss`, or `null`, and is only set for games that finished today.

Every token in `:root` at the top of `style.css` can be overridden. Set Settings → Theme → Mode to **Pick one** to lock a theme while you work on it.

---

## How often things refresh

| Tile | Interval |
|---|---|
| Weather | 10 minutes |
| Portfolio | 5 minutes |
| Gmail, Calendar | 5 minutes |
| Team scores | 15 minutes |
| Fantasy, Movies | on load and on settings change |

Clock updates every 15 seconds.

---

## Testing locally

```bash
cd control-deck
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` by double-clicking won't work — Google OAuth needs a real `http://` origin.

---

## Known limits

- **Banks and brokerages are not connected, by design.** Schwab, Vanguard, and Bank of America don't hand out account access to browser-side pages, and you wouldn't want them to. The portfolio tile prices the holdings you list; balances stay where they belong.
- **Free-agent suggestions need the proxy.** The header ESPN requires triggers a CORS preflight it won't answer directly.
- **ESPN's fantasy API is unofficial.** It can change without notice. If the tile breaks after an ESPN update, that's usually why.
- **Finnhub's earnings calendar is restricted on some plans.** The tile says so plainly if your key can't reach it.
- **Google test-user mode expires.** An unpublished OAuth app makes you re-approve every 7 days. Publishing the consent screen removes that.
