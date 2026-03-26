import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  getCalibration: vi.fn(),
}));

vi.mock("../../src/weather/utils.js", async () => {
  const actual = await vi.importActual("../../src/weather/utils.js");
  return {
    ...actual,
    fetchJson: mocks.fetchJson,
  };
});

vi.mock("../../src/weather/db.js", () => ({
  default: {},
  getCalibration: mocks.getCalibration,
}));

const discovery = await import("../../src/weather/services/discovery.js");

describe("weather discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCalibration.mockReturnValue(null);
  });

  it("fetchMetar returns a parsed Celsius temperature", async () => {
    mocks.fetchJson.mockResolvedValue([{ temp: "18.5", station_id: "KDAL" }]);

    await expect(discovery.fetchMetar("KDAL")).resolves.toEqual({
      tempC: 18.5,
      raw: { temp: "18.5", station_id: "KDAL" },
    });
    expect(mocks.fetchJson).toHaveBeenCalledWith(
      "https://aviationweather.gov/api/data/metar?ids=KDAL&format=json"
    );
  });

  it("forecastHourlyBlended returns medians across successful model calls", async () => {
    mocks.fetchJson
      .mockResolvedValueOnce({
        hourly: {
          time: ["2026-03-24T00:00", "2026-03-24T01:00"],
          temperature_2m: [10, 12],
        },
      })
      .mockResolvedValueOnce({
        hourly: {
          time: ["2026-03-24T00:00", "2026-03-24T01:00"],
          temperature_2m: [20, 22],
        },
      })
      .mockResolvedValueOnce({
        hourly: {
          time: ["2026-03-24T00:00", "2026-03-24T01:00"],
          temperature_2m: [30, 32],
        },
      });

    await expect(
      discovery.forecastHourlyBlended(32.8, -96.8, "America/Chicago", ["m1", "m2", "m3"], "2026-03-24")
    ).resolves.toEqual({
      tmax: 22,
      tmin: 20,
      modelsUsed: 3,
    });
  });

  it("clobPrice returns the parsed market price", async () => {
    mocks.fetchJson.mockResolvedValue({ price: "0.37" });

    await expect(discovery.clobPrice("abc123")).resolves.toBe(0.37);
    expect(mocks.fetchJson).toHaveBeenCalledWith(
      "https://clob.polymarket.com/price?token_id=abc123&side=buy"
    );
  });
});
