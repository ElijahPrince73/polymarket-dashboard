import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

const mockJson = vi.fn();
const mockText = vi.fn();

function makeResponse({ ok = true, status = 200, json = {}, text = "" } = {}) {
  mockJson.mockResolvedValueOnce(json);
  mockText.mockResolvedValueOnce(text);
  return {
    ok,
    status,
    json: mockJson,
    text: mockText,
  };
}

const { fetchObservedHighTemp } = await import("../../src/weather/services/visual-crossing.js");

describe("visual crossing client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VISUAL_CROSSING_API_KEY = "test-key";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.VISUAL_CROSSING_API_KEY;
  });

  it("parses observed daily high temperature for a configured city", async () => {
    global.fetch.mockResolvedValueOnce(
      makeResponse({
        json: { days: [{ tempmax: 81.2 }] },
      })
    );

    await expect(fetchObservedHighTemp("Dallas", "2026-03-25")).resolves.toEqual({
      actualTemp: 81.2,
      unit: "F",
      fetchedAt: expect.any(String),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/32.847%2C-96.852/2026-03-25"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns null when the API key is missing", async () => {
    delete process.env.VISUAL_CROSSING_API_KEY;

    await expect(fetchObservedHighTemp("Dallas", "2026-03-25")).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null on rate limiting and other API failures", async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ ok: false, status: 429, text: "rate limit" }));
    await expect(fetchObservedHighTemp("Dallas", "2026-03-25")).resolves.toBeNull();

    global.fetch.mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: "server error" }));
    await expect(fetchObservedHighTemp("Dallas", "2026-03-25")).resolves.toBeNull();
  });
});
