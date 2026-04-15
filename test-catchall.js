// Test that Express catch-all {*path} doesn't override registered exact routes
import express from 'express';

const app = express();
app.use(express.json());

// Route 1
app.get('/api/test', (req, res) => {
  res.json({ path: '/api/test' });
});

// Route 2
app.get('/api/btc/diag', (req, res) => {
  res.json({ path: '/api/btc/diag' });
});

// Route 3: 15m variant
app.get('/api/btc15m/status', (req, res) => {
  res.json({ path: '/api/btc15m/status' });
});

// Catch-all (the one from index.js)
app.get("/{*path}", (req, res) => {
  res.send(`CATCH-ALL for ${req.path}`);
});

app.listen(4005, () => console.log('Test on 4005'));
