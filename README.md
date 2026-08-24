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
js/weather.js           Open-Meteo (no key needed) + the weather tile and popup
js/google.js            Gmail + Google Calendar, incl. silent token renewal
js/stocks.js            portfolio pricing, earnings dates, the weight/return plot
js/fantasy.js           ESPN fantasy football
js/sports.js            team data from ESPN's public site API
js/teams.js             followed teams and their schedules
js/movies.js            upcoming theatrical releases (TMDB)
js/letterboxd.js        watchlist scrape + diary RSS + CSV import
js/moviesview.js        the Movies tab
js/gamecard.js          game previews, standings, player logs, game stats
js/sportsview.js        the Sports tab
js/calendarview.js      the two-week grid and the focus strip
js/notes.js             to-do list + sticky notes
js/ticker.js            the two bottom crawls
js/app.js               boot, clock, settings drawer, refresh timers
proxy/worker.js         optional proxy: private ESPN leagues + Letterboxd
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
| **Finnhub** | finnhub.io → sign up → dashboard | Free tier. 60 calls/min. Today's quotes and earnings dates. |
| **Twelve Data** | twelvedata.com → sign up | Free tier. 800 credits/day. Price history for the longer windows. |
| **TMDB** | themoviedb.org → Settings → API → request a key | Free. Choose "Developer", personal use. |
| **Google** | see Step 4 | Client ID, not a key. |

Weather needs no key at all — see below.

## Weather

Weather comes from [Open-Meteo](https://open-meteo.com), which is **free and unauthenticated — there is no API key**. The request URL itself is the setting: Settings → Weather → *Open-Meteo request URL*.

To change location, edit `latitude` and `longitude` in that URL. To change which fields come back, build a new URL with the [Open-Meteo docs builder](https://open-meteo.com/en/docs) and paste the whole thing in. Leave the box blank to fall back to the default (Philadelphia).

`temperature_2m` and `weather_code` are added automatically to the `hourly` and `current` field lists if your URL omits them — without `weather_code` every forecast day would render with today's icon.

The tile refreshes at **6am, noon, 3pm, 6pm and 10pm** local time, and shows when it last updated. **Refresh** forces one immediately. The last good reading is cached, so a page reload between those times makes no network call and a failed refresh keeps the previous reading on screen rather than blanking the tile.

## The layout

A slim header holds the tab bar, a weather pill (glyph + temperature, click to refresh), the clock, a weather button that opens the full forecast, and a settings cog. Six tabs:

Every tab is designed to fit a 1920x1080 screen with **no page scrolling**. The layout is a max-width lock rather than fixed pixels, so a smaller screen degrades gracefully instead of clipping. Panels whose contents are genuinely unbounded — a full season of fixtures, every note, a standings table — scroll inside their own frame rather than pushing the page.

### Calendar

A rolling two-week grid, deliberately sparse so it can stay large: a weather glyph with the day's high/low, event pills (Google events, team games, earnings dates), and any sticky notes pinned to that day. A 🎬 marks days with a film release.

Everything that needs room renders in the **focus strip below the grid** for whichever day is selected:

- **Game preview** — both teams' logos and records, each side's stat leaders as small buttons under its own logo, kickoff or live score, who's broadcasting, venue and the betting line. For baseball it also carries both **probable starting pitchers** with their season line. Click the card for the full stats popup, a leader for their game log, or **Standings** for the league table. When a day holds several games, one preview shows at a time and they **rotate themselves every 12 seconds**; the dots page through them by hand, and a pointer over the card holds it.
- **Movie crawl** — posters for that day's releases with genre and director, **crawling like the market ticker** below. Click one for the synopsis. Every line of text is clipped to the width of the poster above it.

The game preview and the poster crawl sit **side by side**, with the fantasy board above them, so the whole panel fits its height without scrolling.
- **Fantasy scoreboard** — on Sundays and Mondays only, showing the week's matchup score and each side's top three scorers.

Click any day to focus it; double-click for a summary dialog.

- **Weather tile** — under the grid: the current conditions, an hour-by-hour strip, and a seven-day outlook with rain chance. Click **Open detail** (or the weather button in the header) for 24 hours and two weeks at full size.

**Sticky notes.** The tray that used to sit under the calendar is gone; **+ Add Note** in the calendar header creates a note pinned to whichever day is in focus. Notes still drag between days, and the Notes tab has an un-pin control (⇱) on any pinned note. Completing a note never deletes it.

### Sports

One sub-tab per followed team, showing the team's record and conference standing, the schedule, recent results, and the latest team news from ESPN. **Georgia Tech football is followed out of the box.**

The **whole remaining season** is listed, not a fixed handful of games. The next three get preview cards; the rest are compact rows, because each preview card costs a summary request to enrich and a 162-game baseball season would fire one per game.

A preview card carries only what you read at a glance: the two teams, their records, when it starts, where to watch, the venue and the line — plus both **probable starting pitchers** for baseball. Everything else is one click away.

**Every game on the tab opens the stats popup** — the preview cards, the rest-of-season rows and the recent results alike. The popup holds the final line, the per-quarter score, both teams' totals side by side, the probable starters before first pitch, and each side's leaders; click a leader for their season game log. Every popup in the app closes three ways: the × in its corner, a click on the backdrop, or Escape.

Sports data needs no API key. It is fetched straight from ESPN's public site API — never through the fantasy proxy, because ESPN answers `403` to datacenter IPs and routing it through a Worker breaks calls that work fine from the browser.

### Portfolio

Returns over five windows, plus a scatter of weight against return. See below. The whole tab is sized to
**fit its screen without scrolling** — the plot takes whatever room the cards leave.

**Every holding is plotted**, including ones with no price history for the chosen window — those sit in a
dashed "no history" lane on the left rather than being dropped from the chart or, worse, drawn at 0% as
though they were flat. Hovering any bubble shows its ticker, its return, and its share of the portfolio.

### Movies

Four blocks. The three poster blocks are each **one line that crawls**, on the same mechanism as the
market ticker — two copies of the row translated by half their width, so the loop never seams. Hovering
pauses it. Every poster carries its genre under the title:

- **Must watch** — your Letterboxd watchlist.
- **Popular movies out now** — what is actually in cinemas this week, ranked by TMDB popularity.
- **Coming out** — upcoming theatrical releases from TMDB, the same feed that puts 🎬 pills on the
  calendar, here with room for posters. The full forward window of the endpoint is fetched, not just the
  first page.
- **Recently watched** — your Letterboxd diary feed, with your star ratings.

Each line is capped so a lap stays watchable, and a chip on a **Coming out** poster says how many days
until release. Films already in cinemas carry no chip — a row of identical labels is just noise over the
art.

See **Step 8** for the Letterboxd setup.

### To Do

A running backlog of improvement ideas for this dashboard — type one in, Enter or **Add** to file it,
click the box to tick it off, × to drop it. **Showing:** cycles open → all → done. Deliberately separate
from sticky notes: notes are pinned to a day and go stale, ideas have no date at all. It is not part of
the kiosk rotation.

### Notes

Every note ever written, with the day it was pinned to, when it was created, and whether it is done. Filter by all / open / done.

### Fantasy

Its own tab, intentionally a shell for now.

### Tickers

Two separate crawls along the bottom — **markets** (the day's biggest movers, by percentage) and **inbox** (unread mail). Each pauses on hover.

Teams are managed in Settings, since following a team is a rare action and its games belong on the calendar.

### Kiosk rotation

**AUTO** in the header hands the deck over to itself: each tab holds for 15 seconds, and after a full pass
one full-screen **AD** summarises the most important thing from a single tab for 30 seconds. ADs take
turns, one per pass, so every tab gets equal airtime. Touching the screen pauses everything and the
rotation resumes 20 seconds after the last interaction; **SKIP** jumps to the next AD without counting as
an interruption.

What the ADs show:

- **Calendar** — today's events, or if today is empty, the next day inside a week that isn't, headed
  "In 4 days". If the whole week is empty the AD is **skipped** and the next pass starts immediately —
  the only slot that is ever skipped rather than rendered.
- **Sports** — the next game as a full preview: both teams' logos and records, the screen tinted with
  each team's own colours, the full date and start time, the venue, where to watch, the betting line,
  both sides' season stat leaders, and for baseball the two probable starting pitchers at full size.
- **Portfolio** — today's move, with the day's top gainers and top losers.
- **Movies** — a coming release or a watchlist pick, with its synopsis (fetched on demand for films past
  the detail cap), the exact release date and a countdown, and three ratings: Rotten Tomatoes, Letterboxd
  and TMDB. A rating that cannot be reached shows an em dash rather than disappearing.
- **Notes**, **Fantasy** — the nearest open note, and the current (or, midweek, the coming) matchup.

**Settings → Kiosk previews** carries one button per followed team as well as one per AD, so a six-team
deck can be checked a screen at a time instead of only ever showing whichever game is nearest. Any of
them opens that single AD and holds it there — no rotation, no timer —
so it can be restyled without waiting for its slot. It works whether AUTO is on or off, closes with the ✕
or Escape, and is `Kiosk.previewAd('sports')` from the console.

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

Quotes refresh **once a day** from Finnhub, on first load of the day, and cache until the date rolls over — so reopening the dashboard repeatedly costs nothing. **Refresh** forces an update. Ticker punctuation is translated for you (`BRK/B` → `BRK.B`). Funds and ETFs are excluded from the earnings feed, since they don't report.

Finnhub's free tier returns **only the current price and today's move** — no history. The weekly, monthly, 6-month and 1-year windows therefore need a second free key from [Twelve Data](https://twelvedata.com/pricing) (Settings → API keys). Without it, Today still works and the other four windows say so rather than showing nothing.

Finnhub does not price **mutual funds, money-market funds and some ETFs** at all — it answers with a zero price rather than an error. Those holdings are then quoted from Twelve Data instead, and if that has no coverage either, the `Price` / `Mkt Val` columns from your own CSV are used as a last resort. Anything left over is listed by name in a **Not priced** strip under the plot rather than being dropped from the tab; `Stocks.coverage()` in the console prints the per-symbol breakdown — live quote, which provider it came from, CSV fallback, and whether history exists.

Twelve Data's free tier allows 800 credits a day and 8 requests a minute. Symbols are batched 8 to a request, so 41 holdings cost 41 credits in about 6 requests, once daily. Only six prices per symbol are kept — the rest of the year of daily bars is discarded on arrival, which keeps the cache small.

### Deliberately vague

The Portfolio tab **never shows a total value.** Percentages are exact; dollar amounts are described only by order of magnitude — "up a few hundred", "down a couple grand", "up tens of thousands". Everything money-shaped goes through one `vague()` function, so there is a single place to change the scale.

Five window cards — today, this week, this month, six months, one year — each showing the return, a size description, and the best and worst five holdings by percentage.

Clicking a card re-plots the **scatter below it**: each holding is a bubble positioned by its return for that window (horizontal) against its share of the portfolio (vertical), with bubble area also tracking weight. That is the whole "how much of it is this, and how is it doing" question in one picture. It is inline SVG — no chart library, and it themes off the same CSS variables as everything else.

**Accounts** split with the sub-tabs beside the Refresh button: all combined, or one at a time. A holding you own in two accounts contributes only its shares from the selected account, so the percentages are genuinely per-account rather than a filtered view of the whole.

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

The proxy also unlocks free-agent suggestions, which need a request header ESPN won't accept directly from a browser, and it forwards Letterboxd (see Step 8). **If you deployed this worker before the Movies tab existed, redeploy it** — the Letterboxd path is new.

### A note on the My teams picker

ESPN's team-*list* endpoint (`/teams`) sends no `Access-Control-Allow-Origin` header, so no browser can read it from any origin — it fails with `Failed to fetch` for every league. Schedules and scoreboards on the same host do allow CORS and work fine.

So the dashboard ships built-in NFL, NBA, MLB and NHL rosters using ESPN's own team IDs. Those four leagues need **no proxy at all**: pick a team and its schedule loads normally.

**The proxy does not help here.** ESPN's edge returns `403 Access Denied` to requests from datacenter IPs, so routing the site API through a Cloudflare Worker fails too — it is blocked by IP reputation, not by a header the worker could spoof. (The fantasy host `lm-api-reads.fantasy.espn.com` is *not* blocked, which is why the proxy still works for its actual job.) The two college leagues are therefore unavailable in the picker for now; they need a different data source, not a proxy.

## Step 7 — Followed teams

Click **Add team**, pick a league and a team. Their games appear in the Calendar tile alongside your Google events, and they drive the game-day, win, and loss themes.

---

## Step 8 — Letterboxd (Movies tab)

Letterboxd publishes **no API**, and its pages send no `Access-Control-Allow-Origin` header, so a static
page on GitHub Pages cannot read them — the browser blocks the request outright. Its RSS feed carries only
films you have *logged*; there is no feed for a watchlist. So there are two ways in, and you can use either
or both.

**Option A — through the worker (stays current on its own).**

1. Deploy or redeploy the proxy from Step 6. The same worker now forwards `/letterboxd/*`.
2. Settings → Movies → paste the worker URL into **Scrape proxy URL** and put your username in
   **Letterboxd username**.

This reads your public watchlist page and your diary RSS server-side. Both are cached in the browser, so a
reload costs nothing and a Letterboxd outage leaves the last good list on screen.

**Option B — CSV import (no proxy, never breaks).**

Letterboxd → Settings → Data → Export, then **Import watchlist CSV** on the Movies tab. Nothing to deploy,
but it goes stale until you re-import.

Posters are in neither payload. Titles are matched against TMDB (the key you already added in Step 3) and
the result is cached per film, so a settled watchlist reloads without spending any API calls.

**Ratings on the movie AD.** Letterboxd's site-wide average is read from the film's own page through the
same worker, so **redeploy the worker** after this update — the `/letterboxd/film/…` path is new. Rotten
Tomatoes has no public API at all; it comes from [OMDb](https://www.omdbapi.com/apikey.aspx) instead, a
free key you paste into Settings → API keys. Both are cached per film forever, and either one missing
just shows an em dash.

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
| Weather | fixed slots: 6am, noon, 3pm, 6pm, 10pm |
| Portfolio quotes | once a day (hourly poke to catch the date rolling over) |
| Gmail, Calendar | 5 minutes |
| Google access token | renewed silently ~5 min before it expires |
| Team scores | 15 minutes |
| Live game schedules | 5 minutes |
| Fantasy, Movies, Letterboxd | on load and on settings change |

Clock updates every 15 seconds. The weather timer reschedules itself from the wall clock after every run,
so it survives a laptop sleep and a DST change instead of drifting.

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
- **Google sign-in has two separate expiries, and only one is fixable in code.** The *access token* lasts
  about an hour; the dashboard now renews it silently before it lapses, retries once on a rejected call, and
  re-arms itself on reload, so normal use no longer needs a manual reconnect. But an **unpublished OAuth app
  in test-user mode also expires its grant every 7 days**, and no amount of silent renewal can get around
  that — the only fix is publishing the consent screen in the Google Cloud console. If you are still being
  asked to reconnect roughly weekly, that is which of the two you are hitting.
- **The Letterboxd watchlist is scraped, not queried.** There is no API to use. The parse reads the
  metadata attributes on Letterboxd's poster grid and falls back through two older markup shapes, but a big
  enough redesign on their end will still break it — in which case the Movies tab keeps showing the cached
  list and says what went wrong, and the CSV import always works.
