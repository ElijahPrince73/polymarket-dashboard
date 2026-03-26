import { describe, expect, it } from "vitest";

import {
  detectMarketType,
  fmtDateInTz,
  normalCdf,
  parseDateFromQuestion,
  parseInequalityC,
  parseRangeC,
  parseThresholdC,
} from "../../src/weather/utils.js";

function expectClose(actual, expected, digits = 3) {
  expect(actual).toBeCloseTo(expected, digits);
}

describe("weather utils", () => {
  it("parses temperature ranges in Fahrenheit and Celsius", () => {
    const fahrenheit = parseRangeC("Will Dallas be between 78-79°F on March 24?");
    expect(fahrenheit?.unit).toBe("F");
    expectClose(fahrenheit.lowC, (78 - 32) * 5 / 9, 4);
    expectClose(fahrenheit.highC, (79 - 32) * 5 / 9, 4);

    expect(parseRangeC("Will Paris be between 14-15°C on March 24?")).toEqual({
      lowC: 14,
      highC: 15,
      unit: "C",
    });
  });

  it("handles range parsing edge cases", () => {
    expect(parseRangeC("between -2--1°C overnight")).toEqual({
      lowC: -2,
      highC: -1,
      unit: "C",
    });
    expect(parseRangeC("No range here")).toBeNull();
  });

  it("parses inequalities in Fahrenheit and Celsius", () => {
    const highF = parseInequalityC("Will Dallas reach 92°F or higher?");
    expect(highF?.op).toBe("ge");
    expectClose(highF.valueC, (92 - 32) * 5 / 9, 4);

    const lowF = parseInequalityC("Will Chicago fall to 73°F or below?");
    expect(lowF?.op).toBe("le");
    expectClose(lowF.valueC, (73 - 32) * 5 / 9, 4);

    expect(parseInequalityC("Will Berlin hit 15°C or higher?")).toEqual({
      valueC: 15,
      op: "ge",
    });
  });

  it("parses single-value thresholds", () => {
    expect(parseThresholdC("Will Paris hit 16°C on March 24?")).toEqual({
      valueC: 16,
      unit: "C",
    });
  });

  it("computes normal CDF for known z values", () => {
    expectClose(normalCdf(0), 0.5, 3);
    expectClose(normalCdf(1.96), 0.975, 3);
    expectClose(normalCdf(-1.96), 0.025, 3);
  });

  it("detects weather market types", () => {
    expect(detectMarketType("What will the highest temperature be in Dallas?")).toBe("temp_max");
    expect(detectMarketType("What will the lowest temperature be in Berlin?")).toBe("temp_min");
  });

  it("extracts market dates from question strings", () => {
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
    }).format(new Date());

    expect(
      parseDateFromQuestion("Will Dallas be between 78-79°F on March 24?", "America/Chicago")
    ).toBe(`${year}-03-24`);
    expect(
      parseDateFromQuestion("Will Paris hit 16°C on Sept 7?", "Europe/Paris")
    ).toBe(`${year}-09-07`);
    expect(parseDateFromQuestion("No date in this question", "UTC")).toBeNull();
  });

  it("formats timezone-local dates as YYYY-MM-DD", () => {
    const formatted = fmtDateInTz("America/New_York");
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
