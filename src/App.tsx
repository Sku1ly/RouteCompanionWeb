import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./components/MapView";
import { ImportIcon, ExportIcon, TrashIcon, RouteIcon, BookmarkIcon } from "./components/icons";
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
import { listRoutes, saveRoute, deleteRoute, type SavedRoute } from "./lib/storage";
import { useTheme, type ThemeMode } from "./lib/theme";

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
  const [mapHoverDist, setMapHoverDist] = useState<number | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => listRoutes());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const [weather, setWeather] = useState<WeatherStop[] | null>(null);
  const [weatherSpeed, setWeatherSpeed] = useState(25); // always km/h internally

  const fmtKm = (km: number) => fmtDistance(km * 1000, units);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const [stops, setStops] = useState<Stop[] | null>(null);
  const [stopTypes, setStopTypes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("rc-stoptypes");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr) && arr.length) return new Set(arr);
      }
    } catch {}
    return new Set(["water", "cafe", "bikeshop", "vegan"]);
  });
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsProgress, setStopsProgress] = useState<string | null>(null);
  const [corridorM, setCorridorM] = useState<number>(() => {
    const v = Number(localStorage.getItem("rc-corridor"));
    return v >= 100 && v <= 2000 ? v : 500;
  });
  const [autoMarkKm, setAutoMarkKm] = useState<number | null>(() => {
    const v = Number(localStorage.getItem("rc-automark"));
    return v > 0 ? v : null;
  });

  const [effort, setEffort] = useState<"easy" | "moderate" | "hard">("moderate");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();
  const { units, setUnits } = useUnits();
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [routePois, setRoutePois] = useState<{ lat: number; lon: number; name: string; emoji: string }[]>([]);
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
        hasPlannedRef.current = true;
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
    (stop: { lat: number; lon: number; distAlong?: number; name?: string; emoji?: string }) => {
      setRoutePois((prev) => {
        if (prev.some((p) => p.lat === stop.lat && p.lon === stop.lon)) return prev;
        return [
          ...prev,
          { lat: stop.lat, lon: stop.lon, name: stop.name ?? "POI", emoji: stop.emoji ?? "📍" },
        ];
      });
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

  const handlePoiRemove = useCallback((poi: { lat: number; lon: number }) => {
    setRoutePois((prev) => prev.filter((p) => !(p.lat === poi.lat && p.lon === poi.lon)));
    setWaypoints((prev) => prev.filter((w) => !(w.lat === poi.lat && w.lon === poi.lon)));
  }, []);

  const doPlan = () => generateRoute(waypoints, profile, routeName);

  useEffect(() => {
    localStorage.setItem("rc-stoptypes", JSON.stringify([...stopTypes]));
  }, [stopTypes]);
  useEffect(() => {
    localStorage.setItem("rc-corridor", String(corridorM));
  }, [corridorM]);
  useEffect(() => {
    localStorage.setItem("rc-automark", String(autoMarkKm ?? 0));
  }, [autoMarkKm]);

  // Auto-replan (debounced) when waypoints change after the first plan.
  // User clicks mid-planning won't thrash the router: 1.2s of quiet first.
  const hasPlannedRef = useRef(false);
  const wasInitializedRef = useRef(false);
  const wpCountRef = useRef(waypoints.length);
  useEffect(() => {
    // skip the very first render (nothing to replan)
    if (!wasInitializedRef.current) {
      wasInitializedRef.current = true;
      wpCountRef.current = waypoints.length;
      return;
    }
    const countChanged = wpCountRef.current !== waypoints.length;
    wpCountRef.current = waypoints.length;
    if (!hasPlannedRef.current) {
      // never planned yet: only auto-plan once user has >=2 waypoints
      if (waypoints.length >= 2) {
        hasPlannedRef.current = true;
      }
      return;
    }
    if (!countChanged) return;
    const t = setTimeout(() => {
      generateRoute(waypoints, profile, routeName);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints]);

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
      setRoutePois([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const doSave = () => {
    if (!route) return;
    try {
      saveRoute(route, profile, routePois);
      setSavedRoutes(listRoutes());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const doLoadSaved = (r: SavedRoute) => {
    setRoute(r.route);
    setRouteName(r.route.name);
    setRoutePois(r.pois);
    setWaypoints([
      { lat: r.route.points[0].lat, lon: r.route.points[0].lon },
      {
        lat: r.route.points[r.route.points.length - 1].lat,
        lon: r.route.points[r.route.points.length - 1].lon,
      },
    ]);
    setWeather(null);
    setStops(null);
    setPlanningMode(false);
  };

  const doDeleteSaved = (id: string) => {
    deleteRoute(id);
    setSavedRoutes(listRoutes());
  };

  const doExport = () => {
    if (!route) return;
    const list = autoMarked ?? visibleStops ?? [];
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
    setHiddenTypes(new Set());
    try {
      const types = STOP_TYPES.filter((t) => stopTypes.has(t.id));
      const s = await findStops(route, types, 2000, setStopsProgress);
      setStops(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop lookup failed");
    } finally {
      setStopsLoading(false);
      setStopsProgress(null);
    }
  };

  const visibleStops = useMemo(() => {
    if (!stops) return null;
    return stops.filter((s) => s.offRoute <= corridorM);
  }, [stops, corridorM]);

  const autoMarked = useMemo(() => {
    if (!visibleStops || !autoMarkKm || autoMarkKm <= 0) return null;
    const marked: Stop[] = [];
    let nextAt = autoMarkKm * 1000;
    for (const s of visibleStops) {
      if (s.dist >= nextAt) {
        marked.push(s);
        nextAt += autoMarkKm * 1000;
      }
    }
    return marked;
  }, [visibleStops, autoMarkKm]);

  const poiOnProfile = useMemo(() => {
    if (!route || routePois.length === 0) return [];
    return routePois
      .map((poi) => {
        let best = { dist: 0, off: Infinity };
        for (let i = 0; i < route.points.length; i++) {
          const p = route.points[i];
          const off = Math.hypot((p.lon - poi.lon) * 85, (p.lat - poi.lat) * 111) * 1000;
          if (off < best.off) best = { dist: p.dist, off };
        }
        return { ...poi, dist: best.dist };
      })
      .sort((a, b) => a.dist - b.dist);
  }, [route, routePois]);

  const kmMarks = useMemo(() => {
    if (!route || route.distance <= 0) return { ms: [] as number[], labels: [] as string[] };
    const stepM = units === "imperial" ? 5 * 1609.344 : 5000;
    const ms: number[] = [];
    const labels: string[] = [];
    for (let d = stepM; d < route.distance; d += stepM) {
      ms.push(d);
      labels.push(fmtDistance(d, units));
    }
    return { ms, labels };
  }, [route, units]);

  const fuel = useMemo(() => {
    if (!route || !weather) return null;
    const avgTemp = weather.reduce((a, w) => a + w.temp, 0) / weather.length;
    return planFuel(route, avgTemp, effort);
  }, [route, weather, effort]);

  const mapStops = useMemo(() => {
    const list = autoMarked ?? visibleStops ?? [];
    return list
      .filter((s) => !hiddenTypes.has(s.type.id))
      .map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        name: s.name,
        emoji: s.type.emoji,
        distAlong: s.dist,
        offRoute: s.offRoute,
      }));
  }, [visibleStops, autoMarked, hiddenTypes]);

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
          </div>
        </header>

        <div className="file-row">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <ImportIcon /> Import
          </button>
          <button className="btn" disabled={!route} onClick={doSave} title="Save route to this browser">
            <BookmarkIcon /> Save
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
              {loading ? <><span className="spinner" /> Planning…</> : "Plan route"}
            </button>
            <button className="btn" onClick={() => { setWaypoints([]); setRoute(null); setWeather(null); setStops(null); setRoutePois([]); }}>
              <><TrashIcon /> Clear</>
            </button>
          </div>
          <p className="hint">{waypoints.length} waypoint{waypoints.length === 1 ? "" : "s"}</p>
        </div>

        {routePois.length > 0 && (
          <div className="field">
            <label>POIs on route ({routePois.length})</label>
            <ul className="stop-list">
              {routePois.map((p) => (
                <li key={`${p.lat},${p.lon}`} className="stop-item">
                  <span>{p.emoji}</span>
                  <span className="stop-name">{p.name}</span>
                  <button
                    className="poi-remove"
                    title="Remove POI"
                    onClick={() => handlePoiRemove(p)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {savedRoutes.length > 0 && (
          <div className="field">
            <label>Saved routes</label>
            <ul className="stop-list saved-routes">
              {savedRoutes.map((r) => (
                <li key={r.id} className="stop-item">
                  <span className="saved-name" onClick={() => doLoadSaved(r)} title="Load route">
                    {r.route.name}
                  </span>
                  <span className="stop-meta">
                    {fmtDistance(r.route.distance, units)} · {new Date(r.savedAt).toLocaleDateString()}
                  </span>
                  <button className="poi-remove" title="Delete saved route" onClick={() => doDeleteSaved(r.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
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

        {tab === "plan" && route && (
          <section className="panel">
            <div className="route-stats route-stats-tall">
              <div><span className="stat-num">{fmtDistance(route.distance, units)}</span><span className="stat-lbl">distance</span></div>
              <div><span className="stat-num">↑{fmtElevation(route.ascent, units)}</span><span className="stat-lbl">ascent</span></div>
              <div><span className="stat-num">↓{fmtElevation(route.descent, units)}</span><span className="stat-lbl">descent</span></div>
            </div>
            {route.points.length > 1 && (
              <div className="route-stats">
                <div><span className="stat-num">{fmtElevation(route.points[route.points.length - 1].ele, units)}</span><span className="stat-lbl">finish alt</span></div>
                <div><span className="stat-num">{fmtElevation(Math.min(...route.points.map((p) => p.ele)), units)}</span><span className="stat-lbl">min alt</span></div>
                <div><span className="stat-num">{fmtElevation(Math.max(...route.points.map((p) => p.ele)), units)}</span><span className="stat-lbl">max alt</span></div>
              </div>
            )}
            {waypoints.length > 0 && (
              <p className="hint">
                {waypoints.length} waypoint{waypoints.length === 1 ? "" : "s"} · click a numbered
                marker on the map to remove it · click the map to add more · replan after changes
              </p>
            )}
            {routePois.length > 0 && (
              <p className="hint">{routePois.length} POI{routePois.length === 1 ? "" : "s"} on route · click a magenta marker to remove</p>
            )}
          </section>
        )}

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
                <p className="hint">{visibleStops?.length ?? 0} of {stops?.length ?? 0} stops shown</p>
                <div className="stop-types hide-filter">
                  {STOP_TYPES.filter((t) => stops.some((s) => s.type.id === t.id)).map((t) => (
                    <label
                      key={t.id}
                      className={`chip ${!hiddenTypes.has(t.id) ? "chip-on" : ""}`}
                      title={hiddenTypes.has(t.id) ? "Hidden — click to show" : "Shown — click to hide"}
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenTypes.has(t.id)}
                        onChange={(e) =>
                          setHiddenTypes((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(t.id);
                            else next.add(t.id);
                            return next;
                          })
                        }
                      />
                      {t.emoji} {t.label}
                    </label>
                  ))}
                </div>
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
          kmMarkersM={kmMarks.ms}
          kmLabels={kmMarks.labels}
          routePois={routePois}
          onPoiRemove={handlePoiRemove}
          hoverDist={hoverDist}
          onRouteHover={setMapHoverDist}
          onMapClick={addWaypoint}
          onWaypointRemove={removeWaypoint}
          onStopAddToRoute={handleStopAddToRoute}
        />
        <div className="elevation-panel">
          <ElevationChart points={route?.points ?? []} units={units} pois={poiOnProfile} onHoverDist={setHoverDist} mapHoverDist={mapHoverDist} />
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
