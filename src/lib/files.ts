import type { PlannedRoute, RoutePoint } from "./geo";
import { cumulativeDistances } from "./geo";

export function parseRouteFile(text: string, filename: string): PlannedRoute {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tcx")) return parseTcx(text, filename);
  return parseGpx(text, filename);
}

function xmlDoc(text: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML file");
  return doc;
}

function buildRoute(name: string, coords: { lat: number; lon: number; ele: number }[]): PlannedRoute {
  if (coords.length < 2) throw new Error("Route has fewer than 2 points");
  const dists = cumulativeDistances(coords);
  const points: RoutePoint[] = coords.map((c, i) => ({ ...c, dist: dists[i] }));
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].ele - points[i - 1].ele;
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return {
    name,
    points,
    distance: points[points.length - 1].dist,
    ascent,
    descent,
  };
}

function parseGpx(text: string, filename: string): PlannedRoute {
  const doc = xmlDoc(text);
  const name =
    doc.querySelector("metadata > name")?.textContent?.trim() ||
    doc.querySelector("trk > name")?.textContent?.trim() ||
    filename.replace(/\.[^.]+$/, "");
  const coordEls = Array.from(
    doc.querySelectorAll("trkpt, rtept")
  ) as Element[];
  if (!coordEls.length) throw new Error("No track points found in GPX");
  const coords = coordEls.map((el) => ({
    lat: parseFloat(el.getAttribute("lat")!),
    lon: parseFloat(el.getAttribute("lon")!),
    ele: parseFloat(el.querySelector("ele")?.textContent ?? "0"),
  }));
  return buildRoute(name, coords);
}

function parseTcx(text: string, filename: string): PlannedRoute {
  const doc = xmlDoc(text);
  const name =
    doc.getElementsByTagName("Name")[0]?.textContent?.trim() ||
    filename.replace(/\.[^.]+$/, "");
  const posEls = Array.from(doc.getElementsByTagName("Trackpoint"));
  const coords = posEls
    .map((el) => {
      const pos = el.getElementsByTagName("Position")[0];
      if (!pos) return null;
      const lat = parseFloat(pos.getElementsByTagName("LatitudeDegrees")[0]?.textContent ?? "0");
      const lon = parseFloat(pos.getElementsByTagName("LongitudeDegrees")[0]?.textContent ?? "0");
      const alt = parseFloat(el.getElementsByTagName("AltitudeMeters")[0]?.textContent ?? "0");
      return { lat, lon, ele: alt };
    })
    .filter((c): c is { lat: number; lon: number; ele: number } => c !== null);
  if (coords.length < 2) throw new Error("No track points found in TCX");
  return buildRoute(name, coords);
}

export interface GpxWaypoint {
  lat: number;
  lon: number;
  name: string;
  symbol?: string;
}

export function exportGpx(route: PlannedRoute, waypoints: GpxWaypoint[] = []): string {
  const pts = route.points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`
    )
    .join("\n");
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}">
    <name>${escapeXml(w.name)}</name>${w.symbol ? `\n    <sym>${escapeXml(w.symbol)}</sym>` : ""}
  </wpt>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Companion Web" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(route.name)}</name>
  </metadata>
${wpts}
  <trk>
    <name>${escapeXml(route.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
