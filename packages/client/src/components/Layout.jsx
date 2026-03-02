import { NavLink } from 'react-router-dom';

const navItems = [
  {
    label: 'Overview',
    to: '/',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z" />
      </svg>
    ),
  },
  {
    label: 'BTC',
    to: '/btc',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 4v16M15 4v16M6 7h8a3 3 0 1 1 0 6H6h9a3 3 0 1 1 0 6H6" />
      </svg>
    ),
  },
  {
    label: 'Weather',
    to: '/weather',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 16a4 4 0 1 1 .8-7.9A5 5 0 0 1 18 10a3.5 3.5 0 1 1 0 7H7z" />
      </svg>
    ),
  },
];

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-64 border-r border-slate-700 bg-slate-800 px-4 py-6">
        <h1 className="mb-8 text-lg font-semibold tracking-wide text-slate-200">Polymarket Dashboard</h1>
        <nav className="space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                }`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 bg-slate-950 p-4 md:p-6">{children}</main>
    </div>
  );
}
