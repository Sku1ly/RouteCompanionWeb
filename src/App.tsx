import { useCallback, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import ElevationChart from "./components/ElevationChart";
import type { LatLng, PlannedRoute } from "./lib/geo";
import { formatDistance } from "./lib/geo";
import { buildRoute, type Profile } from "./lib/routing";
import { parseRouteFile, exportGpx } from "./lib/files";
import { fetchRouteWeather, type WeatherStop } from "./lib/weather";
import { findStops, STOP_TYPES, type Stop, type StopTypeDef } from "./lib/stops";
import { planFuel } from "./lib/fuel";

type Tab = "plan" | "weather" | "stops" | "fuel";

const PROFILES: { id: Profile; label: string; emoji: string }[] = [
  { id: "road", label: "Road", emoji: "🚴" },
  { id: "gravel", label: "Gravel", emoji: "🪨" },
  { id: "mtb", label: "MTB", emoji: "⛰️" },
  { id: "run", label: "Run", emoji: "🏃" },
  { id: "hike", label: "Hike", emoji: "🥾" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("plan");
  const [profile, setProfile] = useState<Profile>("road");
  const [planningMode, setPlanningMode] = useState(true);
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeName, setRouteName] = useState("My route");
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [hoverDist, setHoverDist] = useState<number | null>(null);

  const [weather, setWeather] = useState<WeatherStop[] | null>(null);
  const [weatherSpeed, setWeatherSpeed] = useState(25);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [stops, setStops] = useState<Stop[] | null>(null);
  const [stopTypes, setStopTypes] = useState<Set<string>>(new Set(["water", "cafe", "bikeshop"]));
  const [stopsLoading, setStopsLoading] = useState(false);
  const [corridorM, setCorridorM] = useState(500);
  const [autoMarkKm, setAutoMarkKm] = useState<number | null>(null);

  const [effort, setEffort] = useState<"easy" | "moderate" | "hard">("moderate");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const generateRoute = useCallback(
    async (wps: LatLng[], prof: Profile, name: string) => {
      if (wps.length < 2) {
        setError("Add at least 2 waypoints (click the map).");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const r = await buildRoute(name, wps, prof);
        setRoute(r);
        setWeather(null);
        setStops(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Route planning failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const addWaypoint = useCallback(
    (lat: number, lon: number) => {
      setWaypoints((prev) => {
        const next = [...prev, { lat, lon }];
        return next;
      });
    },
    []
  );

  const removeWaypoint = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const doPlan = () => generateRoute(waypoints, profile, routeName);

  const onImport = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseRouteFile(text, file.name);
      setRouteName(parsed.name);
      setRoute(parsed);
      setPlanningMode(false);
      setWaypoints([
        { lat: parsed.points[0].lat, lon: parsed.points[0].lon },
        {
          lat: parsed.points[parsed.points.length - 1].lat,
          lon: parsed.points[parsed.points.length - 1].lon,
        },
      ]);
      setWeather(null);
      setStops(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const doExport = () => {
    if (!route) return;
    const gpx = exportGpx(route);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${route.name.replace(/[^\w\- ]+/g, "_")}.gpx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doWeather = async () => {
    if (!route) return;
    setWeatherLoading(true);
    setError(null);
    try {
      const w = await fetchRouteWeather(route, weatherSpeed, Date.now() + 30 * 60 * 1000);
      setWeather(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Weather lookup failed");
    } finally {
      setWeatherLoading(false);
    }
  };

  const doStops = async () => {
    if (!route) return;
    setStopsLoading(true);
    setError(null);
    try {
      const types = STOP_TYPES.filter((t) => stopTypes.has(t.id));
      const s = await findStops(route, types, corridorM);
      setStops(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop lookup failed");
    } finally {
      setStopsLoading(false);
    }
  };

  const autoMarked = useMemo(() => {
    if (!stops || !autoMarkKm || autoMarkKm <= 0) return null;
    const marked: Stop[] = [];
    let nextAt = autoMarkKm * 1000;
    for (const s of stops) {
      if (s.dist >= nextAt) {
        marked.push(s);
        nextAt += autoMarkKm * 1000;
      }
    }
    return marked;
  }, [stops, autoMarkKm]);

  const fuel = useMemo(() => {
    if (!route || !weather) return null;
    const avgTemp = weather.reduce((a, w) => a + w.temp, 0) / weather.length;
    return planFuel(route, avgTemp, effort);
  }, [route, weather, effort]);

  const mapStops = useMemo(() => {
    const list = autoMarked ?? stops ?? [];
    return list.map((s) => ({
      id: s.id,
      lat: s.lat,
      lon: s.lon,
      name: `${s.name} (${s.type.label}, ${(s.dist / 1000).toFixed(1)} km)`,
      emoji: s.type.emoji,
    }));
  }, [stops, autoMarked]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>🗺️ Route Companion</h1>
          <p className="tagline">Plan it. Check it. Ride it.</p>
        </header>

        <div className="file-row">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            📂 Import GPX/TCX
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".gpx,.tcx,application/gpx+xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
          <button className="btn" disabled={!route} onClick={doExport}>
            ⬇️ Export GPX
          </button>
        </div>

        <div className="field">
          <label>Route name</label>
          <input value={routeName} onChange={(e) => setRouteName(e.target.value)} />
        </div>

        <div className="field">
          <label>Profile</label>
          <div className="profile-row">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                className={`chip ${profile === p.id ? "chip-on" : ""}`}
                onClick={() => setProfile(p.id)}
              >
                {p.emoji} {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Planning</label>
          <div className="plan-row">
            <button
              className={`chip ${planningMode ? "chip-on" : ""}`}
              onClick={() => setPlanningMode((v) => !v)}
            >
              {planningMode ? "✏️ Clicking adds waypoints" : "👁️ Browse mode"}
            </button>
            <button className="btn btn-primary" onClick={doPlan} disabled={loading || waypoints.length < 2}>
              {loading ? "…" : "Plan route"}
            </button>
            <button className="btn" onClick={() => { setWaypoints([]); setRoute(null); setWeather(null); setStops(null); }}>
              🗑️ Clear
            </button>
          </div>
          <p className="hint">{waypoints.length} waypoint{waypoints.length === 1 ? "" : "s"}</p>
        </div>

        {route && (
          <div className="route-stats">
            <div><span className="stat-num">{formatDistance(route.distance)}</span><span className="stat-lbl">distance</span></div>
            <div><span className="stat-num">↑{Math.round(route.ascent)} m</span><span className="stat-lbl">ascent</span></div>
            <div><span className="stat-num">↓{Math.round(route.descent)} m</span><span className="stat-lbl">descent</span></div>
          </div>
        )}

        {error && <div className="error">⚠️ {error}</div>}

        <nav className="tabs">
          {(["plan", "weather", "stops", "fuel"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? "tab-on" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "plan" ? "Route" : t === "weather" ? "🌤️ Weather" : t === "stops" ? "📍 Stops" : "🍎 Fuel"}
            </button>
          ))}
        </nav>

        {tab === "weather" && (
          <section className="panel">
            <div className="field">
              <label>Planned avg speed: {weatherSpeed} km/h</label>
              <input
                type="range"
                min={5}
                max={45}
                value={weatherSpeed}
                onChange={(e) => setWeatherSpeed(Number(e.target.value))}
              />
            </div>
            <button className="btn btn-primary" disabled={!route || weatherLoading} onClick={doWeather}>
              {weatherLoading ? "Fetching…" : "Check weather along route"}
            </button>
            {weather && (
              <ul className="wx-list">
                {weather.map((w, i) => (
                  <li key={i} className="wx-item" onClick={() => setFocusPoint(route ? pointOnRoute(route, w.dist) : null)}>
                    <span className="wx-emoji">{w.emoji}</span>
                    <span className="wx-main">
                      <strong>{(w.dist / 1000).toFixed(0)} km</strong> · {w.temp}°C
                      <span className={`wx-wind ${w.relativeWind > 5 ? "head" : w.relativeWind < -5 ? "tail" : ""}`}>
                        {w.relativeWind > 5 ? "⬆" : w.relativeWind < -5 ? "⬇" : "↕"} {Math.abs(w.relativeWind)} km/h
                      </span>
                    </span>
                    <span className="wx-side">
                      💧{w.precipProb}%
                      <span className="wx-time">{w.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "stops" && (
          <section className="panel">
            <div className="stop-types">
              {STOP_TYPES.map((t) => (
                <label key={t.id} className={`chip ${stopTypes.has(t.id) ? "chip-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={stopTypes.has(t.id)}
                    onChange={(e) =>
                      setStopTypes((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        return next;
                      })
                    }
                  />
                  {t.emoji} {t.label}
                </label>
              ))}
            </div>
            <div className="field">
              <label>Corridor: {corridorM} m each side</label>
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={corridorM}
                onChange={(e) => setCorridorM(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Auto-Mark interval (km, 0 = off)</label>
              <input
                type="number"
                min={0}
                step={5}
                value={autoMarkKm ?? 0}
                onChange={(e) => setAutoMarkKm(Number(e.target.value) > 0 ? Number(e.target.value) : null)}
              />
            </div>
            <button className="btn btn-primary" disabled={!route || stopsLoading} onClick={doStops}>
              {stopsLoading ? "Searching…" : "Find stops on route"}
            </button>
            {stops && (
              <>
                <p className="hint">{stops.length} stops in corridor</p>
                <ul className="stop-list">
                  {(autoMarked ?? stops).map((s) => (
                    <li key={s.id} className="stop-item" onClick={() => setFocusPoint({ lat: s.lat, lon: s.lon })}>
                      <span>{s.type.emoji}</span>
                      <span className="stop-name">{s.name}</span>
                      <span className="stop-meta">
                        {(s.dist / 1000).toFixed(1)} km · {Math.round(s.offRoute)} m off
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {tab === "fuel" && (
          <section className="panel">
            <div className="field">
              <label>Effort</label>
              <div className="profile-row">
                {(["easy", "moderate", "hard"] as const).map((lv) => (
                  <button
                    key={lv}
                    className={`chip ${effort === lv ? "chip-on" : ""}`}
                    onClick={() => setEffort(lv)}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            </div>
            {!weather && <p className="hint">Run a weather check first — fuel needs conditions.</p>}
            {fuel && (
              <div className="fuel-grid">
                <div className="fuel-card"><span>{fuel.hours} h</span><label>duration est.</label></div>
                <div className="fuel-card"><span>{fuel.carbsPerHour} g/h</span><label>carbs</label></div>
                <div className="fuel-card"><span>{fuel.totalCarbsG} g</span><label>total carbs</label></div>
                <div className="fuel-card"><span>{(fuel.totalWaterMl / 1000).toFixed(1)} L</span><label>fluids</label></div>
                <div className="fuel-card"><span>{fuel.hydrationMlPerHour} ml/h</span><label>drink rate</label></div>
                <div className="fuel-card"><span>{fuel.drinkMixServings}</span><label>bottle servings</label></div>
                <div className="fuel-card"><span>{fuel.bars}</span><label>bars</label></div>
                <div className="fuel-card"><span>{fuel.gels}</span><label>gels</label></div>
              </div>
            )}
            {fuel?.notes.map((n, i) => (
              <p key={i} className="hint">💡 {n}</p>
            ))}
          </section>
        )}
      </aside>

      <main className="main">
        <MapView
          routePoints={route?.points ?? []}
          waypoints={waypoints}
          stops={mapStops}
          planningMode={planningMode}
          focusPoint={focusPoint}
          onMapClick={addWaypoint}
          onWaypointRemove={removeWaypoint}
        />
        <div className="elevation-panel">
          <ElevationChart points={route?.points ?? []} onHoverDist={setHoverDist} />
        </div>
      </main>
    </div>
  );
}

function pointOnRoute(route: PlannedRoute, dist: number) {
  const pts = route.points;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].dist < dist) lo = mid + 1;
    else hi = mid;
  }
  return { lat: pts[lo].lat, lon: pts[lo].lon };
}
