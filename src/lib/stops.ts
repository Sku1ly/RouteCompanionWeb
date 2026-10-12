import type { PlannedRoute } from "./geo";
import { sampleByDistance, haversine } from "./geo";

export interface Stop {
  id: string;
  name: string;
  type: StopTypeDef;
  lat: number;
  lon: number;
  dist: number; // distance along route of nearest point
  offRoute: number; // meters from route line
}

export interface StopTypeDef {
  id: string;
  label: string;
  emoji: string;
  osmFilter: string;
}

export const STOP_TYPES: StopTypeDef[] = [
  { id: "water", label: "Water", emoji: "💧", osmFilter: `node["amenity"~"drinking_water|water_point"]` },
  { id: "cafe", label: "Café", emoji: "☕", osmFilter: `node["amenity"~"cafe|fast_food|restaurant|ice_cream|pub"]` },
  { id: "bikeshop", label: "Bike shop", emoji: "🔧", osmFilter: `node["shop"="bicycle"]` },
  { id: "grocery", label: "Grocery", emoji: "🛒", osmFilter: `node["shop"~"supermarket|convenience|bakery"]` },
  { id: "gas", label: "Gas station", emoji: "⛽", osmFilter: `node["amenity"="fuel"]` },
  { id: "toilets", label: "Toilets", emoji: "🚻", osmFilter: `node["amenity"="toilets"]` },
  { id: "pharmacy", label: "Pharmacy", emoji: "💊", osmFilter: `node["amenity"="pharmacy"]` },
  { id: "repair", label: "Repair station", emoji: "🧰", osmFilter: `node["amenity"="bicycle_repair_station"]` },
  { id: "shelter", label: "Shelter", emoji: "⛺", osmFilter: `node["amenity"="shelter"]` },
  { id: "camping", label: "Camping", emoji: "🏕️", osmFilter: `node["tourism"~"camp_site|alpine_hut|wilderness_hut"]` },
  { id: "atm", label: "ATM", emoji: "🏧", osmFilter: `node["amenity"="atm"]` },
  { id: "hospital", label: "Hospital", emoji: "🏥", osmFilter: `node["amenity"~"hospital|clinic|doctors"]` },
  { id: "vegan", label: "Vegan food", emoji: "🌱", osmFilter: `node["diet:vegan"~"yes|only|limited"]` },
];

// NOTE: only global mirrors here. overpass.osm.ch holds Switzerland-only data
// and returns 200 with EMPTY results for other regions — it silently broke
// stop search outside CH, so it must stay last (Swiss fallback) or be removed.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

const REQUEST_TIMEOUT_MS = 12000;

function corridorBbox(
  route: PlannedRoute,
  corridorM: number
): { south: number; west: number; north: number; east: number } {
  const latSpan = corridorM / 111000;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of route.points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  return {
    south: south - latSpan,
    north: north + latSpan,
    west: west - latSpan,
    east: east + latSpan,
  };
}

function nearestOnRoute(route: PlannedRoute, lat: number, lon: number) {
  const samples = sampleByDistance(route.points, 400);
  let best = { dist: 0, off: Infinity };
  for (const p of samples) {
    const off = haversine(p, { lat, lon });
    if (off < best.off) best = { dist: p.dist, off };
  }
  return best;
}

export async function findStops(
  route: PlannedRoute,
  types: StopTypeDef[],
  corridorM: number,
  onProgress?: (msg: string) => void
): Promise<Stop[]> {
  if (!types.length || !route.points.length) return [];
  const bbox = corridorBbox(route, corridorM);
  const bboxStr = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  const filters = types.map((t) => t.osmFilter).join(";");
  const baseQuery = `[out:json][timeout:25];(${types.map((t) => `${t.osmFilter}(${bboxStr});`).join("")});out body;`;
  let attemptNo = 0;
  const uniqueQuery = (): string => {
    attemptNo++;
    if (attemptNo === 1) return baseQuery;
    // Overpass mirrors reject identical consecutive queries (duplicate_query error),
    // so nudge the bbox by a sub-meter amount on retries to make each query unique.
    const jitter = (attemptNo % 7) * 0.00001;
    const jStr = `${(bbox.south + jitter).toFixed(5)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
    return `[out:json][timeout:25];(${types.map((t) => `${t.osmFilter}(${jStr});`).join("")});out body;`;
  };

  interface OverpassElement { id: number; lat: number; lon: number; tags?: Record<string, string> }
  interface OverpassResult { elements: OverpassElement[] }
  let data: OverpassResult | null = null;
  let lastError: "rate" | "server" | "network" | "dup" | null = null;

  const attempt = async (endpoint: string): Promise<OverpassResult | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(uniqueQuery()),
        signal: controller.signal,
      });
      if (res.status === 429) {
        lastError = "rate";
        return null;
      }
      if (!res.ok) {
        lastError = "server";
        return null;
      }
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as OverpassResult;
        // A regional mirror (e.g. osm.ch) can return 200 with zero elements for
        // areas outside its coverage. Zero results are plausible in remote areas,
        // so only trust them from the first global mirror; otherwise try the
        // next endpoint to be safe.
        if (
          parsed.elements.length === 0 &&
          endpoint.includes("osm.ch")
        ) {
          lastError = "server";
          return null;
        }
        return parsed;
      } catch {
        if (/duplicate_query/.test(text)) {
          lastError = "dup";
        } else {
          lastError = "server";
        }
        return null;
      }
    } catch {
      lastError = "network";
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  outer: for (let round = 0; round < 3; round++) {
    if (round > 0) {
      onProgress?.(`Overpass busy — retrying (attempt ${round + 1}/3)…`);
      await new Promise((r) => setTimeout(r, 1500 * round));
    }
    for (const endpoint of OVERPASS_ENDPOINTS) {
      if (round === 0) onProgress?.("Searching OpenStreetMap…");
      const result = await attempt(endpoint);
      if (result) {
        data = result;
        break outer;
      }
    }
  }
  if (!data) {
    if (lastError === "rate")
      throw new Error("Overpass is rate-limiting right now — wait ~30s and try again");
    if (lastError === "server")
      throw new Error("Overpass servers are overloaded right now — try again shortly");
    throw new Error("Could not reach any Overpass server — check your connection");
  }

  const stops: Stop[] = [];
  const selected = new Set(types.map((t) => t.id));
  for (const el of data.elements) {
    if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    const { dist, off } = nearestOnRoute(route, el.lat, el.lon);
    if (off > corridorM) continue;
    const type = matchType(el.tags ?? {}, selected);
    if (!type) continue;
    stops.push({
      id: `n${el.id}`,
      name: el.tags?.name || type.label,
      type,
      lat: el.lat,
      lon: el.lon,
      dist,
      offRoute: off,
    });
  }
  stops.sort((a, b) => a.dist - b.dist);
  return stops;
}

export function isVegan(tags: Record<string, string>): boolean {
  return /yes|only/.test(tags["diet:vegan"] ?? "");
}

function matchType(tags: Record<string, string>, selected: Set<string>): StopTypeDef | null {
  const am = tags.amenity ?? "";
  const sh = tags.shop ?? "";
  const tu = tags.tourism ?? "";
  const vegan = isVegan(tags);
  // vegan wins over generic café when both categories are selected
  if (vegan && selected.has("vegan")) {
    for (const t of STOP_TYPES) {
      if (t.id === "vegan") return t;
    }
  }
  for (const t of STOP_TYPES) {
    if (!selected.has(t.id)) continue;
    if (t.id === "water" && /drinking_water|water_point/.test(am)) return t;
    if (t.id === "cafe" && /cafe|fast_food|restaurant|ice_cream|pub/.test(am)) return t;
    if (t.id === "vegan" && vegan) return t;
    if (t.id === "bikeshop" && sh === "bicycle") return t;
    if (t.id === "grocery" && /supermarket|convenience|bakery/.test(sh)) return t;
    if (t.id === "gas" && am === "fuel") return t;
    if (t.id === "toilets" && am === "toilets") return t;
    if (t.id === "pharmacy" && am === "pharmacy") return t;
    if (t.id === "repair" && am === "bicycle_repair_station") return t;
    if (t.id === "shelter" && am === "shelter") return t;
    if (t.id === "camping" && /camp_site|alpine_hut|wilderness_hut/.test(tu)) return t;
    if (t.id === "atm" && am === "atm") return t;
    if (t.id === "hospital" && /hospital|clinic|doctors/.test(am)) return t;
  }
  return null;
}
