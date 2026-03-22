import db from "../db.js";
import { fetchJson } from "../utils.js";
import { clobPrice } from "./discovery.js";
import { isLiveMode, placeBuyOrder, placeSellOrder } from "./exchange.js";

function extractEventSlug(url) {
  const m = String(url || "").match(/polymarket\.com\/event\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function parseJsonArray(s) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}

export async function runMonitor(dbApi = db) {
  let updated = 0;
  let switched = 0;
  const openTrades = await dbApi.getOpenTrades();

  for (const row of openTrades) {
    const slug = extractEventSlug(row.market_url);
    if (!slug || !row.question || !row.side || row.model_prob == null) continue;

    const event = await fetchJson(`https://gamma-api.polymarket.com/events/slug/${slug}`);
    const market =
      event?.markets?.find((m) => String(m.question || "").trim() === String(row.question).trim()) ??
      event?.markets?.[0];
    if (!market) continue;

    const outcomes = parseJsonArray(market.outcomes);
    const tokenIds = parseJsonArray(market.clobTokenIds);
    const outcomePrices = parseJsonArray(market.outcomePrices);
    const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
    const noIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "no");
    if (yesIdx < 0 || noIdx < 0) continue;

    let yesPrice = Number.parseFloat(outcomePrices[yesIdx]);
    let noPrice = Number.parseFloat(outcomePrices[noIdx]);
    if (tokenIds[yesIdx]) {
      try {
        yesPrice = await clobPrice(tokenIds[yesIdx]);
      } catch {}
    }
    if (tokenIds[noIdx]) {
      try {
        noPrice = await clobPrice(tokenIds[noIdx]);
      } catch {}
    }
    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;

    const edgeYes = row.model_prob - yesPrice;
    const edgeNo = 1 - row.model_prob - noPrice;
    const edgeExisting = row.side === "YES" ? edgeYes : edgeNo;
    const edgeOpp = row.side === "YES" ? edgeNo : edgeYes;
    const oppSide = row.side === "YES" ? "NO" : "YES";
    const oppPrice = row.side === "YES" ? noPrice : yesPrice;

    if (edgeExisting < -0.05 && edgeOpp >= 0.05) {
      const currentPrice = row.side === "YES" ? yesPrice : noPrice;
      let switchNote = `Switched from ${row.side} to ${oppSide} at ${new Date().toISOString()}`;

      if (isLiveMode() && row.token_id && Number(row.fill_size) > 0) {
        const sellResult = await placeSellOrder(row.token_id, currentPrice, Number(row.fill_size));
        if (!sellResult.success) {
          console.error(`[MONITOR] Switch sell failed for ${row.city}: ${sellResult.error}`);
          continue;
        }
        switchNote += ` | LIVE sell ${sellResult.orderId}`;
      }

      await dbApi.updateTrade(row.id, {
        status: "SWITCHED",
        notes: switchNote,
      });

      const oppTokenId = row.side === "YES" ? tokenIds[noIdx] : tokenIds[yesIdx];
      const newStake = row.stake_usd || 0;

      if (newStake > 0 && oppTokenId) {
        const newTrade = {
          city: row.city,
          station: row.station,
          question: row.question,
          market_url: row.market_url,
          event_date: row.event_date,
          side: oppSide,
          entry_price: oppPrice,
          model_prob: row.model_prob,
          edge: edgeOpp,
          size_pct: row.size_pct,
          stake_usd: newStake,
          status: "OPEN",
          result: "PENDING",
          notes: `Switched from ${row.side} | original trade #${row.id}`,
          token_id: oppTokenId,
          condition_id: row.condition_id,
          neg_risk: row.neg_risk,
        };

        const inserted = await dbApi.insertTrade(newTrade);

        if (isLiveMode()) {
          const buyResult = await placeBuyOrder(oppTokenId, oppPrice, newStake);
          if (buyResult.success) {
            await dbApi.updateTrade(inserted.id, {
              order_id: buyResult.orderId,
              fill_size: buyResult.size,
              notes: `${newTrade.notes} | LIVE order ${buyResult.orderId}`,
            });
            console.log(`[MONITOR] Switched ${row.city} ${row.side} -> ${oppSide} @ ${oppPrice} | order ${buyResult.orderId}`);
          } else {
            await dbApi.updateTrade(inserted.id, {
              status: "SKIP",
              notes: `${newTrade.notes} | LIVE order FAILED: ${buyResult.error}`,
            });
            console.error(`[MONITOR] Switch buy failed for ${row.city}: ${buyResult.error}`);
          }
        }
      }

      updated += 1;
      switched += 1;
      continue;
    }

    if (row.entry_price != null) {
      const current = row.side === "YES" ? yesPrice : noPrice;
      if (current <= row.entry_price * 0.8) {
        let stopNote = `Stop-loss hit at ${current} (entry ${row.entry_price})`;
        if (isLiveMode() && row.token_id && Number(row.fill_size) > 0) {
          const sellResult = await placeSellOrder(row.token_id, current, Number(row.fill_size));
          if (!sellResult.success) {
            console.error(`[MONITOR] Stop-loss sell failed for ${row.city}: ${sellResult.error}`);
            continue;
          }
          stopNote += ` | LIVE sell ${sellResult.orderId}`;
        }
        await dbApi.updateTrade(row.id, {
          status: "STOP",
          notes: stopNote,
        });
        updated += 1;
        continue;
      }
    }
  }
  return { updated, switched };
}
