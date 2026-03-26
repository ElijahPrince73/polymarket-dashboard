import { SEARCH_TERMS } from "../config.js";
import { getCalibration } from "../db.js";
import { fetchJson } from "../utils.js";

export async function searchMarkets(aliases) {
  const results = [];
  for (const alias of aliases) {
    for (const term of SEARCH_TERMS) {
      const q = `${alias} ${term}`;
      const data = await fetchJson(
        `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}`
      );
      if (Array.isArray(data?.events)) results.push(...data.events);
    }
  }

  const map = new Map();
  for (const e of results) map.set(e.id, e);
  return [...map.values()];
}

export async function clobPrice(tokenId) {
  const data = await fetchJson(`https://clob.polymarket.com/price?token_id=${tokenId}&side=buy`);
  return parseFloat(data.price);
}

export async function fetchMetar(station) {
  try {
    const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json`;
    const data = await fetchJson(url);
    if (Array.isArray(data) && data.length > 0 && data[0].temp != null) {
      return { tempC: parseFloat(data[0].temp), raw: data[0] };
    }
  } catch (e) {
    console.warn(`[METAR] ${station}: ${e.message}`);
  }
  return null;
}

export async function forecastDaily(lat, lon, tz) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=${encodeURIComponent(tz)}`;
  return fetchJson(url);
}

export async function forecastHourly(lat, lon, tz) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=${encodeURIComponent(tz)}`;
  return fetchJson(url);
}

function getLocalDateString(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function dayTempsFromHourly(hourly, dateStr) {
  const temps = [];
  for (let i = 0; i < (hourly?.time?.length ?? 0); i += 1) {
    if (hourly.time[i].startsWith(dateStr) && Number.isFinite(hourly.temperature_2m?.[i])) {
      temps.push(hourly.temperature_2m[i]);
    }
  }
  if (!temps.length) return null;
  return { tmax: Math.max(...temps), tmin: Math.min(...temps) };
}

export async function forecastHourlyBlended(lat, lon, tz, models, targetDate = null, metar = null) {
  const dateStr = targetDate || getLocalDateString(tz);

  // models can be an array (legacy) or { shortRange: [...], global: [...] }
  let selectedModels;
  if (Array.isArray(models)) {
    selectedModels = models;
  } else if (models && typeof models === "object") {
    // Combine short-range + global — short-range models that don't have
    // data for the target date will simply fail and get filtered out.
    selectedModels = [...(models.shortRange || []), ...(models.global || [])];
  } else {
    selectedModels = [];
  }

  const modelCalls = selectedModels.map(async (model) => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m&timezone=${encodeURIComponent(tz)}&models=${encodeURIComponent(model)}&forecast_days=2`;
    const data = await fetchJson(url);
    const day = dayTempsFromHourly(data?.hourly, dateStr);
    if (!day) {
      console.warn(`[Weather] No hourly temperatures for ${model} on ${dateStr} - API may be down`);
      return null; // Return null instead of throwing - let Promise.allSettled handle it
    }
    return day;
  });

  const settled = await Promise.allSettled(modelCalls);
  const successful = settled
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
  if (successful.length) {
    const result = {
      tmax: median(successful.map((x) => x.tmax)),
      tmin: median(successful.map((x) => x.tmin)),
      modelsUsed: successful.length,
    };
    if (metar && metar.tempC != null && dateStr === getLocalDateString(tz)) {
      result.tmax = (metar.tempC * 2 + result.tmax) / 3;
    }
    return result;
  }

  const fallback = await forecastHourly(lat, lon, tz);
  const fallbackDay = dayTempsFromHourly(fallback?.hourly, dateStr);
  if (!fallbackDay) return null;
  const result = {
    ...fallbackDay,
    modelsUsed: 0,
  };
  if (metar && metar.tempC != null && dateStr === getLocalDateString(tz)) {
    result.tmax = (metar.tempC * 2 + result.tmax) / 3;
  }
  return result;
}

export function pickDailyForDate(daily, dateStr) {
  const idx = daily?.time?.indexOf(dateStr) ?? -1;
  if (idx < 0) return null;
  return {
    date: dateStr,
    tmax: daily.temperature_2m_max[idx],
    tmin: daily.temperature_2m_min[idx],
    precip: daily.precipitation_sum[idx],
    precipProb: daily.precipitation_probability_max[idx],
    windMax: daily.wind_speed_10m_max[idx],
  };
}

export function pickHourlyForDate(hourly, dateStr) {
  const temps = [];
  const winds = [];
  const precs = [];
  for (let i = 0; i < (hourly?.time?.length ?? 0); i += 1) {
    if (hourly.time[i].startsWith(dateStr)) {
      temps.push(hourly.temperature_2m[i]);
      winds.push(hourly.wind_speed_10m[i]);
      precs.push(hourly.precipitation[i]);
    }
  }
  if (!temps.length) return null;
  return {
    tmax: Math.max(...temps),
    tmin: Math.min(...temps),
    windMax: Math.max(...winds),
    precipSum: precs.reduce((a, b) => a + b, 0),
  };
}

export function applyCalibration(city, type, prob) {
  const row = getCalibration(city, type);
  const bias = row?.bias ?? 0;
  return Math.max(0, Math.min(1, prob + bias));
}
