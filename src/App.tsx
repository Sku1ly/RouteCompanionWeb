import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import { ImportIcon, ExportIcon, TrashIcon, RouteIcon } from "./components/icons";
import ElevationChart from "./components/ElevationChart";
import type { LatLng, PlannedRoute } from "./lib/geo";
import { formatDistance } from "./lib/geo";
import {
  useUnits,
  fmtDistance,
  fmtElevation,
  fmtTemp,
  fmtSpeed,
  fmtFluids,
  fmtRate,
  M_PER_FT,
  M_PER_MI,
} from "./lib/units";
import { buildRoute, type Profile } from "./lib/routing";
import { parseRouteFile, exportGpx, type GpxWaypoint } from "./lib/files";
import { fetchRouteWeather, type WeatherStop } from "./lib/weather";
import { findStops, STOP_TYPES, type Stop, type StopTypeDef } from "./lib/stops";
import { planFuel } from "./lib/fuel";
import { useTheme, type ThemeMode } from "./lib/theme";
import { useDesign, type DesignMode } from "./lib/design";

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
  const [weatherSpeed, setWeatherSpeed] = useState(25); // always km/h internally

  const fmtKm = (km: number) => fmtDistance(km * 1000, units);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [stops, setStops] = useState<Stop[] | null>(null);
  const [stopTypes, setStopTypes] = useState<Set<string>>(new Set(["water", "cafe", "bikeshop"]));
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsProgress, setStopsProgress] = useState<string | null>(null);
  const [corridorM, setCorridorM] = useState(500);
  const [autoMarkKm, setAutoMarkKm] = useState<number | null>(null);

  const [effort, setEffort] = useState<"easy" | "moderate" | "hard">("moderate");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();
  const { units, setUnits } = useUnits();
  const { design, setDesign } = useDesign();
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  const handleStopAddToRoute = useCallback(
    (stop: { lat: number; lon: number; distAlong?: number }) => {
      setWaypoints((prev) => {
        if (prev.length < 2) return [...prev, { lat: stop.lat, lon: stop.lon }];
        if (stop.distAlong == null) return [...prev, { lat: stop.lat, lon: stop.lon }];
        // insert as via-waypoint at the position matching its distance along the route
        const total = route?.distance ?? 0;
        const frac = total > 0 ? stop.distAlong / total : 1;
        const insertAt = Math.max(1, Math.min(prev.length, Math.round(frac * (prev.length - 1)) + 1));
        const next = [...prev];
        next.splice(insertAt, 0, { lat: stop.lat, lon: stop.lon });
        return next;
      });
    },
    [route]
  );

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
    const list = autoMarked ?? stops ?? [];
    const wpts: GpxWaypoint[] = list.map((s) => {
      const remainingM = Math.max(0, route.distance - s.dist);
      return {
        lat: s.lat,
        lon: s.lon,
        name: `${s.type.emoji} ${s.name} · ${fmtDistance(remainingM, units)} to go`,
        symbol: gpxSymbol(s.type.id),
      };
    });
    const gpx = exportGpx(route, wpts);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${route.name.replace(/[^\w\- ]+/g, "_")}${list.length ? "-stops" : ""}.gpx`;
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
    setStopsProgress(null);
    setError(null);
    try {
      const types = STOP_TYPES.filter((t) => stopTypes.has(t.id));
      const s = await findStops(route, types, corridorM, setStopsProgress);
      setStops(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop lookup failed");
    } finally {
      setStopsLoading(false);
      setStopsProgress(null);
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
      name: s.name,
      emoji: s.type.emoji,
      distAlong: s.dist,
      offRoute: s.offRoute,
    }));
  }, [stops, autoMarked]);

  return (
    <div className="app">
      <aside className={`sidebar ${sheetCollapsed && isMobile ? "collapsed" : ""}`}>
        {isMobile && (
          <button
            className="sheet-handle"
            onClick={() => setSheetCollapsed((v) => !v)}
            title={sheetCollapsed ? "Show controls" : "Hide controls"}
          />
        )}
        <header className="brand">
          <h1><RouteIcon size={20} /> Route Companion</h1>
          <p className="tagline">Plan it. Check it. Ride it.</p>
          <div className="theme-toggle">
            {(["auto", "light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className={`chip ${themeMode === m ? "chip-on" : ""}`}
                onClick={() => setThemeMode(m)}
                title={m === "auto" ? "Follow system" : m === "light" ? "Light" : "Dark"}
              >
                {m === "auto" ? "🌓" : m === "light" ? "☀️" : "🌙"}
              </button>
            ))}
            <span className="toggle-divider" />
            <button
              className={`chip ${units === "metric" ? "chip-on" : ""}`}
              onClick={() => setUnits("metric")}
              title="Metric: km, m, °C"
            >
              km/m
            </button>
            <button
              className={`chip ${units === "imperial" ? "chip-on" : ""}`}
              onClick={() => setUnits("imperial")}
              title="Imperial: mi, ft, °F"
            >
              mi/ft
            </button>
            <span className="toggle-divider" />
            <button
              className={`chip ${design === "modern" ? "chip-on" : ""}`}
              onClick={() => setDesign("modern")}
              title="Modern design"
            >
              Modern
            </button>
            <button
              className={`chip ${design === "material" ? "chip-on" : ""}`}
              onClick={() => setDesign("material")}
              title="Material Design 3"
            >
              Material
            </button>
          </div>
        </header>

        <div className="file-row">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <ImportIcon /> Import
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
            <ExportIcon /> Export
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
              <><TrashIcon /> Clear</>
            </button>
          </div>
          <p className="hint">{waypoints.length} waypoint{waypoints.length === 1 ? "" : "s"}</p>
        </div>

        {route && (
          <div className="route-stats">
            <div><span className="stat-num">{fmtDistance(route.distance, units)}</span><span className="stat-lbl">distance</span></div>
            <div><span className="stat-num">↑{fmtElevation(route.ascent, units)}</span><span className="stat-lbl">ascent</span></div>
            <div><span className="stat-num">↓{fmtElevation(route.descent, units)}</span><span className="stat-lbl">descent</span></div>
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
              {t === "plan" ? "Route" : t === "weather" ? "Weather" : t === "stops" ? "Stops" : "Fuel"}
            </button>
          ))}
        </nav>

        {tab === "weather" && (
          <section className="panel">
            <div className="field">
              <label>Planned avg speed: {fmtSpeed(weatherSpeed, units)}</label>
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
                      <strong>{fmtKm(w.dist / 1000)}</strong> · {fmtTemp(w.temp, units)}
                      <span className={`wx-wind ${w.relativeWind > 5 ? "head" : w.relativeWind < -5 ? "tail" : ""}`}>
                        {w.relativeWind > 5 ? "⬆" : w.relativeWind < -5 ? "⬇" : "↕"} {fmtSpeed(Math.abs(w.relativeWind), units)}
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
              <label>Corridor: {fmtDistance(corridorM, units)} each side</label>
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
              <label>Auto-Mark interval ({units === "imperial" ? "miles" : "km"}, 0 = off)</label>
              <input
                type="number"
                min={0}
                step={units === "imperial" ? 2 : 5}
                value={
                  autoMarkKm == null
                    ? 0
                    : units === "imperial"
                      ? Math.round(autoMarkKm / 1.609344)
                      : autoMarkKm
                }
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v <= 0) return setAutoMarkKm(null);
                  setAutoMarkKm(units === "imperial" ? v * 1.609344 : v);
                }}
              />
            </div>
            <button className="btn btn-primary" disabled={!route || stopsLoading} onClick={doStops}>
              {stopsLoading ? (stopsProgress ?? "Searching…") : "Find stops on route"}
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
                        {fmtDistance(s.dist, units)} · {fmtDistance(s.offRoute, units)} off
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
                <div className="fuel-card"><span>{fmtFluids(fuel.totalWaterMl, units)}</span><label>fluids</label></div>
                <div className="fuel-card"><span>{fmtRate(fuel.hydrationMlPerHour, units)}</span><label>drink rate</label></div>
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
          isDark={isDark}
          units={units}
          onMapClick={addWaypoint}
          onWaypointRemove={removeWaypoint}
          onStopAddToRoute={handleStopAddToRoute}
        />
        <div className="elevation-panel">
          <ElevationChart points={route?.points ?? []} units={units} onHoverDist={setHoverDist} />
        </div>
      </main>
    </div>
  );
}

function gpxSymbol(typeId: string): string {
  const map: Record<string, string> = {
    water: "Drinking Water",
    cafe: "Restaurant",
    bikeshop: "Bike Shop",
    grocery: "Grocery Store",
    gas: "Gas Station",
    toilets: "Restroom",
    pharmacy: "Pharmacy",
    repair: "Bike Shop",
    shelter: "Shelter",
    camping: "Campground",
    atm: "Bank",
    hospital: "Hospital",
  };
  return map[typeId] ?? "Flag, Red";
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
