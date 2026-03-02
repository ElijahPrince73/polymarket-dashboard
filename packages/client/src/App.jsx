import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import BtcDashboard from './pages/BtcDashboard.jsx';
import BtcTrades from './pages/BtcTrades.jsx';
import Overview from './pages/Overview.jsx';
import WeatherDashboard from './pages/WeatherDashboard.jsx';
import WeatherTrades from './pages/WeatherTrades.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/btc" element={<BtcDashboard />} />
          <Route path="/btc/trades" element={<BtcTrades />} />
          <Route path="/weather" element={<WeatherDashboard />} />
          <Route path="/weather/trades" element={<WeatherTrades />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
