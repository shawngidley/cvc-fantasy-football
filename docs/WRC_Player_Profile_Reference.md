# WRC Player Profile Reference

Source reviewed from the private WRC reference: `client/src/pages/PlayerPage.tsx`.

## Direct reference structure

WRC’s profile uses a premium dark-turf page with a player hero, ownership state, season stats, current matchup, injury/news, and position-specific stat tables.

| Area | WRC behavior | CVC port requirement |
|---|---|---|
| Hero | Headshot, name, position color badge, NFL team, injury status | Use CVC player provider data and available Tank01 image/team fields; never fabricate unavailable visual data. |
| Ownership | Current fantasy franchise or available FAAB state | Use active CVC roster assignment and live Free Agent eligibility. |
| Points | WRC scoring engine from Tank01 season stats | Use persisted CVC scoring rules and shared `cvcScoring` engine. |
| Season table | Position-specific stats, points, games played | Render fields returned by Tank01 and CVC player metadata. |
| Matchup | Current NFL opponent and kickoff context | Use the existing CVC Tank01 weekly game context. |
| News/injury | Provider designation plus recent player news | Reuse CVC server-only Tank01 news route where matching player data is available. |

## CVC constraints

Player images, ESPN historical data, and projections must be omitted or labelled unavailable until a provider-backed field exists. CVC should not make up player ratings, health labels, or performance data.
