# WRC Tank01 Live-Scoring Reference for CVC

## Reference scope

This document records the verified implementation pattern from the user-provided WRC reference repository. It is used only as a technical reference; CVC retains its own branding, league data, and scoring rules.

## WRC live-data flow

| Concern | Verified WRC implementation |
| --- | --- |
| Credential boundary | A server-side `/api/tank01/:endpoint` proxy holds the RapidAPI credential and accepts only approved Tank01 endpoints and scalar query inputs. |
| Live schedule | `getNFLGamesForWeek` maps NFL team abbreviations to a game ID, kickoff date, and time. |
| Live statistics | `getNFLBoxScore` is requested with fantasy-point parameters for each active game. |
| Client polling | The Live Scoring view polls every 30 seconds while at least one game is active and stops when all games are final. |
| Score conversion | Tank01 player and D/ST box-score stats are converted by a league scoring engine. |
| Caching | Player detail calls use a 10-minute browser session cache; final live scores remain in the browser session. |

## Confirmed CVC direction

CVC will use the same 30-second active-game Tank01 browser polling pattern while adding a server-side finalization path. Tank01—not commissioner entry—will be the sole source for persisted matchup results and standings updates. The supplied CVC scoring system is stored in `docs/CVC_Scoring_System_Transcription.md` and has been persisted to the active CVC season’s scoring-rule configuration.
