import type { Point } from "../lib/mapProjection";
import { computeSvgTransform } from "../lib/mapProjection";
import TrackBackdrop from "./TrackBackdrop";

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
  const transform = computeSvgTransform(allPoints);
  if (!transform) return null;

  return (
    <svg
      viewBox={`0 0 ${transform.width} ${transform.height}`}
      className="w-full max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-800"
      style={{ background: "var(--chart-surface)" }}
    >
      <TrackBackdrop transform={transform} outline={outline} innerEdge={innerEdge} outerEdge={outerEdge} referenceLine={referenceLine} />
    </svg>
  );
}
