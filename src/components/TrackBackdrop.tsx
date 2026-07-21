import type { Point, SvgTransform } from "../lib/mapProjection";

function toPath(points: Point[], toSvg: (p: Point) => [number, number], close = true): string {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${toSvg(p).join(",")}`).join(" ");
  return close ? `${d} Z` : d;
}

// Shared static layer (track bounds + reference centerline) reused by both
// the standalone bounds preview and the lap playback view, so they always
// render the track shape identically.
export default function TrackBackdrop({
  transform,
  outline,
  innerEdge,
  outerEdge,
  referenceLine,
}: {
  transform: SvgTransform;
  outline?: Point[];
  innerEdge?: Point[];
  outerEdge?: Point[];
  referenceLine?: Point[];
}) {
  const { toSvg } = transform;
  return (
    <>
      {outline && <path d={toPath(outline, toSvg)} fill="var(--chart-gridline)" stroke="var(--chart-muted)" strokeWidth={1} />}
      {outerEdge && <path d={toPath(outerEdge, toSvg)} fill="none" stroke="var(--series-1)" strokeWidth={2} />}
      {innerEdge && <path d={toPath(innerEdge, toSvg)} fill="none" stroke="var(--series-2)" strokeWidth={2} />}
      {referenceLine && (
        <path d={toPath(referenceLine, toSvg, false)} fill="none" stroke="var(--series-6)" strokeWidth={2} strokeDasharray="4 3" />
      )}
    </>
  );
}
