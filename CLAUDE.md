# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CVC Fantasy Football — a full-stack league app (standings, live scoring, rosters, protections, auction draft, trades, etc.) for a specific league ("CVC"). It was originally scaffolded from a Manus WebDev template but has since been migrated off Manus hosting entirely to **Vercel** (static build + serverless functions + Vercel Cron), with DNS managed at Namecheap — see `docs/CVC_Domain_Status.md` and `docs/CVC_League_Onboarding.md`. `todo.md` tracks in-flight feature work — check it for current project status before starting new work.

## Commands

```
pnpm dev          # local dev server (tsx watch on server/_core/index.ts + Vite middleware), NODE_ENV=development
pnpm build        # vite build (client) + esbuild bundle of server/_core/index.ts -> dist/ (for self-hosting; Vercel uses its own `vercel.json` buildCommand instead)
pnpm start        # run the built self-hosted server from dist/index.js (production)
pnpm check        # tsc --noEmit (type check only, no test files)
pnpm test         # vitest run (all *.test.ts under server/ and client/src/)
pnpm format       # prettier --write .
```

Run a single test file: `pnpm vitest run server/cvcOwnerAuth.test.ts`. Tests are colocated with the code they cover (e.g. `server/routers/auction.ts` logic is tested indirectly via `server/auction.public.test.ts`; `shared/cvcProtectionPolicy.ts` has `shared/cvcProtectionPolicy.test.ts` next to it).

Package manager is **pnpm** (see `packageManager` in package.json). There's a patch applied to `wouter@3.7.1` via `patches/`.

## Architecture

### Deployment: Vercel serverless + Vercel Cron

`server/_core/app.ts` exports `createApp(): Express` — the whole API surface (body parsers, `/api/tank01/:endpoint`, `/api/scheduled/tank01-scoring-sync`, `/api/trpc`), with no static serving and no `.listen()`. Two things consume it:
- `api/index.ts` — the Vercel serverless entry point, exported directly as `createApp()`. `vercel.json` rewrites all `/api/*` traffic to this one function (preserving the original path, so Express's own router still dispatches correctly) plus an SPA fallback (`/(.*)` → `/index.html`) for wouter's client-side routes.
- `server/_core/index.ts` — the local-dev/self-host entry point (`pnpm dev`/`pnpm start`), which wraps the same `createApp()` with `setupVite`/`serveStatic` and `server.listen(...)`.

The Tank01 scoring sync (`/api/scheduled/tank01-scoring-sync`, driving `server/tank01ScoringSync.ts`) runs on a Vercel Cron Job (see the `crons` array in `vercel.json`). It's authenticated via Vercel's automatic `Authorization: Bearer $CRON_SECRET` header — set a `CRON_SECRET` env var with the same name in the Vercel project and Vercel injects it on cron-triggered requests.

### Data: Supabase for everything

**Supabase (Postgres)** is the sole data store for every CVC domain concept: `league`, `season`, `franchise`, `owner`, `owner_session`, `roster_assignment`, `player`, `player_right`, `draft`, `auction_nomination`, `auction_team_state`, `transaction`, schedule/matchup tables, etc. Accessed via the raw `@supabase/supabase-js` client in `server/supabase.ts`, using the service-role `SUPABASE_SECRET_KEY`. Almost all query results are passed through `unwrap()`, which throws on `{ error }` and returns `.data` otherwise — always use it instead of hand-checking `result.error`.

Supabase **Storage** (public `team-logos` bucket) backs the one dynamic file-upload feature — franchise team-logo uploads via `server/storage.ts`'s `storagePut`. Static branded assets (favicon, PWA icons, background photography, header crest, social-share image) are plain files checked into `client/public/brand/` and referenced directly — no object storage involved for those.

Supabase schema changes live in `supabase/migrations/*.sql` (each paired with a same-named `.json` in some cases) and are applied in filename order (timestamp-prefixed, e.g. `202608220001_cvc_league_domain.sql`). Placeholder/seed data is in `supabase/seeds/`. There is no automatic migration runner checked in here — check `scripts/prepareSupabaseMigration.mjs` / `prepareSupabaseSeed.mjs` for how migrations/seeds get pushed to Supabase.

### `_core` directories

`server/_core/*`, `client/src/_core/*`, and `shared/_core/*` hold generic server plumbing (the base tRPC setup in `trpc.ts`/`context.ts`, cookie helpers, Vite dev middleware, `systemRouter`'s health check, the Vercel app factory described above). What used to be Manus-platform-specific scaffolding (OAuth login, Forge object storage, cron/heartbeat registration, image generation, maps/data-API proxies, voice transcription) has been removed — it was dead weight coupled to a hosting platform this app no longer runs on. Prefer adding CVC feature code in the sibling non-`_core` files (`server/routers/*`, `server/*.ts`, `client/src/pages/*`, `client/src/components/*`, `shared/*.ts`).

### Auth: CVC owner PIN system

`server/cvcOwnerAuth.ts` / `server/routers/ownerAuth.ts` is the only auth system. Owners pick their name from a dropdown and enter a 4-digit PIN (scrypt-hashed, `pin_hash` column). A session token is stored server-side in Supabase `owner_session` and handed to the browser as the `cvc_owner_session` cookie. `server/_core/context.ts` bridges this into tRPC by synthesizing a `CvcUser` object from the CVC owner session (role `commissioner`/`administrator` → tRPC `admin`, everyone else → `user`) — this is what `ctx.user` and `protectedProcedure`/`adminProcedure` (`server/_core/trpc.ts`) actually gate on.

Client-side: `client/src/hooks/useCvcOwnerAuth.ts` (and `client/src/_core/hooks/useAuth.ts`, which is a thin tRPC wrapper around the same session despite its `_core` location) wrap `trpc.ownerAuth.session`. Route protection is `client/src/components/ProtectedPage.tsx`, used as `<ProtectedPage>` (any signed-in owner) or `<ProtectedPage commissioner>` (commissioner/administrator only). The canonical list of public vs. protected paths is `client/src/lib/routeMap.ts` (`cvcRouteMap`) — keep it in sync with the actual `<Route>` list in `client/src/App.tsx` (there's a `routeMap.test.ts` guarding this).

### Server API shape

Single tRPC router tree in `server/routers.ts` (`appRouter`), mounted at `/api/trpc` via `server/_core/app.ts`. Feature routers live in `server/routers/`: `league.ts` (largest — standings, schedule, rosters, protections, transactions, etc.), `auction.ts` (in-room commissioner-operated auction console), `ownerAuth.ts` (PIN sign-in/out, PIN reset, logo upload). `system: systemRouter` (`_core`) only exposes a `health` check.

Non-tRPC Express routes registered in `server/_core/app.ts`: `/api/tank01/:endpoint` (proxies Tank01 NFL data, see `server/tank01Proxy.ts`) and `/api/scheduled/tank01-scoring-sync` (Vercel Cron endpoint, see above).

Procedure levels (`server/_core/trpc.ts`): `publicProcedure`, `protectedProcedure` (requires `ctx.user`), `adminProcedure` (requires `ctx.user.role === 'admin'`, i.e. commissioner/administrator). Auction and owner-auth routers additionally do their own commissioner/role checks by hand against the `owner` table rather than relying solely on `adminProcedure` — follow that pattern when adding CVC-role-gated mutations rather than assuming `adminProcedure` alone is sufficient.

### CVC domain rules worth knowing before touching logic

- **Auction**: commissioner-operated console, no owner self-service bidding. Starting budget cap $115, roster range 15–22 players, no per-position caps, reserve math based on `14 - rosterCount` remaining minimum slots (`calculateAuctionLegalMaxBid` in `server/routers/auction.ts`). Only unrostered, non-rookie, non-`placeholder`-provider players in `CVC_AUCTION_POSITIONS` (QB/RB/WR/TE/K/DST) are eligible. See `docs/CVC_In_Room_Auction_Playbook.md`.
- **Contracts/protections** (`shared/cvcProtectionPolicy.ts`): franchise tags are `two_year` vs `three_year` tiers keyed off salary/`F2`/`F3`/`T2`/`T3` markers; cutting a contracted player has no dead-cap penalty and immediately opens unrestricted free agency/auction eligibility. See `docs/CVC_2026_Rules_and_Protection_Findings.md`.
- **Scoring**: `shared/cvcScoring.ts` + `server/cvcScoring.test.ts`; live sync comes from Tank01 (`server/tank01ScoringSync.ts`, `server/tank01Proxy.ts`) with FantasyPros as a secondary provider (`server/fantasyProsSync.ts`, `server/fantasyProsCache.ts`). The NFL data adapter boundary is deliberately provider-neutral (`server/nflDataAdapter.ts`) — don't hard-code a provider outside the adapter/proxy layer.
- `docs/` has substantial reference material (rules transcriptions, owner/franchise mapping, route-parity checks against a reference "WRC" implementation, verification notes) — check there before re-deriving CVC business rules from scratch.

### Frontend structure

Vite + React 19 + wouter (not react-router) for routing, TanStack Query + tRPC React client (`client/src/lib/trpc.ts`), Tailwind v4, shadcn/radix-based `components/ui/`. Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*` (defined in both `tsconfig.json` and `vite.config.ts`/`vitest.config.ts` — keep them in sync if changed). Most CVC page-level views are large single components under `client/src/components/Cvc*.tsx` rendered by the generic `client/src/pages/LeaguePages.tsx` (`<LeaguePage kind="...">` switch) rather than one component per route file.

### Environment variables

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TANK01_RAPIDAPI_KEY`, `FANTASYPROS_API_KEY`, `CRON_SECRET`. No `.env*` file is committed (gitignored) — set these in Vercel's project settings for deploys and in a local `.env` for `pnpm dev`.
