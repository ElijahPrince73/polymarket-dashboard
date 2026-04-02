import { useState } from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Portfolio' },
  { to: '/compare', label: 'Compare' },
  { to: '/btc15m', label: 'BTC 15M' },
  { to: '/btc', label: 'Bitcoin' },
  { to: '/weather', label: 'Weather' },
  { to: '/trades', label: 'Trades' },
  { to: '/analytics', label: 'Analytics' },
];

function NavItem({ item, onClick, mobile = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'font-label flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] transition-colors',
          mobile ? 'px-0 py-3' : 'px-0 py-2.5',
          isActive ? 'text-[var(--text-display)]' : 'text-[var(--text-disabled)] hover:text-[var(--text-primary)]',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <span className={`h-1 w-1 rounded-full ${isActive ? 'bg-[var(--text-display)]' : 'bg-transparent'}`} aria-hidden="true" />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen max-w-[100vw] overflow-x-hidden bg-[var(--black)] text-[var(--text-primary)]">
      <aside className="hidden w-[200px] flex-col border-r border-[var(--border)] bg-[var(--black)] px-5 py-6 md:flex">
        <div className="pb-6">
          <p className="font-label text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">POLYMARKET</p>
        </div>
        <nav className="mt-6 space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--black)] px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-10 w-10 items-center justify-center text-[var(--text-display)]"
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="4" y1="6" x2="16" y2="6" />
            <line x1="4" y1="10" x2="16" y2="10" />
            <line x1="4" y1="14" x2="16" y2="14" />
          </svg>
        </button>
        <p className="font-label text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">POLYMARKET</p>
      </header>

      {mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/80 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[200px] flex-col border-r border-[var(--border)] bg-[var(--black)] px-5 py-6 md:hidden">
            <div className="flex items-start justify-between pb-6">
              <p className="font-label text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">POLYMARKET</p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-10 w-10 items-center justify-center text-[var(--text-display)]"
                aria-label="Close menu"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="3" y1="3" x2="13" y2="13" />
                  <line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>
            <nav className="mt-6 space-y-1">
              {navItems.map((item) => (
                <NavItem key={item.to} item={item} mobile onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
          </aside>
        </>
      )}

      <main className="min-w-0 flex-1 overflow-x-hidden bg-[var(--black)] px-4 pb-6 pt-20 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
