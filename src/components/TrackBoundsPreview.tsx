interface Point {
  x: number;
  y: number;
}

function toPath(points: Point[], toSvg: (p: Point) => [number, number], close = true): string {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${toSvg(p).join(",")}`).join(" ");
  return close ? `${d} Z` : d;
}

// Minimal shape-only preview for verifying a bounds upload lines up with
// reality - the polished speed/delta-colored track view comes later, once
// laps are projected onto a persistent reference.
export default function TrackBoundsPreview({
  outline,
  innerEdge,
  outerEdge,
  referenceLine,
}: {
  outline?: Point[];
  innerEdge?: Point[];
  outerEdge?: Point[];
  referenceLine?: Point[];
}) {
  const allPoints = [...(outline ?? []), ...(innerEdge ?? []), ...(outerEdge ?? []), ...(referenceLine ?? [])];
  if (allPoints.length === 0) return null;

  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const pad = 10;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  // SVG y grows downward; local y (north) should grow upward on screen.
  const toSvg = (p: Point): [number, number] => [p.x - minX + pad, height - (p.y - minY + pad)];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-800"
      style={{ background: "var(--chart-surface)" }}
    >
      {outline && <path d={toPath(outline, toSvg)} fill="var(--chart-gridline)" stroke="var(--chart-muted)" strokeWidth={1} />}
      {outerEdge && <path d={toPath(outerEdge, toSvg)} fill="none" stroke="var(--series-1)" strokeWidth={2} />}
      {innerEdge && <path d={toPath(innerEdge, toSvg)} fill="none" stroke="var(--series-2)" strokeWidth={2} />}
      {referenceLine && (
        <path d={toPath(referenceLine, toSvg, false)} fill="none" stroke="var(--series-6)" strokeWidth={2.5} strokeDasharray="4 3" />
      )}
    </svg>
  );
}
