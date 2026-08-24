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
| **Finnhub** | finnhub.io → sign up → dashboard | Free tier. 60 calls/min. Powers quotes and earnings. |
| **TMDB** | themoviedb.org → Settings → API → request a key | Free. Choose "Developer", personal use. |
| **Google** | see Step 4 | Client ID, not a key. |

Weather needs no key at all — see below.

## Weather

Weather comes from [Open-Meteo](https://open-meteo.com), which is **free and unauthenticated — there is no API key**. The request URL itself is the setting: Settings → Weather → *Open-Meteo request URL*.

To change location, edit `latitude` and `longitude` in that URL. To change which fields come back, build a new URL with the [Open-Meteo docs builder](https://open-meteo.com/en/docs) and paste the whole thing in. Leave the box blank to fall back to the default (Philadelphia).

`temperature_2m` and `weather_code` are added automatically to the `hourly` and `current` field lists if your URL omits them — without `weather_code` every forecast day would render with today's icon.

The tile refreshes at **6am, noon, 3pm, 6pm and 10pm** local time, and shows when it last updated. **Refresh** forces one immediately. The last good reading is cached, so a page reload between those times makes no network call and a failed refresh keeps the previous reading on screen rather than blanking the tile.

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

The CSV is an **occasional import, not a live feed.** It is read once to learn *what* you hold — symbol, share count, cost basis — and Finnhub prices those holdings daily from then on. Re-import only when your positions actually change; every few months is fine.

Two formats are accepted.

**A Schwab positions export** (the easy path). In Schwab: **Accounts → Positions → Export**. Multiple account sections, `$`/`%` formatting and the `Positions Total` row are all handled. A holding you own in two accounts is merged into one line, tagged `×2 accts`, and costs one quote lookup rather than two. Cash balances are read per account and added to the total.

**A plain sheet**, if you'd rather keep the list by hand:

```csv
symbol,shares,cost
AAPL,25,142.30
VTI,40,215.10
```

`symbol` and `shares` are required; `cost` is the optional per-share basis. `sample-holdings.csv` is included as a template.

> Note the difference: a Schwab export's `Cost Basis` column is the **total dollars** in a position, while `cost` in the plain format is **per share**. Both are normalised to a total internally.

Click **Import** on the Portfolio tile. Holdings live in your browser only.

### Daily pricing

Quotes refresh **once a day** from Finnhub, on first load of the day, and cache until the date rolls over — so reopening the dashboard repeatedly costs nothing. **Refresh** forces an update.

A symbol Finnhub won't quote falls back to its import-time price, is marked `stale`, and still counts toward total value — but is left out of the day's change so that figure stays honest. Ticker punctuation is translated for you (`BRK/B` → `BRK.B`). Funds and ETFs are excluded from the earnings tile, since they don't report.

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

### A note on the My teams picker

ESPN's team-*list* endpoint (`/teams`) sends no `Access-Control-Allow-Origin` header, so no browser can read it from any origin — it fails with `Failed to fetch` for every league. Schedules and scoreboards on the same host do allow CORS and work fine.

So the dashboard ships built-in NFL, NBA, MLB and NHL rosters using ESPN's own team IDs. Those four leagues need **no proxy at all**: pick a team and its schedule loads normally.

**The proxy does not help here.** ESPN's edge returns `403 Access Denied` to requests from datacenter IPs, so routing the site API through a Cloudflare Worker fails too — it is blocked by IP reputation, not by a header the worker could spoof. (The fantasy host `lm-api-reads.fantasy.espn.com` is *not* blocked, which is why the proxy still works for its actual job.) The two college leagues are therefore unavailable in the picker for now; they need a different data source, not a proxy.

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
- **The Google Calendar API must be enabled separately from Gmail.** Enabling only one gives a `403` on the other tile while the first keeps working. Both live under **APIs & Services → Library**.
- **Google test-user mode expires.** An unpublished OAuth app makes you re-approve every 7 days. Publishing the consent screen removes that.
