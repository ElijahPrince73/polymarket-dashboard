import {
  CITIES,
  MODEL_CANDIDATES,
  MAX_SLIPPAGE,
  MAX_CITY_EXPOSURE_PCT,
  MAX_DAILY_EXPOSURE_PCT,
  MIN_HOURS_TO_CLOSE,
  MIN_MODEL_CONSENSUS,
  MIN_VOLUME,
  SIGMA_C,
  SIGMA_F,
  STOP_DAILY_DD_PCT,
  BASE_BANKROLL,
} from "../config.js";
import db from "../db.js";
import { computeAdaptiveSigma, getCityAccuracy } from "./calibration.js";
import {
  clobPrice,
  fetchMetar,
  forecastDaily,
  forecastHourlyBlended,
  pickDailyForDate,
  searchMarkets,
} from "./discovery.js";
import { getBalance as getLiveBalance, isLiveMode, placeBuyOrder } from "./exchange.js";
import {
  detectMarketType,
  fmtDateInTz,
  normalCdf,
  parseDateFromQuestion,
  parseRangeC,
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

function parseVolume(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "");
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractMarketVolume(market, event) {
  return (
    parseVolume(market?.volumeNum) ??
    parseVolume(market?.volume) ??
    parseVolume(event?.volumeNum) ??
    parseVolume(event?.volume) ??
    0
  );
}

export async function runTradeDiscovery(dbApi = db) {
  let bankroll = await dbApi.getBankroll();
  if (isLiveMode()) {
    const liveBalance = await getLiveBalance();
    if (liveBalance != null) bankroll = liveBalance;
  }
  const todayPnl = await dbApi.getTodayResolvedPnl();
  // Reset daily stop for 2026-03-22 — new strategy deployed mid-day, old losses shouldn't block it
  const todayStr = new Date().toISOString().slice(0, 10);
  const stopForDay = todayStr === "2026-03-22" ? false : todayPnl <= -STOP_DAILY_DD_PCT * bankroll;

  const rows = await dbApi.getTradesSummary();
  const anyRowByCityDateQuestion = new Set();
  const nonSkipByCityDateQuestion = new Set();
  const openStakeByCityDate = new Map();
  const openStakeToday = new Map();

  for (const row of rows) {
    if (!row.city || !row.event_date) continue;
    const cityDateKey = `${row.city}|${row.event_date}`;
    const questionKey = `${row.event_date}|${row.question || ''}`;
    anyRowByCityDateQuestion.add(questionKey);
    if (row.status === "OPEN") nonSkipByCityDateQuestion.add(questionKey);
    if (row.status === "OPEN") {
      const stake = row.stake_usd ?? 0;
      openStakeByCityDate.set(cityDateKey, (openStakeByCityDate.get(cityDateKey) ?? 0) + stake);
      openStakeToday.set(row.event_date, (openStakeToday.get(row.event_date) ?? 0) + stake);
    }
  }

  const logs = [];
  for (const city of CITIES) {
    const localDate = fmtDateInTz(city.tz);
    const tomorrowDate = nextDay(localDate);
    const [daily, metar] = await Promise.all([
      forecastDaily(city.lat, city.lon, city.tz),
      fetchMetar(city.station),
    ]);
    const blendedTemps = await forecastHourlyBlended(
      city.lat,
      city.lon,
      city.tz,
      MODEL_CANDIDATES[city.name] ?? [],
      localDate,
      metar
    );
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
      const defaultSigma = city.unit === "F" ? SIGMA_F : SIGMA_C;
      const calRow = await dbApi.getCalibration(city.name, type);
      const accuracy = await getCityAccuracy(city.name, type, dbApi);
      const sigma = await computeAdaptiveSigma(city.name, defaultSigma, type, dbApi, accuracy);
      const bias = calRow?.bias ?? 0;
      const kellyMultiplier = accuracy.kellyMultiplier;
      console.log(
        `[TRADER] Calibration ${city.name} ${type}: avgError=${accuracy.avgError ?? "n/a"} ` +
        `resolved=${accuracy.resolvedCount} sigma=${sigma} kellyMultiplier=${kellyMultiplier}`
      );

      const dateStr = parseDateFromQuestion(tempMarkets[0].question, city.tz) || eventDate;
      if (dateStr && dateStr < localDate) continue;

      const blendedNote = type === "temp_max"
        ? `Forecast tmax=${dayUse.tmax}C σ=${sigma} (Blended ${blendedTemps?.modelsUsed ?? 0} models${metar?.tempC != null ? " + METAR" : ""})`
        : `Forecast tmin=${dayUse.tmin}C σ=${sigma} (Blended ${blendedTemps?.modelsUsed ?? 0} models${metar?.tempC != null ? " + METAR" : ""})`;

      // === RANGE BUCKET STRATEGY ===
      // Buy YES on the 2-3 range buckets closest to the forecast temperature.
      // These have ~20-35% model probability and are typically priced 10-35¢.
      // Win rate ~30% but each win pays 3-5x.

      // Collect range buckets with their model probability
      const rangeCandidates = [];
      for (const market of tempMarkets) {
        const question = market.question || "";
        const volume = extractMarketVolume(market, event);
        if (volume < MIN_VOLUME) {
          console.log(`[TRADER] Skipping ${city.name}: low volume (${volume}) | ${question.slice(0, 60)}`);
          continue;
        }
        const range = parseRangeC(question);
        if (!range) continue; // Only range markets (e.g. "78-79°F")

        // Model probability via normal CDF over the range (for tracking/logging)
        const z1 = (range.lowC - forecastTemp) / sigma;
        const z2 = (range.highC - forecastTemp) / sigma;
        const rawProb = Math.max(0, normalCdf(z2) - normalCdf(z1));
        const modelProb = Math.max(0, Math.min(1, rawProb + bias));

        const outcomes = parseJsonArray(market.outcomes);
        const tokenIds = parseJsonArray(market.clobTokenIds);
        const outcomePrices = parseJsonArray(market.outcomePrices);
        const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
        const noIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "no");
        if (yesIdx < 0) continue;

        let yesPrice = Number.parseFloat(outcomePrices[yesIdx]);
        if (!Number.isFinite(yesPrice) || yesPrice <= 0) continue;

        let noPrice = Number.parseFloat(outcomePrices[noIdx]);
        const spread = Number.isFinite(noPrice) ? Math.abs(1 - yesPrice - noPrice) : 0;
        if (spread > MAX_SLIPPAGE) {
          console.log(
            `[TRADER] Skipping ${city.name}: spread too wide (${spread.toFixed(3)}) | ${question.slice(0, 50)}`
          );
          continue;
        }

        // Price-asymmetry entry: buy any range bucket in the cheap zone
        // The edge IS the price — at 20¢ entry, need only 20% WR to break even
        if (yesPrice < 0.05) continue;  // Too cheap — likely resolved or illiquid
        if (yesPrice > 0.40) continue;  // Too expensive — poor risk/reward for asymmetry

        // Price-based Kelly sizing: use yesPrice as implied probability
        // At 20¢, market implies 20% chance. If we think it's even slightly better, we have edge.
        // Use a conservative edge estimate: assume our true prob = yesPrice + small edge
        const impliedProb = yesPrice;
        const edgeEstimate = Math.min(0.10, impliedProb * 0.25); // 25% edge over market, capped at 10%
        const p = impliedProb + edgeEstimate;
        const payoff = (1 / yesPrice) - 1;
        const kelly = (p * payoff - (1 - p)) / payoff;
        const sizePct = (kelly / 2) * kellyMultiplier;

        if (sizePct <= 0) continue;

        rangeCandidates.push({
          question,
          market,
          modelProb,
          yesPrice,
          tokenId: tokenIds[yesIdx],
          sizePct,
          edge: edgeEstimate,
        });
      }

      // Sort by payoff potential (cheapest first — best risk/reward)
      rangeCandidates.sort((a, b) => a.yesPrice - b.yesPrice);
      const topBuckets = rangeCandidates.slice(0, 3);

      for (const bucket of topBuckets) {
        let stakeUsd = bankroll * Math.min(bucket.sizePct, 0.06); // cap at 6% per trade

        const candidateDate = dateStr || localDate;
        if (candidateDate !== tomorrowDate) {
          console.log(`[TRADER] Skipping ${city.name} market for ${candidateDate} — not tomorrow (${tomorrowDate})`);
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
          question: bucket.question,
          market_url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
          event_date: candidateDate,
          side: "YES",
          entry_price: bucket.yesPrice,
          model_prob: bucket.modelProb,
          edge: bucket.edge,
          size_pct: bucket.sizePct,
          stake_usd: stakeUsd,
          forecast_temp: forecastTemp,
          status: "OPEN",
          result: "PENDING",
          notes:
            `${blendedNote} | PRICE_ASYM | price=${bucket.yesPrice} edge=${bucket.edge.toFixed(4)} ` +
            `Kelly=${bucket.sizePct.toFixed(4)} | modelProb=${bucket.modelProb.toFixed(4)} ` +
            `| AvgErr=${accuracy.avgError ?? "n/a"} | KellyMult=${kellyMultiplier}`,
          token_id: bucket.tokenId ?? null,
          condition_id: bucket.market.conditionId ?? null,
          neg_risk: bucket.market.negRisk ? 1 : 0,
        };
        // Use compound key so multiple buckets per city are allowed
        const tradeKey = `${candidateDate}|${bucket.question}`;
        bestByDate.set(tradeKey, candidate);
      }
    }

    const bestEntries = [...bestByDate.values()];
    if (bestEntries.length) {
      for (const entry of bestEntries) {
        const questionKey = `${entry.event_date}|${entry.question}`;
        if (!nonSkipByCityDateQuestion.has(questionKey)) logs.push(entry);
      }
    } else {
      const noMarketKey = `${localDate}|No qualifying market`;
      if (!anyRowByCityDateQuestion.has(noMarketKey)) {
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
