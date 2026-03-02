const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  const payload = await response.json();
  if (payload && payload.success === true && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export function getBtcStatus() {
  return request('/api/btc/status');
}

export function getBtcTrades() {
  return request('/api/btc/trades');
}

export function getBtcKillSwitch() {
  return request('/api/btc/kill-switch/status');
}

export function getBtcOpenOrders() {
  return request('/api/btc/live/open-orders');
}

export function startBtcTrading() {
  return request('/api/btc/trading/start', { method: 'POST' });
}

export function stopBtcTrading() {
  return request('/api/btc/trading/stop', { method: 'POST' });
}

export function setBtcMode(mode) {
  return request('/api/btc/mode', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mode: String(mode).toLowerCase() }),
  });
}
