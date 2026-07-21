import { XMLParser } from "fast-xml-parser";

export interface GpxPoint {
  lat: number;
  lon: number;
  t: number; // ms epoch
  ele?: number;
}

export interface GpxParseResult {
  // One array per <trkseg> - watches typically emit one trkseg per manually-
  // lapped lap, or a single trkseg for the whole file if never lapped.
  segments: GpxPoint[][];
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseGpx(xmlText: string): GpxParseResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xmlText);
  const gpx = doc.gpx;
  if (!gpx) {
    throw new Error("Not a valid GPX file (missing <gpx> root element).");
  }

  const segments: GpxPoint[][] = [];
  for (const trk of toArray(gpx.trk)) {
    for (const trkseg of toArray(trk.trkseg)) {
      const points: GpxPoint[] = [];
      for (const pt of toArray(trkseg.trkpt)) {
        const lat = Number(pt["@_lat"]);
        const lon = Number(pt["@_lon"]);
        const t = pt.time ? Date.parse(pt.time) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
        const ele = pt.ele !== undefined ? Number(pt.ele) : undefined;
        points.push({ lat, lon, t, ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined });
      }
      if (points.length > 0) segments.push(points);
    }
  }

  if (segments.length === 0) {
    throw new Error("No track points found in this GPX file.");
  }
  return { segments };
}
