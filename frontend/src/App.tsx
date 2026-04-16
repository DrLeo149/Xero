import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, displayName } from './stores/auth';
import {
  BrandMark, PulseIcon, ProfitIcon, CashIcon, CustomersIcon,
  TailorIcon, SettingsIcon, TenantsIcon, AnalyticsIcon,
} from './components/Icons';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Pulse from './pages/Pulse';
import Profit from './pages/Profit';
import CashFlow from './pages/CashFlow';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import TailorThis from './pages/TailorThis';
import AdminTenants from './pages/admin/Tenants';
import AdminAnalytics from './pages/admin/Analytics';
import { track } from './lib/telemetry';
import { useEffect, useState } from 'react';

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };

// Main data tabs.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Pulse', icon: PulseIcon },
  { to: '/profit', label: 'Profit', icon: ProfitIcon },
  { to: '/cash', label: 'Cash Flow', icon: CashIcon },
  { to: '/customers', label: 'Customers', icon: CustomersIcon },
];
// Rendered below NAV_ITEMS with a blank slot in between so Tailor this and
// Settings visually read as a separate "meta" group from the data tabs.
const NAV_EXTRAS: NavItem[] = [
  { to: '/tailor', label: 'Tailor this', icon: TailorIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];
const ADMIN_ITEMS: NavItem[] = [
  { to: '/admin/tenants', label: 'Tenants', icon: TenantsIcon },
  { to: '/admin/analytics', label: 'Analytics', icon: AnalyticsIcon },
];

function SidebarLink({
  to, label, icon: Icon, active, collapsed,
}: { to: string; label: string; icon: NavItem['icon']; active: boolean; collapsed: boolean }) {
  if (collapsed) {
    return (
      <Link
        to={to}
        title={label}
        className={[
          'group flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-colors',
          active
            ? 'bg-accent-50 text-accent-700 border border-accent-200 shadow-sm'
            : 'border border-transparent text-ink-400 hover:text-ink-900 hover:bg-canvas-sunken',
        ].join(' ')}
      >
        <Icon size={16} />
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className={[
        'group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors',
        active
          ? 'bg-accent-50 text-accent-700 border border-accent-200 shadow-sm'
          : 'border border-transparent text-ink-500 hover:text-ink-900 hover:bg-canvas-sunken',
      ].join(' ')}
    >
      <Icon size={16} className={active ? 'text-accent-600' : 'text-ink-400 group-hover:text-ink-700'} />
      {label}
    </Link>
  );
}

const SIDEBAR_KEY = 'mynumbers.sidebar.collapsed';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    track('page_view', { path: loc.pathname });
  }, [loc.pathname]);

  if (!user) return <>{children}</>;

  const isAdmin = user.role === 'admin';
  const label = displayName(user);
  // Initials from the display name (e.g., "Meghana Rao" → "MR").
  // Falls back to the first two letters if only one word.
  const initials = (() => {
    const parts = label.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return label.slice(0, 2).toUpperCase();
  })();

  return (
    <div className="min-h-screen flex bg-canvas text-ink-900">
      {/* Sidebar - sticky, full viewport height, independent scroll */}
      <aside
        className={[
          'shrink-0 border-r hairline bg-canvas-raised flex flex-col',
          'sticky top-0 h-screen overflow-y-auto',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-[60px]' : 'w-[200px]',
        ].join(' ')}
      >
        {/* Brand + collapse */}
        <div className={collapsed ? 'px-2 py-4 flex flex-col items-center gap-2' : 'px-5 py-5 flex items-start justify-between gap-2'}>
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <BrandMark size={collapsed ? 26 : 24} />
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-[19px] leading-none text-ink-900 tracking-tight">
                  mynumbers
                </div>
                <div className="smallcaps mt-1">Live Finance</div>
              </div>
            )}
          </Link>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="text-ink-300 hover:text-ink-900 hover:bg-canvas-sunken rounded-md p-1.5 transition-colors shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex-1 ${collapsed ? 'px-2 space-y-1' : 'px-3 space-y-0.5'}`}>
          {!collapsed && <div className="smallcaps px-3 mb-2">Workspace</div>}
          {NAV_ITEMS.map((it) => (
            <SidebarLink
              key={it.to}
              to={it.to}
              label={it.label}
              icon={it.icon}
              active={loc.pathname === it.to}
              collapsed={collapsed}
            />
          ))}
          {/* Blank slot: one nav-row of height so Tailor this + Settings
              visually separate from the data tabs. */}
          <div aria-hidden className={collapsed ? 'h-10' : 'h-8'} />
          {NAV_EXTRAS.map((it) => (
            <SidebarLink
              key={it.to}
              to={it.to}
              label={it.label}
              icon={it.icon}
              active={loc.pathname === it.to}
              collapsed={collapsed}
            />
          ))}
          {isAdmin && (
            <>
              {!collapsed ? (
                <div className="smallcaps px-3 mt-6 mb-2">Admin</div>
              ) : (
                <div className="my-3 mx-3 border-t hairline" />
              )}
              {ADMIN_ITEMS.map((it) => (
                <SidebarLink
                  key={it.to}
                  to={it.to}
                  label={it.label}
                  icon={it.icon}
                  active={loc.pathname === it.to}
                  collapsed={collapsed}
                />
              ))}
            </>
          )}
        </nav>

        {/* User */}
        <div className={`p-3 border-t hairline ${collapsed ? 'px-2' : ''}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                title={`${label} · ${user.role}`}
                className="h-9 w-9 rounded-full bg-accent-600 text-white flex items-center justify-center text-xs font-semibold"
              >
                {initials}
              </div>
              <button
                onClick={() => { logout(); nav('/login'); }}
                title="Sign out"
                className="text-ink-400 hover:text-ink-900 p-1 rounded-md hover:bg-canvas-sunken transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M5 3V2a1 1 0 011-1h5a1 1 0 011 1v10a1 1 0 01-1 1H6a1 1 0 01-1-1v-1M8 7H1m0 0l3-3m-3 3l3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              {/* Match SidebarLink padding (px-3 gap-3) + 16px indicator so name text
                  aligns exactly with the nav item labels above it. */}
              <div className="flex items-center gap-3 px-3 py-2">
                <div
                  className="h-4 w-4 rounded-full bg-accent-600 text-white flex items-center justify-center text-[8px] font-bold shrink-0"
                  title={user.email}
                >
                  {initials[0]}
                </div>
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="text-[13px] font-medium text-ink-900 truncate" title={user.email}>{label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">{user.role}</div>
                </div>
              </div>
              <button
                onClick={() => { logout(); nav('/login'); }}
                className="mt-1 w-full text-left text-xs text-ink-400 hover:text-ink-900 px-3 py-1.5 rounded-md hover:bg-canvas-sunken transition-colors"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="max-w-[1280px] mx-auto px-10 pb-10">{children}</div>
      </main>
    </div>
  );
}

function Protected({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<Protected><Pulse /></Protected>} />
        <Route path="/profit" element={<Protected><Profit /></Protected>} />
        <Route path="/cash" element={<Protected><CashFlow /></Protected>} />
        <Route path="/customers" element={<Protected><Customers /></Protected>} />
        <Route path="/tailor" element={<Protected><TailorThis /></Protected>} />
        <Route path="/details" element={<Protected><Dashboard /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/admin/tenants" element={<Protected adminOnly><AdminTenants /></Protected>} />
        <Route path="/admin/analytics" element={<Protected adminOnly><AdminAnalytics /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
