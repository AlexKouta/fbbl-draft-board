# ESPN Fantasy Basketball: data access note

Written 10 October 2026 for league 41967023 (Williamstown FBBL, private, head-to-head points). Companion to the API catalogue, `espn_fba_sample_responses.json` and `espn_fba_id_map.json`.

## Summary

Public data (players, stats, projections, NBA schedule, news) can be fetched from anywhere with no login. League data cannot: the league is private, so every league call needs a logged-in ESPN session. That single constraint decides how a tool has to be built.

**Recommendation:** split the tool's data layer in two. Fetch public data directly. For league data, use a local script that sends your ESPN session cookies, and have it save snapshots to JSON so everything else (including single-file HTML tools) can run from the snapshots. Reasons are in "Recommendation" below.

## What was tested

| Where the request came from | Public endpoints | League 41967023 |
| --- | --- | --- |
| Claude's cloud workspace shell (curl, Python) | Blocked by the workspace network allowlist | Blocked |
| Claude's web fetch tool | Works, but cannot send the `X-Fantasy-Filter` header, so player lists stop at 50 | 401, not authorised |
| A web page on an unrelated site (tested from example.com) | Works, including the custom filter header. ESPN allows cross-origin requests | 401, even with `credentials: 'include'`. The browser does not attach ESPN cookies to a third-party request |
| A page on ESPN's own domain in a browser signed in to ESPN | Works | Works, including the filter header and past seasons |

The last row is how the catalogue was verified: Claude's built-in browser pane in the desktop app, signed in to ESPN by Alex, running `fetch` from a page on `lm-api-reads.fantasy.espn.com`.

Terms used above:

- **Cross-origin request (CORS):** a web page on one site calling an API on another. The API decides whether to allow it. ESPN's fantasy API does.
- **Third-party cookies:** cookies belonging to a site other than the one in the address bar. Browsers increasingly refuse to send them, which is why a page on another site cannot use your ESPN login.

## What needs a login and what does not

| Data | Endpoint | Login |
| --- | --- | --- |
| Season, scoring periods, NBA schedule, ESPN enumerations | `/seasons/{year}`, `?view=proTeamSchedules_wl` | No |
| All players: eligibility, injury status, ownership, draft ranks, raw stats, projections, game logs | `/seasons/{year}/players?view=kona_player_info` | No |
| Player news | `site.api.espn.com/apis/fantasy/v3/games/fba/news/players` | No |
| League rules, teams, standings, rosters, matchups, box scores, draft, transactions, chat | `/seasons/{year}/segments/0/leagues/41967023` | Yes |
| Who is a free agent in this league, and fantasy points pre-calculated under league weights (`appliedTotal`) | League call with `kona_player_info` | Yes |

Fantasy points do not strictly need the league call. The weights are known (see the catalogue), so they can be computed from public raw stats. Recomputing 10 player lines and two weekly totals from the samples matched ESPN exactly.

## Options for league data

| Option | How it works | Good for | Drawbacks |
| --- | --- | --- | --- |
| A. Signed-in browser session | Requests run from a page on ESPN's domain in a browser where you are logged in. Claude can do this through the desktop app's browser pane | Ad hoc analysis inside a Claude conversation. Nothing to set up; no credentials leave the browser | Only works in a session linked to your computer with the desktop app open. Not usable by a standalone app or a scheduled job |
| B. Session cookies in a local script | Copy two cookies, `espn_s2` and `SWID`, from your logged-in browser and send them as a `Cookie` header from a script on your own machine | Any standalone tool: a Python or Node script, a local server, an iOS app's backend | The cookies are credentials. They expire and must be refreshed by hand. They must never be committed to code, pasted into a chat or saved to project knowledge |
| C. Make the league public | The league manager switches the league to publicly viewable. All league calls then work with no login, from anywhere, including a single-file HTML tool | The simplest possible tool architecture | Anyone with the league ID can read every member's real name, every roster and the league chat. Needs the league manager's agreement |
| D. Snapshots | League responses are saved to JSON files on a schedule or on demand. The tool reads the files and never calls ESPN for league data | Locked-down machines, single-file HTML tools, fast repeatable analysis, working offline | Data is only as fresh as the last snapshot. Still needs A or B to produce the snapshots |

## Recommendation

Use **B to fetch and D to store**, with **A as the fallback inside Claude**.

1. **B over C** because C exposes other people's names and the league chat to anyone who has the ID, and it is not your decision alone. B keeps the league private.
2. **D on top of B** because league data changes slowly: rosters and scores move daily, rules and draft results almost never. A snapshot taken once or twice a day is fresh enough for lineup and waiver decisions, and it removes the login problem from every other part of the tool. It also keeps the number of calls to an undocumented API low.
3. **Public data fetched live**, because it needs no login and is where freshness matters most (injury status, news, tonight's schedule).
4. **A for one-off questions** asked in a Claude conversation, where setting up a script would be overkill.

If the tool turns out to be something only ever used inside Claude conversations, A alone is enough and B is unnecessary.

## Handling the cookies (option B)

- Find them in your browser's developer tools on any `espn.com` page while logged in, under stored cookies for `.espn.com`: `espn_s2` (long token) and `SWID` (an ID in curly braces).
- Keep them in a local environment file that is excluded from version control. Send them as `Cookie: espn_s2=...; SWID=...`.
- Do not put them in project knowledge, a chat message or source code. Claude will not enter or store them; set them up yourself.
- Treat a 401 response as "cookies expired": log in again and copy fresh values.
- `SWID` is also your member ID in the API (`members[].id`, `teams[].owners`). The sample file redacts all member IDs for that reason.

## Constraints to design around

- **Unofficial API.** No documentation, no published rate limits, no notice of changes. Cache responses, keep call volume low, and fail gracefully when a field disappears.
- **Read-only.** Plan for a tool that advises; lineup changes and adds still happen in the ESPN app.
- **Paging.** Player calls return 50 players unless `X-Fantasy-Filter` sets `players.limit`. The active pool is 1,095 players.
- **Season naming.** The season is the year it ends: 2026-27 is `2027`.
- **Daily granularity.** A scoring period is one day (1 to 174 this season); a matchup period is one week. Rosters and box scores are requested per scoring period.
- **Past seasons.** 2020 to 2026 are available for this league with full rosters, drafts and transactions. The activity feed is current season only.
- **Privacy.** League responses contain members' real names and chat messages. Decide what the tool stores and displays.
- **Pre-draft state.** As of this note the 2027 draft had not happened, so current-season rosters, transactions and scores were empty. Sample data for those views comes from 2026.

## Still to confirm

- How long the session cookies last before they expire.
- Whether `matchupAcquisitionLimit: 1` with `matchupLimitPerScoringPeriod: true` means one add per week or per day.
- The shape of waiver claims and completed trades in `mTransactions2` (none in the samples).
- The add and drop message type IDs in the activity feed (none yet this season).
