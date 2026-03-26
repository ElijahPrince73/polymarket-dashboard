import { CITIES } from "../config.js";

const BASE_URL = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

function getCityConfig(cityName) {
  return CITIES.find((city) => city.name === cityName) ?? null;
}

function getUnitGroup(unit) {
  return unit === "F" ? "us" : "metric";
}

export async function fetchObservedHighTemp(cityName, date) {
  const apiKey = process.env.VISUAL_CROSSING_API_KEY;
  if (!apiKey) return null;

  const city = getCityConfig(cityName);
  if (!city?.lat || !city?.lon || !date) return null;

  const location = `${city.lat},${city.lon}`;
  const url =
    `${BASE_URL}/${encodeURIComponent(location)}/${date}` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&include=days&elements=tempmax&unitGroup=${getUnitGroup(city.unit)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) {
      console.warn(`[VISUAL_CROSSING] Rate limited for ${cityName} ${date}`);
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[VISUAL_CROSSING] ${cityName} ${date} failed: ${res.status} ${text}`.trim());
      return null;
    }

    const data = await res.json();
    const actualTemp = data?.days?.[0]?.tempmax;
    if (!Number.isFinite(actualTemp)) return null;

    return {
      actualTemp,
      unit: city.unit,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`[VISUAL_CROSSING] ${cityName} ${date} error: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

