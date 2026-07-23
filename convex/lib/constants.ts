// ClubSpeed timing glitches occasionally record implausibly fast "laps"
// (sub-76s isn't physically achievable on this track); exclude them
// anywhere lap times are ranked or aggregated.
export const MIN_VALID_LAP_MS = 76_000;
// ...and, less commonly, implausibly slow ones (a stuck/duplicated timing
// beacon can record a "lap" of several minutes). A real caution/spin lap
// stays well under this; exclude anything past it as scraper garbage rather
// than a legitimate slow lap, everywhere lap times are charted or aggregated.
export const MAX_VALID_LAP_MS = 600_000;
