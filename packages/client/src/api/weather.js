const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

export function getWeatherStatus() {
  return request('/api/weather/status');
}

export function getWeatherTrades() {
  return request('/api/weather/trades');
}

export function getWeatherSummary() {
  return request('/api/weather/summary');
}

export function triggerWeatherTick() {
  return request('/api/weather/tick', { method: 'POST' });
}

export function killWeather() {
  return request('/api/weather/kill', { method: 'POST' });
}

export function setWeatherMode(mode) {
  return request('/api/weather/mode', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mode: String(mode).toLowerCase() }),
  });
}
