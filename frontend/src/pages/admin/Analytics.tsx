import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import PageHeader, { useTzFormatter } from '../../components/PageHeader';

/**
 * Admin usage analytics - rebuilt to be actionable, not a raw event dump.
 *
 * Three questions this page answers, in order:
 *
 *   1. Is anyone stuck right now? -> friction signals list (rapid refresh,
 *      bounces, dead dwell).
 *
 *   2. Where do people actually spend their time? -> tab dwell ranking. Tells
 *      the admin which tabs are earning their keep vs which ones nobody looks
 *      at.
 *
 *   3. Who's engaged overall? -> per-tenant rollup (active time, sessions,
 *      active days, last seen).
 *
 * Plus a live presence strip at the top for "active right now".
 */

interface FrictionSignal {
  type: 'rapid_refresh' | 'bounce' | 'dead_dwell';
  userId: string;
  userLabel: string;
  tenantName: string | null;
  at: string;
  detail: string;
  severity: number;
}

interface TabDwell {
  tab: string;
  seconds: number;
  uniquePct: number;
  uniqueUsers: number;
}

interface TenantEngagement {
  tenantId: string;
  companyName: string;
  activeViewSeconds: number;
  sessionCount: number;
  activeDays: number;
  lastSeenAt: string | null;
}

interface ExpertClick {
  userId: string;
  userLabel: string;
  tenantName: string | null;
  count: number;
  lastAt: string;
  fromPaths: string[];
}

interface Insights {
  days: number;
  frictionSignals: FrictionSignal[];
  tabDwell: TabDwell[];
  tenantEngagement: TenantEngagement[];
  expertReviewClicks: ExpertClick[];
}

interface LiveUser {
  userId: string;
  email: string;
  tenantId: string | null;
  companyName: string | null;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Each signal type gets its own tone + glyph so the list scans quickly.
const SIGNAL_STYLES: Record<
  FrictionSignal['type'],
  { label: string; rail: string; badgeBg: string; badgeText: string }
> = {
  rapid_refresh: {
    label: 'Fighting stale data',
    rail: 'var(--negative)',
    badgeBg: '#FBEEEE',
    badgeText: '#7A1616',
  },
  dead_dwell: {
    label: 'Stuck / confused',
    rail: 'var(--warning)',
    badgeBg: '#FBF5EA',
    badgeText: '#7A4C08',
  },
  bounce: {
    label: 'Opened and left',
    rail: 'var(--ink-300)',
    badgeBg: 'var(--canvas-sunken)',
    badgeText: 'var(--ink-700)',
  },
};

export default function AdminAnalytics() {
  const fmtTime = useTzFormatter();

  const insights = useQuery<Insights>({
    queryKey: ['admin-insights'],
    queryFn: () => api.get('/api/admin/analytics/insights?days=7'),
    refetchInterval: 30_000,
  });

  const live = useQuery<LiveUser[]>({
    queryKey: ['admin-live'],
    queryFn: () => api.get('/api/admin/analytics/live'),
    refetchInterval: 15_000,
  });

  const d = insights.data;
  const totalSeconds = d?.tabDwell.reduce((a, t) => a + t.seconds, 0) ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        tag="Usage analytics - last 7 days"
        title="Who's actually getting value?"
        meta={
          d ? (
            <>
              {d.frictionSignals.length} signal{d.frictionSignals.length === 1 ? '' : 's'} detected -
              {' '}{formatDuration(totalSeconds)} of active time across {d.tenantEngagement.length} tenant{d.tenantEngagement.length === 1 ? '' : 's'}
            </>
          ) : (
            <>Loading insights...</>
          )
        }
      />

      {insights.isLoading && <div className="text-ink-400 text-sm">Loading analytics...</div>}
      {insights.error && (
        <div className="card p-4 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {(insights.error as Error).message}
        </div>
      )}

      {/* LIVE PRESENCE - thin strip, not a big card */}
      <section className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <div className="smallcaps">Active right now</div>
            <div className="text-xs text-ink-400 mt-1">Users with activity in the last 2 minutes</div>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-ink-400">Updates every 15s</span>
        </div>
        {live.data?.length === 0 ? (
          <p className="text-sm text-ink-400">No one online.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {live.data?.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-2 rounded-full border hairline px-3 py-1 text-xs"
                style={{ background: 'var(--canvas-sunken)' }}
              >
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--positive)' }} />
                <span className="text-ink-900">{u.email}</span>
                {u.companyName && <span className="text-ink-400">- {u.companyName}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* WHAT NEEDS ATTENTION - friction signals */}
      {d && (
        <section className="card p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b hairline">
            <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
              What needs attention
            </h2>
            <div className="smallcaps mt-2">Detected friction in the last 7 days</div>
          </div>
          {d.frictionSignals.length === 0 ? (
            <div className="p-10 text-center text-ink-400 text-sm">
              No friction detected. Everyone's moving smoothly.
            </div>
          ) : (
            <ul>
              {d.frictionSignals.map((s, i) => {
                const st = SIGNAL_STYLES[s.type];
                return (
                  <li
                    key={`${s.userId}-${s.type}-${i}`}
                    className="relative px-6 py-4 flex items-start justify-between gap-6 border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors"
                  >
                    <span
                      className="absolute left-0 top-0 bottom-0 w-[3px]"
                      style={{ background: st.rail }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5"
                          style={{ background: st.badgeBg, color: st.badgeText }}
                        >
                          {st.label}
                        </span>
                        <span className="text-ink-900 text-sm font-medium truncate">{s.userLabel}</span>
                        {s.tenantName && (
                          <span className="text-ink-400 text-xs">@ {s.tenantName}</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-500 mt-1.5">{s.detail}</div>
                    </div>
                    <div className="text-[11px] text-ink-400 whitespace-nowrap pt-1">
                      {fmtTime(s.at)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* WHERE ARE PEOPLE SPENDING TIME - tab dwell */}
      {d && d.tabDwell.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b hairline">
            <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
              Where people spend their time
            </h2>
            <div className="smallcaps mt-2">Tab dwell ranked by total active seconds</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline">
                <th className="smallcaps font-medium text-left py-3 px-6">Tab</th>
                <th className="smallcaps font-medium text-right py-3 px-6">Active time</th>
                <th className="smallcaps font-medium text-right py-3 px-6">% of total</th>
                <th className="smallcaps font-medium text-right py-3 px-6">Unique users</th>
                <th className="py-3 px-6 w-[30%]"></th>
              </tr>
            </thead>
            <tbody>
              {d.tabDwell.map((t) => (
                <tr key={t.tab} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                  <td className="px-6 py-3 text-ink-900 font-medium">{t.tab}</td>
                  <td className="px-6 py-3 text-right num text-ink-900">{formatDuration(t.seconds)}</td>
                  <td className="px-6 py-3 text-right num text-ink-700">{t.uniquePct.toFixed(0)}%</td>
                  <td className="px-6 py-3 text-right num text-ink-700">{t.uniqueUsers}</td>
                  <td className="px-6 py-3">
                    <div className="h-1.5 w-full rounded-full bg-canvas-sunken overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, t.uniquePct)}%`,
                          background: 'var(--accent-600)',
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* EXPERT REVIEW CLICKS - highest-intent signal */}
      {d && (
        <section className="card p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b hairline flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                Free expert review - who clicked
              </h2>
              <div className="smallcaps mt-2">Highest-intent signal in the product</div>
            </div>
            <span className="text-[11px] text-ink-400 num">
              {d.expertReviewClicks.reduce((a, r) => a + r.count, 0)} clicks - {d.expertReviewClicks.length} unique
            </span>
          </div>
          {d.expertReviewClicks.length === 0 ? (
            <div className="p-10 text-center text-ink-400 text-sm">
              Nobody has clicked the chip yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline">
                  <th className="smallcaps font-medium text-left py-3 px-6">User</th>
                  <th className="smallcaps font-medium text-left py-3 px-6">Company</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Clicks</th>
                  <th className="smallcaps font-medium text-left py-3 px-6">Clicked from</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Last click</th>
                </tr>
              </thead>
              <tbody>
                {d.expertReviewClicks.map((r) => (
                  <tr key={r.userId} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                    <td className="px-6 py-3 text-ink-900 font-medium">{r.userLabel}</td>
                    <td className="px-6 py-3 text-ink-700">{r.tenantName ?? '-'}</td>
                    <td className="px-6 py-3 text-right num text-ink-900">{r.count}</td>
                    <td className="px-6 py-3 text-ink-500 text-xs">{r.fromPaths.join(', ') || '-'}</td>
                    <td className="px-6 py-3 text-right text-ink-500 text-xs">{relativeTime(r.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* PER-TENANT ENGAGEMENT */}
      {d && (
        <section className="card p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b hairline">
            <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
              Per-tenant engagement
            </h2>
            <div className="smallcaps mt-2">Ranked by active view time</div>
          </div>
          {d.tenantEngagement.length === 0 ? (
            <div className="p-10 text-center text-ink-400 text-sm">No tenants yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline">
                  <th className="smallcaps font-medium text-left py-3 px-6">Company</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Active time</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Sessions</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Active days</th>
                  <th className="smallcaps font-medium text-right py-3 px-6">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {d.tenantEngagement.map((t) => (
                  <tr key={t.tenantId} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                    <td className="px-6 py-3 text-ink-900 font-medium">{t.companyName}</td>
                    <td className="px-6 py-3 text-right num text-ink-900">{formatDuration(t.activeViewSeconds)}</td>
                    <td className="px-6 py-3 text-right num text-ink-700">{t.sessionCount}</td>
                    <td className="px-6 py-3 text-right num text-ink-700">{t.activeDays} / 7</td>
                    <td className="px-6 py-3 text-right text-ink-500 text-xs">{relativeTime(t.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
