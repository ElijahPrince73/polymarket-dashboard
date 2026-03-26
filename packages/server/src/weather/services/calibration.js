import { CITIES } from "../config.js";
import db from "../db.js";

function getCityUnit(cityName) {
  return CITIES.find((city) => city.name === cityName)?.unit ?? "F";
}

export function determineAdaptiveSigma(avgError, resolvedCount, defaultSigma) {
  if (resolvedCount >= 30 && Number.isFinite(avgError) && avgError > 0) {
    return avgError;
  }
  return defaultSigma;
}

export function determineKellyMultiplier(avgError, resolvedCount, unit = "F") {
  if (resolvedCount < 10) return 0.5;
  if (!Number.isFinite(avgError) || avgError < 0) return 0.25;

  const thresholds = unit === "C"
    ? { full: 0.5, medium: 1.0, low: 1.5 }
    : { full: 1.0, medium: 2.0, low: 3.0 };

  if (avgError <= thresholds.full) return 1.0;
  if (avgError <= thresholds.medium) return 0.75;
  if (avgError <= thresholds.low) return 0.5;
  return 0.25;
}

export async function getCityAccuracy(city, marketType = "temp_max", dbApi = db) {
  const row = await dbApi.getCalibration(city, marketType);
  const avgError = row?.avg_error ?? null;
  const resolvedCount = row?.resolved_count ?? 0;
  const sigma = row?.sigma ?? null;
  const kellyMultiplier = determineKellyMultiplier(avgError, resolvedCount, getCityUnit(city));

  return {
    avgError,
    resolvedCount,
    sigma,
    kellyMultiplier,
  };
}

export async function computeAdaptiveSigma(
  city,
  defaultSigma,
  marketType = "temp_max",
  dbApi = db,
  accuracy = null
) {
  const stats = accuracy ?? await getCityAccuracy(city, marketType, dbApi);
  return determineAdaptiveSigma(stats.avgError, stats.resolvedCount, defaultSigma);
}

export async function computeKellyMultiplier(
  city,
  marketType = "temp_max",
  dbApi = db,
  accuracy = null
) {
  const stats = accuracy ?? await getCityAccuracy(city, marketType, dbApi);
  return determineKellyMultiplier(stats.avgError, stats.resolvedCount, getCityUnit(city));
}

