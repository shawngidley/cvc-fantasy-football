# WRC Lineup Direct-Reference Notes

Source reviewed from the private WRC reference: `client/src/pages/Lineup.tsx`.

## Required CVC parity patterns

- A **team selector and My Lineup hero** precede the roster content.
- A compact metric strip reports total points, projection, and league median.
- The roster is split into distinct WRC-style groups: a main **Superflex / starter group**, then grouped **Kicker** and **D/ST** sections. Bench players appear below starter rows and are visually differentiated with BN slot treatment.
- Each group uses a two-row dense header: player identity and weekly-decision fields, fantasy totals, and position-relevant season-stat columns.
- Player rows use headshots for offensive players and NFL team marks for D/ST, with a safe initials fallback only when source imagery is unavailable.
- The player identity, matchup, game time, current/live fantasy points, and position-specific stat context remain together in each row.

## CVC data constraint

CVC must retain its own roster assignments, slot rules, scoring, Tank01 stat lines, and current NFL matchup feed. Any unavailable season field or portrait must remain an explicit unavailable/fallback state; no WRC player records or mock statistics may be imported.
