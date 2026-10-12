import type { PlannedRoute } from "./geo";

export interface SavedRoute {
  id: string;
  name: string;
  savedAt: number;
  route: PlannedRoute;
  pois: { lat: number; lon: number; name: string; emoji: string }[];
  profile: string;
}

const KEY = "rc-saved-routes";

function readAll(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedRoute[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: SavedRoute[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("Storage is full — delete some saved routes first");
  }
}

export function listRoutes(): SavedRoute[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveRoute(
  route: PlannedRoute,
  profile: string,
  pois: SavedRoute["pois"]
): SavedRoute {
  const all = readAll();
  const existing = all.find((r) => r.name === route.name);
  const entry: SavedRoute = {
    id: existing?.id ?? `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: route.name,
    savedAt: Date.now(),
    route,
    pois,
    profile,
  };
  const next = existing
    ? all.map((r) => (r.id === existing.id ? entry : r))
    : [entry, ...all];
  writeAll(next);
  return entry;
}

export function deleteRoute(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}
