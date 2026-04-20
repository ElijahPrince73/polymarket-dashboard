import { fetchJson } from "../utils.js";

// Wunderground / The Weather Company ground-truth fetch.
//
// Strategy: we pull station-exact hourly observations from the same public
// JSON endpoint Wunderground's own web frontend uses. The API key isn't
// hardcoded here — it's extracted at call time from the WU history page for
// the target station/date, which freshly publishes the key every load. This
// keeps us aligned with whatever key WU is currently rotating its anonymous
// traffic onto, and avoids shipping a stale secret.
//
// Coverage: works for the stations Polymarket resolves against (LFPB, VHHH,
// KBKF, etc.) that GHCND doesn't carry. Falls back to VC for anything not
// mapped below.

const WU_BASE = "https://www.wunderground.com/history/daily";
const TWC_OBS = "https://api.weather.com/v1/location";

// CITIES[].station → Wunderground URL path segment { country, city } +
// the 2-letter ISO country code used in the api.weather.com location ID.
// Kept small on purpose; add new entries only for stations that actually
// resolve on WU.
const WU_STATION_MAP = {
  // Europe
  LFPB: { country: "fr", city: "bonneuil-en-france", iso2: "FR" },
  EGLC: { country: "gb", city: "london", iso2: "GB" },
  LEMD: { country: "es", city: "madrid", iso2: "ES" },
  EDDB: { country: "de", city: "berlin", iso2: "DE" },
  EDDM: { country: "de", city: "munich", iso2: "DE" },
  EHAM: { country: "nl", city: "schiphol", iso2: "NL" },
  EFHK: { country: "fi", city: "vantaa", iso2: "FI" },
  EPWA: { country: "pl", city: "warsaw", iso2: "PL" },
  LIMC: { country: "it", city: "milan", iso2: "IT" },
  LTAC: { country: "tr", city: "%C3%A7ubuk", iso2: "TR" },
  // Asia
  RJTT: { country: "jp", city: "tokyo", iso2: "JP" },
  RKSI: { country: "kr", city: "incheon", iso2: "KR" },
  RKPK: { country: "kr", city: "busan", iso2: "KR" },
  WSSS: { country: "sg", city: "singapore", iso2: "SG" },
  VHHH: { country: "hk", city: "chek-lap-kok", iso2: "HK" },
  VABB: { country: "in", city: "mumbai", iso2: "IN" },
  VILK: { country: "in", city: "lucknow", iso2: "IN" },
  VTBS: { country: "th", city: "bangkok", iso2: "TH" },
  WIHH: { country: "id", city: "jakarta", iso2: "ID" },
  WMKK: { country: "my", city: "sepang-district", iso2: "MY" },
  OEJN: { country: "sa", city: "jeddah", iso2: "SA" },
  ZBAA: { country: "cn", city: "beijing", iso2: "CN" },
  ZUUU: { country: "cn", city: "chengdu", iso2: "CN" },
  ZUCK: { country: "cn", city: "chongqing", iso2: "CN" },
  ZSPD: { country: "cn", city: "shanghai", iso2: "CN" },
  ZGSZ: { country: "cn", city: "shenzhen", iso2: "CN" },
  ZHHH: { country: "cn", city: "wuhan", iso2: "CN" },
  RCSS: { country: "tw", city: "taipei", iso2: "TW" },
  // Oceania
  YSSY: { country: "au", city: "sydney", iso2: "AU" },
  NZWN: { country: "nz", city: "wellington", iso2: "NZ" },
  // Africa
  FACT: { country: "za", city: "matroosfontein", iso2: "ZA" },
  DNMM: { country: "ng", city: "lagos", iso2: "NG" },
  // Americas
  CYYZ: { country: "ca", city: "mississauga", iso2: "CA" },
  SBGR: { country: "br", city: "guarulhos", iso2: "BR" },
  MMMX: { country: "mx", city: "mexico-city", iso2: "MX" },
  SAEZ: { country: "ar", city: "ezeiza", iso2: "AR" },
  // US station NOAA doesn't have: Buckley / Denver
  KBKF: { country: "us", city: "aurora", iso2: "US" },
};

export function hasWunderground(stationIcao) {
  return Object.prototype.hasOwnProperty.call(WU_STATION_MAP, stationIcao);
}

function isoDateCompact(date) {
  return String(date).replace(/-/g, "");
}

// Pulls the current anonymous API key from the WU history page for this
// station+date. The key is published as `?apiKey=<32 hex>` in the embedded
// api.weather.com URLs the page uses to hydrate its client.
async function extractApiKey(station, entry, date) {
  const url = `${WU_BASE}/${entry.country}/${entry.city}/${station}/date/${date}`;
  let html;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 polymarket-dashboard" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const m = html.match(/apiKey=([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

export async function fetchObservedHighTempWU(city, date) {
  const entry = WU_STATION_MAP[city?.station];
  if (!entry) return null;
  const apiKey = await extractApiKey(city.station, entry, date);
  if (!apiKey) return null;

  const compact = isoDateCompact(date);
  const unitGroup = city.unit === "F" ? "e" : "m";
  const locationId = `${city.station}:9:${entry.iso2}`;
  const url =
    `${TWC_OBS}/${encodeURIComponent(locationId)}/observations/historical.json` +
    `?apiKey=${apiKey}&units=${unitGroup}&startDate=${compact}`;

  let data;
  try {
    data = await fetchJson(url, { retries: 2, retryDelayMs: 1000 });
  } catch {
    return null;
  }
  const obs = Array.isArray(data?.observations) ? data.observations : [];
  if (!obs.length) return null;

  // Prefer explicit max_temp when present; fall back to max of hourly temps.
  let maxTemp = -Infinity;
  for (const o of obs) {
    const explicit = Number.parseFloat(o?.max_temp);
    if (Number.isFinite(explicit) && explicit > maxTemp) maxTemp = explicit;
    const hourly = Number.parseFloat(o?.temp);
    if (Number.isFinite(hourly) && hourly > maxTemp) maxTemp = hourly;
  }
  if (!Number.isFinite(maxTemp)) return null;

  return {
    actualTemp: maxTemp,
    unit: city.unit,
    source: "wu",
  };
}
