import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Both scrape loops are self-rescheduling (see convex/actions/scrapeHeats.ts).
// These hourly watchdogs just re-kick the chain if it ever dies (e.g. after
// a deploy) - calling an already-running loop again is harmless/idempotent.
crons.interval("scrape heats watchdog", { hours: 1 }, internal.actions.scrapeHeats.scrapeBatch, {});
crons.interval(
  "recheck empty heats watchdog",
  { hours: 1 },
  internal.actions.scrapeHeats.recheckEmptyHeats,
  {},
);
crons.interval(
  "recheck missed heats watchdog",
  { hours: 1 },
  internal.actions.scrapeHeats.recheckMissedHeats,
  {},
);

export default crons;
