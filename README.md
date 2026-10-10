# FBBL Draft Board

Offline-capable draft board for the Williamstown FBBL (ESPN, 10 teams, head-to-head points). A static web app for iPad: rank players by fantasy points under the league's scoring, tier and annotate them before the draft, and track picks during it.

The brief is in `reference/PRD Fantasy Basketball Draft Board.md`. Decisions made while building are in `DECISIONS.md`.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `core.js`, `app.js` | The app. No build step, no dependencies |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache and home-screen install |
| `data/players.json` | Player pool with projected and last-season stats, plus every NBA team's depth chart, built by the fetch script |
| `scripts/fetch_data.mjs` | Fetches ESPN's public player pool, validates, seeds tiers, writes `data/players.json` |
| `scripts/config.json` | Manual include list of ESPN player IDs for the pool |
| `scripts/make_icons.mjs` | Generates the PNG icons |
| `tests/run_tests.mjs` | Automated tests (Node, no dependencies) |
| `tests/browser_checks.mjs` | Headless browser checks (needs Playwright) |
| `reference/` | ESPN API catalogue, ID map, sample responses, data access notes, PRD and the depth chart addendum |

## Refresh the data

Run on the Mac, then commit and push. The app picks up the new file on its next online load. Tiers, notes, flags and picks are keyed by player ID and are not affected.

```bash
node scripts/fetch_data.mjs
```

`--offline` re-runs the transform from the saved raw response in `data/raw/` without calling ESPN. `--no-ages` skips the age lookups. Validation checks print (the four fantasy-point rows, then the roster checks and the Denver and Oklahoma City depth charts) and the script fails loudly if they do not match.

## Tests

```bash
node tests/run_tests.mjs
```

Browser checks run against a local server at two iPad viewport sizes:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/browser_checks.mjs
```

## Local preview

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/ in a browser.
