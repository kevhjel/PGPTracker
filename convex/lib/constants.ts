// ClubSpeed timing glitches occasionally record implausibly fast "laps"
// (sub-76s isn't physically achievable on this track); exclude them
// anywhere lap times are ranked or aggregated.
export const MIN_VALID_LAP_MS = 76_000;
