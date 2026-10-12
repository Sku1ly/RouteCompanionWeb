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
];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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
  corridorM: number
): Promise<Stop[]> {
  if (!types.length || !route.points.length) return [];
  const bbox = corridorBbox(route, corridorM);
  const bboxStr = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  const filters = types.map((t) => t.osmFilter).join(";");
  const query = `[out:json][timeout:25];(${types.map((t) => `${t.osmFilter}(${bboxStr});`).join("")});out body;`;

  interface OverpassElement { id: number; lat: number; lon: number; tags?: Record<string, string> }
  interface OverpassResult { elements: OverpassElement[] }
  let data: OverpassResult | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) continue;
      data = (await res.json()) as OverpassResult;
      break;
    } catch {
      // try next endpoint
    }
  }
  if (!data) throw new Error("Stop lookup failed (Overpass unreachable)");

  const stops: Stop[] = [];
  for (const el of data.elements) {
    if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    const { dist, off } = nearestOnRoute(route, el.lat, el.lon);
    if (off > corridorM) continue;
    const type = matchType(el.tags ?? {});
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

function matchType(tags: Record<string, string>): StopTypeDef | null {
  const am = tags.amenity ?? "";
  const sh = tags.shop ?? "";
  const tu = tags.tourism ?? "";
  for (const t of STOP_TYPES) {
    if (t.id === "water" && /drinking_water|water_point/.test(am)) return t;
    if (t.id === "cafe" && /cafe|fast_food|restaurant|ice_cream|pub/.test(am)) return t;
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
