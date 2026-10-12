export interface LatLng {
  lat: number;
  lon: number;
}

export interface RoutePoint extends LatLng {
  ele: number;
  dist: number; // cumulative meters from start
}

export interface PlannedRoute {
  name: string;
  points: RoutePoint[];
  distance: number; // meters
  ascent: number; // meters
  descent: number; // meters
}

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function cumulativeDistances(points: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + haversine(points[i - 1], points[i]));
  }
  return out;
}

/** Interpolate position at distance d (meters) along the polyline. */
export function pointAtDistance(
  points: RoutePoint[],
  d: number
): { lat: number; lon: number; ele: number; index: number } {
  if (points.length === 0) throw new Error("empty route");
  if (d <= 0) return { ...points[0], index: 0 };
  const last = points[points.length - 1];
  if (d >= last.dist) return { lat: last.lat, lon: last.lon, ele: last.ele, index: points.length - 1 };
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].dist < d) lo = mid + 1;
    else hi = mid;
  }
  const p2 = points[lo];
  const p1 = points[lo - 1] ?? p2;
  const seg = p2.dist - p1.dist;
  const t = seg > 0 ? (d - p1.dist) / seg : 0;
  return {
    lat: p1.lat + (p2.lat - p1.lat) * t,
    lon: p1.lon + (p2.lon - p1.lon) * t,
    ele: p1.ele + (p2.ele - p1.ele) * t,
    index: lo,
  };
}

export function routeStats(points: RoutePoint[]) {
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].ele - points[i - 1].ele;
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return { ascent, descent, distance: points.length ? points[points.length - 1].dist : 0 };
}

/** Sample n roughly-evenly spaced points (by distance) from the route. */
export function sampleByDistance(points: RoutePoint[], maxCount: number): RoutePoint[] {
  if (points.length <= maxCount) return points;
  const total = points[points.length - 1].dist;
  const out: RoutePoint[] = [];
  for (let i = 0; i < maxCount; i++) {
    const { lat, lon, ele } = pointAtDistance(points, (total * i) / (maxCount - 1));
    out.push({ lat, lon, ele, dist: (total * i) / (maxCount - 1) });
  }
  return out;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`;
}

/** Corridor bounds around a route for map fitting. */
export function routeBounds(points: LatLng[]): [[number, number], [number, number]] {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
