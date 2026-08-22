# WRC Schedule & Results Reference

Source reviewed from the private WRC reference project: `client/src/pages/ScheduleResults.tsx`.

## WRC interaction model to port into CVC

The WRC page is a combined **Schedule & Results** game-center route. It uses a compact page title, current-week context, week selection, and matchup cards. A card surfaces both franchise identities, owner context, the matchup state, and—when a matchup is final—the final team totals. The current week routes the user to Live Scoring rather than treating results as manually entered data.

| WRC behavior | CVC implementation requirement |
|---|---|
| Past weeks show final weekly results | Display Tank01-finalized CVC matchup totals. |
| Current week exposes a Live entry point | Link CVC current-week matchups to `/live`. |
| Future weeks show scheduled opponents | Use imported CVC 2026 matchup data. |
| Owner can filter to My Schedule | Use the independent CVC owner-PIN franchise session. |
| Team cards visually mark the owner’s matchup | Highlight the signed-in CVC franchise when applicable. |
| WRC formerly offered commissioner score entry | **Do not port.** CVC is Tank01-only; automatic finalization is the sole result writer. |

## CVC data substitutions

Use CVC imported schedule weeks and matchups, CVC franchises/owners, the current CVC season, and the Tank01 reconciliation output. Do not bring WRC static schedule data, manual score-entry controls, or WRC teams into CVC.
