import type { PlannedRoute } from "./geo";

export interface FuelPlan {
  hours: number;
  carbsPerHour: number;
  totalCarbsG: number;
  hydrationMlPerHour: number;
  totalWaterMl: number;
  drinkMixServings: number;
  sodiumMgPerHour: number;
  totalSodiumMg: number;
  bars: number;
  gels: number;
  notes: string[];
}

export function planFuel(route: PlannedRoute, avgTempC: number, effort: "easy" | "moderate" | "hard"): FuelPlan {
  const distanceKm = route.distance / 1000;
  const notes: string[] = [];

  let speedKph: number;
  if (effort === "easy") speedKph = 18;
  else if (effort === "moderate") speedKph = 24;
  else speedKph = 30;
  const climbFactor = 1 + Math.min(route.ascent / 1500, 0.5);
  const hours = (distanceKm / (speedKph / climbFactor)) || 0;

  let carbsPerHour = effort === "easy" ? 40 : effort === "moderate" ? 60 : 80;
  if (hours > 3) carbsPerHour = Math.max(carbsPerHour, 70);
  if (hours > 5) notes.push("Long effort: eat solid food early, save gels for the last third.");

  const totalCarbsG = Math.round(carbsPerHour * hours);

  let baseMlPerHour = 500;
  if (avgTempC >= 28) baseMlPerHour = 850;
  else if (avgTempC >= 22) baseMlPerHour = 700;
  else if (avgTempC >= 15) baseMlPerHour = 550;
  else baseMlPerHour = 450;
  if (effort === "hard") baseMlPerHour += 100;

  const hydrationMlPerHour = baseMlPerHour;
  const totalWaterMl = Math.round(hydrationMlPerHour * hours);
  const drinkMixServings = Math.max(1, Math.round(totalWaterMl / 500));
  const sodiumMgPerHour = Math.round(hydrationMlPerHour * 0.7);
  const totalSodiumMg = sodiumMgPerHour * Math.ceil(hours);

  const bars = Math.ceil((totalCarbsG * 0.5) / 40);
  const gels = Math.ceil((totalCarbsG * 0.5) / 25);

  if (avgTempC >= 28) notes.push("Hot conditions: consider an extra bottle and electrolyte tabs.");
  if (avgTempC <= 5) notes.push("Cold conditions: reduce fluids slightly, insulate bottles.");
  if (route.ascent > 1000) notes.push(`Big climb day (${Math.round(route.ascent)} m ascent): spread intake across climbs.`);

  return {
    hours: Math.round(hours * 10) / 10,
    carbsPerHour,
    totalCarbsG,
    hydrationMlPerHour,
    totalWaterMl,
    drinkMixServings,
    sodiumMgPerHour,
    totalSodiumMg,
    bars,
    gels,
    notes,
  };
}
