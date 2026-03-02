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

export const getBtcStatus = () => jsonRequest('/api/btc/status');
export const getBtcTrades = () => jsonRequest('/api/btc/trades');
export const getBtcAnalytics = () => jsonRequest('/api/btc/analytics');
export const startBtcTrading = () => jsonRequest('/api/btc/trading/start', { method: 'POST' });
export const stopBtcTrading = () => jsonRequest('/api/btc/trading/stop', { method: 'POST' });
