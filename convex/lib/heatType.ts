export type HeatCategory =
  | "arrive_and_drive"
  | "league"
  | "pro_am"
  | "group_event"
  | "practice"
  | "endurance"
  | "other";

export type ResultModeHint = "individual" | "team" | "unknown";

/**
 * ClubSpeed's raw race-type label is uncontrolled free text (inconsistent
 * spacing/hyphenation for the same concept, e.g. "Arrive and Drive- 18 Karts"
 * vs "Arrive and Drive -15 Karts"). Classify by keyword rather than exact
 * match, and never throw on an unrecognized string - fall back to "other".
 */
export function categorizeHeatType(raw: string): {
  category: HeatCategory;
  resultModeHint: ResultModeHint;
} {
  const s = raw.toLowerCase();

  if (s.includes("endurance")) {
    return { category: "endurance", resultModeHint: "team" };
  }
  if (s.includes("arrive") && s.includes("drive")) {
    return { category: "arrive_and_drive", resultModeHint: "individual" };
  }
  if (s.includes("league")) {
    return { category: "league", resultModeHint: "individual" };
  }
  if (s.includes("pro-am") || s.includes("pro am")) {
    return { category: "pro_am", resultModeHint: "individual" };
  }
  if (s.includes("group event")) {
    return { category: "group_event", resultModeHint: "individual" };
  }
  if (s.includes("practice") || s.includes("lo206") || s.includes("open session")) {
    return { category: "practice", resultModeHint: "individual" };
  }

  return { category: "other", resultModeHint: "unknown" };
}
