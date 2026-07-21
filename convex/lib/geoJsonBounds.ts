export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackBoundsParseResult {
  outline?: LatLon[];
  innerEdge?: LatLon[];
  outerEdge?: LatLon[];
}

// GeoJSON positions are [lon, lat] (RFC 7946), the opposite order of every
// other field in this schema - convert at the boundary, not downstream.
function ringToLatLon(ring: number[][]): LatLon[] {
  return ring.map(([lon, lat]) => ({ lat, lon }));
}

function firstRing(geometry: { type?: string; coordinates?: unknown } | undefined): number[][] | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][] | undefined;
    return rings?.[0] ?? null;
  }
  if (geometry.type === "LineString") {
    return (geometry.coordinates as number[][] | undefined) ?? null;
  }
  return null;
}

/**
 * Handles the shape produced by hand-tracing a track over a calibrated
 * image: a FeatureCollection with one Polygon per edge, distinguished by
 * feature.properties.name (e.g. "track boundary" / "Inner Edge"). Falls
 * back to a single outline if only one usable ring is present.
 */
export function parseTrackBoundsGeoJson(text: string): TrackBoundsParseResult {
  type GeoJsonFeature = { properties?: { name?: string }; geometry?: { type?: string; coordinates?: unknown } };
  const doc = JSON.parse(text) as {
    type?: string;
    features?: GeoJsonFeature[];
  } & GeoJsonFeature;

  const features = doc.type === "FeatureCollection" ? (doc.features ?? []) : doc.type === "Feature" ? [doc] : [];
  if (features.length === 0) {
    throw new Error("No features found in this GeoJSON file.");
  }

  const rings = features
    .map((f) => ({ name: String(f.properties?.name ?? "").toLowerCase(), ring: firstRing(f.geometry) }))
    .filter((r): r is { name: string; ring: number[][] } => r.ring !== null && r.ring.length >= 3);

  if (rings.length === 0) {
    throw new Error("No usable Polygon or LineString geometry found in this GeoJSON file.");
  }

  if (rings.length === 1) {
    return { outline: ringToLatLon(rings[0].ring) };
  }

  const inner = rings.find((r) => r.name.includes("inner"));
  const outer = rings.find((r) => r !== inner) ?? rings[0];
  return {
    innerEdge: inner ? ringToLatLon(inner.ring) : undefined,
    outerEdge: ringToLatLon(outer.ring),
  };
}
