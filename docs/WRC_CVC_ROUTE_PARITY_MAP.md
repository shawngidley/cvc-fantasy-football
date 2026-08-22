# WRC-to-CVC Route Parity Map

## Direct-reference principle

CVC uses the WRC source as the route, layout, interaction, and responsive-design baseline. CVC substitutions are limited to league branding, CVC owner/franchise data, CVC rules, independent owner-PIN access, and CVC provider-backed data.

| WRC source route | CVC route | Reference status | CVC-specific substitution |
|---|---|---|---|
| `/standings` | `/standings` | East/West table implemented; needs continued WRC visual parity review | CVC divisions, owners, money owed, dynamic records |
| `/live` | `/live` | WRC-style current-week rail and head-to-head structure in progress | Tank01 / CVC scoring rules / CVC lineups |
| `/lineup` and `/lineup/:teamId` | `/lineup` and `/lineup/:franchiseId` | WRC-style owner workspace in progress | Owner PIN access / CVC roster slots |
| `/draft`, `/draft-lottery`, `/draft-recap` | Same CVC routes | Functional CVC foundation; WRC parity pending | CVC rookie-draft rules and pick ownership |
| `/rundown` | `/rundown` | Parity pending | CVC league updates |
| `/news` | `/news` | Parity pending | CVC provider news |
| `/transactions` | `/transactions` | Functional CVC ledger; parity pending | CVC protections, waiver, auction, and trade events |
| `/results` and `/schedule` | `/results` | Schedule data implemented; parity pending | CVC imported schedule and Tank01 final totals |
| `/trades` | `/trades` | Functional CVC workflow; parity pending | CVC owner and commissioner rules |
| `/history` | `/history` | Parity pending | CVC historical content |
| `/playoffs` | `/playoffs` | Parity pending | CVC playoff rules |
| `/rules` | `/rules` | Parity pending | CVC rulebook |
| `/nfl-sites` | `/nfl-sites` | Parity pending | CVC resources |
| `/rosters` | `/rosters` | Dynamic CVC roster data; parity pending | CVC contracts and rights |
| `/money` | `/money` | Dynamic CVC financial data; parity pending | CVC finance ledger |
| `/settings` | `/settings` and `/owner-settings` | CVC owner PIN/settings implemented; WRC parity pending | CVC owner-PIN and commissioner setup |
| `/player/:playerName` | `/player/:id` | Dynamic CVC profiles implemented; parity pending | Stable CVC provider/imported player ID |
| `/free-agents` | `/free-agents` | Dynamic CVC player pool and waiver workflow implemented; parity pending | CVC auction/waiver rules |

## Evidence retained from WRC source

WRC exposes its owner Lineup route with direct access to: current-week matchup data, Tank01 live scores, player stat tables, player/game context, lineup persistence, player locks, and an automatic final-results writer. WRC Live Scoring uses the same Tank01 live-score hooks and current-week data surface. CVC must retain this structure while replacing the WRC data conventions with CVC Supabase records, CVC scoring rules, and the CVC Tank01 server proxy.
