# CVC Fantasy Football: Commissioner Onboarding Guide

## Purpose

The CVC Fantasy Football foundation is connected to the dedicated **CVC Auction Football** Supabase project. It includes demonstration records so every public and commissioner-facing surface can be reviewed immediately. Those records are explicitly placeholders and should be replaced in a controlled order before the league is opened to members.

> The CVC website uses its server-side data adapter for all Supabase reads and writes. The Supabase secret key remains server-only; commissioners should never paste database keys into the site or distribute them to league members.

## Recommended setup order

| Step | Commissioner task | CVC configuration area | Result |
| --- | --- | --- | --- |
| 1 | Confirm the league name, season year, timezone, and brand colors. | Supabase `league` and `season` records. | Establishes the active CVC season. |
| 2 | Create each owner and assign the correct role. | **League Configuration → Owners & access** | Supports owner, commissioner, and administrator permissions. |
| 3 | Create each franchise and division. | **League Configuration → Teams** | Populates standings, roster, schedule, and draft ownership. |
| 4 | Set positions, starter counts, benches, taxi, and IR. | **League Configuration → Roster slots** | Defines legal roster and lineup structure. |
| 5 | Enter scoring values and special rules. | **League Configuration → Scoring** | Provides the CVC scoring-rule source of truth. |
| 6 | Configure weeks, matchups, playoffs, and tiebreakers. | **League Configuration → Schedule & playoffs** | Enables schedule/results and playoff representation. |
| 7 | Set draft format, protections, keepers, and auction settings. | Draft records in Supabase; CVC draft pages display them. | Enables draft hub, lottery, and recap workflows. |
| 8 | Publish the approved league rules and finance entries. | **League Configuration → Rules & content** and **Finance** | Gives members a versioned governance and finance record. |
| 9 | Replace all sample transactions, players, rosters, and results. | Controlled Supabase import or commissioner tools. | Removes demonstration-only content. |

## Required league inputs

Before the public launch, collect the following information from the commissioner. The data model is intentionally configurable, so no code changes are needed for any of these items.

| Area | Required information |
| --- | --- |
| League identity | Official league name, short name, logo, colors, timezone, public/private preference. |
| Teams | Franchise name, abbreviation, owner, division, branding color, and display order. |
| Owners | Display name, email, and permission level: `owner`, `commissioner`, or `administrator`. |
| Rosters | Eligible positions, required starters, bench, IR, taxi, and position-specific restrictions. |
| Scoring | Every stat key, point value, bonuses, penalties, and position scope. |
| Schedule | Regular-season weeks, home/away pairings, lock times, playoffs, seeding, and tiebreakers. |
| Draft | Auction/snake/linear format, budget, timer, round count, pick ownership, lottery, keepers, and protections. |
| Transactions | Waiver cadence, FAAB budget, bid tiebreaker, trade approvals, deadlines, and commissioner override policy. |
| Finance | Dues, payout categories, due dates, balances, penalties, credits, and privacy settings. |
| Rules | Approved Markdown-ready rules text and version label. |

## Commissioner access

The project owner’s first authenticated visit maps their managed project identity to the initial CVC commissioner record. Additional commissioners or administrators should be created through **League Configuration → Owners & access**. Each role is enforced server-side:

| Role | Intended access |
| --- | --- |
| Owner | Secured lineup and owner workspace access. |
| Commissioner | Full league configuration, administrative updates, and audit-aware operations. |
| Administrator | Same protected management access for delegated league staff. |

If a signed-in person sees **“Commissioner only,”** their account has not yet been mapped to a CVC commissioner or administrator record. A commissioner must create or update their owner record with the correct managed user identity before granting access.

## CSV templates and imports

The commissioner area provides downloadable CSV header templates for teams, owners, scoring, roster slots, schedule weeks, rule metadata, and financial entries. Use the templates as the authoritative column order. CSV review is intentionally surfaced in the UI, while the current first-release workflow saves validated records through the individual forms.

For a large initial league import, prepare the CSV files using the template headers, review them with the commissioner, and import them through the server-side CVC data workflow. Do not run direct database edits from an untrusted spreadsheet, and do not expose the Supabase secret key in a browser or spreadsheet.

## Replacing demonstration data

The seeded records exist only to make CVC immediately reviewable. Before launch, replace the placeholder league, owner, franchise, player, roster, matchup, draft, transaction, waiver, rule, and finance records. Preserve the schema and security configuration; replace the record content, not the table structure.

The CVC Supabase schema has Row Level Security enabled on every league-domain table. The public website accesses it through protected server procedures, and commissioner actions write an `audit_event` entry. Keep this pattern when adding future modules.

## Live NFL data provider

The live-scoring and player-news views have a provider-neutral boundary. Before enabling live data, select a provider, define the normalized player/game/stat payload, set a refresh strategy, and establish a correction policy. The provider’s credential must be added as a server-only secret; it must never be delivered to the browser.

## Launch checklist

| Check | Status required |
| --- | --- |
| All placeholder CVC records replaced or clearly retained only for non-production testing. | Complete |
| Commissioner and administrator roles tested with real accounts. | Complete |
| Owner access tested for lineup pages. | Complete |
| Scoring, roster, waiver, trade, and tiebreaker policies approved. | Complete |
| Draft settings and pick ownership verified. | Complete |
| Rules document published and linked from the Rules page. | Complete |
| Financial entries reviewed and privacy expectations communicated. | Complete |
| NFL data provider configured, or live-data pages intentionally remain in provider-ready mode. | Complete |
| Desktop and mobile routes reviewed after real league data is loaded. | Complete |

## Custom domain handoff: cvcfantasyfootball.com

CVC is hosted on Vercel; DNS for `cvcfantasyfootball.com` is managed at Namecheap. To connect the domain:

1. In the Vercel project, open **Settings → Domains** and add both `cvcfantasyfootball.com` and `www.cvcfantasyfootball.com`. Choose the apex domain as canonical, with `www` redirecting to it.
2. Vercel displays the exact DNS records required (typically an `A` record for `@` pointing at Vercel's anycast IP, and a `CNAME` for `www` pointing at `cname.vercel-dns.com` — use whatever the dashboard currently shows).
3. Add those records in Namecheap's **Advanced DNS** panel for the domain, removing any conflicting existing `@`/`www` records.
4. Wait for DNS propagation and Vercel's automatic SSL issuance, then confirm both `https://cvcfantasyfootball.com` and `https://www.cvcfantasyfootball.com` resolve to the live site.
