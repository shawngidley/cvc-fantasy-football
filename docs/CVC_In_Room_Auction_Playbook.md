# CVC In-Room Auction Draft Playbook

## Operating model

The CVC auction is designed for a shared physical room. One commissioner operates the official draft console, which is projected for the league. Owners call bids aloud; they do not need to authenticate or place bids through their own devices. The commissioner is the sole operator for nominations, bid entry, auction close, corrections, and draft completion.

## Locked draft rules

| Rule | CVC behavior |
| --- | --- |
| Starting budgets | The commissioner enters each franchise’s individual starting budget before the draft. No starting budget may exceed **$115**. |
| Minimum bid | Every winning amount must be at least **$1**. |
| Bid increments | The commissioner may record any legal higher amount; no fixed increment is enforced. |
| Roster limits | Each franchise must finish with at least **15 players** and may acquire no more than **22 players**. |
| Nomination order | The commissioner selects the nominating franchise manually for every player. |
| Sale close | Only the commissioner can close an auction by pressing **Award player**. No timer is required. |
| Eligible pool | Only players who are neither rostered nor rookies may be nominated. Rookie selection is deferred to the separate rookie draft. |

## Protected budget math

For every potential award, CVC should compute the franchise’s legal spending ceiling before saving the transaction.

> **Maximum legal bid = remaining budget − $1 × max(0, 14 − current roster size)**

This protects the minimum one-dollar reserve only until the franchise reaches its 15-player minimum. For example, a franchise with 10 players and $28 remaining may spend no more than $24 now; CVC reserves $1 for each of the four remaining players needed after that award. Once a franchise has 15 players, it may spend all remaining funds on additional legal purchases up to the 22-player maximum. A franchise at 22 players cannot receive another award.

## Commissioner screen

The draft console should have a single “run the room” surface. The primary panel contains player search, the manually selected nominating franchise, current leading franchise, winning amount, and a prominent **Award player** action. The surrounding budget board shows every franchise’s remaining budget, protected reserve, maximum legal bid, and open roster slots. A recent-sales ribbon provides a visible record of the last several awards.

| Control | Commissioner action | Safeguard |
| --- | --- | --- |
| Start nomination | Select a player and nominate a franchise. | Prevents duplicate drafted players. |
| Record high bid | Enter the leading franchise and amount. | Rejects bids below $1 or above the legal ceiling. |
| Award player | Closes the sale. | Atomically records purchase, updates budget, and assigns roster slot. |
| Pause room | Stops changes while the league discusses a question. | Keeps the active nomination visible without mutation. |
| Correct last award | Reverses the most recent sale. | Requires a reason; restores player, budget, and roster capacity. |
| Manual correction | Corrects a historical award. | Requires commissioner confirmation and permanent audit note. |
| End draft | Moves draft to reconciliation. | Blocks closure until errors are reviewed. |

## Draft-night procedure

Before the room starts, the commissioner enters each starting budget, confirms the 15-player roster limit, verifies that the eligible player directory is loaded, and opens the projected public board. For each player, the commissioner selects the nominating franchise, searches the player, records the final winning franchise and amount after the room’s call, and presses **Award player**. The system displays the updated budget math immediately.

At the end, CVC should run a reconciliation check. It flags franchises below 15 or above 22 players, teams with a negative budget, players with duplicate assignments, and franchises that do not satisfy required roster rules once those rules are configured. The commissioner resolves flagged issues before the draft is locked.

## Player-pool spreadsheet import

Before the auction, the commissioner imports the current league player spreadsheet using `CVC_Auction_Player_Import_Template.csv`. The required fields are `player_name`, `position`, `nfl_team`, `is_rookie`, and `current_franchise`; `external_player_id` is recommended when available. Leave `current_franchise` blank for an unrostered player. Set `is_rookie` to `TRUE` for a rookie and `FALSE` for an established player.

The auction pool is derived automatically as follows: a player is eligible only when `current_franchise` is blank and `is_rookie` is `FALSE`. CVC preserves the imported rostered players for roster history but excludes them from the auction search and nomination controls.

## Intentionally deferred decisions

The following decisions can remain configurable until the league rules arrive: the player-data source used to identify current roster and rookie status, keeper and salary carryovers, IR/taxi treatment during the draft, nomination restrictions, and post-draft roster correction window. None of these changes the core in-room auction workflow.
