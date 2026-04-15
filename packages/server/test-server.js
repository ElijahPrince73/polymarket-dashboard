import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Simple test: register a route, then start async boot, then check
const app = express();
const port = 4003;

app.use(express.json());

// Route registered BEFORE async boot starts
app.get('/api/test', (req, res) => {
  res.json({ ok: true, before: true, ts: Date.now() });
});

// Register a /api/btc route that we can check
app.get('/api/btc/check', (req, res) => {
  res.json({ ok: true, btc: true });
});

// Now start async boot (simulated)
async function boot() {
  console.log('[Boot] Simulating 2s boot...');
  await new Promise(r => setTimeout(r, 2000));
  console.log('[Boot] Done, now mounting more routes');
  
  // Mount another route after boot
  app.get('/api/after', (req, res) => {
    res.json({ ok: true, after: true });
  });
  
  console.log('[Boot] Routes after boot:', app._router ? 'router exists' : 'NO ROUTER');
}

boot();

// Start server immediately (boot runs in background)
app.listen(port, () => {
  console.log(`=== Test on http://localhost:${port} ===`);
  console.log('[Main] Server listening immediately');
});

// Don't exit
