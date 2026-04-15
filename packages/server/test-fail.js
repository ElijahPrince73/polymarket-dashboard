// Test: what happens when boot() throws
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = 4004;

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, before: true }));

// Simulate boot that throws
async function boot() {
  console.log('[Boot] Starting...');
  await new Promise(r => setTimeout(r, 1000));
  throw new Error('BOOT FAILED');
}

boot().catch(err => {
  console.error('[Boot] Fatal error:', err.message);
  console.error('[Boot] NOT calling process.exit() - let server keep running');
  // NOT calling process.exit()
});

app.listen(port, () => {
  console.log(`=== Test on http://localhost:${port} ===`);
});
