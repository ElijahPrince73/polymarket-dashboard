import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('packages/server/scripts/backups');
fs.mkdirSync(backupDir, { recursive: true });

const dryRun = process.argv.includes('--dry-run');

async function dumpTable(table, outPath) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  return rows.length;
}

async function wipeTable(table) {
  // Delete everything in the table. Supabase requires a filter; use a clause
  // that matches any real row (id >= 0 works for numeric PK tables).
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .gte('id', 0);
  if (error) throw new Error(`${table} delete: ${error.message}`);
  return count ?? 0;
}

async function wipeCalibration() {
  // weather_calibration is keyed by (city, market_type), not a numeric id.
  const { error, count } = await supabase
    .from('weather_calibration')
    .delete({ count: 'exact' })
    .not('city', 'is', null);
  if (error) throw new Error(`weather_calibration delete: ${error.message}`);
  return count ?? 0;
}

console.log(`Backup dir: ${backupDir}`);
const tradesFile = path.join(backupDir, `weather_trades_${ts}.json`);
const calibFile = path.join(backupDir, `weather_calibration_${ts}.json`);

console.log('Dumping weather_trades...');
const tradeCount = await dumpTable('weather_trades', tradesFile);
console.log(`  wrote ${tradeCount} rows → ${tradesFile}`);

console.log('Dumping weather_calibration...');
const calibCount = await dumpTable('weather_calibration', calibFile);
console.log(`  wrote ${calibCount} rows → ${calibFile}`);

if (dryRun) {
  console.log('\n--dry-run: skipping deletes.');
  process.exit(0);
}

console.log('\nDeleting weather_trades...');
const delTrades = await wipeTable('weather_trades');
console.log(`  deleted ${delTrades} rows`);

console.log('Deleting weather_calibration...');
const delCalib = await wipeCalibration();
console.log(`  deleted ${delCalib} rows`);

console.log('\nDone. Verify with:');
console.log('  curl https://polymarket-dashboard-ip4ea.ondigitalocean.app/api/weather/status');
