# PRD Addendum: Team Depth Charts

Oct 10, 2026 · @Alex

## Summary

Add a team depth chart to the Draft Board: a new Depth view showing every NBA team's roster by position in order of projected minutes per game, and a Team depth section in the player sheet showing the selected player's positional competition. It extends `PRD Fantasy Basketball Draft Board.md` and must be live before Sunday 11:00am, the cut-off for fixes in that PRD.

| Item | Decision |
| --- | --- |
| Purpose | See at a glance whether a player has competition for minutes or shots on his own NBA team |
| Data | Rebuilt from the raw ESPN response already saved in `data/raw/`. No new ESPN call is required, no league endpoint, no login |
| Roster scope | All active players on each of the 30 NBA teams with a 2026-27 projection, not only the draft pool of about 240 |
| Ordering | Projected minutes per game (MPG), descending. Last season's MPG when the stat source toggle is set to Last season |
| Depth view | A fifth view: pick a team, see five columns (PG, SG, SF, PF, C), each player listed once under his primary position |
| Player sheet | A Team depth section listing teammates in the same position group (guards, forwards, centres), with the selected player highlighted |
| Modes | Read-only in both Prep and Draft. Reachable from a row in Draft mode in one tap |
| Usage signal | Shot attempts per game and a share-of-team-shots figure beside minutes |
| Saved state | None added, except the last team viewed. Existing tiers, notes and picks are untouched |

"Depth chart" here means a ranking inferred from ESPN's projected minutes. It is not a coach's official depth chart, and the app must label it that way.

## Instructions for Claude Code

This is an addition to a tool that is already built and deployed, so protecting what works comes first. Read the existing code and `DECISIONS.md` before changing anything, and follow the conventions already there for file layout, naming, styling and tests.

**Rules for this change**

- Do not change the saved-state shape, the scoring, the player pool, tier seeding or any existing view's behaviour, beyond the additions listed here.
- Do not re-fetch from ESPN if a raw response exists in `data/raw/`. Re-run the transform on the saved file.
- All existing automated tests and the four data validation rows must still pass.
- Bump the service worker cache version so the iPad picks up the new files.
- Make sensible decisions where this document is silent and record them in `DECISIONS.md`.
- Items marked **Nice** are skipped without asking if they take more than about 15 minutes.

**Update the original PRD**

Once the feature is built and tests pass, fold it into `PRD Fantasy Basketball Draft Board.md` in the repository so there is one current brief for the whole tool.

- Merge each part into the matching section of the PRD (Summary table, Goals and scope, Data, Saved state, Functional requirements, Design, Acceptance criteria, Risks). Do not paste this addendum in as one block at the end.
- Describe what was actually built. Where the build differs from this addendum, the PRD follows the build and `DECISIONS.md` records why.
- Change the PRD's "four views" to five, and add the Depth view and the Team depth section wherever views or the player sheet are listed.
- Leave every unrelated requirement in the PRD as it is.
- Add a dated line under the PRD's title noting the depth chart update.
- If the PRD is not in the repository, save this addendum to `reference/` instead and say so in the report.

**Stop and ask Alex only when:**

- `data/raw/` is empty and the ESPN fetch fails.
- The roster validation in the Data section fails (fewer than 30 teams, or a team with fewer than 8 projected players).
- An existing test breaks and the cause is not obvious.

**End the turn with:**

1. The live URL and confirmation that the deployed version includes the Depth view.
2. The roster validation output: players per team and each team's total projected minutes per game.
3. The depth chart for two teams printed as text (Denver and Oklahoma City), so Alex can sanity-check the ordering.
4. Anything skipped or decided on Alex's behalf, and a short list of the sections changed in the original PRD.
5. The iPad checks from the Acceptance section.

## Goals and scope

The feature answers one question in a few seconds: who on this player's NBA team is competing with him for minutes and shots?

**Goals**

- From any player, in Prep or Draft mode, see his teammates at the same position group ordered by projected MPG.
- Browse any team's full depth chart by position.
- Show enough beside each name to judge the threat: minutes, the change in minutes from last season, shot volume, injury status and whether the player is already drafted.

**Out of scope**

- Official or coach-confirmed depth charts and starting line-ups. ESPN's fantasy API does not supply them reliably (`proGamePlayerDetail.starterStatus` is present only for some players).
- Editing the depth chart or reordering players by hand.
- Detecting that a player changed teams in the off-season. Season totals in the API carry no team, so last season's minutes may have been earned elsewhere.
- Drafting a player who is not in the draft pool. Non-pool teammates are shown for context only.
- Any change to automated tier seeding.

**How position is decided**

ESPN gives each player one primary position (`defaultPositionId`) and one or more eligible positions (`eligibleSlots`). The two are used for different jobs.

| Where | Rule | Why |
| --- | --- | --- |
| Depth view columns | Each player appears once, under his primary position | A team's minutes then read cleanly down each column, with no double counting |
| Player sheet competition list | Teammates who share a position group with the selected player, using eligible positions | A PG and an SG compete for the same guard minutes even though they share no single slot |

Position groups: Guards = PG or SG. Forwards = SF or PF. Centres = C. A player eligible at PF and C belongs to both Forwards and Centres, and his competition list covers both.

## Data

Team rosters are built by the existing transform from the saved raw player response, which already holds all active players (about 1,095) with their team, positions, projection and last-season totals.

### Source and roster rules

- Read the raw response in `data/raw/`. Fetch again only if it is missing, using the existing script and header unchanged.
- Group players by `proTeamId`, excluding 0 (free agents). Decode teams with `proTeams` in `espn_fba_id_map.json`.
- A player is on a team's depth chart when his `102027` projection has games played above zero and minutes above zero.
- Keep at most 15 players per team, by projected MPG. Record the decision in `DECISIONS.md` if a different cap works better.
- Every pool player with a team must appear on that team's chart, even if the cap would cut him. Print a warning for each case.

### Fields per roster player

Pool players already carry most of this. Non-pool teammates need a lighter record with the same field names, so the UI reads both the same way.

| Field | Source |
| --- | --- |
| `id`, `name`, `team` | As in the main PRD |
| `positions`, `primaryPosition` | `eligibleSlots` filtered to 0 to 4, and `defaultPositionId` |
| `groups` | Derived from `positions`: `G`, `F`, `C` |
| `injuryStatus` | `injuryStatus` |
| `inPool` | True when the player is in the draft pool |
| `proj`, `last` | Games played, `mpg`, `fppg`, and per-game `fga`, `fta`, `to`, computed as in the main PRD |
| `proj.poss`, `last.poss` | Possessions used per game (see below), 1 decimal |
| `last.gs` | Games started last season (stat 41). **Nice** |

### Usage measure

True usage rate needs team totals the API does not give, so the tool uses a simple stand-in: possessions used per game, the count of a team's possessions a player finishes with a shot, a trip to the line or a turnover.

```latex
\text{POSS} = \frac{\text{FGA} + 0.44\,\text{FTA} + \text{TO}}{\text{GP}}
```

**Share of team** is a player's POSS divided by the sum of POSS across his team's depth chart, shown as a percentage. Keep 0.44 in the same config object as the scoring weights. Label the column "Usage" with a tooltip or footnote: "Share of the team's projected shots, free-throw trips and turnovers. An estimate."

### Output

Add the rosters to the existing data output so there is still one data file to cache and refresh. Suggested shape: a top-level `teams` object in `data/players.json`, keyed by team abbreviation, each holding `name`, `totalProjMpg` and `roster[]` sorted by projected MPG. Pool players may be referenced by `id` to avoid duplication. If a separate `data/teams.json` is simpler in the existing code, use it and add it to the service worker's network-first list.

### Validation (Must pass before building the UI)

The script prints these and fails loudly on the first two.

| Check | Expected |
| --- | --- |
| Number of teams | Exactly 30 |
| Players per team with a projection | At least 8 on every team |
| Total projected MPG per team | Printed for all 30. Warn outside 200 to 280 (a real team plays 240 minutes a game, and injuries and deep benches move the projected sum) |
| Every pool player with a team is on a chart | Zero missing |
| Existing four fantasy-point validation rows | Unchanged |

A draft-morning data refresh must rebuild the rosters in the same run, so injury status on the depth chart stays current.

## Functional requirements

The feature has two surfaces that share one data source and one row design: a Team depth section in the player sheet, and a Depth view. Everything is **Must** unless marked **Nice**.

### Depth row (shared by both surfaces)

Every player on a depth chart is drawn the same way.

| Element | Notes |
| --- | --- |
| Order number | 1, 2, 3 within the list, by MPG for the selected stat source |
| Name | With the existing injury badge when status is not `ACTIVE`, and the uptick marker if set |
| Positions | All eligible positions, such as `SG/SF` |
| MPG | For the selected stat source. The sort key |
| MPG change | Projected minus last season, signed. A dash when last season has zero games |
| Usage | Share of team, as a percentage |
| FPPG | For the selected stat source |
| Tier | Existing tier chip. Pool players only |
| Draft status | Same row states as the Players view: greyed with pick number when taken by another team, highlighted with pick number when Alex's |

Rules:

- A player with zero games in the selected source shows a dash for MPG and sorts last.
- Teammates outside the draft pool are shown in a muted style with no tier chip and are not tappable.
- Tapping a pool teammate opens that player's sheet, with a Back control that returns to the previous player.
- The stat source follows the app's existing global toggle. There is no separate toggle.

### Team depth section in the player sheet

This is the main use: tap a player, see his competition.

- The section appears in the player sheet in both Prep mode (editable sheet) and Draft mode (read-only sheet). It is itself read-only in both.
- Heading: the team and the selected player's position groups, such as "Oklahoma City · Guards".
- List: every teammate on the team's depth chart who shares a position group with the selected player, plus the selected player himself, ordered by MPG. The selected player's row is clearly highlighted.
- A player in two groups (such as PF/C) gets one merged list, with each row's positions making clear who plays where.
- Below the list, one summary line: the selected player's rank in the group and the gap to the next man, such as "2nd of 6 guards · 4.2 MPG behind the leader · 6.8 MPG ahead of the next".
- A "Full team" button opens the Depth view on that team with the selected player highlighted.
- A free agent (`team` is `FA`) shows "No team" in place of the section.
- A fixed caption under the section: "Ordered by ESPN projected minutes. Not an official depth chart."
- In Draft mode the section must be visible without scrolling when the sheet opens in landscape, because it will be read under time pressure. Place it above the stat comparison if needed.

### Depth view

A fifth view beside Players, My Team, Picks and Settings, available in both modes.

- **Team picker**, always visible: all 30 teams as chips or a compact grid, showing abbreviations, in alphabetical order. The last team viewed is remembered.
- **Team header:** team name, number of players shown, total projected MPG, and how many are already drafted.
- **Chart:** five columns in the order PG, SG, SF, PF, C. Each player appears once, under his primary position, ordered by MPG. Each entry is a depth row as defined above. An empty column shows a dash.
- **Highlight:** when opened from a player sheet, that player's row is highlighted and scrolled into view.
- **Nice:** a "By group" toggle that collapses the five columns into three (Guards, Forwards, Centres) using eligible positions, matching the player sheet.
- **Nice:** previous and next team buttons.

### Entry points

| From | Action | Result |
| --- | --- | --- |
| Players view, Prep mode | Tap a row (existing behaviour) | Player sheet opens with the Team depth section |
| Players view, Draft mode | Tap a player's name (existing behaviour) | Read-only sheet opens with the Team depth section |
| Player sheet | Tap "Full team" | Depth view on that team |
| Navigation | Tap Depth | Depth view on the last team viewed, or the first team alphabetically |
| My Team view | Tap a player's name. **Nice** | Read-only sheet with the Team depth section |

The Draft button and the draft modal are unchanged. Nothing in this feature can mark, change or remove a pick.

### Saved state

One addition to settings: `depthTeam`, the last team viewed. Loading must tolerate saved state that lacks it, and export and import must carry it without breaking older exports.

## Design and device requirements

The existing design rules in the main PRD apply unchanged; these are the additions.

- **Reuse:** tier chips, injury badges, row states and numerals come from the existing styles. No new colours beyond one highlight for the selected player.
- **Landscape (primary):** the Depth view shows all five columns side by side without horizontal scrolling. Fifteen players on one team must fit with at most vertical scrolling inside the chart.
- **Portrait:** columns stack or wrap. In depth rows, hide Usage and MPG change before anything else.
- **Player sheet:** the Team depth section must not push the tier buttons, note or target off screen in Prep mode on landscape iPad. Cap its height and scroll inside it if a group is long.
- **Touch targets:** team chips and tappable rows are at least 44 by 44 points.
- **Speed:** opening the sheet and switching teams show no visible delay. Build any per-team lookup once at load, not on every tap.
- **Offline:** the feature works with no network after first load, like the rest of the app.

## Acceptance criteria

The change is done when every check below passes and every existing test still passes.

### Automated tests (Claude Code writes and runs these)

- Position groups: PG gives Guards. SG/SF gives Guards and Forwards. PF/C gives Forwards and Centres. C gives Centres.
- Competition list: for a fixture team, a guard's list contains every teammate eligible at PG or SG and no one else, ordered by projected MPG descending, with the selected player included.
- Depth view placement: every roster player appears in exactly one column, the one for his primary position.
- Ordering: a player with zero games in the selected source sorts last. Switching stat source re-orders by last season's MPG.
- Usage: POSS reproduces a hand-calculated value for one player, and shares across a team's chart sum to 100% within rounding.
- Roster build: 30 teams, no free agents on any chart, every pool player with a team present on that team's chart.
- State: saved state without `depthTeam` loads cleanly, and an export made before this change imports without error.

### Browser checks (Claude Code, at 1180 by 820 and 820 by 1180)

- No console errors on load or when opening the Depth view.
- In Prep mode, opening a player shows the Team depth section with that player highlighted, and the tier buttons, note and target are still reachable.
- In Draft mode, tapping a player's name shows the section without scrolling in landscape.
- Marking a teammate as drafted by another team greys his depth row in both surfaces.
- "Full team" opens the Depth view on the right team with the player highlighted.
- Tapping a pool teammate opens his sheet, and Back returns to the first player.
- With the network disabled after first load, the Depth view still opens with data.
- A full Draft mode pass from the main PRD still works: mark, undo, correct, reload.

### iPad checks (Alex)

1. Close and reopen the app from the home screen icon while online. The Depth tab appears. If it does not, close and reopen once more (the first open fetches the update, the second shows it).
2. Confirm tiers, notes, targets and any picks from before the update are still there.
3. In Prep mode, open a guard on a team you know well. His fellow guards are listed in a believable order.
4. In Draft mode, mark one of his teammates as drafted by other. The teammate greys out in the depth list.
5. Tap "Full team", then switch between three teams. No lag.
6. Turn on aeroplane mode, reopen, and open a depth chart.
7. Rotate to portrait. The depth chart is still readable.

## Build plan and risks

Build the player sheet section before the Depth view, because it delivers the main benefit and is the smaller piece. If time runs out, ship the section alone.

1. **Export first.** Remind Alex to export a backup from the iPad before the new version is deployed.
2. **Data.** Extend the transform, pass roster validation, print the Denver and Oklahoma City charts.
3. **Shared logic.** Position groups, competition list, ordering and usage share, with tests.
4. **Player sheet section,** in Prep and Draft modes.
5. **Depth view** and the "Full team" link.
6. **Service worker** cache version bump, full test run, deploy, report back.
7. **Nice items,** only if time remains: By group toggle, previous and next team, games started, My Team entry point.

### Timeline (Melbourne time)

| When | Milestone |
| --- | --- |
| Sunday morning, 11 October | Built, tested and deployed in one Claude Code turn |
| Sunday by 11:00am | Verified on the iPad. If it is not working by now, revert to the previous deployed version |
| Sunday 11:00am to 3:00pm | Alex's prep, using the depth chart to set uptick flags and adjust tiers |
| Sunday 4:00pm | Draft |

### Risks

| Risk | Likelihood | Response |
| --- | --- | --- |
| The change breaks the working draft tool hours before the draft | Low to medium | Additive change only, existing tests must pass, export before deploy, and revert the commit if iPad checks fail |
| ESPN projects minutes for too few players on some teams, leaving thin charts | Medium | Roster validation prints players per team. Stop and ask if any team has fewer than 8 |
| Projected minutes do not match real rotations (new coach, trade, injury return) | Certain | By design. The caption says so, and injury badges and MPG change sit beside every name |
| A player who changed teams shows last season's minutes from his old team | Certain for some players | Accepted. MPG change is a prompt to look closer, not a verdict |
| Primary position puts a player in a column that surprises Alex | Medium | The player sheet uses eligible positions and groups, so competition is still caught there |
| iPad keeps serving the old version from cache | Medium | Cache version bump, and the reopen-twice step in the iPad checks |
| Sheet becomes too crowded in Prep mode | Medium | Height cap with internal scroll. Claude Code checks at both screen sizes |

### Open items

- Whether the usage share reads sensibly across teams will only be known once the data is built. If it looks misleading, hide the column and keep raw shot attempts per game.
- Whether to mark likely starters explicitly. Left out for now, because the projection has no games-started figure and a guess would look more certain than it is.
