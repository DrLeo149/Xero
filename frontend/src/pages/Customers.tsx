import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import { useChartColors } from '../stores/theme';
import PageHeader from '../components/PageHeader';
import PeriodSelector from '../components/PeriodSelector';

type Risk = 'concentration' | 'slow-pay' | 'slipping' | 'overdue' | 'healthy';

interface CustomerRow {
  contactId: string;
  name: string;
  revenueTTM: number;
  pctOfTotal: number;
  outstanding: number;
  avgDaysToPay: number | null;
  lastInvoiceDate: string | null;
  risks: Risk[];
}

interface CustomerData {
  totalRevenueTTM: number;
  customerCount: number;
  topCustomerName: string | null;
  topCustomerPct: number;
  concentrationTone: 'healthy' | 'warn' | 'critical';
  concentrationBar: { name: string; pct: number; revenue: number }[];
  rows: CustomerRow[];
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Human label for the trailing-12-month window, e.g. "May 2025 - Apr 2026". */
function ttmRangeLabel(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return `${fmt(start)} - ${fmt(now)}`;
}

const riskLabels: Record<Risk, string> = {
  concentration: 'Concentration',
  'slow-pay': 'Slow pay',
  slipping: 'Slipping',
  overdue: 'Overdue',
  healthy: 'Healthy',
};

const riskStyles: Record<Risk, string> = {
  concentration: 'bg-[#FBEEEE] text-[#7A1616] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]',
  'slow-pay':    'bg-[#FBF5EA] text-[#7A4C08] dark:bg-[#2A220A] dark:text-[#FCD34D]',
  slipping:      'bg-[#FBF5EA] text-[#7A4C08] dark:bg-[#2A220A] dark:text-[#FCD34D]',
  overdue:       'bg-[#FBEEEE] text-[#7A1616] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]',
  healthy:       'bg-[#F1F8F3] text-[#0D3E20] dark:bg-[#132C1D] dark:text-[#86EFAC]',
};

type SortKey = 'revenue' | 'pct' | 'outstanding' | 'avgDaysToPay' | 'lastInvoice';

export default function Customers() {
  const { user, adminActiveTenantId } = useAuth();
  const chart = useChartColors();
  const [sortBy, setSortBy] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState<Risk | 'all'>('all');
  const period = usePrefs((s) => s.period);
  const setPeriod = usePrefs((s) => s.setPeriod);

  const needsTenantSelection = user?.role === 'admin' && !adminActiveTenantId;

  const q = useQuery<CustomerData>({
    queryKey: ['customers', adminActiveTenantId, period],
    queryFn: () => api.get(`/api/dashboard/customers?period=${encodeURIComponent(period)}`),
    enabled: !!user && !needsTenantSelection,
  });

  const sortedRows = useMemo(() => {
    if (!q.data) return [];
    const filtered = filter === 'all' ? q.data.rows : q.data.rows.filter((r) => r.risks.includes(filter));
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'revenue':      return sign * (a.revenueTTM - b.revenueTTM);
        case 'pct':          return sign * (a.pctOfTotal - b.pctOfTotal);
        case 'outstanding':  return sign * (a.outstanding - b.outstanding);
        case 'avgDaysToPay': return sign * ((a.avgDaysToPay ?? 9999) - (b.avgDaysToPay ?? 9999));
        case 'lastInvoice': {
          const ad = a.lastInvoiceDate ? new Date(a.lastInvoiceDate).getTime() : 0;
          const bd = b.lastInvoiceDate ? new Date(b.lastInvoiceDate).getTime() : 0;
          return sign * (ad - bd);
        }
      }
    });
  }, [q.data, sortBy, sortDir, filter]);

  if (needsTenantSelection) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center mt-10">
        <h2 className="font-display text-2xl text-ink-900 mb-3">Pick a tenant first</h2>
      </div>
    );
  }

  function toggleSort(k: SortKey) {
    if (sortBy === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('desc'); }
  }

  const d = q.data;
  const toneColor =
    d?.concentrationTone === 'critical' ? 'text-negative'
    : d?.concentrationTone === 'warn' ? 'text-warning'
    : 'text-positive';
  const toneLabel =
    d?.concentrationTone === 'critical' ? 'high risk'
    : d?.concentrationTone === 'warn' ? 'watch'
    : 'healthy';

  return (
    <div className="space-y-8">
      <PageHeader
        tag={`Customers · ${period === 'ttm' ? ttmRangeLabel() : (d?.customerCount !== undefined ? 'Selected period' : '…')}`}
        title="Who's carrying this business?"
        meta={<>{d?.customerCount ?? '…'} customers · {d ? fmtMoney(d.totalRevenueTTM) : '…'} total in range</>}
        right={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {q.isLoading && <div className="text-ink-400 text-sm">Loading customers…</div>}
      {q.error && (
        <div className="card p-4 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {(q.error as Error).message}
        </div>
      )}

      {d && (
        <>
          {/* HERO: concentration risk headline */}
          <section className="card p-8">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div>
                <div className="smallcaps mb-3">Concentration risk</div>
                <div className="font-display text-[28px] text-ink-900 tracking-tight leading-tight max-w-lg">
                  {d.topCustomerName
                    ? <>
                        <span className="font-semibold">{d.topCustomerName}</span> is{' '}
                        <span className={`${toneColor} font-semibold num`}>
                          {d.topCustomerPct.toFixed(0)}%
                        </span>{' '}
                        of revenue
                      </>
                    : <>No customers yet</>}
                </div>
                <div className={`smallcaps mt-3 ${toneColor}`}>{toneLabel}</div>
              </div>
              <div className="text-right">
                <div className="smallcaps">Threshold</div>
                <div className="text-sm text-ink-500 mt-2">
                  Healthy · <span className="text-ink-900">&lt; 15%</span><br />
                  Watch · <span className="text-warning">15-30%</span><br />
                  High risk · <span className="text-negative">&gt; 30%</span>
                </div>
              </div>
            </div>

            {/* Horizontal stacked bar - one per top customer, % width.
                Segments grow from width 0 -> target with a staggered reveal
                the first time the data lands, so the chart "draws itself". */}
            <div className="mt-8">
              <ConcentrationBar segments={d.concentrationBar} chart={chart} />
              {/* 20% line marker */}
              <div className="relative h-3 mt-1">
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-negative"
                  style={{ left: '20%' }}
                />
                <div
                  className="absolute text-[10px] text-negative num -translate-x-1/2"
                  style={{ left: '20%', top: '2px' }}
                >
                  20%
                </div>
              </div>
              {/* Legend */}
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                {d.concentrationBar.map((c, i) => (
                  <span key={c.name + i} className="flex items-center gap-2 text-ink-500">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: c.name === 'Others' ? chart.grey : chart.categorical[i % chart.categorical.length] }}
                    />
                    <span className="text-ink-900">{c.name}</span>
                    <span className="num">{c.pct.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Filter chips */}
          <section>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="smallcaps mr-2">Filter</span>
              {(['all', 'concentration', 'overdue', 'slow-pay', 'slipping', 'healthy'] as const).map((f) => {
                const active = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f as any)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:opacity-90"
                    style={
                      active
                        ? { background: 'var(--ink-900)', color: 'var(--canvas)', borderColor: 'var(--ink-900)' }
                        : { background: 'var(--canvas-raised)', color: 'var(--ink-700)', borderColor: 'var(--ink-200)' }
                    }
                  >
                    {f === 'all' ? `All (${d.rows.length})` : riskLabels[f as Risk]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Customer table */}
          <section className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline">
                    <Th active={false}>Customer</Th>
                    <Th active={sortBy === 'revenue'} dir={sortDir} onClick={() => toggleSort('revenue')} align="right">Revenue TTM</Th>
                    <Th active={sortBy === 'pct'} dir={sortDir} onClick={() => toggleSort('pct')} align="right">% of total</Th>
                    <Th active={sortBy === 'outstanding'} dir={sortDir} onClick={() => toggleSort('outstanding')} align="right">Outstanding</Th>
                    <Th active={sortBy === 'avgDaysToPay'} dir={sortDir} onClick={() => toggleSort('avgDaysToPay')} align="right">Avg days to pay</Th>
                    <Th active={sortBy === 'lastInvoice'} dir={sortDir} onClick={() => toggleSort('lastInvoice')} align="right">Last invoice</Th>
                    <Th active={false}>Risk</Th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-ink-400 text-sm py-10">No customers match this filter</td></tr>
                  )}
                  {sortedRows.map((r) => (
                    <tr key={r.contactId} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                      <td className="px-5 py-3 text-ink-900 font-medium">{r.name}</td>
                      <td className="px-5 py-3 text-right num text-ink-900">{fmtMoney(r.revenueTTM)}</td>
                      <td className="px-5 py-3 text-right num text-ink-700">{r.pctOfTotal.toFixed(1)}%</td>
                      <td className={`px-5 py-3 text-right num ${r.outstanding > 0 ? 'text-ink-900' : 'text-ink-400'}`}>
                        {r.outstanding > 0 ? fmtMoney(r.outstanding) : '-'}
                      </td>
                      <td className="px-5 py-3 text-right num text-ink-700">
                        {r.avgDaysToPay === null ? '-' : `${r.avgDaysToPay.toFixed(0)} d`}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-500 text-xs">
                        {r.lastInvoiceDate
                          ? new Date(r.lastInvoiceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '-'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {r.risks.map((rk) => (
                            <span key={rk} className={`px-2 py-0.5 rounded text-[10px] font-medium ${riskStyles[rk]}`}>
                              {riskLabels[rk]}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Th({
  children, active, dir, onClick, align = 'left',
}: {
  children: React.ReactNode;
  active: boolean;
  dir?: 'asc' | 'desc';
  onClick?: () => void;
  align?: 'left' | 'right';
}) {
  const clickable = !!onClick;
  return (
    <th
      onClick={onClick}
      className={[
        'smallcaps font-medium py-3 px-5',
        align === 'right' ? 'text-right' : 'text-left',
        clickable ? 'cursor-pointer select-none hover:text-ink-900' : '',
        active ? 'text-ink-900' : '',
      ].join(' ')}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[8px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

/**
 * Horizontal stacked bar that "draws itself" on first mount - each segment
 * grows from width 0 to its target pct with a left-to-right stagger. Uses a
 * CSS width transition triggered by a one-tick state flip so the browser
 * sees the initial 0-width render before it paints the target width.
 *
 * Re-keyed on the segment signature so switching filters/period restarts
 * the animation from scratch (feels alive).
 */
function ConcentrationBar({
  segments,
  chart,
}: {
  segments: { name: string; pct: number; revenue: number }[];
  chart: ReturnType<typeof useChartColors>;
}) {
  const [revealed, setRevealed] = useState(false);
  const sig = segments.map((s) => `${s.name}:${s.pct.toFixed(2)}`).join('|');

  useEffect(() => {
    setRevealed(false);
    // Two rAFs: first paint sees width:0, second applies target width so
    // the browser interpolates the transition. One rAF alone races the
    // initial style commit in some browsers.
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, [sig]);

  return (
    <div className="flex h-6 w-full rounded-md overflow-hidden border hairline">
      {segments.map((c, i) => {
        const color = c.name === 'Others' ? chart.grey : chart.categorical[i % chart.categorical.length];
        // Stagger: each segment starts 90ms after the previous one. Total
        // duration scales with segment size so big ones feel weighty.
        const delayMs = i * 90;
        const durationMs = 550 + Math.min(600, c.pct * 10);
        return (
          <div
            key={c.name + i}
            title={`${c.name} · ${c.pct.toFixed(1)}% · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(c.revenue)}`}
            className="hover:opacity-80"
            style={{
              width: revealed ? `${c.pct}%` : '0%',
              background: color,
              transition: `width ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms, opacity 200ms`,
              opacity: revealed ? 1 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}
