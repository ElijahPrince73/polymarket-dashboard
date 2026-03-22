import {
  BASE_BANKROLL,
  CITIES,
  MODEL_CANDIDATES,
  MAX_CITY_EXPOSURE_PCT,
  MAX_DAILY_EXPOSURE_PCT,
  MIN_HOURS_TO_CLOSE,
  MIN_MODEL_CONSENSUS,
  STOP_DAILY_DD_PCT,
} from "../config.js";
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
  MIN_BUCKET_PROB,
  normalCdf,
  parseDateFromQuestion,
  parseInequalityC,
  parseRangeC,
  parseThresholdC,
} from "../utils.js";

function nextDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseJsonArray(s) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}

function kellySize(modelProb, price) {
  // p = model probability of YES winning
  // payoff = (1/price) - 1 (what you gain per dollar risked if you win)
  // kelly = (p * payoff - (1-p)) / payoff
  const p = modelProb;
  const payoff = 1 / price - 1;
  const kelly = (p * payoff - (1 - p)) / payoff;
  return kelly / 2; // half-Kelly
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
    const tomorrowDate = nextDay(localDate);
    const [daily, blendedTemps] = await Promise.all([
      forecastDaily(city.lat, city.lon, city.tz),
      forecastHourlyBlended(city.lat, city.lon, city.tz, MODEL_CANDIDATES[city.name] ?? []),
    ]);
    const day = pickDailyForDate(daily.daily, localDate);
    if (!day && !blendedTemps) continue;

    // Check model consensus - require minimum number of models agreeing
    if (blendedTemps && blendedTemps.modelsUsed < MIN_MODEL_CONSENSUS) {
      console.log(`[TRADER] Skipping ${city.name}: only ${blendedTemps.modelsUsed} models, need ${MIN_MODEL_CONSENSUS}`);
      continue;
    }

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

      // Find the single bucket with highest model probability (the forecast bucket)
      let bestBucket = null;
      let bestProb = 0;
      for (const [question, prob] of bucketProbs.entries()) {
        if (prob > bestProb) {
          bestProb = prob;
          bestBucket = question;
        }
      }
      if (!bestBucket) continue;

      // Find the market object for the best bucket
      const market = tempMarkets.find((m) => m.question === bestBucket);
      if (!market) continue;

      const modelProb = applyCalibration(city.name, type, bestProb);

      const outcomes = parseJsonArray(market.outcomes);
      const tokenIds = parseJsonArray(market.clobTokenIds);
      const outcomePrices = parseJsonArray(market.outcomePrices);
      const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
      if (yesIdx < 0) continue;

      let yesPrice = Number.parseFloat(outcomePrices[yesIdx]);
      if (tokenIds[yesIdx]) {
        try { yesPrice = await clobPrice(tokenIds[yesIdx]); } catch {}
      }
      if (!Number.isFinite(yesPrice) || yesPrice <= 0) continue;

      // Half-Kelly sizing — if negative, Kelly says dont bet
      const sizePct = kellySize(modelProb, yesPrice);
      if (sizePct <= 0) {
        console.log(`[TRADER] Skipping ${city.name} ${bestBucket}: Kelly negative (model=${modelProb.toFixed(3)}, price=${yesPrice.toFixed(3)})`);
        continue;
      }

      const edge = modelProb - yesPrice;
      let stakeUsd = bankroll * Math.min(sizePct, 0.08); // cap at 8% of bankroll per trade

      const candidateDate = dateStr || localDate;
      if (candidateDate > tomorrowDate) {
        console.log(`[TRADER] Skipping ${city.name} market for ${candidateDate} — beyond tomorrow (${tomorrowDate})`);
        continue;
      }
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
        question: bestBucket,
        market_url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
        event_date: candidateDate,
        side: "YES",
        entry_price: yesPrice,
        model_prob: modelProb,
        edge,
        size_pct: sizePct,
        stake_usd: stakeUsd,
        status: "OPEN",
        result: "PENDING",
        notes: `${blendedNote} | FORECAST_BUCKET | Kelly=${sizePct.toFixed(4)}`,
        token_id: tokenIds[yesIdx] ?? null,
        condition_id: market.conditionId ?? null,
        neg_risk: market.negRisk ? 1 : 0,
      };
      const currentBest = bestByDate.get(candidateDate);
      if (!currentBest || candidate.edge > currentBest.edge) bestByDate.set(candidateDate, candidate);
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
