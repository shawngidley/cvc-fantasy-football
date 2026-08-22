# WRC Money Page Reference

Source reviewed from the private WRC reference: `client/src/pages/Money.tsx`.

## WRC structure

The WRC Money page uses a turf-backed financial dashboard with four principal sections:

1. **Money Owed:** an owner-by-owner matrix, visible to all; commissioners can enter edit mode and save balances.
2. **Prize Structure:** payout tiers and total pool values.
3. **Game of the Week history:** weekly winner, team, opponent, score, and payout records; commissioner-managed.
4. **Season earnings:** owner-by-owner payout summary.

## CVC source mapping

| WRC concept | CVC source |
|---|---|
| Money Owed | `financial_entry` rows with open dues, penalties, adjustments, credits, and paid/void status. |
| Owner/franchise columns | Active CVC `owner` and `franchise` records. |
| Prize structure / earnings | CVC financial entries or commissioner configuration; do not invent prize amounts. |
| GOW history | CVC weekly matchup result plus finance record, only when CVC prize rules are configured. |

## CVC constraint

The WRC layout can be ported directly, but CVC will render clearly empty/configuration-needed prize and Game of the Week sections until the commissioner supplies CVC-specific payout rules. No WRC amounts or owner data may be carried into CVC.
