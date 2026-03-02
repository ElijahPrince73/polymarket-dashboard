import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Overview' },
  { to: '/btc', label: 'BTC Dashboard' },
  { to: '/btc/trades', label: 'BTC Trades' },
  { to: '/weather', label: 'Weather Dashboard' },
  { to: '/weather/trades', label: 'Weather Trades' },
];

const getLinkClass = ({ isActive }) =>
  [
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/60 hover:text-white',
  ].join(' ');

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-700 bg-slate-800 p-4 md:border-b-0 md:border-r">
        <h1 className="mb-4 text-lg font-semibold">Polymarket Dashboard</h1>
        <nav className="grid gap-1">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} className={getLinkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
