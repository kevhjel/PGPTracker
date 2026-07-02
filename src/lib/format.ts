export function formatLapTime(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return "–";
  return (ms / 1000).toFixed(3);
}

export function formatGap(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return "–";
  if (ms === 0) return "–";
  return `+${(ms / 1000).toFixed(3)}`;
}

export function formatDate(ms: number | undefined | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatHeatCategory(category: string): string {
  const labels: Record<string, string> = {
    arrive_and_drive: "Arrive and Drive",
    league: "League",
    pro_am: "Pro-Am",
    group_event: "Group Event",
    practice: "Practice",
    endurance: "Endurance",
    other: "Other",
  };
  return labels[category] ?? category;
}
