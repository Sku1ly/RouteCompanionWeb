import type { LatLng, PlannedRoute, RoutePoint } from "./geo";
import { cumulativeDistances } from "./geo";

export type Profile = "bike" | "road" | "gravel" | "mtb" | "run" | "hike";

const OSRM_PROFILES: Record<string, string> = {
  road: "https://routing.openstreetmap.de/routed-bike",
  bike: "https://routing.openstreetmap.de/routed-bike",
  gravel: "https://routing.openstreetmap.de/routed-bike",
  mtb: "https://routing.openstreetmap.de/routed-bike",
  run: "https://routing.openstreetmap.de/routed-foot",
  hike: "https://routing.openstreetmap.de/routed-foot",
};

interface OsrmResponse {
  code: string;
  routes: {
    geometry: { coordinates: [number, number][] };
    legs: { steps: { geometry: { coordinates: [number, number][] } }[] }[];
  }[];
}

export async function snapRoute(
  waypoints: LatLng[],
  profile: Profile
): Promise<{ lat: number; lon: number; ele: number }[]> {
  if (waypoints.length < 2) return [];
  const base = OSRM_PROFILES[profile] ?? OSRM_PROFILES.bike;
  const coordStr = waypoints
    .map((w) => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`)
    .join(";");
  const url = `${base}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&annotations=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = (await res.json()) as OsrmResponse;
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found");
  const coords = data.routes[0].geometry.coordinates;
  return coords.map(([lon, lat]) => ({ lat, lon, ele: 0 }));
}

export async function fetchElevation(
  points: { lat: number; lon: number }[]
): Promise<number[]> {
  if (!points.length) return [];
  const chunks: { lat: number; lon: number }[][] = [];
  const CH = 100;
  for (let i = 0; i < points.length; i += CH) chunks.push(points.slice(i, i + CH));
  const out: number[] = [];
  for (const chunk of chunks) {
    const url =
      `https://api.open-meteo.com/v1/elevation?latitude=` +
      chunk.map((p) => p.lat.toFixed(5)).join(",") +
      "&longitude=" +
      chunk.map((p) => p.lon.toFixed(5)).join(",");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Elevation lookup failed (${res.status})`);
    const data = (await res.json()) as { elevation: number[] };
    out.push(...data.elevation);
  }
  return out;
}

export async function buildRoute(
  name: string,
  waypoints: LatLng[],
  profile: Profile
): Promise<PlannedRoute> {
  const snapped = await snapRoute(waypoints, profile);
  const dists = cumulativeDistances(snapped);
  const maxPts = 800;
  const idxs =
    snapped.length <= maxPts
      ? snapped.map((_, i) => i)
      : Array.from({ length: maxPts }, (_, i) =>
          Math.round((i * (snapped.length - 1)) / (maxPts - 1))
        );
  const sampled = idxs.map((i) => snapped[i]);
  const elevations = await fetchElevation(sampled);
  const points: RoutePoint[] = sampled.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    ele: elevations[i] ?? 0,
    dist: dists[idxs[i]],
  }));
  const { ascent, descent, distance } = routeStatsLocal(points);
  return { name, points, distance, ascent, descent };
}

function routeStatsLocal(points: RoutePoint[]) {
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].ele - points[i - 1].ele;
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return {
    ascent,
    descent,
    distance: points.length ? points[points.length - 1].dist : 0,
  };
}
