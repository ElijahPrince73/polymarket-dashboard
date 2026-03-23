import db from "../db.js";

// Monitor disabled — NO-on-tails strategy lets positions ride to resolution.
// No stop-loss, no switching. Positions are sized by Half-Kelly and resolve naturally.
// Re-enable when a mid-trade adjustment strategy is needed.

export async function runMonitor(dbApi = db) {
  return { updated: 0, switched: 0 };
}
