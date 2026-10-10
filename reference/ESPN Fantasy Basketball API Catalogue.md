# ESPN Fantasy Basketball API Catalogue

Oct 9, 2026 · @Alex

## Summary

ESPN's fantasy basketball API exposes nearly everything the fantasy site shows, in five groups. It is unofficial and undocumented, so this catalogue is built from live calls plus open-source community code.

| Group | What you get | Login needed |
| --- | --- | --- |
| Game and season | Season dates, today's scoring period, the full NBA schedule by team | No |
| Player pool | Every player: eligibility, injury status, ownership and draft trends, ESPN rankings and ratings, season stats, last 7/15/30 days, projections, game logs | No |
| Player news | Rotowire blurbs and ESPN stories per player, with full text | No |
| League | Rules, teams, owners, rosters, standings, category totals, matchups and scores, draft picks, transactions, waiver bids, activity feed | Only for private leagues |
| Reference IDs | Not supplied by the API; decoder tables for stats, slots and teams are included here | n/a |

All five groups have now been confirmed against live responses, including a private league's 2027 and 2026 seasons. The few items still unconfirmed are listed in the last section.

## How the API works

Every request is a plain HTTPS GET that returns JSON, and three inputs decide what comes back: the URL path, the `view` parameter, and an optional filter header.

**Base URL:** `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba`

`fba` is the game code for fantasy basketball. The season is named by the year it ends, so the 2026-27 NBA season is `2027`.

| Path (after the base URL) | What it returns | Login needed |
| --- | --- | --- |
| *(none)* | Game metadata | No |
| `/seasons/2027` | Season metadata, and pro team schedules with a view | No |
| `/seasons/2027/players` | The global player pool | No |
| `/seasons/2027/segments/0/leaguedefaults/{1-n}` | ESPN's template leagues: default settings and player pool | No |
| `/seasons/2027/segments/0/leagues/{leagueId}` | Your league: everything in the League data section | Only if the league is private |
| `/seasons/2027/segments/0/leagues/{leagueId}/communication/` | League activity feed and message board | Only if the league is private |
| `/leagueHistory/{leagueId}?seasonId={year}` | Archived seasons before 2018 | Only if the league is private |

Player news sits on a different host: `https://site.api.espn.com/apis/fantasy/v3/games/fba/news/players?playerId={id}`.

**Views.** A view is a named slice of data, passed as `?view=mTeam`. Several can be combined in one call (`?view=mTeam&view=mRoster`). With no view, a league call returns only a thin shell.

**Scoring periods.** A scoring period is one day of the NBA season, numbered from 1 (this season's final period is 174). A matchup period is one head-to-head week, made up of several scoring periods. Adding `&scoringPeriodId=N` returns rosters and stats as they stood on that day.

**Filter header.** `X-Fantasy-Filter` is a JSON object sent as a request header. It filters, sorts and pages results. Without it, player calls return only the first 50 players alphabetically. With an active-players filter the pool is 1,095 players. Filter keys (all confirmed except the last row):

| Filter key | Purpose |
| --- | --- |
| `players.limit`, `players.offset` | Page size and paging |
| `players.filterIds` | Specific player IDs |
| `players.filterStatus` | `FREEAGENT`, `WAIVERS`, `ONTEAM` |
| `players.filterSlotIds` | Players eligible for given lineup slots |
| `players.sortPercOwned` | Sort by ownership percentage |
| `players.filterStatsForTopScoringPeriodIds` | Which stat splits and how many recent game logs to include |
| `filterActive` | Active players only |
| `schedule.filterMatchupPeriodIds` | Matchups for given weeks |
| `transactions.filterType` | Transaction types to include |
| `topics.filterType`, `topics.filterIncludeMessageTypeIds` | Activity feed message types |

**Authentication.** Public leagues need none. A private league needs two cookies copied from a logged-in ESPN browser session: `espn_s2` and `SWID`. There is no API key and no username and password login. A league manager can make a league publicly viewable in league settings, which removes the need for cookies.

## Game and season metadata

These endpoints describe the fantasy game itself and the NBA calendar, with no login. All dates are Unix timestamps in milliseconds.

**Game list** (`/apis/v3/games`) returns the five fantasy games ESPN runs.

| Code | Game | Game ID | Current season |
| --- | --- | --- | --- |
| `ffl` | Fantasy Football (NFL) | 1 | 2026 |
| `flb` | Fantasy Baseball (MLB) | 2 | 2026 |
| `fba` | Fantasy Basketball (NBA) | 3 | 2027 |
| `fhl` | Fantasy Hockey (NHL) | 4 | 2027 |
| `wfba` | Fantasy Women's Basketball (WNBA) | 5 | 2026 |

Fields per game: `id`, `abbrev`, `name`, `active`, `display`, `displayOrder`, `proSportAbbrev`, `proSportName`, `currentSeasonId`, `currentSeason`.

**Season** (`/seasons/2027`) returns `id`, `gameId`, `name`, `abbrev`, `active`, `display`, `displayOrder`, `startDate`, `endDate`, and `currentScoringPeriod.id` (today's scoring period).

**Pro team schedules** (`/seasons/2027?view=proTeamSchedules_wl`) returns the full NBA schedule by team.

| Field | Meaning |
| --- | --- |
| `settings.proTeams[]` | One entry per NBA team: `id`, `abbrev`, `location`, `name`, `byeWeek`, `universeId` |
| `proTeams[].proGamesByScoringPeriod` | Map of scoring period to that team's games on that day |
| Game: `id` | ESPN event ID, the same ID used by ESPN's scoreboard and news endpoints |
| Game: `date`, `startTimeTBD` | Tip-off time, and whether it is still to be confirmed |
| Game: `homeProTeamId`, `awayProTeamId` | The two teams |
| Game: `scoringPeriodId` | The fantasy day the game counts towards |
| Game: `statsOfficial`, `validForLocking` | Whether stats are final, and whether the game locks lineups |
| `settings.playerOwnershipSettings` | `startDate`, `firstGameDate`, `lastGameDate` for ownership tracking |
| `settings.gameNotificationSettings` | Eight flags for which notification types the game supports |
| `settings.defaultDraftPosition`, `draftLobbyMinimumLeagueCount`, `gated` | Game-level draft defaults |

The schedule answers questions such as how many games each player has in a given matchup week.

## Player pool

Every NBA player is available with identity, eligibility, ownership trends, draft rankings, ESPN's player rating, season stats, projections and a game-by-game log. Three views return progressively more.

| View | Called on | Returns |
| --- | --- | --- |
| `players_wl` | `/players` | Lightweight list: identity, position, eligibility, team, percent owned |
| `kona_player_info` | `/players` or a league | Adds injury status, full ownership trends, draft ranks and all stat splits |
| `kona_playercard` | A league | Same as above plus `invalid`, `laterality`, `stance`, `universeId`, `waiverDate` |

**Identity and eligibility**

| Field | Meaning |
| --- | --- |
| `id` | ESPN player ID, shared with ESPN's news and stats endpoints |
| `firstName`, `lastName`, `fullName`, `jersey` | Name and jersey number |
| `proTeamId` | NBA team (see Reference IDs) |
| `defaultPositionId` | Primary position |
| `eligibleSlots[]` | Every lineup slot the player can fill |
| `active`, `droppable` | Whether the player is active, and whether ESPN allows dropping them |
| `universeId` | A grouping of 1 or 2 that appears to be conference (East or West) |
| `lastNewsDate` | When the latest news item was published |

**Injury**

| Field | Meaning |
| --- | --- |
| `injured` | True or false |
| `injuryStatus` | `ACTIVE`, `DAY_TO_DAY` or `OUT` (the three values across all 1,095 active players) |
| `proGamePlayerDetail` | Per upcoming game: `starterStatus` (e.g. `NOTSTARTING`) and `lineupOrder`. Present only for some players |
| `expectedReturnDate` | Read by the open-source library for injured players; not seen in testing |

**Ownership** (`ownership` object, across all ESPN leagues)

| Field | Meaning |
| --- | --- |
| `percentOwned`, `percentStarted` | Share of leagues rostering and starting the player |
| `percentChange` | Change in percent owned (the window is not stated in the response; 7 days is my assumption) |
| `averageDraftPosition`, `averageDraftPositionPercentChange` | Where the player is being drafted, and the trend |
| `auctionValueAverage`, `auctionValueAverageChange` | Average auction price, and the trend |
| `date`, `leagueType`, `activityLevel` | Snapshot time and segment |

**Draft rankings** (`draftRanksByRankType`). Two entries, `STANDARD` (points leagues) and `ROTO` (category leagues), each with `rank`, `auctionValue`, `rankType`, `rankSourceId`, `slotId`, `published`.

**League-context fields.** When players are requested through a league, each is wrapped with that league's view of them.

| Field | Meaning |
| --- | --- |
| `status` | `FREEAGENT`, `WAIVERS` or `ONTEAM` |
| `onTeamId` | Fantasy team holding the player (0 if none) |
| `waiverDate`, `waiverProcessDate` | When the player went on waivers and when they clear |
| `lineupLocked`, `rosterLocked`, `tradeLocked` | Whether the player can currently be moved, dropped or traded |
| `keeperValue`, `keeperValueFuture`, `draftAuctionValue` | Keeper cost and auction price paid |
| `droppedByEliminatedTeam` | Flag for players dropped by eliminated teams |
| `ratings` | ESPN Player Rater: `totalRating`, `totalRanking`, `positionalRanking`, keyed by time window (`0` = season) |

`ratings` has four windows, keyed 0 to 3 (0 is the full season). Player cards also carry `seasonOutlook` (ESPN's written preview, about 600 characters), `eligibleDateByPosition` (when a new position eligibility was earned), `variance` and the player's own `transactions[]` history in the league.

**Stats** (`stats[]`). Each player carries about 80 entries. Every entry has `id`, `seasonId`, `scoringPeriodId`, `statSourceId` (0 = actual, 1 = projected), `statSplitTypeId`, `proTeamId`, `externalId` and a `stats` map of stat ID to value. Some entries also carry `averageStats` (per-game averages).

| Entry `id` | What it holds |
| --- | --- |
| `00` + season, e.g. `002027` | Actual season totals |
| `01` + season | Last 7 days |
| `02` + season | Last 15 days |
| `03` + season | Last 30 days |
| `10` + season, e.g. `102027` | ESPN's full-season projection |
| `002026`, `102026` | Last season's actuals and projection |
| `05` + game ID, e.g. `05401810493` | One game's box score line; `externalId` is the ESPN event ID |

Game-log entries carry stat IDs 0 to 44. In a league that scores by points, entries also include `appliedTotal`, `appliedAverage` and `appliedStats`: the stats converted to that league's fantasy points.

**Player news** (separate host, by `playerId`). Returns `resultsCount` and a `feed[]` of items with `id`, `type` (`Rotowire` or `Story`), `headline`, `description`, `story` (full text of the blurb), `published`, `lastModified`, `categorized`, `images[]`, `links`, `premium` and `playerId`. Unlike ESPN's general league news feed, the body text is included.

## League data

A league call returns everything the ESPN fantasy site shows for your competition: rules, teams, rosters, matchups, standings, the draft, transactions and the activity feed. Each is a view on `/segments/0/leagues/{leagueId}`.

Every field below was read from live responses for a private 10-team head-to-head points league, using the 2027 season (pre-draft) and the completed 2026 season. Fields that only appear in other league formats are noted.

| View | Returns | Root key |
| --- | --- | --- |
| *(no view)* | Thin shell: members, teams (IDs and names), basic settings, status | `members`, `teams`, `settings`, `status` |
| `mSettings` | All league rules | `settings` |
| `mStatus` | League state | `status` |
| `mTeam`, `mStandings` | Teams, records, owners, members, season schedule | `teams`, `members`, `schedule` |
| `mRoster` | Each team's players and lineup slots | `teams[].roster` |
| `mMatchup`, `mMatchupScore` | Schedule, scores, lineups | `schedule` |
| `mScoreboard`, `mBoxscore`, `mLiveScoring`, `mTopPerformers` | Variations of `schedule` with more or less roster detail | `schedule` |
| `mDraftDetail` | Every draft pick | `draftDetail` |
| `mTransactions2` | Adds, drops, lineup moves, trades | `transactions` |
| `kona_league_communication` (on `/communication/`) | Activity feed and league chat | `topics` |
| `kona_league_messageboard` | League chat and activity grouped by type | `communication.topicsByType` |
| `kona_player_info`, `kona_playercard` | Players with league context | `players` |

Every league response also carries `id`, `gameId`, `seasonId`, `segmentId`, `scoringPeriodId` and a small `draftDetail` (`drafted`, `inProgress`). The views `mNav`, `mPositionalRatings`, `mPendingTransactions`, `mSchedule` and `modular` are accepted but returned nothing extra before the draft.

### Settings (`mSettings`)

| Group | Fields |
| --- | --- |
| General | `name`, `size`, `isPublic`, `isCustomizable`, `isAutoReactivate`, `restrictionType` |
| `scoringSettings` | `scoringType` (`H2H_POINTS`, `H2H_CATEGORY`, `ROTO` seen; `H2H_MOST_CATEGORIES` reported), `scoringItems[]`, `playerRankType`, `matchupTieRule`, `matchupTieRuleBy`, `playoffMatchupTieRule`, `playoffMatchupTieRuleBy`, `homeTeamBonus`, `playoffHomeTeamBonus`, `allowOutOfPositionScoring` |
| `scoringItems[]` | One per scored stat: `statId`, `points` (fantasy points per unit, negative for penalties), `pointsOverrides`, `isReverseItem`, `leagueRanking`, `leagueTotal` |
| `rosterSettings` | `lineupSlotCounts` (how many of each slot), `positionLimits`, `lineupSlotStatLimits` (games-played caps per slot), `isBenchUnlimited`, `moveLimit`, `lineupLocktimeType`, `rosterLocktimeType`, `isUsingUndroppableList`, `autoPilotTypeSupported`, `universeIds` |
| `scheduleSettings` | `matchupPeriodCount`, `matchupPeriodLength`, `matchupPeriods` (which weeks make up each matchup; playoff rounds span two), `divisions[]` (`id`, `name`, `size`), `playoffTeamCount`, `playoffMatchupPeriodLength`, `variablePlayoffMatchupPeriodLength`, `playoffSeedingRule`, `playoffSeedingRuleBy`, `playoffReseed`, `consolationLadderDisabled`, `periodTypeId` |
| `acquisitionSettings` | `acquisitionType` (e.g. `WAIVERS_TRADITIONAL`), `waiverHours`, `waiverProcessDays`, `waiverProcessHour`, `waiverOrderReset`, `acquisitionLimit`, `matchupAcquisitionLimit`, `matchupLimitPerScoringPeriod`, `isUsingAcquisitionBudget`, `acquisitionBudget`, `minimumBid`, `transactionLockingEnabled`, `finalPlaceTransactionEligible` |
| `draftSettings` | `type` (`SNAKE` seen), `date`, `availableDate`, `orderType`, `pickOrder[]` (team IDs in draft order), `timePerSelection`, `auctionBudget`, `keeperCount`, `keeperCountFuture`, `keeperOrderType`, `isTradingEnabled`, `leagueSubType` |
| `tradeSettings` | `deadlineDate`, `revisionHours`, `vetoVotesRequired`, `max`, `allowOutOfUniverse` |
| `financeSettings` | `entryFee`, `miscFee`, `perLoss`, `perTrade`, `playerAcquisition`, `playerDrop`, `playerMoveToActive`, `playerMoveToIR` |

An acquisition budget is the free-agent bidding pot, often called FAAB (free agent acquisition budget).

### Status (`mStatus`)

`currentMatchupPeriod`, `firstScoringPeriod`, `latestScoringPeriod`, `finalScoringPeriod`, `transactionScoringPeriod`, `isActive`, `isExpired`, `isFull`, `isViewable`, `isToBeDeleted`, `isPlayoffMatchupEdited`, `isWaiverOrderEdited`, `teamsJoined`, `previousSeasons[]`, `activatedDate`, `waiverLastExecutionDate`, `waiverProcessStatus`, `createdAsLeagueType`, `currentLeagueType`, `creationInfo`, `lastUpdateInfo`.

`previousSeasons` lists every earlier year the league ran. Each can be requested by swapping the season in the URL, with full teams, rosters, draft and transactions.

### Members (`mTeam`)

`members[]` holds one entry per person: `id`, `displayName`, `firstName`, `lastName`, and `notificationSettings[]` (`id`, `type`, `enabled`, `forId`). The API returns every member's real first and last name, which matters if you ever display or share this data.

### Teams and standings (`mTeam`, `mStandings`)

| Field | Meaning |
| --- | --- |
| `id`, `abbrev`, `name`, `logo`, `logoType` | Team identity |
| `divisionId` | Division |
| `owners[]`, `primaryOwner` | Member IDs, matched against `members[]` |
| `record.overall`, `.home`, `.away`, `.division` | Each has `wins`, `losses`, `ties`, `percentage`, `gamesBack`, `pointsFor`, `pointsAgainst`, `streakType`, `streakLength` |
| `points`, `pointsAdjusted`, `pointsDelta` | Season fantasy points, and manual adjustments |
| `playoffSeed`, `currentProjectedRank`, `draftDayProjectedRank` | Current seed and ESPN's projected finish |
| `rankFinal`, `rankCalculatedFinal` | Final placing once the season ends |
| `eliminated`, `eliminationMatchupPeriod` | Playoff elimination |
| `valuesByStat` | Team season totals per scored stat ID |
| `waiverRank` | Waiver priority |
| `transactionCounter` | `acquisitions`, `drops`, `trades`, `moveToActive`, `moveToIR`, `acquisitionBudgetSpent`, `matchupAcquisitionTotals` (adds per matchup week), `misc`, `paid`, `teamCharges` |
| `draftStrategy` | `keeperPlayerIds`, `futureKeeperPlayerIds` |
| `watchList[]` | Player IDs on the team's watch list |
| `tradeBlock`, `isActive`, `isTransactionLocked` | Trade block contents and team state |

### Rosters (`mRoster`)

`teams[].roster` holds `entries[]`, `appliedStatTotal` (the team's fantasy points for the period) and `tradeReservedEntries`.

| Entry field | Meaning |
| --- | --- |
| `playerId` | Player |
| `lineupSlotId` | The slot the player sits in, including bench and IR (injured reserve) |
| `acquisitionType`, `acquisitionDate` | How and when the team got the player (empty in the samples read) |
| `injuryStatus`, `status` | Roster-level flags (`NORMAL` in the samples read) |
| `pendingTransactionIds` | Pending moves involving the player |
| `playerPoolEntry` | The full player record from the Player pool section, with stats converted to the league's fantasy points |

Add `scoringPeriodId` to see the roster as it stood on any past day.

### Matchups and scores (`mMatchup`, `mMatchupScore`, `mBoxscore`)

`schedule[]` holds one entry per head-to-head matchup for the whole season (132 last season).

| Field | Meaning |
| --- | --- |
| `id`, `matchupPeriodId` | The matchup and its week |
| `winner` | `HOME`, `AWAY` or `UNDECIDED` seen; `TIE` reported |
| `playoffTierType` | Marks playoff and consolation games (`NONE` in the regular season) |
| `home`, `away` | Each side's result, with the fields below |
| `teamId`, `gamesPlayed` | Fantasy team, and games played so far |
| `totalPoints`, `adjustment`, `tiebreak` | Score, manual adjustment and tiebreak value |
| `pointsByScoringPeriod` | Score for each day of the matchup |
| `cumulativeScore` | `wins`, `losses`, `ties`, `statBySlot` and `scoreByStat` |
| `scoreByStat.{statId}` | `score` (team total for that stat), `result`, `rank`, `ineligible`. In category leagues `result` holds the category outcome |
| `rosterForCurrentScoringPeriod` | The lineup for the requested day, with each player's stats: the daily fantasy box score. Includes `appliedStatTotal` |
| `rosterForMatchupPeriod`, `rosterForMatchupPeriodDelayed` | The same for the whole matchup week |

Use the `schedule.filterMatchupPeriodIds` filter with `scoringPeriodId` to pull one week's box scores.

### Draft (`mDraftDetail`)

`draftDetail` holds `drafted`, `inProgress`, `completeDate` and `picks[]` (156 last season).

Each pick has `id`, `overallPickNumber`, `roundId`, `roundPickNumber`, `teamId`, `memberId`, `playerId`, `lineupSlotId`, `keeper`, `reservedForKeeper`, `bidAmount` (auction price), `nominatingTeamId` (auction drafts), `autoDraftTypeId` (whether the pick was auto-drafted) and `tradeLocked`.

### Transactions (`mTransactions2`)

`transactions[]` is requested per scoring period, filtered by type.

| Field | Meaning |
| --- | --- |
| `id`, `teamId`, `memberId` | The transaction, the team and the person who made it |
| `type` | `FREEAGENT`, `FUTURE_ROSTER` and `TRADE_DECLINE` seen. Also reported: `WAIVER`, `WAIVER_ERROR`, `ROSTER`, `RETRO_ROSTER`, `DRAFT`, `TRADE_PROPOSAL`, `TRADE_ACCEPT`, `TRADE_VETO`, `TRADE_UPHOLD`, `TRADE_ERROR` |
| `status`, `executionType`, `isPending` | Outcome (`EXECUTED` seen) and how it was run |
| `scoringPeriodId`, `proposedDate` | The day it applied and when it was submitted |
| `bidAmount` | Waiver bid, where a budget is used |
| `rating` | Present on every transaction (0 in the samples read) |
| `relatedTransactionId` | Links related transactions, such as the legs of a trade |
| `isActingAsTeamOwner`, `isLeagueManager` | Whether the league manager made the move on someone's behalf |
| `items[]` | Each player moved: `playerId`, `type` (`ADD`, `DROP`, `LINEUP`), `fromTeamId`, `toTeamId`, `fromLineupSlotId`, `toLineupSlotId`, `isKeeper`, `overallPickNumber` |

Lineup changes are logged as transactions (`FUTURE_ROSTER` with `LINEUP` items), so every start and sit decision is recoverable.

### Activity feed and league chat (`/communication/`)

`topics[]` holds one entry per thread: `id`, `type`, `author`, `date`, `dateEdited`, `isEdited`, `isDeleted`, `totalMessageCount`, `creationInfo`, `lastUpdateInfo` and `messages[]`.

Topic types seen: `ACTIVITY_SETTINGS` (rule changes), `ACTIVITY_STATUS`, `REMINDER_ACTIVATE`, `CHAT_ALL_MEMBERS` (league chat). `ACTIVITY_TRANSACTIONS` is reported for adds, drops and trades; none exist yet this season.

Each message has `id`, `topicId`, `author`, `date`, `messageTypeId`, `targetId`, `to`, `from`, `isEdited`, `isDeleted`, `isAlternateFormat`, and for chat messages `content` (the text). The `kona_league_messageboard` view adds `isUnread` and `unreadMessageCount`.

| `messageTypeId` (reported, not seen) | Meaning |
| --- | --- |
| 178 | Added from free agency |
| 180 | Added from waivers |
| 179, 181, 239 | Dropped |
| 188 | Moved between lineup slots |
| 244 | Traded |

The feed only worked for the current season. Requests for 2026 and 2025 returned "This Communication Group does not exist", so past seasons' activity has to come from `mTransactions2`.

## How points are calculated

A player's fantasy points for a game are each scored stat multiplied by its league weight, then summed. A team's matchup score is the sum of its starters' points across every day of the matchup week. This was checked against a 2026 matchup in league 41967023: all 10 player lines, the daily total and the weekly total reproduced exactly.

**Scoring weights** (`settings.scoringSettings.scoringItems`, identical for 2026 and 2027, no position overrides)

| Stat ID | Stat | Points per unit |
| --- | --- | --- |
| 0 | Points | +1 |
| 6 | Rebounds | +1 |
| 3 | Assists | +1 |
| 2 | Steals | +2 |
| 1 | Blocks | +1 |
| 11 | Turnovers | -1 |
| 13 | Field goals made | +1 |
| 14 | Field goals attempted | -1 |
| 15 | Free throws made | +1 |
| 16 | Free throws attempted | -1 |

In effect a missed field goal or free throw costs 1 point and a made one nets 0 beyond the points it scores. Three-pointers carry no bonus.

**Formula**

```latex
\text{FP} = \text{PTS} + \text{REB} + \text{AST} + 2\,\text{STL} + \text{BLK} - \text{TO} + (\text{FGM} - \text{FGA}) + (\text{FTM} - \text{FTA})
```

**Where each number lives in the API**

| Level | Field | How it is built |
| --- | --- | --- |
| Player, one game | `stats[].appliedTotal` on the game-log entry (`statSplitTypeId` 5) | Sum of `stats[statId]` × weight. `appliedStats` gives the per-stat breakdown |
| Player, season or projection | `appliedTotal`, `appliedAverage` on entries `00`/`10` + season | Same weights applied to season totals or ESPN's projection |
| Team, one day | `rosterForCurrentScoringPeriod.appliedStatTotal`, and `pointsByScoringPeriod[day]` | Sum of the day's `appliedTotal` for players in starting slots |
| Team, matchup week | `totalPoints` | Sum of `pointsByScoringPeriod` over the week. Also equals `cumulativeScore.scoreByStat` weighted by the table above |
| Team, season | `teams[].points`, `record.overall.pointsFor` | Sum of matchup totals |
| Result | `winner` | Higher `totalPoints`; `matchupTieRule` is `NONE` |

A calculator should read the weights from `scoringItems` at run time, because the league manager can change them.

**Rules that shape the score**

| Rule | Setting | Value |
| --- | --- | --- |
| Starting lineup | `lineupSlotCounts` | PG, SG, SF, PF, C, G, F (1 each) and 3 UTIL: 10 starters. 3 bench, no IR |
| Who scores | `lineupSlotId` | Only players in starting slots (IDs 0 to 11). Bench is slot 12 |
| Lineup lock | `lineupLocktimeType` | `INDIVIDUAL_GAME`: each player locks at their own tip-off, so lineups can change daily |
| Matchup length | `matchupPeriods` | One week each for 20 regular-season matchups; the two playoff rounds span two weeks each |
| Adds | `matchupAcquisitionLimit`, `matchupLimitPerScoringPeriod` | 1, with the per-scoring-period flag on. Whether that means one add per week or per day is not confirmed |
| Playoffs | `playoffTeamCount`, `playoffSeedingRule` | 4 teams, seeded by head-to-head record |
| Divisions | `divisions` | 2 divisions of 5 |

Because scoring is a daily sum over starters, the number of games a player has in a matchup week (from the pro team schedule) drives output as much as per-game quality.

## Reference IDs

The API returns numbers in place of names for stats, positions and teams, and never supplies the labels. These tables are the decoder, taken from the `espn-api` library.

### Stat IDs

ESPN's default eight-category league scores IDs 0, 1, 2, 3, 6, 17, 19 and 20, which confirms those labels. Nine-category leagues add 11 (turnovers).

| ID | Stat | ID | Stat | ID | Stat |
| --- | --- | --- | --- | --- | --- |
| 0 | Points | 15 | Free throws made | 30 | Rebounds per game |
| 1 | Blocks | 16 | Free throws attempted | 31 | Steals per game |
| 2 | Steals | 17 | Three-pointers made | 32 | Turnovers per game |
| 3 | Assists | 18 | Three-pointers attempted | 33 | Threes per game |
| 4 | Offensive rebounds | 19 | Field goal % | 34 | Points per minute |
| 5 | Defensive rebounds | 20 | Free throw % | 35 | Assist-to-turnover ratio |
| 6 | Rebounds | 21 | Three-point % | 36 | Listed as `STR` (meaning unconfirmed) |
| 7 | Ejections | 22 | Adjusted field goal % | 37 | Double-doubles |
| 8 | Flagrant fouls | 23 | Field goals missed | 38 | Triple-doubles |
| 9 | Personal fouls | 24 | Free throws missed | 39 | Quadruple-doubles |
| 10 | Technical fouls | 25 | Three-pointers missed | 40 | Minutes |
| 11 | Turnovers | 26 | Assists per game | 41 | Games started |
| 12 | Disqualifications | 27 | Blocks per game | 42 | Games played |
| 13 | Field goals made | 28 | Minutes per game | 43 | Listed as TW (likely team wins) |
| 14 | Field goals attempted | 29 | Points per game | 44 | Listed as `FTR` (meaning unconfirmed) |

### Lineup slot IDs

Used by `eligibleSlots`, `lineupSlotId` and `lineupSlotCounts`.

| ID | Slot | ID | Slot |
| --- | --- | --- | --- |
| 0 | PG | 7 | SG/SF |
| 1 | SG | 8 | G/F |
| 2 | SF | 9 | PF/C |
| 3 | PF | 10 | F/C |
| 4 | C | 11 | UTIL |
| 5 | G | 12 | Bench |
| 6 | F | 13 | IR |

`defaultPositionId` uses a different numbering that starts at 1: 1 = PG, 2 = SG, 3 = SF, 4 = PF, 5 = C.

### NBA team IDs (`proTeamId`)

Six of these (11 to 16) were confirmed in the live schedule response.

| ID | Team | ID | Team | ID | Team |
| --- | --- | --- | --- | --- | --- |
| 0 | Free agent | 11 | IND | 22 | POR |
| 1 | ATL | 12 | LAC | 23 | SAC |
| 2 | BOS | 13 | LAL | 24 | SAS |
| 3 | NOP | 14 | MIA | 25 | OKC |
| 4 | CHI | 15 | MIL | 26 | UTA |
| 5 | CLE | 16 | MIN | 27 | WAS |
| 6 | DAL | 17 | BKN | 28 | TOR |
| 7 | DEN | 18 | NYK | 29 | MEM |
| 8 | DET | 19 | ORL | 30 | CHA |
| 9 | GSW | 20 | PHI |  |  |
| 10 | HOU | 21 | PHX |  |  |

## Gaps and caveats

The API is read-only in practice, unofficial, and silent on a few things the ESPN site shows.

- **No official support.** ESPN publishes no documentation, keys, rate limits or change notices. The host has already moved once, from `fantasy.espn.com` to `lm-api-reads.fantasy.espn.com`.
- **No write access.** Setting lineups, adding players or proposing trades is not realistic through this API.
- **No labels.** Stats, slots and teams come back as numeric IDs, so the Reference IDs tables have to live in your own code.
- **No real NBA box scores or play-by-play.** Player game logs give the fantasy stat line per game. Live game state comes from ESPN's separate scoreboard API, joined on the event ID.
- **Activity feed is current season only.** Past seasons returned an error, though their transactions are still available.
- **Other teams' trades may be thin.** The library notes that executed trades you were not part of come back without the players involved. The test league had no completed trades to check.
- **Private leagues need a login.** A private league returns "You are not authorized to view this League" until the request carries a logged-in ESPN session (the `espn_s2` and `SWID` cookies). Sessions expire, and each user of an app would need their own.
- **Members' real names are exposed** to anyone who can read the league.
- **Default paging.** Without the filter header, player calls return 50 players. The header cannot be sent from a plain browser address bar.

## Verification status and sources

Almost everything in this catalogue was confirmed by calling the API on 9 and 10 October 2026. League views were checked against a private 10-team head-to-head points league, through a logged-in ESPN session.

| Area | Status | How |
| --- | --- | --- |
| Game list, season metadata | Confirmed | Live call |
| Pro team schedules | Confirmed | Live call (response cut off after 6 of 30 teams) |
| Player pool and player cards | Confirmed | Live calls across all 1,095 active players |
| Player news | Confirmed | Live call |
| League settings and status | Confirmed | Template leagues and the real league |
| Members, teams, standings | Confirmed | Real league, 2027 and 2026 |
| Rosters, matchups, box scores | Confirmed | Real league, 2026 season |
| Draft picks | Confirmed | Real league, 2026 draft (156 picks) |
| Transactions | Confirmed for adds, drops, lineup moves, declined trades | 64 transactions sampled from 2026 |
| League chat and activity feed structure | Confirmed | Real league, 2027 |
| Filter header keys | Confirmed, except the activity feed filters | Sent from the logged-in session |
| Waiver claims, accepted trades, add/drop message type IDs | Unconfirmed | None in the samples; names from `espn-api` source |
| Category-league fields (`scoreByStat.result`, `TIE`) | Unconfirmed | The test league scores by points |
| Stat ID labels | Partly confirmed | From `espn-api`; consistent with the league's scoring items and ESPN's default categories |
| Stat IDs 36, 43, 44 | Unconfirmed | Abbreviations only, meaning not established |

The 2027 checks were made before the league's draft, so current-season rosters, transactions and scores were empty. Their structure was read from the 2026 season.

The remaining unconfirmed rows can be closed once the league has waiver claims and a completed trade this season.

**Sources**

- [ESPN fantasy API, game list](https://lm-api-reads.fantasy.espn.com/apis/v3/games)
- [ESPN fantasy API, 2027 basketball season](https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027)
- [ESPN fantasy API, template league settings](https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leaguedefaults/1?view=mSettings)
- [ESPN fantasy player news](https://site.api.espn.com/apis/fantasy/v3/games/fba/news/players?playerId=4431679)
- [espn-api, open-source Python library (cwendt94)](https://github.com/cwendt94/espn-api)
- [List of ESPN API endpoints (nntrn gist)](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)
