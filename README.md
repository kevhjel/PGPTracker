# PGP Times

Race history, leaderboards, and per-driver stats for PGP Kent's ClubSpeed karting
timing system, rebuilt on Vercel + Convex. See `.claude/plans/` (or your original
plan doc) for the full architecture writeup.

## Stack

- Vite + React + TypeScript SPA, Tailwind v4
- Convex for schema, queries/mutations, and the ingestion scraper (Node actions)
- Recharts for lap-time visualizations
- Deployed to Vercel; `vercel.json`'s build command runs `npx convex deploy` before `vite build`

## Development

```bash
npm install
npx convex dev   # starts a local Convex backend + watches convex/ for changes
npm run dev      # in a second terminal - Vite dev server
```

Set an admin secret for the local deployment (gates admin mutations/actions):

```bash
npx convex env set ADMIN_SECRET <some-value>
```

Enter that same value once in the Admin → Scrape Health page (stored in
`localStorage`) to unlock admin actions in the UI.

## Scraping

The scraper (`convex/actions/scrapeHeats.ts`) walks ClubSpeed's `HeatDetails.aspx`
pages by heat number, parses both the `RaceResults` table (for each driver's
stable ClubSpeed CustID and summary stats) and the `LapTimesContainer` table (for
per-lap times), joins them by driver name, and upserts into Convex. It runs as a
self-rescheduling loop (`crons.ts` has an hourly watchdog in case the chain ever
dies) that doubles as both the historical backfill and the ongoing live poll for
new heats.

Trigger scraping manually from Admin → Scrape Health, or via CLI:

```bash
npx convex run actions/scrapeHeats:scrapeOneHeat '{"heatNo": 84700}'
npx convex run actions/scrapeHeats:scrapeBatch '{}'
```
