import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/weather/db.js", () => ({
  default: {},
}));

const calibration = await import("../../src/weather/services/calibration.js");

describe("weather calibration", () => {
  it("uses the default sigma until enough resolutions are available", () => {
    expect(calibration.determineAdaptiveSigma(1.4, 29, 2.0)).toBe(2.0);
    expect(calibration.determineAdaptiveSigma(1.4, 30, 2.0)).toBe(1.4);
  });

  it("scales Kelly conservatively when history is sparse", () => {
    expect(calibration.determineKellyMultiplier(0.5, 0, "F")).toBe(0.5);
    expect(calibration.determineKellyMultiplier(0.5, 9, "C")).toBe(0.5);
  });

  it("maps average forecast error to the configured Kelly tiers", () => {
    expect(calibration.determineKellyMultiplier(1.0, 10, "F")).toBe(1.0);
    expect(calibration.determineKellyMultiplier(2.0, 10, "F")).toBe(0.75);
    expect(calibration.determineKellyMultiplier(3.0, 10, "F")).toBe(0.5);
    expect(calibration.determineKellyMultiplier(3.1, 10, "F")).toBe(0.25);

    expect(calibration.determineKellyMultiplier(0.5, 10, "C")).toBe(1.0);
    expect(calibration.determineKellyMultiplier(1.0, 10, "C")).toBe(0.75);
    expect(calibration.determineKellyMultiplier(1.5, 10, "C")).toBe(0.5);
    expect(calibration.determineKellyMultiplier(1.6, 10, "C")).toBe(0.25);
  });

  it("returns city accuracy with derived kelly multiplier", async () => {
    const dbApi = {
      getCalibration: vi.fn().mockResolvedValue({
        avg_error: 1.2,
        resolved_count: 35,
        sigma: 1.1,
      }),
    };

    await expect(calibration.getCityAccuracy("Dallas", "temp_max", dbApi)).resolves.toEqual({
      avgError: 1.2,
      resolvedCount: 35,
      sigma: 1.1,
      kellyMultiplier: 0.75,
    });
  });
});
