import { BtcDashboard } from './Btc.jsx';

export default function Btc15m() {
  return (
    <BtcDashboard
      basePath="/api/btc15m"
      title="Bitcoin 15-Minute"
      marketPrefix="btc-updown-15m-"
      marketShortPrefix="15m-"
    />
  );
}
