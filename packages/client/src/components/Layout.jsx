import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Portfolio', icon: '📊' },
  { to: '/compare', label: 'Compare', icon: '⚖️' },
  { to: '/btc15m', label: 'BTC 15m', icon: '⏱️' },
  { to: '/btc', label: 'Bitcoin', icon: '₿' },
  { to: '/weather', label: 'Weather', icon: '🌤' },
  { to: '/trades', label: 'Trades', icon: '📋' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
];

function NavItem({ item, onClick }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-md px-3 py-2 transition',
          isActive
            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
            : 'text-slate-300 hover:bg-slate-700 hover:text-slate-100',
        ].join(' ')
      }
    >
      <span className="inline-flex w-6 justify-center text-lg">{item.icon}</span>
      <span className="whitespace-nowrap text-sm font-medium">{item.label}</span>
    </NavLink>
  );
}

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Find current page label for the header
  const currentPage = navItems.find(
    (item) => item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );

  return (
    <div className="flex min-h-screen max-w-[100vw] overflow-x-hidden bg-slate-950 text-slate-100">
      {/* Desktop sidebar — always open */}
      <aside className="hidden w-[220px] flex-col border-r border-slate-700 bg-slate-800 p-2 md:flex">
        <div className="mb-4 truncate px-2 pt-2 text-xs uppercase tracking-widest text-slate-400">
          Polymarket Dashboard
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      {/* Mobile hamburger header */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center border-b border-slate-700 bg-slate-900/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="mr-3 flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-700 hover:text-white"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        </button>
        <span className="text-sm font-medium text-slate-200">{currentPage?.label || 'Dashboard'}</span>
      </header>

      {/* Mobile slide-out drawer */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-slate-700 bg-slate-800 p-3 shadow-xl md:hidden">
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <span className="text-xs uppercase tracking-widest text-slate-400">
                Polymarket Dashboard
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-700 hover:text-white"
                aria-label="Close menu"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="3" x2="13" y2="13" />
                  <line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>
            <nav className="mt-2 space-y-1">
              {navItems.map((item) => (
                <NavItem key={item.to} item={item} onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
          </aside>
        </>
      )}

      {/* Main content — top padding on mobile for fixed header */}
      <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-950 px-4 pt-16 pb-4 md:px-6 md:pt-6 md:pb-6">{children}</main>
    </div>
  );
}
