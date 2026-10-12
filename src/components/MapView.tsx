import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
    },
  ],
};

interface StopMarkerData {
  id: string;
  lat: number;
  lon: number;
  name: string;
  emoji: string;
  distAlong?: number; // meters along route
  offRoute?: number; // meters from route line
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
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
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
