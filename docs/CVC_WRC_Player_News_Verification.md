# CVC WRC Player News Verification

## Source parity completed

The CVC `/news` route now uses the WRC page hierarchy: Player Wire label, compact News heading, My Team toggle, manual refresh control, position pills, and a direct-reference feed card. The route uses a CVC server-only Tank01 proxy; provider keys are not exposed to the browser.

## Remaining provider-state finding

Two mobile route captures showed the expected loading state but did not receive the Tank01 news payload before the capture. This is a provider-response or proxy-state verification issue, not a layout issue. Confirm `getNFLNews?recentNews=true` returns within the CVC proxy timeout, then capture the populated row state before marking the Player News port complete.
