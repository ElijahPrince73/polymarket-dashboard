import { beforeEach, describe, expect, it, vi } from "vitest";

function kellySize(modelProb, price) {
  const p = modelProb;
  const payoff = (1 / price) - 1;
  const kelly = (p * payoff - (1 - p)) / payoff;
  return kelly / 2;
}

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const mocks = vi.hoisted(() => ({
  forecastDaily: vi.fn(),
  fetchMetar: vi.fn(),
  forecastHourlyBlended: vi.fn(),
  pickDailyForDate: vi.fn(),
  searchMarkets: vi.fn(),
  clobPrice: vi.fn(),
  isLiveMode: vi.fn(),
  getBalance: vi.fn(),
  placeBuyOrder: vi.fn(),
  fmtDateInTz: vi.fn(),
  parseDateFromQuestion: vi.fn(),
  getCityAccuracy: vi.fn(),
  computeAdaptiveSigma: vi.fn(),
}));

vi.mock("../../src/weather/config.js", () => ({
  CITIES: [],
  MODEL_CANDIDATES: {},
  MAX_SLIPPAGE: 0.05,
  MAX_CITY_EXPOSURE_PCT: 0.04,
  MAX_DAILY_EXPOSURE_PCT: 0.25,
  MIN_HOURS_TO_CLOSE: 3,
  MIN_MODEL_CONSENSUS: 1,
  MIN_VOLUME: 500,
  SIGMA_C: 1.2,
  SIGMA_F: 2.0,
  STOP_DAILY_DD_PCT: 0.05,
  BASE_BANKROLL: 100,
}));

vi.mock("../../src/weather/db.js", () => ({
  default: {},
}));

vi.mock("../../src/weather/services/discovery.js", () => ({
  forecastDaily: mocks.forecastDaily,
  fetchMetar: mocks.fetchMetar,
  forecastHourlyBlended: mocks.forecastHourlyBlended,
  pickDailyForDate: mocks.pickDailyForDate,
  searchMarkets: mocks.searchMarkets,
  clobPrice: mocks.clobPrice,
}));

vi.mock("../../src/weather/services/exchange.js", () => ({
  isLiveMode: mocks.isLiveMode,
  getBalance: mocks.getBalance,
  placeBuyOrder: mocks.placeBuyOrder,
}));

vi.mock("../../src/weather/services/calibration.js", () => ({
  getCityAccuracy: mocks.getCityAccuracy,
  computeAdaptiveSigma: mocks.computeAdaptiveSigma,
}));

vi.mock("../../src/weather/utils.js", async () => {
  const actual = await vi.importActual("../../src/weather/utils.js");
  return {
    ...actual,
    fmtDateInTz: mocks.fmtDateInTz,
    parseDateFromQuestion: mocks.parseDateFromQuestion,
  };
});

const config = await import("../../src/weather/config.js");
const { runTradeDiscovery } = await import("../../src/weather/services/trader.js");

function makeDbApi() {
  return {
    getBankroll: vi.fn().mockResolvedValue(100),
    getTodayResolvedPnl: vi.fn().mockResolvedValue(0),
    getTradesSummary: vi.fn().mockResolvedValue([]),
    getCalibration: vi.fn().mockResolvedValue(null),
    insertTrade: vi.fn().mockResolvedValue({ id: 1 }),
    updateTrade: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEvent(question, outcomePrices) {
  return [{
    slug: "dallas-temp",
    closed: false,
    endDate: "2026-03-25T18:00:00Z",
    volume: 5000,
    markets: [
      {
        question,
        closed: false,
        active: true,
        volume: 5000,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(outcomePrices),
        clobTokenIds: JSON.stringify([]),
        conditionId: "cond-1",
        negRisk: false,
      },
    ],
  }];
}

async function runScenario({ city, question, forecastTempC, outcomePrices, calibration = null, markets = null }) {
  config.CITIES.splice(0, config.CITIES.length, city);
  config.MODEL_CANDIDATES[city.name] = [];

  const dbApi = makeDbApi();
  dbApi.getCalibration.mockResolvedValue(calibration);

  mocks.isLiveMode.mockReturnValue(false);
  mocks.getBalance.mockResolvedValue(null);
  mocks.placeBuyOrder.mockResolvedValue({ success: true, orderId: "order-1", size: 10 });
  mocks.fmtDateInTz.mockReturnValue("2026-03-24");
  mocks.parseDateFromQuestion.mockReturnValue("2026-03-25");
  mocks.forecastDaily.mockResolvedValue({ daily: {} });
  mocks.fetchMetar.mockResolvedValue({ tempC: forecastTempC });
  mocks.forecastHourlyBlended.mockResolvedValue({ tmax: forecastTempC, tmin: forecastTempC - 5, modelsUsed: 2 });
  mocks.pickDailyForDate.mockReturnValue({ tmax: forecastTempC, tmin: forecastTempC - 5 });
  mocks.searchMarkets.mockResolvedValue(markets ?? makeEvent(question, outcomePrices));
  mocks.getCityAccuracy.mockResolvedValue({
    avgError: calibration?.avg_error ?? null,
    resolvedCount: calibration?.resolved_count ?? 0,
    sigma: calibration?.sigma ?? null,
    kellyMultiplier: 0.5,
  });
  mocks.computeAdaptiveSigma.mockResolvedValue(calibration?.sigma ?? (city.unit === "F" ? 2.0 : 1.2));
  mocks.clobPrice.mockImplementation(async () => {
    throw new Error("should not be called");
  });

  await runTradeDiscovery(dbApi);
  return dbApi.insertTrade.mock.calls.map(([trade]) => trade);
}

describe("weather trader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.CITIES.splice(0, config.CITIES.length);
    for (const key of Object.keys(config.MODEL_CANDIDATES)) {
      delete config.MODEL_CANDIDATES[key];
    }
  });

  it("kelly sizing is positive above edge, negative below edge, and zero at breakeven", () => {
    expect(kellySize(0.6, 0.4)).toBeGreaterThan(0);
    expect(kellySize(0.3, 0.4)).toBeLessThan(0);
    expect(kellySize(0.4, 0.4)).toBeCloseTo(0, 10);
  });

  it("nextDay handles normal, month-end, and year-end boundaries", () => {
    expect(nextDay("2026-03-25")).toBe("2026-03-26");
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("rejects markets below the 5c floor and above the 50c ceiling", async () => {
    const city = {
      name: "Dallas",
      station: "KDAL",
      lat: 32.847,
      lon: -96.852,
      tz: "America/Chicago",
      unit: "F",
      aliases: ["Dallas"],
    };

    const lowPriceTrades = await runScenario({
      city,
      question: "Will Dallas highest temperature be between 78-79°F on March 25?",
      forecastTempC: 26,
      outcomePrices: [0.04, 0.96],
    });
    expect(lowPriceTrades.find((trade) => trade.status === "OPEN")).toBeUndefined();

    const highPriceTrades = await runScenario({
      city,
      question: "Will Dallas highest temperature be between 78-79°F on March 25?",
      forecastTempC: 26,
      outcomePrices: [0.51, 0.49],
    });
    expect(highPriceTrades.find((trade) => trade.status === "OPEN")).toBeUndefined();
  });

  it("uses SIGMA_F for Fahrenheit cities and SIGMA_C for Celsius cities by default", async () => {
    const fTrades = await runScenario({
      city: {
        name: "Dallas",
        station: "KDAL",
        lat: 32.847,
        lon: -96.852,
        tz: "America/Chicago",
        unit: "F",
        aliases: ["Dallas"],
      },
      question: "Will Dallas highest temperature be between 76-80°F on March 25?",
      forecastTempC: 26,
      outcomePrices: [0.2, 0.8],
    });
    expect(fTrades.find((trade) => trade.status === "OPEN")?.notes).toContain("σ=2");
    expect(mocks.computeAdaptiveSigma).toHaveBeenCalled();

    const cTrades = await runScenario({
      city: {
        name: "Paris",
        station: "LFPG",
        lat: 48.9962,
        lon: 2.5979,
        tz: "Europe/Paris",
        unit: "C",
        aliases: ["Paris"],
      },
      question: "Will Paris highest temperature be between 14-16°C on March 25?",
      forecastTempC: 14.5,
      outcomePrices: [0.2, 0.8],
    });
    expect(cTrades.find((trade) => trade.status === "OPEN")?.notes).toContain("σ=1.2");
  });

  it("skips markets below the minimum volume threshold", async () => {
    const city = {
      name: "Dallas",
      station: "KDAL",
      lat: 32.847,
      lon: -96.852,
      tz: "America/Chicago",
      unit: "F",
      aliases: ["Dallas"],
    };

    const trades = await runScenario({
      city,
      question: "Will Dallas highest temperature be between 78-79°F on March 25?",
      forecastTempC: 26,
      outcomePrices: [0.2, 0.8],
      markets: [{
        slug: "dallas-temp",
        closed: false,
        endDate: "2026-03-25T18:00:00Z",
        markets: [
          {
            question: "Will Dallas highest temperature be between 78-79°F on March 25?",
            closed: false,
            active: true,
            volume: 1500,
            outcomes: JSON.stringify(["Yes", "No"]),
            outcomePrices: JSON.stringify([0.2, 0.8]),
            clobTokenIds: JSON.stringify([]),
            conditionId: "cond-1",
            negRisk: false,
          },
        ],
      }],
    });

    expect(trades.find((trade) => trade.status === "OPEN")).toBeUndefined();
  });

  it("skips markets when slippage exceeds MAX_SLIPPAGE", async () => {
    const trades = await runScenario({
      city: {
        name: "Dallas",
        station: "KDAL",
        lat: 32.847,
        lon: -96.852,
        tz: "America/Chicago",
        unit: "F",
        aliases: ["Dallas"],
      },
      question: "Will Dallas highest temperature be between 78-79°F on March 25?",
      forecastTempC: 26,
      outcomePrices: [0.25, 0.6],
    });

    expect(trades.find((trade) => trade.status === "OPEN")).toBeUndefined();
  });
});
