/**
 * Weather bot database layer — Supabase (PostgreSQL).
 * Drop-in replacement for the SQLite version. All methods are now async.
 */
import { createClient } from "@supabase/supabase-js";
import { BASE_BANKROLL } from "./config.js";
import { getBalance as getLiveBalance, isLiveMode } from "./services/exchange.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(supabaseUrl, supabaseKey);

function getTradingMode() {
  return isLiveMode() ? "live" : "paper";
}

// ── Trades ─────────────────────────────────────────────────────────────────

export async function insertTrade(trade) {
  const row = {
    city: trade.city ?? null,
    station: trade.station ?? null,
    question: trade.question ?? null,
    market_url: trade.market_url ?? null,
    event_date: trade.event_date ?? null,
    side: trade.side ?? null,
    entry_price: trade.entry_price ?? null,
    model_prob: trade.model_prob ?? null,
    edge: trade.edge ?? null,
    size_pct: trade.size_pct ?? null,
    stake_usd: trade.stake_usd ?? null,
    status: trade.status ?? "SKIP",
    result: trade.result ?? "PENDING",
    pnl: trade.pnl ?? null,
    notes: trade.notes ?? null,
    token_id: trade.token_id ?? null,
    order_id: trade.order_id ?? null,
    fill_size: trade.fill_size ?? null,
    condition_id: trade.condition_id ?? null,
    neg_risk: trade.neg_risk ?? 0,
    trading_mode: getTradingMode(),
    resolved_at: trade.resolved_at ?? null,
  };
  const { data, error } = await supabase.from("weather_trades").insert(row).select().single();
  if (error) throw new Error(`insertTrade failed: ${error.message}`);
  return data;
}

const UPDATABLE_COLUMNS = new Set([
  "city", "station", "question", "market_url", "event_date", "side",
  "entry_price", "model_prob", "edge", "size_pct", "stake_usd",
  "status", "result", "pnl", "notes", "token_id", "order_id",
  "fill_size", "condition_id", "neg_risk", "trading_mode", "resolved_at",
]);

export async function updateTrade(id, updates) {
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([key]) => UPDATABLE_COLUMNS.has(key))
  );
  if (!Object.keys(filtered).length) return;
  const { error } = await supabase.from("weather_trades").update(filtered).eq("id", id);
  if (error) throw new Error(`updateTrade failed: ${error.message}`);
}

export async function getOpenTrades() {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .eq("status", "OPEN")
    .eq("trading_mode", getTradingMode())
    .order("id", { ascending: false });
  if (error) throw new Error(`getOpenTrades failed: ${error.message}`);
  return data ?? [];
}

export async function getUnresolvedTrades() {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .in("status", ["OPEN", "STOP", "SWITCHED"])
    .or("result.is.null,result.eq.PENDING")
    .eq("trading_mode", getTradingMode())
    .order("id", { ascending: false });
  if (error) throw new Error(`getUnresolvedTrades failed: ${error.message}`);
  return data ?? [];
}

export async function getTradesSummary() {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("city,event_date,status,stake_usd,question")
    .eq("trading_mode", getTradingMode());
  if (error) throw new Error(`getTradesSummary failed: ${error.message}`);
  return data ?? [];
}

export async function getResolvedTradesSince(sinceDate) {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .in("result", ["WIN", "LOSS"])
    .not("resolved_at", "is", null)
    .gte("resolved_at", sinceDate)
    .eq("trading_mode", getTradingMode())
    .order("resolved_at", { ascending: false });
  if (error) throw new Error(`getResolvedTradesSince failed: ${error.message}`);
  return data ?? [];
}

export async function getTodayResolvedTrades(todayIso = new Date().toISOString().slice(0, 10)) {
  const dayStart = `${todayIso}T00:00:00Z`;
  const nextDayIso = new Date(`${todayIso}T00:00:00Z`);
  nextDayIso.setUTCDate(nextDayIso.getUTCDate() + 1);
  const dayEnd = nextDayIso.toISOString();

  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .in("result", ["WIN", "LOSS"])
    .not("resolved_at", "is", null)
    .gte("resolved_at", dayStart)
    .lt("resolved_at", dayEnd)
    .eq("trading_mode", getTradingMode())
    .order("resolved_at", { ascending: false });
  if (error) throw new Error(`getTodayResolvedTrades failed: ${error.message}`);
  return data ?? [];
}

export async function getTradesByCityDate(city, date) {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .eq("city", city)
    .eq("event_date", date)
    .eq("trading_mode", getTradingMode())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getTradesByCityDate failed: ${error.message}`);
  return data ?? [];
}

export async function getTodayResolvedPnl(todayIso = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("pnl")
    .in("result", ["WIN", "LOSS"])
    .not("resolved_at", "is", null)
    .gte("resolved_at", `${todayIso}T00:00:00Z`)
    .lt("resolved_at", `${todayIso}T23:59:59Z`)
    .eq("trading_mode", getTradingMode());
  if (error) throw new Error(`getTodayResolvedPnl failed: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + (r.pnl ?? 0), 0);
}

export async function getAllResolved() {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .in("result", ["WIN", "LOSS"])
    .eq("trading_mode", getTradingMode())
    .order("resolved_at", { ascending: false });
  if (error) throw new Error(`getAllResolved failed: ${error.message}`);
  return data ?? [];
}

export async function getAllTrades(status = null) {
  let query = supabase
    .from("weather_trades")
    .select("*")
    .eq("trading_mode", getTradingMode())
    .order("id", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`getAllTrades failed: ${error.message}`);
  return data ?? [];
}

export async function getTradeById(id) {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function markOpenTradesAsSkip() {
  const { data, error } = await supabase
    .from("weather_trades")
    .update({ status: "SKIP", notes: `KILL switch ${new Date().toISOString()}` })
    .eq("status", "OPEN")
    .select();
  if (error) throw new Error(`markOpenTradesAsSkip failed: ${error.message}`);
  return data?.length ?? 0;
}

// ── Bankroll ───────────────────────────────────────────────────────────────

async function getPaperBankroll() {
  const { data, error } = await supabase
    .from("weather_trades")
    .select("pnl")
    .in("result", ["WIN", "LOSS"])
    .eq("trading_mode", "paper");
  if (error) throw new Error(`getPaperBankroll failed: ${error.message}`);
  const realizedPnl = (data ?? []).reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  return BASE_BANKROLL + realizedPnl;
}

export async function getBankroll() {
  if (isLiveMode()) {
    const liveBalance = await getLiveBalance();
    if (liveBalance != null) return liveBalance;
  }
  return getPaperBankroll();
}

// ── Calibration ────────────────────────────────────────────────────────────

export async function getCalibration(city, marketType) {
  const { data, error } = await supabase
    .from("weather_calibration")
    .select("*")
    .eq("city", city)
    .eq("market_type", marketType)
    .single();
  if (error) return null;
  return data;
}

export async function upsertCalibration(
  city,
  marketType,
  bias,
  updatedAt = new Date().toISOString(),
  sigma = undefined
) {
  const row = { city, market_type: marketType, bias, updated_at: updatedAt };
  if (sigma !== undefined) row.sigma = sigma;
  const { error } = await supabase
    .from("weather_calibration")
    .upsert(row, { onConflict: "city,market_type" });
  if (error) throw new Error(`upsertCalibration failed: ${error.message}`);
}

// ── Default export (same shape as before) ──────────────────────────────────

const db = {
  insertTrade,
  updateTrade,
  getOpenTrades,
  getUnresolvedTrades,
  getTradesSummary,
  getResolvedTradesSince,
  getTodayResolvedTrades,
  getTradesByCityDate,
  getTodayResolvedPnl,
  getBankroll,
  getAllResolved,
  getAllTrades,
  getTradeById,
  markOpenTradesAsSkip,
  getCalibration,
  upsertCalibration,
};

export default db;
