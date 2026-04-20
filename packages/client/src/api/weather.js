const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

export function triggerWeatherTick() {
  return request('/api/weather/tick', { method: 'POST' });
}

export function startWeatherTrading() {
  return request('/api/weather/trading/start', { method: 'POST' });
}

export function stopWeatherTrading() {
  return request('/api/weather/trading/stop', { method: 'POST' });
}

export function killWeather() {
  return request('/api/weather/kill', { method: 'POST' });
}

export function syncDatabase() {
  return request('/api/weather/sync-database', { method: 'POST' });
}

export function setWeatherMode(mode) {
  return request('/api/weather/mode', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mode: String(mode).toLowerCase() }),
  });
}
