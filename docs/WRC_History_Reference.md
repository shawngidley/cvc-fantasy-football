# WRC Franchise History Reference

Source reviewed from the private WRC reference: `client/src/pages/History.tsx`.

## Direct reference structure

WRC’s History page is a history dashboard with a page title and five data-driven sections:

1. **Champions banner/table:** season, champion franchise, owner, and championship score; clicking a season selects it.
2. **Year selector:** chips or buttons that change the selected historical season.
3. **Season standings:** division tables with W/L, games back, head-to-head record, median record, division record, and points where historical data is available.
4. **Playoff results:** playoff rounds with matchup-result rows.
5. **All-time records:** franchise, owner, all-time W/L, winning percentage, and titles.

## CVC constraint

No CVC historical standings, champions, playoff results, or award data have been supplied/imported. A CVC port must use the WRC structure but render an explicit CVC history configuration/empty state until commissioner-approved historical seasons are imported. Never copy WRC historical names, records, champions, or payout facts into CVC.
