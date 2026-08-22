# CVC 2026 Rules and Player-Protection Findings

## Source scope

This review is based on the supplied **CVCFootballFolder(2026)** workbook, specifically the 2026 Standings, Rosters, Schedule, Rules, Matching Rights Players, Rookie Draft, and Issues to Discuss sheets. The workbook identifies ten franchises, organized into East and West divisions, and retains salary and contract information for active roster records.

## Owners and franchises

The workbook identifies ten current owner/franchise pairs, split evenly between divisions. These should form the first CVC owner-selector choices and franchise records once the commissioner confirms each display name and access role.

| Division | Owner | Team No. | Franchise |
| --- | --- | ---: | --- |
| East | Mackar | 5 | Xavier Musketeers |
| East | Stapel | 4 | The Rusty Trombones |
| East | Sutton | 3 | Shepard's Pie |
| East | Heiden | 2 | Heiden's Hardtimes |
| East | Brock | 1 | DS Warteaters |
| West | Brickman | 6 | Dresser Drawer Devices |
| West | Nelson | 8 | Miller Time |
| West | Pattie | 9 | The Super Snuffleupagus |
| West | Sotka | 7 | The Legends |
| West | Sanner | 10 | Washington Foreskins |

The roster sheet contains some franchise labels in all capitals and at least one label that is not directly represented in the standings summary. CVC should use the standings names as the canonical franchise list and present any unmatched roster header to the commissioner for confirmation rather than assuming a mapping.

## Roster and salary rules

The rules sheet requires every franchise to carry **at least 15 and no more than 22 players at all times**. The salary cap is a firm **$115**, and the rules explicitly prohibit drafting above that cap and cutting down afterward. These rules align with the planned Auction Room safeguards: every award must preserve a one-dollar reserve for the number of players needed to reach 15, and no team may receive a twenty-third player.

>The live auction maximum is: **remaining budget − $1 × max(0, 14 − current roster size)**.

The roster sheet records a player’s position, NFL team, current salary, and a contract/right marker. The current source includes ordinary year labels as well as suffixes such as `R`, `F`, `T`, and `W`. CVC should not treat those suffixes merely as display text; it should preserve the original contract marker and translate it to a formal rights record after commissioner review.

| Workbook marker | CVC interpretation to verify | Application treatment |
| --- | --- | --- |
| Year only, such as `2027` | Standard active contract through the listed year. | Keep the player rostered and preserve salary/expiry. |
| `R` | Rookie contract or rookie-rights player. | Exclude from the regular auction while contract is active; retain rookie history. |
| `F` | Franchised player. | Preserve as a franchise designation with its contract term and salary. |
| `T` | Transition player. | Preserve as a transition designation with a one-year protected term. |
| `W` | Waiver / expiring free-agent marker. | Treat as a reviewable expiring player until the commissioner confirms cut, retention, or rights status. |

## How owners protect players

CVC has three related but distinct protection models. They should be represented separately in the data model and user interface rather than using one generic “protected” flag.

| Protection type | Rule derived from workbook | CVC behavior |
| --- | --- | --- |
| **Existing contract** | Players whose contracts have not expired are retained at the annual transition point. | The player remains on the franchise roster and is excluded from the auction pool. |
| **Franchise designation** | An owner may franchise one player in the under-$10 tier and one player in the over-$10 tier. Franchise contracts can be renewed; a franchise player may be traded. | Store a `franchise` designation, source salary, term, tier, designation season, and whether the tag remains available following a trade. |
| **Transition designation** | A transition player is retained for one final year. Under-$10 contracts double; over-$10 contracts add $10. The player cannot be transitioned again after that final term. | Store a `transition` designation, calculated salary, one-year end date, and `transition_exhausted` flag. |
| **Rookie restricted right** | Rookie contracts run three years, increase by $1 after year one and $5 after year two, and become restricted rights free agents at expiry. The original owner has the right to match the final regular-auction bid. | Store the original franchise and a `rookie_matching_right` record. Keep the player eligible for nomination only after the rookie contract ends, with an intervening commissioner match-decision state. |
| **Waiver restricted right** | At season end, an owner may designate one waiver-acquired player as a restricted rights free agent and receive the last right to match a following-year auction bid. | Store a single configurable waiver-right designation per franchise and season, with original owner, player, and match state. |

## Auction and rights sequence

The workbook describes two draft stages. The rookie event precedes the regular auction. Rookie picks may be bid up to **$15**, and the owner of the rookie pick has a final matching right; the current rookie draft order is stored separately. The normal auction then includes players no longer on active rosters.

For the regular auction, CVC should use the following commissioner flow when a player has rights:

1. The commissioner nominates an eligible player and records the room’s high bid.
2. If the player has a current rookie or waiver matching right, CVC pauses at the final bid and identifies the right-holding franchise.
3. The original rights holder either **matches** the final bid or **declines**.
4. CVC awards the player to the original rights holder if matched, or to the high bidder if declined, then updates the budget, roster count, salary, and rights record in one audited action.

The **Matching Rights Players** sheet is structurally prepared for this data but contains no populated player-right entries in the supplied workbook. The existing roster contract markers and the rookie-draft sheets therefore serve as the current evidence for protections. The commissioner should confirm the active waiver-right designation and any separate matching-rights entries before the auction pool is locked.

## Schedule and playoff implications

The schedule sheet stores matchups by week in a repeating layout, using owner names rather than franchise names. CVC should import the owner-to-franchise mapping first, then normalize each matchup to franchise IDs. The rules specify two divisions and a six-team playoff bracket: both division winners receive byes, with four wild-card teams.

The required CVC tiebreaker hierarchy is context-dependent: divisional ties use head-to-head, division record, and points scored; cross-division ties use head-to-head, then total points where required. Draft order uses related tiebreaking logic, with lower total points receiving the earlier pick after the relevant head-to-head check.

## Import decisions that require commissioner confirmation

| Item | Why confirmation is needed |
| --- | --- |
| Roster header mappings | At least one roster header does not match the canonical standings franchise list verbatim. |
| `W`, `R`, `F`, and `T` markers | The workbook shows these markers but does not provide a legend in the source itself. |
| Active waiver matching right | The dedicated matching-rights sheet is presently blank. |
| Current rookie-pick ownership | The 2026 rookie sheet contains trade-style owner annotations such as `Sanner (Heiden)` that need original/current ownership separation. |
| 2026 schedule lock dates | The schedule contains weekly pairings but no finalized timestamps for CVC page locks. |
| Rules refresh | Some visible dates reference prior seasons and Fantrax; CVC should preserve rule text as history while the commissioner updates current-year operational dates and website references. |
