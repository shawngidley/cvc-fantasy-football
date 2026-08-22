# CVC Live Scoring Verification

## Verified current-week presentation

The mobile Live Scoring route now uses a WRC-style structure: current-week-only indicator, horizontally scrollable matchup rail, selected head-to-head card, franchise identifiers, live-total area, and a side-by-side starter-row container. The page uses CVC branding and the Tank01-only scoring model.

## Current data prerequisite

The imported CVC roster records do not yet include submitted `assigned_slot_code` lineup assignments for the selected scoring week. Accordingly, the verified view correctly displays zero configured starters rather than fabricating lineups or scores. Owners must assign their current-week starters through the protected My Lineup workspace before real side-by-side player rows and Tank01 totals can populate.
