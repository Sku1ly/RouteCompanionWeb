# Route Companion Web

A zero-backend, browser-based version of the Route Companion concept: plan or import
a route, check conditions along it, find stops, and plan fuel — then export the route.

## Features

- **Map & route planning** — MapLibre GL + OpenStreetMap tiles. Click to add waypoints,
  plan along road/gravel/MTB/run/hike profiles via OSRM (bicycle & foot routers).
- **Import** — GPX and TCX files (track or route points), parsed fully client-side.
- **Export** — download any route as GPX.
- **Elevation profile** — Open-Meteo elevation API, interactive canvas chart with
  distance/elevation tooltip.
- **Weather along the route** — samples the route at ~12 points, offsets each sample
  by estimated travel time at your planned speed, and shows temperature, precipitation
  probability, conditions, and — key for cyclists — headwind/tailwind component
  relative to your direction of travel.
- **Stops on route** — Overpass API (OpenStreetMap): 12 stop categories (water, cafés,
  bike shops, groceries, gas, toilets, pharmacy, repair stations, shelters, camping,
  ATMs, hospitals) within an adjustable corridor around the route, sorted by distance
  along the route, with Auto-Mark selection at a set interval.
- **Fuel planner** — estimated duration from distance/elevation/effort, then carbs per
  hour, total carbs, hydration rate adjusted for temperature, drink mix servings,
  bars/gels to pack.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

```bash
npm run build     # production build in dist/
npm run typecheck
```

## Architecture

- `src/lib/geo.ts` — distance math, interpolation, sampling, formatting
- `src/lib/routing.ts` — OSRM snap-to-roads routing + Open-Meteo elevation enrichment
- `src/lib/files.ts` — GPX/TCX parsing and GPX export
- `src/lib/weather.ts` — route-time-offset weather sampling + relative wind
- `src/lib/stops.ts` — Overpass corridor search with endpoint fallbacks
- `src/lib/fuel.ts` — fuel/hydration planning model
- `src/components/MapView.tsx` — MapLibre map, route line, waypoint & stop markers
- `src/components/ElevationChart.tsx` — canvas elevation profile
- `src/App.tsx` — state, tabs, sidebar UI

No backend, no API keys. All data comes from free public APIs:
OpenStreetMap tiles, OSRM (routing.openstreetmap.de), Open-Meteo, and Overpass.
