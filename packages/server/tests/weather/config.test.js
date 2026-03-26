import { describe, expect, it } from "vitest";

import { CITIES, MAX_SLIPPAGE, SIGMA_C, SIGMA_F } from "../../src/weather/config.js";

describe("weather config", () => {
  it("defines the required fields for every city", () => {
    for (const city of CITIES) {
      expect(city).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          station: expect.any(String),
          lat: expect.any(Number),
          lon: expect.any(Number),
          tz: expect.any(String),
          aliases: expect.any(Array),
          unit: expect.any(String),
        })
      );
    }
  });

  it("keeps all coordinates within valid ranges", () => {
    for (const city of CITIES) {
      expect(city.lat).toBeGreaterThanOrEqual(-90);
      expect(city.lat).toBeLessThanOrEqual(90);
      expect(city.lon).toBeGreaterThanOrEqual(-180);
      expect(city.lon).toBeLessThanOrEqual(180);
    }
  });

  it("uses four-letter ICAO station codes", () => {
    for (const city of CITIES) {
      expect(city.station).toMatch(/^[A-Z]{4}$/);
    }
  });

  it("has no duplicate city names", () => {
    const names = CITIES.map((city) => city.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("assigns Fahrenheit to US cities and Celsius elsewhere", () => {
    for (const city of CITIES) {
      const expectedUnit = city.station.startsWith("K") ? "F" : "C";
      expect(city.unit).toBe(expectedUnit);
    }
  });

  it("uses positive sigma defaults", () => {
    expect(SIGMA_F).toBeGreaterThan(0);
    expect(SIGMA_C).toBeGreaterThan(0);
  });

  it("keeps max slippage inside a sane range", () => {
    expect(MAX_SLIPPAGE).toBeGreaterThanOrEqual(0);
    expect(MAX_SLIPPAGE).toBeLessThanOrEqual(0.10);
  });
});
