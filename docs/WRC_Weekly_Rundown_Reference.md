# WRC Weekly Rundown Reference

Source reviewed from the private WRC reference project: `client/src/pages/Rundown.tsx`.

## Core WRC structure

WRC presents a weekly league summary, not generic commissioner copy. It has a compact title showing the selected week and its status, a week selector for all regular-season weeks, and a responsive grid of matchup cards. Each matchup card displays both franchises, final scores when they exist, an upcoming state when they do not, optional league-median context, and a visual marker for the signed-in owner’s matchup.

## CVC requirements

| WRC behavior | CVC replacement |
|---|---|
| Week selector | Imported CVC 2026 schedule weeks. |
| Final scores | Tank01-only finalized CVC matchup totals. |
| Upcoming state | Imported CVC scheduled matchup. |
| Current owner marker | CVC owner-PIN session and mapped franchise. |
| Median comparison | Calculate from current CVC week results when sufficient final scores exist. |
| Manual commissioner entry | Do not port; CVC final scores are Tank01-only. |

The CVC route should use the WRC dark turf/game-center hierarchy and matchup-card density while replacing WRC branding, static schedule arrays, and manual data-write paths.
