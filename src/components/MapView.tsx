import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

const OSM_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
const OSM_DARK_TILES = [
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
];
const ATTRIBUTION = "© OpenStreetMap contributors";

function osmStyle(dark: boolean) {
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: dark ? OSM_DARK_TILES : OSM_TILES,
        tileSize: dark ? 512 : 256,
        attribution: ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  };
}

interface StopMarkerData {
  id: string;
  lat: number;
  lon: number;
  name: string;
  emoji: string;
  distAlong?: number; // meters along route
  offRoute?: number; // meters from route line
}

const ARROW_SIZE = 36;

function makeArrowImageData(): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = ARROW_SIZE;
  canvas.height = ARROW_SIZE;
  const ctx = canvas.getContext("2d")!;
  const cx = ARROW_SIZE / 2;
  const r = ARROW_SIZE / 2 - 2;
  ctx.clearRect(0, 0, ARROW_SIZE, ARROW_SIZE);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeStyle = "rgba(8, 145, 178, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(8, 145, 178, 1)";
  ctx.beginPath();
  ctx.moveTo(cx + 8, cx);
  ctx.lineTo(cx - 6, cx - 7);
  ctx.lineTo(cx - 2, cx);
  ctx.lineTo(cx - 6, cx + 7);
  ctx.closePath();
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, ARROW_SIZE, ARROW_SIZE);
  return { width: ARROW_SIZE, height: ARROW_SIZE, data: new Uint8Array(imageData.data.buffer) };
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function bearingDeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

const R_EARTH = 6371000;

function segMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

const ARROW_SPACING_M = 1200;

function arrowFeatures(
  points: { lat: number; lon: number }[]
): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  if (points.length < 2) return features;
  let sinceLast = ARROW_SPACING_M;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = segMeters(a, b);
    if (d < 0.5) continue;
    sinceLast += d;
    if (sinceLast >= ARROW_SPACING_M) {
      const midLon = a.lon + (b.lon - a.lon) / 2;
      const midLat = a.lat + (b.lat - a.lat) / 2;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [midLon, midLat] },
        properties: { bearing: bearingDeg(a, b) },
      });
      sinceLast = 0;
    }
  }
  return features;
}

interface MapViewProps {
  routePoints: { lat: number; lon: number }[];
  waypoints: { lat: number; lon: number }[];
  stops: StopMarkerData[];
  planningMode: boolean;
  focusPoint: { lat: number; lon: number } | null;
  onMapClick: (lat: number, lon: number) => void;
  onWaypointRemove: (index: number) => void;
}

export default function MapView({
  routePoints,
  waypoints,
  stops,
  planningMode,
  focusPoint,
  onMapClick,
  onWaypointRemove,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const planRef = useRef(planningMode);
  planRef.current = planningMode;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle(dark),
      center: [6.14, 46.2],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    map.on("click", (e) => {
      if (planRef.current) clickRef.current(e.lngLat.lat, e.lngLat.lng);
    });
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getSource("route")) {
      map.addImage("arrow-icon", makeArrowImageData(), { pixelRatio: 2 });
      map.addSource("route-arrows", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-arrows-layer",
        type: "symbol",
        source: "route-arrows",
        layout: {
          "icon-image": "arrow-icon",
          "icon-size": 0.55,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": 0.9,
        },
      });
    }
    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0e7490", "line-width": 8, "line-opacity": 0.25 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0891b2", "line-width": 4 },
      });
    }
    const src = map.getSource("route") as maplibregl.GeoJSONSource;
    src.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: routePoints.map((p) => [p.lon, p.lat]),
      },
      properties: {},
    });
    const arrows = map.getSource("route-arrows") as maplibregl.GeoJSONSource | undefined;
    arrows?.setData({
      type: "FeatureCollection",
      features: arrowFeatures(routePoints),
    });
  }, [routePoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = waypoints.map((w, i) => {
      const el = document.createElement("div");
      const isEnd = i === waypoints.length - 1;
      el.className = "wp-marker";
      el.textContent = isEnd ? "🏁" : i === 0 ? "🚩" : String(i);
      el.title = isEnd ? "Finish (click to remove)" : `Waypoint ${i + 1} (click to remove)`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        onWaypointRemove(i);
      };
      return new maplibregl.Marker({ element: el }).setLngLat([w.lon, w.lat]).addTo(map);
    });
  }, [waypoints, ready, onWaypointRemove]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = stops.map((s) => {
      const el = document.createElement("div");
      el.className = "stop-marker";
      el.textContent = s.emoji;
      el.title = s.name;
      el.onclick = (ev) => {
        ev.stopPropagation();
        const parts = [s.name];
        if (s.distAlong != null) parts.push(`${(s.distAlong / 1000).toFixed(1)} km along route`);
        if (s.offRoute != null) parts.push(`${Math.round(s.offRoute)} m off route`);
        const popupEl = document.createElement("div");
        popupEl.className = "stop-popup";
        popupEl.textContent = parts.join(" · ");
        new maplibregl.Popup({ closeOnClick: true, offset: 24 })
          .setLngLat([s.lon, s.lat])
          .setDOMContent(popupEl)
          .addTo(map);
        map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 14), duration: 400 });
      };
      return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
    });
  }, [stops, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.flyTo({ center: [focusPoint.lon, focusPoint.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  }, [focusPoint]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const map = mapRef.current;
      if (!map) return;
      map.setStyle(osmStyle(mq.matches), { diff: false });
      map.once("styledata", () => {
        setReady(false);
        setTimeout(() => setReady(true), 0);
      });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || routePoints.length < 2) return;
    const lons = routePoints.map((p) => p.lon);
    const lats = routePoints.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, duration: 600, maxZoom: 16 }
    );
  }, [routePoints, ready]);

  return (
    <div className="map-container">
      <div ref={containerRef} className="map-canvas" />
      {planningMode && (
        <div className="map-hint">Click the map to add waypoints (click a marker to remove it)</div>
      )}
    </div>
  );
}
