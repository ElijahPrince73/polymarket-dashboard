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
  normalCdf,
  parseDateFromQuestion,
  parseInequalityC,
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

      // === NO-ON-TAILS STRATEGY ===
      // Bet NO on tail inequality markets where model strongly disagrees
      // e.g. forecast 81°F, market "73°F or below" priced at 15¢ YES
      // → buy NO at 85¢, win $0.15 when tail doesnt happen (94% of the time)
      for (const market of tempMarkets) {
        const question = market.question || "";

        const ineq = parseInequalityC(question);
        if (!ineq) continue;

        // Model probability that YES wins (the tail event happens)
        const z = (ineq.valueC - forecastTemp) / FORECAST_SIGMA;
        const yesProbRaw = ineq.op === "le" ? normalCdf(z) : 1 - normalCdf(z);
        const yesProb = applyCalibration(city.name, type, yesProbRaw);

        // We want to bet NO, so our win probability is 1 - yesProb
        const noModelProb = 1 - yesProb;

        // Only bet when model is very confident the tail wont happen (>85%)
        if (noModelProb < 0.85) continue;

        const outcomes = parseJsonArray(market.outcomes);
        const tokenIds = parseJsonArray(market.clobTokenIds);
        const outcomePrices = parseJsonArray(market.outcomePrices);
        const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
        const noIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "no");
        if (yesIdx < 0 || noIdx < 0) continue;

        // Get NO price from CLOB
        let noPrice = Number.parseFloat(outcomePrices[noIdx]);
        if (tokenIds[noIdx]) {
          try { noPrice = await clobPrice(tokenIds[noIdx]); } catch {}
        }
        if (!Number.isFinite(noPrice) || noPrice <= 0) continue;

        // Skip if NO is too expensive (>97¢ — tiny payoff not worth the risk)
        if (noPrice > 0.97) continue;
        // Skip if NO is too cheap (<50¢ — market thinks tail is likely, dont fight it)
        if (noPrice < 0.50) continue;

        // Half-Kelly for NO side
        const p = noModelProb;
        const payoff = (1 / noPrice) - 1;
        const kelly = (p * payoff - (1 - p)) / payoff;
        const sizePct = kelly / 2;

        if (sizePct <= 0) {
          console.log(`[TRADER] Skipping ${city.name}: Kelly negative for NO (noProb=${noModelProb.toFixed(3)}, noPrice=${noPrice.toFixed(3)}) | ${question.slice(0,50)}`);
          continue;
        }

        const edge = noModelProb - noPrice;
        let stakeUsd = bankroll * Math.min(sizePct, 0.08);

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
          question,
          market_url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
          event_date: candidateDate,
          side: "NO",
          entry_price: noPrice,
          model_prob: noModelProb,
          edge,
          size_pct: sizePct,
          stake_usd: stakeUsd,
          status: "OPEN",
          result: "PENDING",
          notes: `${blendedNote} | NO_ON_TAIL | yesProb=${yesProb.toFixed(4)} | Kelly=${sizePct.toFixed(4)}`,
          token_id: tokenIds[noIdx] ?? null,
          condition_id: market.conditionId ?? null,
          neg_risk: market.negRisk ? 1 : 0,
        };
        // Keep ALL qualifying trades per city+date (both tail ends can qualify)
        // Use a compound key: city|date|question to allow multiple trades
        const tradeKey = `${candidateDate}|${question}`;
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
