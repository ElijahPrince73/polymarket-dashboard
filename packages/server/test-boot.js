// Test route registration order issue
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 4002;

app.use(cors());
app.use(express.json());

// Route 1: BEFORE async boot
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, test: 'health-before-boot', uptime: process.uptime() });
});

// Route 2: BEFORE async boot
app.get('/api/test', (_req, res) => {
  res.json({ ok: true, test: true, path: '/api/test' });
});

// Simulate async boot that takes 3 seconds
async function boot() {
  console.log('[Boot] Starting...');
  await new Promise(r => setTimeout(r, 3000));
  console.log('[Boot] Done');
}
boot();

// Route 3: AFTER async boot start (but boot hasn't finished)
app.get('/api/delayed', (_req, res) => {
  res.json({ ok: true, test: true, path: '/api/delayed' });
});

app.listen(port, () => {
  console.log(`=== Test server on http://localhost:${port} ===`);
});
