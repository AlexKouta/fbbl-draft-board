# PRD: Fantasy Basketball Draft Board

Oct 10, 2026 · @Alex

Updated 11 October 2026: team depth charts added (a Depth view and a Team depth section in the player sheet), merged from the addendum in `reference/PRD Addendum Team Depth Charts.md`. The PRD describes what was built; `DECISIONS.md` records where the build departed from the addendum and why.

## Summary

Build an offline-capable web app for iPad that ranks NBA players by fantasy points under the Williamstown FBBL scoring rules, lets Alex tier and annotate them before the draft, shows each player's competition for minutes on his NBA team, and tracks picks during the draft. It must be deployed and usable on the iPad before the draft at 4:00pm on Sunday 11 October 2026 (Melbourne time).

| Item | Decision |
| --- | --- |
| Form | Static web app (plain HTML, CSS, JavaScript), installable to the iPad home screen as a PWA (progressive web app: a website that caches itself and opens like an app) |
| Hosting | GitHub Pages, public repository |
| Data | ESPN's public fantasy basketball player pool, fetched once at build time by a local script and saved as a static file. No login, no league endpoints |
| Stat sources | ESPN projection for 2026-27 (default) and actual 2025-26 stats, toggled in the app |
| Player pool | About 220 to 240 players |
| Tiers | S, A, B, C, D, E, F, seeded from projected fantasy points per game, editable |
| Modes | Prep mode (edit tiers, flags, notes, targets) and Draft mode (mark picks only) |
| Depth charts | Every NBA team's roster by position, ordered by ESPN projected minutes per game, as a Depth view and as a Team depth section in the player sheet. Inferred from projections, not a coach's depth chart, and labelled that way |
| Persistence | All user input saved on the device, with export and import as backup. The depth charts add only the last team viewed |
| Builder | Claude Code, running locally on Alex's Mac |

Reference files in the project: `ESPN Fantasy Basketball API Catalogue.md`, `espn_fba_id_map.json`, `espn_fba_sample_responses.json`, `espn_fba_data_access.md`. Copy them into the repository's `reference/` folder if they are not already there.

## Instructions for Claude Code

This document is the full brief. Build everything in it, make sensible decisions where it is silent, and record those decisions in `DECISIONS.md` instead of asking. Speed matters more than polish: there is a hard deadline and Alex needs time after the build to do his draft preparation in the tool.

**Stop and ask Alex only when:**

- The ESPN data fetch fails, or the validation checks in the Data section do not match.
- GitHub access is not set up (no `gh` login, or the push or Pages setup fails).
- A requirement marked **Must** cannot be met.

**Do not stop for:** styling choices, library choices, file layout, anything marked **Nice**. If a Nice item takes more than about 15 minutes, skip it and note that in `DECISIONS.md`.

**Ask for another turn when it improves the result.** Three turns is the expectation, not a limit. The planned shape is: turn 1 builds and deploys, turn 2 fixes what Alex finds on the iPad, turn 3 is polish.

**End turn 1 with:**

1. The live URL.
2. The data validation results.
3. The seeded tier boundaries (the players either side of each cut, with their projected points per game).
4. A list of anything skipped or decided on Alex's behalf.
5. A short iPad test script (the steps in the Acceptance section that need a real device).

## Goals and league context

The tool has to answer one question quickly, many times in a row: who is the best player still available for my team right now?

**Goals**

- Rank players by fantasy points per game and season total, under this league's scoring.
- Let Alex impose his own judgement before the draft: tiers, an uptick flag, notes and target picks.
- Track the draft as it happens with minimal taps, and keep the available list accurate.
- From any player, in Prep or Draft mode, see his teammates at the same position group ordered by projected MPG, with minutes, the change in minutes from last season, shot volume, injury status and draft status beside each name. Browse any team's full depth chart by position.
- Work with no internet, and never lose data.

**Out of scope**

- Live connection to ESPN during the draft, or any league endpoint, cookie or login.
- Tracking which opponent took which player. Picks are only "mine" or "other".
- Automated pick recommendations.
- Syncing between devices (export and import covers moving data).
- Deciding which players get the uptick flag. Alex will do that separately; the tool only stores the flag.
- Official or coach-confirmed depth charts and starting line-ups. ESPN's fantasy API does not supply them reliably. Editing or reordering depth charts by hand. Detecting that a player changed teams in the off-season (season totals carry no team, so last season's minutes may have been earned elsewhere). Drafting a player who is not in the draft pool; non-pool teammates are shown for context only.

**League rules that shape the tool**

| Rule | Value |
| --- | --- |
| League | Williamstown FBBL, ESPN, head-to-head points |
| Teams | 10 |
| Roster | 13 players: PG, SG, SF, PF, C, G, F, 3 UTIL, 3 bench. No injured reserve slot |
| Draft | Snake (order reverses each round), 13 rounds, 130 picks, no keepers |
| Alex's draft slot | Unknown until about 3:00pm on draft day. Entered in the app's settings |
| Draft room | ESPN's draft room runs on a separate device. This tool is a companion |

Scoring formula:

```latex
\text{FP} = \text{PTS} + \text{REB} + \text{AST} + 2\,\text{STL} + \text{BLK} - \text{TO} + (\text{FGM} - \text{FGA}) + (\text{FTM} - \text{FTA})
```

Keep the weights in one config object so they are easy to change. Stat IDs for each term are in `espn_fba_id_map.json` under `league_41967023.scoringWeights`.

## Data

All data comes from one public ESPN endpoint, fetched by a script on the Mac and written to a static file that the app ships with. The app itself never calls ESPN.

### Fetch

Write `scripts/fetch_data` (Node or Python, standard library only) that produces `data/players.json`.

- **Endpoint:** `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/players?view=kona_player_info`. Season `2027` means 2026-27.
- **Header:** the request needs an `X-Fantasy-Filter` header (a JSON object that controls paging and which stat entries return). Without it only 50 players come back. Starting point, to adjust until validation passes:

```json
{"players":{"limit":1500,"sortPercOwned":{"sortPriority":1,"sortAsc":false},"filterStatsForTopScoringPeriodIds":{"value":2,"additionalValue":["002027","102027","002026"]}},"filterActive":{"value":true}}
```

- The exact header shape for the global `/players` path is the least certain part of this brief. The catalogue and `espn_fba_sample_responses.json` show working examples. If `limit` is capped, page with `offset`. Expect about 1,095 active players.
- Save the raw response to `data/raw/` (git-ignored) so the transform can be re-run without re-fetching. Make at most a handful of calls; this is an unofficial API with no published rate limits.
- Do not call any `/leagues/` endpoint and do not use cookies.

### Fields per player

| Output field | Source |
| --- | --- |
| `id`, `name` | `id`, `fullName` |
| `team` | `proTeamId`, decoded with `proTeams` in the ID map (0 = free agent, show `FA`) |
| `positions` | `eligibleSlots` filtered to slots 0 to 4, decoded to PG, SG, SF, PF, C. A player can have several |
| `primaryPosition` | `defaultPositionId` (1 = PG to 5 = C; a different numbering from slots) |
| `injuryStatus` | `injuryStatus` (`ACTIVE`, `DAY_TO_DAY`, `OUT` and others listed in the ID map) |
| `adp` | `ownership.averageDraftPosition` (average draft position across ESPN leagues) |
| `espnRank` | `draftRanksByRankType.STANDARD.rank` |
| `proj` | Stats entry with `id` `102027` (ESPN's 2026-27 projection) |
| `last` | Stats entry with `id` `002026` (2025-26 actual totals) |
| `age` | **Nice.** See below |

For each of `proj` and `last`, store: games played (stat 42), total minutes (stat 40), and totals for PTS, REB, AST, STL, BLK, TO, FGM, FGA, FTM, FTA and 3PM. Compute and store:

- `fp`: season fantasy points, from the formula and totals. Round to 1 decimal.
- `fppg`: `fp / gamesPlayed`, 1 decimal. Zero when games played is zero.
- `mpg`: `minutes / gamesPlayed`, 1 decimal.

A player with no `002026` entry (rookies, or anyone who missed the whole season) gets zeros for `last`. A player with no `102027` entry gets zeros for `proj`.

### Player pool

The pool is the union of three sets:

1. Top 200 by projected 2026-27 season fantasy points.
2. Top 200 by actual 2025-26 season fantasy points.
3. A manual include list of ESPN player IDs in `scripts/config`, empty to start.

This should give about 220 to 240 players. Players who missed last season but have a projection, such as Tyrese Haliburton, enter through set 1. Print a warning if Haliburton is not in the final pool.

### Tier seeding

Seed tiers at build time and store as `seedTier` on each player.

1. Sort the pool by projected points per game, descending.
2. Start from these cumulative cut positions: S ends at 5, A at 15, B at 30, C at 50, D at 80, E at 120. F is everyone after that.
3. For each cut, look at the candidate positions from 3 above to 3 below the target. Move the cut to the candidate with the largest gap in projected points per game between that player and the next.

That gives roughly S 5, A 10, B 15, C 20, D 30, E 40, with each boundary sitting on a natural drop-off.

### Team depth charts

Built in the same transform run from the same raw response, so a draft-morning refresh rebuilds them with current injury status.

- Group every active player by `proTeamId`, excluding 0 (free agents), decoded with `proTeams` in the ID map.
- A player is on a team's chart when his `102027` projection has games and minutes above zero. A pool player with a team is always on that team's chart, even without a projection (placed last, with a dash for MPG) and even beyond the cap, with a warning printed for each case.
- Keep at most 15 players per team by projected MPG.
- Position groups, derived from eligible positions: Guards = PG or SG, Forwards = SF or PF, Centres = C. A PF/C belongs to both Forwards and Centres.
- Every stat block (`proj` and `last`, pool and non-pool) also stores `poss`, possessions used per game, and `gs`, games started:

```latex
\text{POSS} = \frac{\text{FGA} + 0.44\,\text{FTA} + \text{TO}}{\text{GP}}
```

The 0.44 weight sits beside the scoring weights in the fetch script and is exported as `usageFtWeight`. **Usage** in the app is a player's POSS as a share of the sum across his team's chart, labelled as an estimate of the team's projected shots, free-throw trips and turnovers.

- Output: a top-level `teams` object in `data/players.json`, keyed by team abbreviation, each with `name`, `totalProjMpg` and `roster[]` sorted by projected MPG. Pool players are stored as `{ id, inPool: true }` and resolved against `players[]` at load; non-pool teammates carry a light record with the same field names (`id`, `name`, `team`, `positions`, `primaryPosition`, `groups`, `injuryStatus`, `inPool`, `proj`, `last` with `gp`, `mpg`, `fppg`, totals for `fga`, `fta`, `to`, plus `poss` and `gs`).
- Roster validation, printed every run and failing loudly on the first two: exactly 30 teams; at least 8 players with a projection on every team; total projected MPG per team printed for all 30 with a warning outside 200 to 280 (most teams exceed 280 because ESPN projects overlapping bench minutes, see `DECISIONS.md`); every pool player with a team present on that team's chart; the four fantasy-point rows unchanged. The script also prints the Denver and Oklahoma City charts as text.

### Age (Nice)

Age is not in the fantasy API. Try ESPN's public athlete endpoint, which is unverified: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/{id}`, reading `age` or `dateOfBirth`. Only call it for players in the pool, throttled. If it does not work within 15 minutes of effort, leave `age` null and hide the column.

### Validation (Must pass before building the UI)

The script must print these and fail loudly if they do not match. Expected values come from live responses captured on 10 October 2026.

| Player (ESPN ID) | Source | Games | Fantasy points | Per game |
| --- | --- | --- | --- | --- |
| Nikola Jokic (3112335) | 2025-26 actual | 65 | 2,757 | 42.4 |
| Nikola Jokic (3112335) | 2026-27 projection | 72 | 3,068 | 42.6 |
| Shai Gilgeous-Alexander (4278073) | 2025-26 actual | 68 | 2,284 | 33.6 |
| Victor Wembanyama (5104157) | 2025-26 actual | 64 | 2,104 | 32.9 |

Allow a tolerance of 1 point on the projection row in case ESPN has updated it. Also print: pool size, the top 20 by projected points per game, and the players either side of each tier cut.

### Output file

`data/players.json` holds `builtAt` (timestamp), `season`, `scoringWeights`, `usageFtWeight`, `players[]` and `teams{}`. Player state in the app is keyed by ESPN `id`, so re-running the fetch on draft morning to refresh injury status must not disturb Alex's tiers, notes or picks.

## Architecture

A static site with no build step and no external dependencies at run time, so it works offline and deploys by pushing files.

| Part | Requirement |
| --- | --- |
| App | `index.html` plus CSS and vanilla JavaScript. No framework needed for about 240 rows. No CDN scripts, web fonts or analytics: every asset is served from the repository |
| Data | `data/players.json`, loaded at start |
| Offline | A service worker (a script the browser runs to cache the app's files). Use network-first with a 3 second timeout, falling back to cache, for `index.html` and `players.json`, so a data refresh arrives when online and the app still opens when offline |
| Install | A web app manifest and icons, so "Add to Home Screen" on iPad opens it full screen |
| Hosting | GitHub Pages from the repository. Use the `gh` command line tool to create the repository and enable Pages. The repository is public and contains only public player data |
| Paths | All relative, because Pages serves from `/<repo-name>/` |

### Saved state (Must)

Everything Alex enters is saved to `localStorage` (the browser's on-device storage) under one versioned key, written on every change.

| State | Shape |
| --- | --- |
| Per player | `tier`, `uptick` (true or false), `note` (text), `target` (pick number or empty) |
| Picks | One ordered array of `{playerId, by}` where `by` is `me` or `other`. Pick numbers are the array positions, never stored separately, so removing or inserting a pick renumbers everything after it automatically |
| Settings | Teams (10), rounds (13), my draft slot (empty until set), current mode, stat source, sort, filters, `depthTeam` (the last team viewed in the Depth view; missing or unknown values fall back to the first team alphabetically) |

Rules:

- On first run, copy every player's `seedTier` into saved state. After that, a data refresh never changes a tier. A player new to the pool takes their `seedTier`.
- Loading must tolerate missing or extra players and missing fields.
- **Export:** one button that produces the full state as JSON, both as a file download and as text in a box with a copy button (file downloads are awkward on iPad).
- **Import:** paste JSON or choose a file, with a confirmation before overwriting.
- Export and import is also how prep done on the Mac moves to the iPad.

### iPad storage caveat

On iPad, a site opened in Safari and the same site opened from the home screen have separate storage. Prep done in one will not appear in the other. Show a one-line reminder in Settings: "Always open from the home screen icon. Use Export and Import to move data."

## Functional requirements

The app has five views (Players, My Team, Picks, Depth, Settings) and two modes (Prep, Draft). Everything is **Must** unless marked **Nice**.

### Modes

| Mode | What can change | Default status filter |
| --- | --- | --- |
| Prep | Tier, uptick flag, note, target. Picks cannot be marked | All |
| Draft | Picks only. Tier, uptick, note and target are visible but locked | Available |

A clearly labelled toggle switches mode, and the current mode is always visible. The mode survives a reload.

### Players view

The main screen: one table of the whole pool.

**Controls, always visible above the table:**

- **Search** by player name. Filters as you type, ignores case and accents (so "jokic" finds Jokić), has a clear button.
- **Stat source toggle:** Projected 2026-27 (default) or Last season 2025-26. Switches every stat column and the sort.
- **Status filter:** Available, Taken (everyone drafted), Mine, All.
- **Tier filter:** S, A, B, C, D, E, F chips, multi-select.
- **Position filter:** PG, SG, SF, PF, C chips, multi-select. Matches any position the player is eligible for.
- **Team filter:** dropdown of NBA teams.
- **Uptick only** toggle.
- **Group by tier** toggle: sorts by tier first, then the current sort, with a header row per tier showing how many are still available.
- **Clear filters** button, and a count of players shown.

**Columns:**

| Column | Notes |
| --- | --- |
| Rank | Position in the full pool by the current sort and stat source. Not affected by filters or by who has been drafted |
| Player | Name, with an injury badge when status is not `ACTIVE`, an uptick marker, and a note marker when a note exists |
| Team, Pos | Team abbreviation and all eligible positions |
| Age | Nice. Hidden if no data |
| Tier | Coloured chip |
| FPPG | Fantasy points per game for the selected source. Default sort, descending |
| FP | Season fantasy points for the selected source |
| GP, MPG | Games played and minutes per game for the selected source |
| Other FPPG | Points per game from the source not selected, in a muted style, for quick comparison |
| MPG change | Projected minutes per game minus last season's. Helps spot uptick candidates |
| ADP | ESPN average draft position |
| Target | Target pick with its round, such as `45 · R5` |
| Action | Draft mode only. See Draft mode |

Every column header sorts on tap, and a second tap reverses. Players with zero games in the selected source show a dash and sort last.

**Row states:** available rows are normal. Rows taken by others are greyed with their pick number. Alex's rows are highlighted in a distinct colour with their pick number. Under the Available filter, drafted rows disappear immediately.

### Prep mode

- Tapping a row opens a player sheet with: the Team depth section (below), tier selector (seven large buttons), uptick toggle, target pick number field that shows the round as you type, a free-text note, and a side-by-side comparison of projected and last-season stats (GP, MPG, PTS, REB, AST, STL, BLK, TO, 3PM, FG%, FT%, FPPG, FP, each per game where that applies).
- Tapping the tier chip in the table opens a quick tier picker without opening the full sheet.
- Target round is `ceil(target / teams)`.
- Changes save immediately. No save button.

### Draft mode

**Status bar, always visible:**

- Current pick and round, such as "Pick 23 · Round 3".
- Alex's next pick and how far away it is, such as "Your next pick: 38 (Round 4), in 15 picks". When the current pick is his: a prominent "Your pick" state.
- If no draft slot is set: a prompt that opens the setting.
- **Undo** button: removes the most recent pick and names it in a brief confirmation.

Snake order: for slot `s` and `N` teams, Alex's pick in round `r` is `(r - 1) * N + s` in odd rounds and `(r - 1) * N + (N - s + 1)` in even rounds.

**Marking a pick:**

1. Each available row has a large Draft button.
2. Tapping it opens a modal showing the player's name and the pick number about to be assigned, with two big buttons: "Drafted by me" and "Drafted by other". Tapping outside or Cancel closes it with no change.
3. Choosing one appends the pick, closes the modal, updates the table, status bar and My Team, and clears the search box.

**Correcting a pick:** tapping a drafted player's row or pick number opens a modal with "Switch to me" or "Switch to other", and "Return to available". Returning a player renumbers all later picks.

**Target cue:** an available player whose target pick is at or before Alex's next pick gets a visible "target" highlight.

Tapping a player's name in Draft mode opens the player sheet read-only, so notes and the Team depth section can be read without risk of editing. Nothing in the depth chart feature can mark, change or remove a pick.

### Depth row (shared by the player sheet and the Depth view)

Every player on a depth chart is drawn the same way: order number within the list; name with the injury badge and uptick marker; all eligible positions; MPG for the selected stat source (the sort key); MPG change (projected minus last season, signed, a dash when last season has zero games); Usage (share of team, percentage); FPPG for the selected source; the tier chip for pool players; and the same row states as the Players view (greyed with pick number when taken by another team, highlighted with pick number when Alex's).

- A player with zero games in the selected source shows a dash for MPG and sorts last.
- Teammates outside the draft pool are shown muted, with no tier chip, and are not tappable.
- Tapping a pool teammate opens that player's sheet, with a Back control that returns to the previous player.
- The stat source follows the app's global toggle. There is no separate toggle.

### Team depth section in the player sheet

- Appears directly under the sheet header in both Prep mode and Draft mode, and is itself read-only in both. Its list is capped in height and scrolls inside itself, so the tier buttons, target and note stay on screen in Prep mode on a landscape iPad, and the whole section is visible without scrolling in Draft mode.
- Heading: the team and the selected player's position groups, such as "Oklahoma City Thunder · Guards", with the stat source.
- List: every teammate on the team's chart who shares a position group with the selected player, plus the player, ordered by MPG, with the selected player's row highlighted. A player in two groups (such as PF/C) gets one merged list.
- Summary line below the list: rank in the group and the gaps, such as "2nd of 6 guards · 4.2 MPG behind the leader · 6.8 MPG ahead of the next".
- A "Full team" button opens the Depth view on that team with the player highlighted.
- A free agent shows "No team" in place of the section.
- Fixed caption: "Ordered by ESPN projected minutes. Not an official depth chart."

### Depth view

A fifth view beside Players, My Team, Picks and Settings, available in both modes.

- **Team picker**, always visible: all 30 teams as chips in alphabetical order. The last team viewed is remembered.
- **Team header:** team name, number of players shown, total projected MPG, how many are already drafted, and the stat source. Previous and next team buttons.
- **Chart:** five columns in the order PG, SG, SF, PF, C. Each player appears once, under his primary position, ordered by MPG. Each entry is a depth row. An empty column shows a dash.
- **By group** toggle: three columns (Guards, Forwards, Centres) using eligible positions, so a player can appear in two.
- **Highlight:** when opened from a player sheet, that player's row is highlighted and scrolled into view.
- A footnote repeats the caption and defines Usage and MPG change.

Entry points: a row in Prep mode or a name in Draft mode opens the sheet with the section; "Full team" in the sheet opens the Depth view; the Depth tab opens the last team viewed or the first alphabetically; a row in My Team opens the read-only sheet.

### My Team view

- Alex's players in the order drafted: pick number, round, name, team, positions, tier, projected FPPG.
- Roster count, such as 6 of 13.
- Counts by eligible position (PG, SG, SF, PF, C), where a multi-position player counts towards each.
- A lineup grid of the 13 slots (PG, SG, SF, PF, C, G, F, UTIL x3, Bench x3) filled by a best-effort automatic assignment, most restricted slots first, so empty slots show what is still needed. G takes PG or SG; F takes SF or PF; UTIL takes anyone.
- Total projected FPPG of the 10 starters.

### Picks view

A chronological log of every pick: number, round, player, and whether it was Alex's or another team's. Tapping an entry opens the same correction modal. **Nice:** move a pick up or down to fix ordering after a missed pick.

### Settings view

- My draft slot (1 to 10), teams, rounds.
- Export and Import.
- **Reset draft:** clears all picks and keeps tiers, flags, notes and targets. Requires confirmation. This is what makes mock drafts possible.
- **Reset tiers to seed:** requires confirmation.
- Data build time, pool size, and the home screen reminder.

## Design and device requirements

The tool is used under time pressure, on a touch screen, beside another device, so speed and legibility come before looks.

- **Device:** iPad, current Safari, opened from the home screen. Landscape is the primary layout. Portrait must still work, hiding lower-priority columns (Other FPPG, MPG change, Age, FP) before anything else.
- **Also usable** on a Mac in desktop Safari or Chrome, with mouse and keyboard.
- **Touch targets** at least 44 by 44 points. Modal buttons much larger, well separated, and visually distinct for "me" and "other".
- **Sticky** controls, table header and Draft mode status bar. Only the table body scrolls. Keep the Player column pinned if the table scrolls sideways.
- **Speed:** search, filter, sort and marking a pick all respond with no visible delay for 240 rows.
- **No accidental navigation:** disable pull-to-refresh and double-tap zoom. Nothing destructive happens on a single tap without a confirmation, other than Undo.
- **Theme:** follow the device's light or dark setting. Tier chips use seven clearly different colours that work in both.
- **Legibility:** tabular (fixed-width) numerals in stat columns. Dense rows, but names readable at arm's length.
- **Nice:** keep the screen awake in Draft mode using the Screen Wake Lock API where supported.
- **Depth charts:** reuse tier chips, injury badges, row states and numerals; the only new colour is the highlight for the selected player. In landscape all five columns sit side by side with no horizontal scrolling, with the stats line wrapping inside a column rather than truncating. In portrait the columns wrap to three, and on phones to one with Usage and MPG change hidden first. Team chips and tappable rows are at least 44 by 44 points. Per-team lookups are built once at load.

## Acceptance criteria

The build is done when every check below passes. Claude Code verifies the first two groups itself; Alex verifies the third on the iPad.

### Automated tests (Claude Code writes and runs these)

- Fantasy point calculation reproduces the four validation rows in the Data section.
- Snake order: slot 3 of 10 gives picks 3, 18, 23, 38, 43. Slot 10 gives 10, 11, 30, 31. Slot 1 gives 1, 20, 21, 40.
- Round of a pick: 1 is round 1, 10 is round 1, 11 is round 2, 45 is round 5, 130 is round 13.
- Tier seeding: every pool player has exactly one tier, tiers are in order down the projected FPPG ranking, and each cut is within 3 places of its target.
- Picks: after marking five players, returning the second to available leaves four picks numbered 1 to 4 in the original order.
- State: save, reload and import round-trip without loss, and loading tolerates a player ID that is no longer in the pool.
- Position groups: PG gives Guards; SG/SF gives Guards and Forwards; PF/C gives Forwards and Centres; C gives Centres.
- Competition list: for a fixture team, a guard's list contains every teammate eligible at PG or SG and no one else, ordered by projected MPG descending, with the selected player included.
- Depth columns: every roster player appears in exactly one column, the one for his primary position.
- Ordering: a player with zero games in the selected source sorts last, and switching source re-orders by last season's MPG.
- Usage: POSS reproduces a hand-calculated value for one player, and shares across a team's chart sum to 100% within rounding.
- Roster build: 30 teams, no free agents on any chart, every pool player with a team present on that team's chart.
- State: saved state without `depthTeam` loads cleanly, and an export made before the depth chart change imports without error.

### Browser checks (Claude Code, using a local server and a headless browser at 1180 by 820 and 820 by 1180 if one is available)

- The app loads with no console errors and shows the pool sorted by projected FPPG.
- Switching the stat source changes the FPPG, FP, GP and MPG values and re-sorts.
- Each filter works alone and combined, and Clear filters resets all of them.
- A full pass in Prep mode: change a tier, set uptick, add a note, set target 45 and see `R5`. Reload and all four persist.
- A full pass in Draft mode: mark one pick as other and one as mine, see both leave the Available list, see My Team and Picks update, undo, correct, and reload with state intact.
- With the network disabled after first load, a reload still opens the app with data, and the Depth view opens with data.
- Depth charts: no console errors when opening the Depth view. In Prep mode, opening a player shows the Team depth section with that player highlighted and the tier buttons, note and target still on screen. In Draft mode, tapping a name shows the section without scrolling in landscape. Marking a teammate as drafted by another team greys his depth row in both surfaces. "Full team" opens the Depth view on the right team with the player highlighted. Tapping a pool teammate opens his sheet and Back returns to the first player. The team picker, previous and next, and By group all work, and the last team survives a reload.

### iPad checks (Alex)

1. Open the URL in Safari, add to home screen, open from the icon.
2. Turn on aeroplane mode, close and reopen the app. It loads with data.
3. In Prep mode, edit a tier, note and target. Force-close and reopen. Edits are still there.
4. In Draft mode, mark ten picks quickly. The modal buttons are easy to hit and nothing lags.
5. Undo, then return a pick to available from the Picks view. Numbers renumber correctly.
6. Export, Reset draft, Import. Picks come back.
7. Rotate to portrait. The table is still usable.

Depth charts (added 11 October):

8. Close and reopen the app from the home screen icon while online. The Depth tab appears. If it does not, close and reopen once more (the first open fetches the update, the second shows it).
9. Confirm tiers, notes, targets and any picks from before the update are still there.
10. In Prep mode, open a guard on a team you know well. His fellow guards are listed in a believable order.
11. In Draft mode, mark one of his teammates as drafted by other. The teammate greys out in the depth list.
12. Tap "Full team", then switch between three teams. No lag.
13. Turn on aeroplane mode, reopen, and open a depth chart.
14. Rotate to portrait. The depth chart is still readable.

## Build plan and risks

Build in this order, so the riskiest step fails first and a usable tool exists as early as possible.

1. **Data.** Write the fetch script, run it, pass validation, seed tiers, write `players.json`. Stop here only if validation fails.
2. **Core app.** Players view with stat toggle, search, filters, sort and saved state.
3. **Prep mode.** Player sheet, tier editing, uptick, note, target.
4. **Draft mode.** Modal, pick list, undo, corrections, status bar, draft slot.
5. **My Team, Picks, Settings,** including export, import and resets.
6. **Offline and install.** Service worker, manifest, icons.
7. **Test, deploy to GitHub Pages, report back** as described in Instructions for Claude Code.
8. **Nice items,** only if time remains: age, wake lock, pick reordering.

### Timeline (Melbourne time)

| When | Milestone |
| --- | --- |
| Saturday evening, 10 October | Turn 1: built, deployed, on the iPad |
| Sunday by 11:00am | Turn 2 fixes from iPad testing complete. Anything not working by now is cut |
| Sunday 11:00am to 3:00pm | Alex's prep: review tiers, uptick flags, notes, targets. Optional mock draft, then Reset draft |
| Sunday about 3:00pm | Draft slot known and entered. Optional data refresh for injury status. Export a backup |
| Sunday 4:00pm | Draft |

### Risks

| Risk | Likelihood | Response |
| --- | --- | --- |
| Filter header shape is wrong for the global player endpoint | Medium | Working examples are in the sample file. Iterate until validation passes; stop and ask if it cannot be made to work |
| ESPN changes or blocks the endpoint | Low | Raw response is saved locally after the first success, so the build does not depend on a second call |
| iPad Safari behaves differently from desktop testing | Medium | Alex runs the iPad checks after turn 1. Turn 2 is reserved for fixes |
| Saved state lost on the iPad | Low | Install to home screen, export a backup before the draft, and the Picks log makes a rebuild quick |
| Stale app or data served from cache after an update | Medium | Network-first service worker, and the data build time shown in Settings |
| Per-game ranking overrates players projected for few games | Certain | By design. Games played sits beside FPPG, and Alex adjusts tiers in prep |
| Scope exceeds the time available | Medium | Build order above puts Must items first. Nice items are skipped without asking |
| The depth chart change breaks the working draft tool hours before the draft | Low to medium | Additive change only, every existing test still passes, a pre-change export is imported in the test run, and the commit can be reverted if iPad checks fail |
| ESPN projects minutes for too few players on some teams, leaving thin charts | Medium | Roster validation prints players per team and fails below 8. The thinnest chart is Cleveland with 8 |
| Projected minutes do not match real rotations (new coach, trade, injury return) | Certain | By design. The caption says so, and injury badges and MPG change sit beside every name |
| A player who changed teams shows last season's minutes from his old team | Certain for some players | Accepted. MPG change is a prompt to look closer, not a verdict |
| Primary position puts a player in a column that surprises Alex | Medium | The player sheet and the By group toggle use eligible positions, so competition is still caught |

### Open items

- Age depends on an unverified endpoint and may be dropped.
- Uptick flags will be decided in a separate session. A paste-in import of flags by player ID through the standard Import is enough; no special feature is needed.
- Likely starters are not marked on the depth charts. The projection has no games-started figure, and a guess would look more certain than it is.
