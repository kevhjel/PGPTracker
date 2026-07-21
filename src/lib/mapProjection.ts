export interface Point {
  x: number;
  y: number;
}

// User preference: every map view rotates the local (x,y) frame 90°
// counterclockwise before laying out the SVG, so this is the single place
// that convention lives - every map component should go through here
// rather than each picking its own orientation.
export function rotate90Ccw(p: Point): Point {
  return { x: -p.y, y: p.x };
}

export interface SvgTransform {
  width: number;
  height: number;
  toSvg: (p: Point) => [number, number];
}

export function computeSvgTransform(allPoints: Point[], pad = 10): SvgTransform | null {
  if (allPoints.length === 0) return null;
  const rotated = allPoints.map(rotate90Ccw);
  const minX = Math.min(...rotated.map((p) => p.x));
  const maxX = Math.max(...rotated.map((p) => p.x));
  const minY = Math.min(...rotated.map((p) => p.y));
  const maxY = Math.max(...rotated.map((p) => p.y));
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  // SVG y grows downward; local y (rotated) should grow upward on screen.
  const toSvg = (p: Point): [number, number] => {
    const r = rotate90Ccw(p);
    return [r.x - minX + pad, height - (r.y - minY + pad)];
  };

  return { width, height, toSvg };
}
