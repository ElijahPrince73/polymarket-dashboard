import {
  BASE_BANKROLL,
  CITIES,
  MODEL_CANDIDATES,
  MAX_CITY_EXPOSURE_PCT,
  MAX_DAILY_EXPOSURE_PCT,
  MAX_PRICE,
  MIN_ABS_MODEL_DIFF,
  MIN_EDGE,
  MIN_HOURS_TO_CLOSE,
  MIN_PRICE,
  STOP_DAILY_DD_PCT,
} from "../config.js";
import { getCityThresholds, getCityFilters } from "../city-specific-thresholds.js";
import db from "../db.js";
import {
  applyCalibration,
  clobPrice,
  forecastDaily,
  forecastHourlyBlended,
  pickDailyForDate,
  searchMarkets,
} from "./discovery.js";
import { getBalance as getLiveBalance, isLiveMode, placeBuyOrder } from "./exchange.js";
import {
  detectMarketType,
  fmtDateInTz,
  FORECAST_SIGMA,
  isTemperatureQuestion,
  MIN_BUCKET_PROB,
  normalCdf,
  parseDateFromQuestion,
  parseInequalityC,
  parseRangeC,
  parseThresholdC,
  probTempEquals,
} from "../utils.js";

function parseJsonArray(s) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}

function kellySize(modelProb, entryPrice, side) {
  const p = side === "YES" ? modelProb : 1 - modelProb;
  const payoff = 1 / entryPrice - 1;
  const kelly = (p * payoff - (1 - p)) / payoff;
  const halfKelly = kelly / 2;
  return Math.max(0.01, Math.min(0.04, halfKelly));
}

/**
 * Compute model probabilities for ALL buckets in a neg-risk grouped event,
 * then normalize so they sum to 1. This gives proper multinomial probabilities
 * instead of evaluating each bucket independently with a continuous CDF.
 *
 * Returns a Map of question → modelProb (normalized).
 */
function computeEventBucketProbs(markets, forecastTemp, sigma) {
  const bucketProbs = [];

  for (const market of markets) {
    if (!market.question || !market.active) continue;
    const question = market.question;
    const range = parseRangeC(question);
    const ineq = parseInequalityC(question);
    const thr = parseThresholdC(question);

    let rawProb = 0;
    if (range) {
      const z1 = (range.lowC - forecastTemp) / sigma;
      const z2 = (range.highC - forecastTemp) / sigma;
      rawProb = Math.max(0, normalCdf(z2) - normalCdf(z1));
    } else if (ineq) {
      const z = (ineq.valueC - forecastTemp) / sigma;
      rawProb = ineq.op === "le" ? normalCdf(z) : 1 - normalCdf(z);
    } else if (thr) {
      const z1 = ((thr.valueC - 0.5) - forecastTemp) / sigma;
      const z2 = ((thr.valueC + 0.5) - forecastTemp) / sigma;
      rawProb = Math.max(0, normalCdf(z2) - normalCdf(z1));
    } else {
      continue;
    }
    bucketProbs.push({ question, rawProb });
  }

  // Normalize so all buckets sum to 1
  const total = bucketProbs.reduce((s, b) => s + b.rawProb, 0);
  const result = new Map();
  if (total > 0) {
    for (const b of bucketProbs) {
      const normalized = Math.max(MIN_BUCKET_PROB, b.rawProb / total);
      result.set(b.question, normalized);
    }
  }
  return result;
}

export async function runTradeDiscovery(dbApi = db) {
  let bankroll = await dbApi.getBankroll();
  if (isLiveMode()) {
    const liveBalance = await getLiveBalance();
    if (liveBalance != null) bankroll = liveBalance;
  }
  const todayPnl = await dbApi.getTodayResolvedPnl();
  const stopForDay = todayPnl <= -STOP_DAILY_DD_PCT * bankroll;

  const rows = await dbApi.getTradesSummary();
  const anyRowByCityDate = new Set();
  const nonSkipByCityDate = new Set();
  const openStakeByCityDate = new Map();
  const openStakeToday = new Map();

  for (const row of rows) {
    if (!row.city || !row.event_date) continue;
    const key = `${row.city}|${row.event_date}`;
    anyRowByCityDate.add(key);
    if (row.status && row.status !== "SKIP") nonSkipByCityDate.add(key);
    if (row.status === "OPEN") {
      const stake = row.stake_usd ?? 0;
      openStakeByCityDate.set(key, (openStakeByCityDate.get(key) ?? 0) + stake);
      openStakeToday.set(row.event_date, (openStakeToday.get(row.event_date) ?? 0) + stake);
    }
  }

  const logs = [];
  for (const city of CITIES) {
    const localDate = fmtDateInTz(city.tz);
    const [daily, blendedTemps] = await Promise.all([
      forecastDaily(city.lat, city.lon, city.tz),
      forecastHourlyBlended(city.lat, city.lon, city.tz, MODEL_CANDIDATES[city.name] ?? []),
    ]);
    const day = pickDailyForDate(daily.daily, localDate);
    if (!day && !blendedTemps) continue;

    const dayUse = {
      tmax: blendedTemps?.tmax ?? day?.tmax,
      tmin: blendedTemps?.tmin ?? day?.tmin,
      windMax: day?.windMax ?? null,
      precip: day?.precip ?? null,
      precipProb: day?.precipProb ?? null,
    };

    const events = await searchMarkets(city.aliases);
    const bestByDate = new Map();
    for (const event of events) {
      if (event.closed || !Array.isArray(event.markets)) continue;
      const eventDate = event.endDate ? event.endDate.slice(0, 10) : null;

      if (event.endDate) {
        const hrs = (new Date(event.endDate).getTime() - Date.now()) / 36e5;
        if (Number.isFinite(hrs) && hrs >= 0 && hrs < MIN_HOURS_TO_CLOSE) continue;
      }

      // Filter to temperature markets for this city
      const tempMarkets = event.markets.filter((m) => {
        if (m.closed || !m.active) return false;
        const q = (m.question || "").toLowerCase();
        const aliasMatch = city.aliases.some((a) => q.includes(a.toLowerCase()));
        if (!aliasMatch) return false;
        const type = detectMarketType(m.question);
        return type === "temp_max" || type === "temp_min";
      });
      if (!tempMarkets.length) continue;

      // Determine type and forecast temp for this event
      const type = detectMarketType(tempMarkets[0].question);
      const forecastTemp = type === "temp_max" ? dayUse.tmax : dayUse.tmin;
      if (forecastTemp == null) continue;

      const dateStr = parseDateFromQuestion(tempMarkets[0].question, city.tz) || eventDate;
      if (dateStr && dateStr < localDate) continue;

      const blendedNote = type === "temp_max"
        ? `Forecast tmax=${dayUse.tmax}C σ=${FORECAST_SIGMA} (Blended ${blendedTemps?.modelsUsed ?? 0} models)`
        : `Forecast tmin=${dayUse.tmin}C σ=${FORECAST_SIGMA} (Blended ${blendedTemps?.modelsUsed ?? 0} models)`;

      // Compute normalized bucket probabilities across ALL markets in this event
      const bucketProbs = computeEventBucketProbs(tempMarkets, forecastTemp, FORECAST_SIGMA);

      // Strategy: find the bucket that CONTAINS the forecast temperature and buy YES
      // if the market underprices it. This gives better payoff asymmetry:
      // buying YES at $0.15 that resolves to $1.00 = 567% return
      // vs buying NO at $0.60 that resolves to $1.00 = 67% return
      //
      // Also consider adjacent buckets (±1 range from forecast).
      // Only take NO bets on extreme mispricings (>25% edge).

      // Find which bucket actually contains the forecast temperature
      const forecastBuckets = new Set();
      for (const market of tempMarkets) {
        const q = market.question || "";
        const range = parseRangeC(q);
        const ineq = parseInequalityC(q);
        const thr = parseThresholdC(q);
        let contains = false;
        if (range) {
          // Range: check if forecast falls within lowC..highC (with 1°C buffer for adjacent)
          contains = forecastTemp >= (range.lowC - 1.5) && forecastTemp <= (range.highC + 1.5);
        } else if (ineq) {
          // Inequality: forecast bucket if forecast is near the boundary
          const dist = Math.abs(forecastTemp - ineq.valueC);
          contains = dist <= 2.0;
        } else if (thr) {
          // Exact temp: forecast bucket if within ±1.5°C
          contains = Math.abs(forecastTemp - thr.valueC) <= 1.5;
        }
        if (contains) forecastBuckets.add(q);
      }
      // If no bucket matched (shouldn't happen), fall back to top 3 by model prob
      if (forecastBuckets.size === 0) {
        const sorted = [...bucketProbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        for (const [q] of sorted) forecastBuckets.add(q);
      }

      for (const market of tempMarkets) {
        const question = market.question || "";
        let modelProb = bucketProbs.get(question);
        if (modelProb == null) continue;

        modelProb = applyCalibration(city.name, type, modelProb);

        const outcomes = parseJsonArray(market.outcomes);
        const tokenIds = parseJsonArray(market.clobTokenIds);
        const outcomePrices = parseJsonArray(market.outcomePrices);
        const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
        const noIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "no");
        if (yesIdx < 0 || noIdx < 0) continue;

        let yesPrice = Number.parseFloat(outcomePrices[yesIdx]);
        let noPrice = Number.parseFloat(outcomePrices[noIdx]);
        if (tokenIds[yesIdx]) {
          try { yesPrice = await clobPrice(tokenIds[yesIdx]); } catch {}
        }
        if (tokenIds[noIdx]) {
          try { noPrice = await clobPrice(tokenIds[noIdx]); } catch {}
        }
        if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;

        const edgeYes = modelProb - yesPrice;
        const edgeNo = 1 - modelProb - noPrice;

        // Determine side based on strategy:
        // - For forecast-aligned buckets (top 3): strongly prefer YES
        // - For other buckets: only take NO if edge is very large (>25%)
        let side, price, edge, tokenId;
        const isForecastBucket = forecastBuckets.has(question);

        // Get city-specific thresholds
        const cityThresholds = getCityThresholds(city.name);
        const cityFilters = getCityFilters(city.name);
        
        // Apply city-specific minimum edge requirement
        const requiredEdgeYes = Math.max(MIN_EDGE, cityThresholds.minEdge);
        const requiredEdgeNo = Math.max(0.25, cityThresholds.minEdge + 0.10); // NO trades need higher edge
        
        if (isForecastBucket && edgeYes >= requiredEdgeYes) {
          // Buy YES on forecast-aligned bucket — the core strategy
          side = "YES";
          price = yesPrice;
          edge = edgeYes;
          tokenId = tokenIds[yesIdx];
        } else if (!isForecastBucket && edgeNo >= requiredEdgeNo) {
          // Sell (buy NO) on far-from-forecast buckets only with huge edge
          side = "NO";
          price = noPrice;
          edge = edgeNo;
          tokenId = tokenIds[noIdx];
        } else {
          continue; // Skip — no clear edge
        }

        const marketProbYes = yesPrice;
        if (marketProbYes < MIN_PRICE || marketProbYes > cityThresholds.maxPrice) continue;
        
        // Apply city-specific model difference requirement
        const requiredModelDiff = Math.max(MIN_ABS_MODEL_DIFF, cityThresholds.minModelDiff);
        if (Math.abs(modelProb - marketProbYes) < requiredModelDiff) continue;
        
        // City-specific additional filters
        if (cityFilters.requireMinModels && forecast?.modelsUsed < cityFilters.requireMinModels) {
          console.log(`[TRADER] Skipping ${city.name}: only ${forecast?.modelsUsed} models, need ${cityFilters.requireMinModels}`);
          continue;
        }
        
        if (cityFilters.requirePriceDiscrepancy && Math.abs(modelProb - marketProbYes) < cityFilters.requirePriceDiscrepancy) {
          console.log(`[TRADER] Skipping ${city.name}: price discrepancy ${Math.abs(modelProb - marketProbYes).toFixed(3)} below required ${cityFilters.requirePriceDiscrepancy}`);
          continue;
        }

        const sizePct = kellySize(modelProb, price, side);
        let stakeUsd = bankroll * sizePct;
        
        // Apply city-specific position sizing
        if (cityFilters.sizingMultiplier) {
          stakeUsd *= cityFilters.sizingMultiplier;
          console.log(`[TRADER] Reducing ${city.name} position by ${((1-cityFilters.sizingMultiplier)*100).toFixed(0)}% due to poor performance`);
        }
        const candidateDate = dateStr || localDate;
        const cityDateKey = `${city.name}|${candidateDate}`;
        const dailyCap = bankroll * MAX_DAILY_EXPOSURE_PCT;
        const cityCap = bankroll * MAX_CITY_EXPOSURE_PCT;
        const remainingDaily = Math.max(0, dailyCap - (openStakeToday.get(candidateDate) ?? 0));
        const remainingCity = Math.max(0, cityCap - (openStakeByCityDate.get(cityDateKey) ?? 0));
        stakeUsd = Math.max(0, Math.min(stakeUsd, remainingDaily, remainingCity));

        if (stopForDay || stakeUsd <= 0.0001) continue;

        const candidate = {
          city: city.name,
          station: city.station,
          question,
          market_url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
          event_date: candidateDate,
          side,
          entry_price: price,
          model_prob: modelProb,
          edge,
          size_pct: sizePct,
          stake_usd: stakeUsd,
          status: "OPEN",
          result: "PENDING",
          notes: `${blendedNote} | ${isForecastBucket ? "FORECAST_BUCKET" : "FAR_BUCKET"}`,
          token_id: tokenId ?? null,
          condition_id: market.conditionId ?? null,
          neg_risk: market.negRisk ? 1 : 0,
        };
        const currentBest = bestByDate.get(candidateDate);
        if (!currentBest || candidate.edge > currentBest.edge) bestByDate.set(candidateDate, candidate);
      }
    }

    const bestEntries = [...bestByDate.values()];
    if (bestEntries.length) {
      for (const entry of bestEntries) {
        const key = `${entry.city}|${entry.event_date}`;
        if (!nonSkipByCityDate.has(key)) logs.push(entry);
      }
    } else {
      const key = `${city.name}|${localDate}`;
      if (!anyRowByCityDate.has(key)) {
        logs.push({
          city: city.name,
          station: city.station,
          question: "No qualifying market",
          market_url: null,
          event_date: localDate,
          status: "SKIP",
          result: "PENDING",
          notes: "No qualifying temperature market met filters",
        });
      }
    }
  }

  for (const candidate of logs) {
    const insertResult = await dbApi.insertTrade(candidate);
    if (isLiveMode() && candidate.status === "OPEN" && candidate.token_id) {
      const result = await placeBuyOrder(candidate.token_id, candidate.entry_price, candidate.stake_usd);
      if (result.success) {
        await dbApi.updateTrade(insertResult.id, {
          order_id: result.orderId,
          fill_size: result.size,
          notes: `${candidate.notes ?? ""} | LIVE order ${result.orderId}`,
        });
        console.log(
          `[LIVE] Placed BUY order ${result.orderId} for ${candidate.city} ${candidate.side} @ ${candidate.entry_price}`
        );
      } else {
        await dbApi.updateTrade(insertResult.id, {
          status: "SKIP",
          notes: `${candidate.notes ?? ""} | LIVE order FAILED: ${result.error}`,
        });
        console.error(`[LIVE] Order failed for ${candidate.city}: ${result.error}`);
      }
    }
  }
  return { openedOrLogged: logs.length, stopForDay, bankroll: bankroll || BASE_BANKROLL };
}
