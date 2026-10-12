import { useEffect, useState } from "react";

export type UnitMode = "metric" | "imperial";

const KEY = "rc-units";

export function useUnits(): { units: UnitMode; setUnits: (u: UnitMode) => void } {
  const [units, setUnitsState] = useState<UnitMode>(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === "imperial" || saved === "metric") return saved;
    // default from browser locale
    const imperial = navigator.language.startsWith("en-US") || navigator.language.startsWith("en-LR");
    return imperial ? "imperial" : "metric";
  });
  useEffect(() => {
    localStorage.setItem(KEY, units);
  }, [units]);
  return { units, setUnits: setUnitsState };
}

export const M_PER_MI = 1609.344;
export const M_PER_FT = 0.3048;

export function fmtDistance(m: number, mode: UnitMode): string {
  if (mode === "imperial") {
    const mi = m / M_PER_MI;
    if (mi < 0.1) return `${Math.round(m / M_PER_FT)} ft`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function fmtDistanceKm(km: number, mode: UnitMode): string {
  return fmtDistance(km * 1000, mode);
}

export function fmtElevation(m: number, mode: UnitMode): string {
  if (mode === "imperial") return `${Math.round(m / M_PER_FT)} ft`;
  return `${Math.round(m)} m`;
}

export function fmtTemp(c: number, mode: UnitMode): string {
  if (mode === "imperial") return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

export function fmtSpeed(kmh: number, mode: UnitMode): string {
  if (mode === "imperial") return `${Math.round(kmh / 1.609344)} mph`;
  return `${Math.round(kmh)} km/h`;
}

export function fmtFluids(ml: number, mode: UnitMode): string {
  if (mode === "imperial") {
    const oz = ml / 29.5735;
    if (oz >= 128) return `${(ml / 3785.41).toFixed(1)} gal`;
    return `${Math.round(oz)} fl oz`;
  }
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)} L`;
  return `${Math.round(ml)} ml`;
}

export function fmtRate(mlPerHour: number, mode: UnitMode): string {
  if (mode === "imperial") return `${Math.round(mlPerHour / 29.5735)} oz/h`;
  return `${Math.round(mlPerHour)} ml/h`;
}
