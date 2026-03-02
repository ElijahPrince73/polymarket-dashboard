const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
};

export const getWeatherStatus = () => jsonRequest('/api/weather/status');
export const getWeatherTrades = () => jsonRequest('/api/weather/trades');
export const getWeatherSummary = () => jsonRequest('/api/weather/summary');
