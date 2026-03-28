import { beforeEach, describe, expect, it, vi } from "vitest";

function parseResolved(outcomes, prices) {
  if (!outcomes.length || !prices.length) return null;
  let max = -1;
  let maxIdx = -1;
  for (let i = 0; i < prices.length; i += 1) {
    const p = Number.parseFloat(prices[i]);
    if (p > max) {
      max = p;
      maxIdx = i;
    }
  }
  if (max < 0.95 || maxIdx < 0) return null;
  const outcome = outcomes[maxIdx];
  if (!outcome) return null;
  const val = String(outcome).toLowerCase() === "yes" ? 1 : 0;
  return { outcome, val, confidence: max };
}

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchObservedHighTemp: vi.fn(),
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
}));

vi.mock("../../src/weather/services/visual-crossing.js", () => ({
  fetchObservedHighTemp: mocks.fetchObservedHighTemp,
}));

const { runResolver } = await import("../../src/weather/services/resolver.js");

function makeEvent(outcomePrices, question = "Will Dallas highest temperature be between 78-79°F on March 25?") {
  return {
    closed: true,
    markets: [
      {
        question,
        closed: true,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(outcomePrices),
      },
    ],
  };
}

function makeDbApi(trades) {
  return {
    getUnresolvedTrades: vi.fn().mockResolvedValue(trades),
    updateTrade: vi.fn().mockResolvedValue(undefined),
    getCalibration: vi.fn().mockResolvedValue(null),
    upsertCalibration: vi.fn().mockResolvedValue(undefined),
  };
}

describe("weather resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchObservedHighTemp.mockResolvedValue(null);
  });

  it("parseResolved detects YES wins, NO wins, and unresolved markets", () => {
    expect(parseResolved(["Yes", "No"], ["0.97", "0.03"])).toEqual({
      outcome: "Yes",
      val: 1,
      confidence: 0.97,
    });
    expect(parseResolved(["Yes", "No"], ["0.04", "0.96"])).toEqual({
      outcome: "No",
      val: 0,
      confidence: 0.96,
    });
    expect(parseResolved(["Yes", "No"], ["0.5", "0.5"])).toBeNull();
  });

  it("calculates PnL for winning YES, losing YES, and winning NO trades", async () => {
    const tradeBase = {
      city: "Dallas",
      question: "Will Dallas highest temperature be between 78-79°F on March 25?",
      market_url: "https://polymarket.com/event/dallas-temp",
    };

    const yesWinDb = makeDbApi([
      {
        id: 1,
        ...tradeBase,
        side: "YES",
        entry_price: 0.4,
        stake_usd: 20,
        trading_mode: "paper",
        model_prob: 0.6,
      },
    ]);
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.97, 0.03]));
    await runResolver(yesWinDb);
    expect(yesWinDb.updateTrade).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ result: "WIN", pnl: 30 })
    );

    const yesLossDb = makeDbApi([
      { id: 2, ...tradeBase, side: "YES", entry_price: 0.4, stake_usd: 20, trading_mode: "paper", model_prob: 0.6 },
    ]);
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.04, 0.96]));
    await runResolver(yesLossDb);
    expect(yesLossDb.updateTrade).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ result: "LOSS", pnl: -20 })
    );

    const noWinDb = makeDbApi([
      { id: 3, ...tradeBase, side: "NO", entry_price: 0.3, stake_usd: 15, trading_mode: "paper", model_prob: 0.4 },
    ]);
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.04, 0.96]));
    await runResolver(noWinDb);
    expect(noWinDb.updateTrade).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ result: "WIN", pnl: 35 })
    );
  });

  it("resolves paper trades without an order_id", async () => {
    const dbApi = makeDbApi([
      {
        id: 1,
        city: "Dallas",
        question: "Will Dallas highest temperature be between 78-79°F on March 25?",
        market_url: "https://polymarket.com/event/dallas-temp",
        side: "YES",
        entry_price: 0.4,
        stake_usd: 20,
        trading_mode: "paper",
      },
    ]);
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.97, 0.03]));

    await expect(runResolver(dbApi)).resolves.toEqual({ resolved: 1 });
    expect(dbApi.updateTrade).toHaveBeenCalledTimes(1);
  });

  it("skips live trades without an order_id", async () => {
    const dbApi = makeDbApi([
      {
        id: 1,
        city: "Dallas",
        question: "Will Dallas highest temperature be between 78-79°F on March 25?",
        market_url: "https://polymarket.com/event/dallas-temp",
        side: "YES",
        entry_price: 0.4,
        stake_usd: 20,
        trading_mode: "live",
      },
    ]);
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.97, 0.03]));

    await expect(runResolver(dbApi)).resolves.toEqual({ resolved: 0 });
    expect(dbApi.updateTrade).not.toHaveBeenCalled();
  });

  it("enriches resolved temp_max trades with actual temperature and rolling calibration error", async () => {
    const dbApi = makeDbApi([
      {
        id: 4,
        city: "Dallas",
        question: "Will Dallas highest temperature be between 78-79°F on March 25?",
        market_url: "https://polymarket.com/event/dallas-temp",
        event_date: "2026-03-25",
        side: "YES",
        entry_price: 0.4,
        stake_usd: 20,
        trading_mode: "paper",
        model_prob: 0.6,
        forecast_temp: 26.67, // ~80°F in Celsius
      },
    ]);
    dbApi.getCalibration.mockResolvedValue({
      bias: 0.1,
      avg_error: 1.5,
      resolved_count: 10,
      sigma: 1.5,
    });
    mocks.fetchObservedHighTemp.mockResolvedValue({
      actualTemp: 78,
      unit: "F",
      fetchedAt: "2026-03-26T00:00:00.000Z",
    });
    mocks.fetchJson.mockResolvedValueOnce(makeEvent([0.97, 0.03]));

    await expect(runResolver(dbApi)).resolves.toEqual({ resolved: 1 });
    expect(mocks.fetchObservedHighTemp).toHaveBeenCalledWith("Dallas", "2026-03-25");
    // actual_temp stays in native unit (78°F), forecast_error is in °C (|26.67 - 25.56| ≈ 1.11)
    const updateCall = dbApi.updateTrade.mock.calls[0][1];
    expect(updateCall.result).toBe("WIN");
    expect(updateCall.actual_temp).toBe(78);
    expect(updateCall.forecast_error).toBeCloseTo(1.1133, 2);

    const [, , calibrationUpdate] = dbApi.upsertCalibration.mock.calls[0];
    expect(calibrationUpdate.bias).toBeCloseTo(0.13, 6);
    expect(calibrationUpdate.actual_temp).toBe(78);
    expect(calibrationUpdate.forecast_error).toBeCloseTo(1.1133, 2);
    expect(calibrationUpdate.last_actual_temp).toBe(78);
    expect(calibrationUpdate.resolved_count).toBe(11);
    // Rolling avg: (1.5 * 10 + 1.1133) / 11 ≈ 1.4648
    expect(calibrationUpdate.avg_error).toBeCloseTo(1.4648, 2);
    expect(calibrationUpdate.sigma).toBeCloseTo(1.4648, 2);
  });
});
