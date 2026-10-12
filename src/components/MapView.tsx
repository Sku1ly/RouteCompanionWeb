import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { fmtDistance, type UnitMode } from "../lib/units";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/fiord";

function styleUrl(dark: boolean): string {
  return dark ? DARK_STYLE : LIGHT_STYLE;
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

const ARROW_SIZE = 28;

function makeArrowImageData(dark: boolean): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = ARROW_SIZE;
  canvas.height = ARROW_SIZE;
  const ctx = canvas.getContext("2d")!;
  const cx = ARROW_SIZE / 2;
  ctx.clearRect(0, 0, ARROW_SIZE, ARROW_SIZE);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, 3);
  ctx.lineTo(cx + 9, ARROW_SIZE - 6);
  ctx.lineTo(cx, ARROW_SIZE - 12);
  ctx.lineTo(cx - 9, ARROW_SIZE - 6);
  ctx.closePath();
  ctx.fillStyle = dark ? "rgba(34, 211, 238, 1)" : "rgba(8, 145, 178, 1)";
  ctx.strokeStyle = dark ? "rgba(15, 23, 42, 0.9)" : "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
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


function mapsLinkEl(lat: number, lon: number): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "maps-link";
  a.href = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Open in Google Maps ↗";
  return a;
}

function interpolateAtDistance(
  points: { lat: number; lon: number; dist: number }[],
  d: number
): { lat: number; lon: number } {
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
  return { lat: p1.lat + (p2.lat - p1.lat) * t, lon: p1.lon + (p2.lon - p1.lon) * t };
}

function makeKmBadgeImageData(dark: boolean): { width: number; height: number; data: Uint8Array } {
  const S = 30;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = dark ? "#1e293b" : "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = dark ? "#22d3ee" : "#0891b2";
  ctx.stroke();
  ctx.fillStyle = dark ? "#e2e8f0" : "#0f172a";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("5", S / 2, S / 2 + 1);
  const imageData = ctx.getImageData(0, 0, S, S);
  return { width: S, height: S, data: new Uint8Array(imageData.data.buffer) };
}

interface MapViewProps {
  routePoints: { lat: number; lon: number; dist: number }[];
  waypoints: { lat: number; lon: number }[];
  stops: StopMarkerData[];
  planningMode: boolean;
  focusPoint: { lat: number; lon: number } | null;
  isDark: boolean;
  units: UnitMode;
  onMapClick: (lat: number, lon: number) => void;
  onWaypointRemove: (index: number) => void;
  onStopAddToRoute: (stop: StopMarkerData) => void;
  onPoiRemove: (poi: { lat: number; lon: number; name: string; emoji: string }) => void;
  routePois: { lat: number; lon: number; name: string; emoji: string }[];
  kmMarkersM: number[]; // cumulative meters positions for distance badges
  kmLabels: string[]; // matching labels per badge index
  hoverDist: number | null; // distance along route currently hovered (from chart)
  onRouteHover: (dist: number | null) => void; // hover on map route line
}

export default function MapView({
  routePoints,
  waypoints,
  stops,
  planningMode,
  focusPoint,
  isDark,
  units,
  onMapClick,
  onWaypointRemove,
  onStopAddToRoute,
  onPoiRemove,
  routePois,
  kmMarkersM,
  kmLabels,
  hoverDist,
  onRouteHover,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const poiMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const planRef = useRef(planningMode);
  planRef.current = planningMode;
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const styleDarkRef = useRef<boolean | null>(null);
  const addStopRef = useRef(onStopAddToRoute);
  addStopRef.current = onStopAddToRoute;
  const poiRemoveRef = useRef(onPoiRemove);
  poiRemoveRef.current = onPoiRemove;
  const routeHoverRef = useRef(onRouteHover);
  routeHoverRef.current = onRouteHover;
  const hoverMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routePointsRef = useRef(routePoints);
  routePointsRef.current = routePoints;
  const unitsRef = useRef(units);
  unitsRef.current = units;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl(isDarkRef.current),
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
      if (map.hasImage("arrow-icon")) map.removeImage("arrow-icon");
      map.addImage("arrow-icon", makeArrowImageData(isDarkRef.current));
      map.addSource("route-arrows", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      if (map.hasImage("km-badge")) map.removeImage("km-badge");
      map.addImage("km-badge", makeKmBadgeImageData(isDarkRef.current));
      map.addSource("route-km-marks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-km-badge-layer",
        type: "symbol",
        source: "route-km-marks",
        layout: {
          "icon-image": "km-badge",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 0.8, 16, 1],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular", "Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, -1.6],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
        filter: ["==", ["get", "showLabel"], true],
      });
      map.addLayer({
        id: "route-arrows-layer",
        type: "symbol",
        source: "route-arrows",
        layout: {
          "icon-image": "arrow-icon",
          "icon-size": 1.0,
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
      const dark = isDarkRef.current;
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": dark ? "#67e8f9" : "#0e7490",
          "line-width": 8,
          "line-opacity": 0.3,
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": dark ? "#22d3ee" : "#0891b2",
          "line-width": 4,
        },
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
    const kmSrc = map.getSource("route-km-marks") as maplibregl.GeoJSONSource | undefined;
    if (kmSrc) {
      const features: GeoJSON.Feature<GeoJSON.Point>[] = []
      for (let i = 0; i < kmMarkersM.length && i < routePoints.length; i++) {
        const d = kmMarkersM[i];
        if (d <= 0 || d >= (routePoints[routePoints.length - 1]?.dist ?? 0)) continue;
        const latlon = interpolateAtDistance(routePoints, d);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [latlon.lon, latlon.lat] },
          properties: { label: kmLabels[i], showLabel: i % 2 === 1 },
        });
      }
      kmSrc.setData({ type: "FeatureCollection", features });
    }
  }, [routePoints, ready, kmMarkersM, kmLabels]);

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
        if (s.distAlong != null) parts.push(`${fmtDistance(s.distAlong, unitsRef.current)} along route`);
        if (s.offRoute != null) parts.push(`${fmtDistance(s.offRoute, unitsRef.current)} off route`);
        const popupEl = document.createElement("div");
        popupEl.className = "stop-popup";
        const textEl = document.createElement("div");
        textEl.textContent = parts.join(" · ");
        popupEl.appendChild(textEl);
        const btn = document.createElement("button");
        btn.className = "btn btn-primary stop-add-btn";
        btn.textContent = "Add to route";
        btn.onclick = (bev) => {
          bev.stopPropagation();
          addStopRef.current(s);
        };
        popupEl.appendChild(btn);
        popupEl.appendChild(mapsLinkEl(s.lat, s.lon));
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
    if (!map || !ready) return;
    poiMarkersRef.current.forEach((m) => m.remove());
    poiMarkersRef.current = routePois.map((p) => {
      const el = document.createElement("div");
      el.className = "poi-marker";
      el.textContent = p.emoji;
      el.title = `${p.name} — on route`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        const popupEl = document.createElement("div");
        popupEl.className = "stop-popup";
        const textEl = document.createElement("div");
        textEl.textContent = p.name;
        popupEl.appendChild(textEl);
        const btn = document.createElement("button");
        btn.className = "btn poi-remove-btn";
        btn.textContent = "Remove from route";
        btn.onclick = (bev) => {
          bev.stopPropagation();
          poiRemoveRef.current(p);
        };
        popupEl.appendChild(btn);
        popupEl.appendChild(mapsLinkEl(p.lat, p.lon));
        new maplibregl.Popup({ closeOnClick: true, offset: 24 })
          .setLngLat([p.lon, p.lat])
          .setDOMContent(popupEl)
          .addTo(map);
      };
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    });
  }, [routePois, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.flyTo({ center: [focusPoint.lon, focusPoint.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  }, [focusPoint]);

  // hover dot on map (driven by elevation profile hover)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (hoverDist == null || routePoints.length < 2) {
      hoverMarkerRef.current?.remove();
      hoverMarkerRef.current = null;
      return;
    }
    const pos = interpolateAtDistance(routePoints, hoverDist);
    const el = document.createElement("div");
    el.className = "hover-dot";
    if (!hoverMarkerRef.current) {
      hoverMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([pos.lon, pos.lat]).addTo(map);
    } else {
      hoverMarkerRef.current.setLngLat([pos.lon, pos.lat]);
    }
  }, [hoverDist, routePoints, ready]);

  // map route hover -> report distance to chart
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const moveHandler = (e: maplibregl.MapMouseEvent) => {
      const pts = routePointsRef.current;
      if (pts.length < 2) return;
      const rpx = e.point;
      let best = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < pts.length; i++) {
        const pp = map.project([pts[i].lon, pts[i].lat]);
        const d2 = (pp.x - rpx.x) ** 2 + (pp.y - rpx.y) ** 2;
        if (d2 < best) {
          best = d2;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && best < 144) {
        map.getCanvas().style.cursor = "pointer";
        routeHoverRef.current(pts[bestIdx].dist);
      } else {
        map.getCanvas().style.cursor = "";
        routeHoverRef.current(null);
      }
    };
    map.on("mousemove", moveHandler);
    return () => {
      map.off("mousemove", moveHandler);
      map.getCanvas().style.cursor = "";
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || styleDarkRef.current === isDark) return;
    styleDarkRef.current = isDark;
    map.setStyle(styleUrl(isDark));
    map.once("idle", () => {
      setReady(false);
      setTimeout(() => setReady(true), 0);
    });
  }, [isDark, ready]);

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
