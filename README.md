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
- **Fantasy scoreboard** — on Sundays and Mondays only: the week's matchup and the two scores, nothing else. The lineup is a screen's worth of reading and it has one — the fantasy AD.

Click any day to focus it; double-click for a summary dialog.

**Weather** is called out at the **top right of the page**: the glyph, the temperature at full size, today's high and low, what it feels like, and — the part worth acting on — whether it rains today and roughly when. Click it, or the temperature pill in the header, for 24 hours and two weeks at full size. The detailed forecast otherwise lives in its own kiosk AD; the tile that used to sit under the grid is gone.

**Sticky notes.** The tray that used to sit under the calendar is gone; **+ Add Note** in the calendar header creates a note pinned to whichever day is in focus. Notes still drag between days, and the Notes tab has an un-pin control (⇱) on any pinned note. Completing a note never deletes it.

### Live score strip

When a followed team is playing — from an hour before first pitch until the final — the score sits in
the **header**, between the tabs and the clock, whatever tab is up. While the game is live it refreshes
on its own timer rather than waiting for the fifteen-minute schedule poll. Click it for the game popup.

### Sports

One sub-tab per followed team, and three panels that fit the screen without scrolling.

- **Top left — the next game.** Both teams with their records and their last three results as W/L pills, the full date and time, and the betting line drawn as a bar in the two teams' own colours, split where the market has it, with the line printed on the seam. Baseball adds both probable starters; football adds the team numbers. Click it for the full stats popup.
- **Top right — where they stand.** The team's own conference table with them highlighted: AFC or NFC, American or National, Eastern or Western. College has 130 teams and no table worth the space, so it gets the **AP Top 25** instead.
- **Bottom third — the next five.** One mini per game: opponent, date and time, venue and the line. No carousel and no scroll; five is the whole row.

**Georgia Tech football is followed out of the box.**

The same preview card is what the calendar's focus strip shows for a day's games: the two teams, their records, when it starts, where to watch, the venue, the line, and each side's stat leaders as small buttons under its own logo. **Baseball before the last out is the exception** — the two probable starters carry the card and the season leaders wait for the popup, because that is what the matchup actually is. Once a baseball game is final those leaders are its box score, which is exactly what a recent result should show.

**Every game opens the stats popup** — the preview cards, the rest-of-season rows and the recent results alike. The popup holds the final line, the per-quarter score, both teams' totals side by side, the probable starters before first pitch, and each side's leaders; click a leader for their season game log. Every popup in the app closes three ways: the × in its corner, a click on the backdrop, or Escape.

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
- **Recently watched** — a tall column down the left: poster, who watched it, when, the stars and the
  review. **Yours and your whole network's**, mixed and newest first — the following list is scraped
  once a day and each person's diary RSS every three hours. Yours carry an accent edge and your own
  name; everyone else's are green. **This needs the redeployed worker** — see Step 8.

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

Two bars along the bottom. Each has a **fixed head** that never moves and a **crawl** that takes the width left over; both pause on hover.

- **Markets** — the head carries today's move across the whole portfolio, then the best name and the worst with their percentages. The crawl continues with everything else.
- **Inbox** — three lamps: a red warning triangle for important, an envelope for ordinary, a tin for spam, each with its unread count. **Unlit is an outline**; anything unread fills the shape and colours the number. The inbox and spam figures come from Gmail's labels endpoint, which carries the real count — a search's `resultSizeEstimate` is exactly that, an estimate, and on a large mailbox it is wrong by hundreds. Important has no label of its own, so it is counted by listing the ids of unread, important, Primary-inbox mail.

Teams are managed in Settings, since following a team is a rare action and its games belong on the calendar.

### Kiosk rotation

**AUTO** in the header hands the deck over to itself: each tab holds for 15 seconds, and after a full pass
one full-screen **AD** summarises the most important thing from a single tab for 30 seconds. ADs take
turns, one per pass, so every tab gets equal airtime. Touching the screen pauses everything and the
rotation resumes 20 seconds after the last interaction.

What the ADs show:

- **Calendar** — today's events, or if today is empty, the next day inside a week that isn't, headed
  "In 4 days". If the whole week is empty the AD is **skipped** and the next pass starts immediately —
  the only slot that is ever skipped rather than rendered.
- **Weather** — the rest of today hour by hour, then the next seven days. Rain chance called out.
- **Sports** — the next game as a full preview: both teams' logos and records, the full date and start
  time, the venue, where to watch, the betting line, both sides' season stat leaders, and for baseball
  the two probable starting pitchers at full size. Football gets the team numbers instead — points and
  yards a game, for and against.

  The screen is **split into the two teams' own colours, in proportion to the line**: a one-point
  favourite takes just over half of it, a two-touchdown favourite takes nearly all of it, and the
  underdog always keeps a strip of its own. A moneyline is read the same way, as the implied
  probability it already is.
- **Portfolio** — today's move, with the day's top gainers and top losers.
- **Movies** — a coming release or a watchlist pick, with its synopsis (fetched on demand for films past
  the detail cap), the exact release date and a countdown, and three ratings: Rotten Tomatoes, Letterboxd
  and TMDB. A rating that cannot be reached shows an em dash rather than disappearing.
- **Fantasy** — the matchup with **every starter** on both sides, their points and the team logos.
- **Notes** — the nearest open note.

No AD ever scrolls: anything too tall for the screen is scaled down until it fits, which is why a
40-holding portfolio and a two-team stat sheet both land on one screen.

**Settings → Kiosk rotation** is one switch per thing the deck can show. Turning one off drops both its
tab and its full-screen AD; Weather is an AD with no tab, To Do is a tab with no AD and starts off.

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

**Ratings.** Letterboxd's site-wide average is read from the film's own page through the same worker,
and your network's diaries through its following list, so **redeploy the worker** after this update —
the `/letterboxd/film/…` and `/letterboxd/…/following/` paths are both new. Rotten Tomatoes has no
public API at all; it comes from [OMDb](https://www.omdbapi.com/apikey.aspx) instead, a free key you
paste into Settings → API keys. Both are cached per film forever, and either one missing just shows an
em dash. Click any poster and the popup names each score and its scale — a bare 7.4 says nothing about
out of what, or from whom.

The Letterboxd lookup **checks the year on the page it landed on**. Letterboxd keeps the bare slug for
whichever film got there first and hands later ones the year, so `/film/the-odyssey/` is the 1997
Konchalovsky film at 3.2 and Nolan's is `/film/the-odyssey-2026/` at 4.4. The year-suffixed guess is
tried first and a page whose year disagrees is refused outright — a missing rating is better than
another film's.

**If anyone has written about the film**, that goes above the studio's synopsis, in the movie AD and in
the popup: who said it, what they gave it, and their words. Yours wins over the network's, and an entry
with actual writing wins over a bare star rating.

## Light and dark, with the sun

The deck goes **light at sunrise and dark at sunset**, off the real times for your coordinates rather
than a guess at office hours — Open-Meteo returns them, and the request URL is patched to ask for them
even if you hand-edited it. A clear day gets **Sunshine**, warmer and brighter than the plain daylight
theme; the forty minutes either side of sunrise and sunset get **Golden hour**. Named weather still
outranks all of it, because rain is not a bright day.

## Weather on screen

The theme has always changed colour with the weather. It now changes the screen itself:

- **Snow** falls and **settles on the panels** — every card, note, row, news item and calendar cell
  grows a drift along its top edge over the next few minutes. The drift is inset by each panel's own
  corner radius and rolls off at the ends, because past the corner the surface is curving away
  underneath and there is nothing to sit on.
- **Rain** falls, **runs off the bottom edge of everything it lands on** as drips, and gathers in a
  **puddle across the bottom of the screen** with the deck's own glow smeared across the wet floor.
- **Sun** throws a **lens flare** from off the top right, ghosts marching through the centre.
- **Wind** leans the panels, on and off, and streaks the background.
- **Thunderstorms** flash, with a bolt, every few seconds.

Each one follows the actual forecast. **Settings → Weather effects** has a master switch and a
force-on box per effect, so any of them can be seen without waiting for that weather. Everything
respects `prefers-reduced-motion`: one static pass, no loop.

There are **two canvases**: the ambient one behind the deck, and a second one in front of it (under the
popups) for the things that have to be on top of the panels to read as weather at all. Drawing the
drifts behind the deck was the bug that made snow skip the calendar and the news list — a drift on the
top edge of one cell is behind the cell above it.

### Game day

On a day a followed team plays, the deck paints itself in **that team's own colour** — accent, rail,
panel wash and edges — and the status rail says whose day it is. A colour too dark to read against
falls back to the team's alternate, and then to the standard green rather than shipping something
illegible. A dark-but-not-black primary is **lifted** toward the light rather than swapped out, so a navy
team stays navy — the Sixers and the Giants both have navy primaries that a flat brightness cutoff used
to push onto their red alternates. Only an actually black primary falls through, which is the Raiders,
and they go silver.

A small **ball sits at the top of the screen for each team playing that day**, in that team's colour and
in the shape of its sport — four teams out on the same day reads as two footballs, a basketball and a
baseball.

**When two teams play at once**, a game already in progress beats one that has not started, and among
those that have not, the one kicking off soonest wins. A genuine tie — two kickoffs at the same minute —
falls back to the order the teams are followed in. It is never a coin toss, and it re-evaluates every
five minutes, so an evening game takes over from an afternoon one as the day goes on.

**Settings → Theme → Game day test** pins the theme to any followed team, whatever the schedule says, so
each one can be seen without waiting for them to play. The rail says `· test` while it is on.

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
