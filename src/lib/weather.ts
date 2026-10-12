import type { PlannedRoute } from "./geo";
import { sampleByDistance, pointAtDistance } from "./geo";

export interface WeatherAtPoint {
  dist: number;
  time: Date;
  temp: number;
  apparent: number;
  windSpeed: number; // km/h
  windDir: number; // degrees FROM which wind blows
  precip: number; // mm
  precipProb: number; // %
  weatherCode: number;
  isDay: boolean;
}

export interface WeatherStop {
  dist: number;
  time: Date;
  temp: number;
  wind: number;
  windDir: number;
  relativeWind: number; // km/h headwind(+)/tailwind(-)
  precipProb: number;
  precip: number;
  code: number;
  label: string;
  emoji: string;
}

const WEATHER_CODES: Record<number, [string, string]> = {
  0: ["Clear", "☀️"],
  1: ["Mostly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Icy fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  61: ["Light rain", "🌧️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "❄️"],
  75: ["Heavy snow", "❄️"],
  80: ["Rain showers", "🌦️"],
  81: ["Showers", "🌦️"],
  82: ["Violent showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Storm + hail", "⛈️"],
  99: ["Severe storm", "⛈️"],
};

export function describeWeather(code: number): [string, string] {
  return WEATHER_CODES[code] ?? ["Unknown", "❓"];
}

export function bearingBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Fetch weather at sampled points along the route, offset by travel time.
 * Uses one Open-Meteo call per distinct sampled location.
 */
export async function fetchRouteWeather(
  route: PlannedRoute,
  speedKph: number,
  startMs: number
): Promise<WeatherStop[]> {
  if (!route.points.length) return [];
  const samples = sampleByDistance(route.points, 12);
  const speedMps = speedKph / 3.6;

  const reqs = samples.map(async (s) => {
    const travelSec = s.dist / speedMps;
    const when = new Date(startMs + travelSec * 1000);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${s.lat.toFixed(4)}` +
      `&longitude=${s.lon.toFixed(4)}&hourly=temperature_2m,apparent_temperature,` +
      `precipitation,precipitation_probability,weather_code,wind_speed_10m,` +
      `wind_direction_10m,is_day&forecast_days=2&timeformat=unixtime&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather lookup failed (${res.status})`);
    const d = (await res.json()) as {
      hourly: Record<string, number[]>;
    };
    const times: number[] = d.hourly.time;
    const targetSec = Math.floor(when.getTime() / 1000 / 3600) * 3600;
    let idx = times.findIndex((t) => Math.abs(t - targetSec) <= 1801);
    if (idx < 0) idx = 0;
    return {
      dist: s.dist,
      time: new Date(times[idx] * 1000),
      temp: d.hourly.temperature_2m[idx],
      apparent: d.hourly.apparent_temperature[idx],
      wind: d.hourly.wind_speed_10m[idx],
      windDir: d.hourly.wind_direction_10m[idx],
      precip: d.hourly.precipitation[idx],
      precipProb: d.hourly.precipitation_probability[idx],
      code: d.hourly.weather_code[idx],
      isDay: d.hourly.is_day[idx] === 1,
    };
  });

  const results = await Promise.all(reqs);
  return results.map((r, i) => {
    const next = samples[Math.min(i + 1, samples.length - 1)];
    const heading = bearingBetween(samples[i], next);
    const rel = relativeWind(r.wind, r.windDir, heading);
    const [label, emoji] = describeWeather(r.code);
    return {
      dist: r.dist,
      time: r.time,
      temp: Math.round(r.temp),
      wind: Math.round(r.wind),
      windDir: r.windDir,
      relativeWind: Math.round(rel),
      precipProb: r.precipProb,
      precip: r.precip,
      code: r.code,
      label,
      emoji,
    };
  });
}

/** Positive = headwind component (km/h), negative = tailwind. */
export function relativeWind(windKph: number, windFromDeg: number, headingDeg: number): number {
  const angle = ((windFromDeg - headingDeg) * Math.PI) / 180;
  return windKph * Math.cos(angle);
}
