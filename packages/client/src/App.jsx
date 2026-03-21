import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Analytics from './pages/Analytics.jsx';
import Btc from './pages/Btc.jsx';
import Compare from './pages/Compare.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Trades from './pages/Trades.jsx';
import Weather from './pages/Weather.jsx';
import WeatherCity from './pages/WeatherCity.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/btc" element={<Btc />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="/weather/:city" element={<WeatherCity />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
