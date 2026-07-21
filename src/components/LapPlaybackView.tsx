import { useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { projectToLocalMeters } from "../../convex/lib/geo";
import { computeSvgTransform } from "../lib/mapProjection";
import type { Point } from "../lib/mapProjection";
import { seriesColor } from "../lib/chartColors";
import TrackBackdrop from "./TrackBackdrop";

const TRAIL_DURATION_MS = 2500;
const TRAIL_POINT_COUNT = 10;
const SPEED_OPTIONS = [0.5, 1, 2, 4];

interface LapForPlayback {
  _id: Id<"gpsLaps">;
  lapIndex: number;
  points: { lat: number; lon: number; t: number }[];
}

interface LatLonAtTime {
  lat: number;
  lon: number;
}

// Linear interpolation between the two raw GPS samples bracketing this
// elapsed time - laps are compared on a shared clock starting at each lap's
// own t=0, same convention as the delta trace.
function interpolateLatLonAtElapsed(points: { lat: number; lon: number; t: number }[], elapsedMs: number): LatLonAtTime | null {
  if (points.length === 0) return null;
  const targetT = points[0].t + elapsedMs;
  if (targetT <= points[0].t) return points[0];
  const last = points[points.length - 1];
  if (targetT >= last.t) return last;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (targetT >= a.t && targetT <= b.t) {
      const frac = b.t > a.t ? (targetT - a.t) / (b.t - a.t) : 0;
      return { lat: a.lat + (b.lat - a.lat) * frac, lon: a.lon + (b.lon - a.lon) * frac };
    }
  }
  return last;
}

export default function LapPlaybackView({
  laps,
  originLat,
  originLon,
  outline,
  innerEdge,
  outerEdge,
  referenceLine,
}: {
  laps: LapForPlayback[];
  originLat: number;
  originLon: number;
  outline?: Point[];
  innerEdge?: Point[];
  outerEdge?: Point[];
  referenceLine?: Point[];
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const maxDurationMs = Math.max(
    0,
    ...laps.map((l) => (l.points.length > 0 ? l.points[l.points.length - 1].t - l.points[0].t : 0)),
  );

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = null;
      return;
    }
    function tick(now: number) {
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      setCurrentTimeMs((prev) => {
        const next = prev + dt * speed;
        return next > maxDurationMs ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speed, maxDurationMs]);

  const allBackdropPoints = [...(outline ?? []), ...(innerEdge ?? []), ...(outerEdge ?? []), ...(referenceLine ?? [])];
  const transform = computeSvgTransform(allBackdropPoints);

  if (laps.length === 0) {
    return <p className="text-sm text-neutral-500">Select one or more laps below to play them back.</p>;
  }
  if (!transform) {
    return <p className="text-sm text-neutral-500">Upload track bounds or build a track reference first.</p>;
  }
  const { toSvg, width, height } = transform;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => setIsPlaying((p) => !p)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={maxDurationMs}
          step={100}
          value={currentTimeMs}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentTimeMs(Number(e.target.value));
          }}
          className="min-w-[200px] flex-1"
        />
        <span className="tabular-nums text-neutral-500">
          {(currentTimeMs / 1000).toFixed(1)}s / {(maxDurationMs / 1000).toFixed(1)}s
        </span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-800"
        style={{ background: "var(--chart-surface)" }}
      >
        <TrackBackdrop transform={transform} outline={outline} innerEdge={innerEdge} outerEdge={outerEdge} referenceLine={referenceLine} />
        {laps.map((lap, i) => {
          const color = seriesColor(i);
          const current = interpolateLatLonAtElapsed(lap.points, currentTimeMs);
          const trail: LatLonAtTime[] = [];
          for (let ti = 1; ti <= TRAIL_POINT_COUNT; ti++) {
            const offset = (TRAIL_DURATION_MS / TRAIL_POINT_COUNT) * ti;
            const p = interpolateLatLonAtElapsed(lap.points, currentTimeMs - offset);
            if (p) trail.push(p);
          }
          return (
            <g key={lap._id}>
              {trail.map((p, ti) => {
                const { x, y } = projectToLocalMeters(p.lat, p.lon, originLat, originLon);
                const [sx, sy] = toSvg({ x, y });
                const opacity = (1 - (ti + 1) / (TRAIL_POINT_COUNT + 1)) * 0.5;
                return <circle key={ti} cx={sx} cy={sy} r={2.5} fill={color} opacity={opacity} />;
              })}
              {current &&
                (() => {
                  const { x, y } = projectToLocalMeters(current.lat, current.lon, originLat, originLon);
                  const [sx, sy] = toSvg({ x, y });
                  return <circle cx={sx} cy={sy} r={5} fill={color} stroke="var(--chart-surface)" strokeWidth={1} />;
                })()}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-3 text-xs">
        {laps.map((lap, i) => (
          <span key={lap._id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(i) }} />
            Lap {lap.lapIndex + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
