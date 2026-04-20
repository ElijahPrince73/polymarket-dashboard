import { CITIES } from "../config.js";
import { fetchJson } from "../utils.js";
import { fetchObservedHighTemp as fetchObservedHighTempVC } from "./visual-crossing.js";
import { fetchObservedHighTempWU, hasWunderground } from "./wunderground.js";

// NOAA NCEI Climate Data Online — token-free `daily-summaries` endpoint.
// Returns station-exact TMAX for stations whose GHCND IDs are mapped below.
// Coverage: strong for US (USW...). International GHCND coverage is sparse —
// LFPB/LEMD/RJTT/etc. either have no daily summaries ingested or don't
// report TMAX. For those, keep the existing Visual Crossing path as fallback.
const NCEI_DAILY = "https://www.ncei.noaa.gov/access/services/data/v1";

// Map from CITIES[].station (ICAO) → GHCND station ID.
// Only include stations we've empirically verified return TMAX data.
// Verified on 2026-04-20 via a TMAX probe; add new entries only after
// re-verifying they return data, otherwise fallback takes over anyway.
export const GHCND_STATION_MAP = {
  KLAX: "USW00023174",
  KSFO: "USW00023234",
  KSEA: "USW00024233",
  KMIA: "USW00012839",
  KATL: "USW00013874",
  KLGA: "USW00014732",
  KORD: "USW00094846",
  KDAL: "USW00013960",
  KAUS: "USW00013904",
  KHOU: "USW00012918",
  KPHX: "USW00023183",
  KPDX: "USW00024229",
  KMSP: "USW00014922",
  KBNA: "USW00013897",
  KDTW: "USW00094847",
  KLAS: "USW00023169",
};

export function hasNoaaCoverage(stationIcao) {
  return Object.prototype.hasOwnProperty.call(GHCND_STATION_MAP, stationIcao);
}

// NCEI's daily-summaries endpoint publishes with roughly a 1–2 day lag for
// US stations. Calls made for dates closer than this will usually return an
// empty array — the caller falls back to Visual Crossing in that case.
export async function fetchObservedHighTempNOAA(city, date) {
  const ghcndId = GHCND_STATION_MAP[city?.station];
  if (!ghcndId) return null;
  const params = new URLSearchParams({
    dataset: "daily-summaries",
    stations: ghcndId,
    startDate: date,
    endDate: date,
    dataTypes: "TMAX",
    format: "json",
    units: city.unit === "F" ? "standard" : "metric",
  });
  let rows;
  try {
    rows = await fetchJson(`${NCEI_DAILY}?${params}`, {
      retries: 2,
      retryDelayMs: 1000,
    });
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const tmax = Number.parseFloat(rows[0]?.TMAX);
  if (!Number.isFinite(tmax)) return null;
  return { actualTemp: tmax, unit: city.unit, source: "noaa" };
}

// Orchestrator: station-exact sources first, then Visual Crossing.
//   1. NOAA GHCND daily-summaries — covers most US stations, ~1-day lag, free.
//   2. Wunderground hourly observations — covers international + Denver/KBKF
//      (anything Polymarket resolves against); uses the public browser key
//      WU's own site hydrates with.
//   3. Visual Crossing — lat/lon-interpolated fallback; always reachable.
// The `source` field is attached so the resolver can log which provider was
// used per trade for auditing.
export async function fetchObservedHighTempDispatched(cityName, date) {
  const city = CITIES.find((c) => c.name === cityName);
  if (city && hasNoaaCoverage(city.station)) {
    const noaa = await fetchObservedHighTempNOAA(city, date);
    if (noaa) return noaa;
  }
  if (city && hasWunderground(city.station)) {
    const wu = await fetchObservedHighTempWU(city, date);
    if (wu) return wu;
  }
  const vc = await fetchObservedHighTempVC(cityName, date);
  if (vc) return { ...vc, source: "vc" };
  return null;
}
