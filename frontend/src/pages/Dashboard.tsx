import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import KpiCard from '../components/kpi/KpiCard';
import ChartCard from '../components/charts/ChartCard';
import { track } from '../lib/telemetry';
import { useState, useEffect } from 'react';

interface Summary {
  kpis: {
    cash: number;
    revenueTTM: number;
    grossProfit: number;
    grossMargin: number | null;
    netProfit: number;
    netMargin: number | null;
    workingCapital: number;
    currentRatio: number | null;
    quickRatio: number | null;
    arOutstanding: number;
    apOutstanding: number;
    dso: number | null;
    dpo: number | null;
    runwayMonths: number | null;
  };
  revenueTrend: { month: string; revenue: number }[];
  topCustomers: { contactId: string; name: string; revenue: number; outstanding: number }[];
  arAging: {
    buckets: { current: number; d30: number; d60: number; d90: number; d90plus: number };
    totalOutstanding: number;
    overdueInvoices: { id: string; number: string; contact: string; amountDue: number; daysOverdue: number }[];
  };
  apAging: { buckets: { current: number; d30: number; d60: number; d90: number; d90plus: number }; totalOutstanding: number };
  invoiceStatusSplit: { status: string; count: number; total: number }[];
  suggestions: { severity: 'info' | 'warn' | 'critical'; title: string; detail: string }[];
  recentInvoices: any[];
}

interface XeroStatus {
  connected: boolean;
  orgName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  refreshCron: string | null;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number | null) => (n === null ? '-' : `${n.toFixed(1)}%`);
const fmtNum = (n: number | null, d = 1) => (n === null ? '-' : n.toFixed(d));

const sevStyles = {
  info:     { wrap: 'border-ink-100 bg-canvas-raised', dot: 'bg-ink-300', title: 'text-ink-900', body: 'text-ink-500' },
  warn:     { wrap: 'border-[#EED9B5] bg-[#FBF5EA]',  dot: 'bg-warning',  title: 'text-[#7A4C08]', body: 'text-[#8A5A10]' },
  critical: { wrap: 'border-[#F2C9C9] bg-[#FBEEEE]',  dot: 'bg-negative', title: 'text-[#7A1616]', body: 'text-[#8A2020]' },
};

const CHART_GREEN = '#166534';
const CHART_AXIS = '#6B7A6F';
const CHART_GRID = '#E6EAE5';

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-[22px] text-ink-900 tracking-tight leading-none">{title}</h2>
      {subtitle && <div className="smallcaps mt-2">{subtitle}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user, adminActiveTenantId } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  // Admin must pick a tenant before the dashboard can scope any API calls.
  const needsTenantSelection = user?.role === 'admin' && !adminActiveTenantId;

  const status = useQuery<XeroStatus>({
    queryKey: ['xero-status', adminActiveTenantId],
    queryFn: () => api.get('/api/xero/status'),
    enabled: !!user && !needsTenantSelection,
    retry: false,
  });

  if (needsTenantSelection) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center">
        <h2 className="font-display text-2xl text-ink-900 mb-3">Pick a tenant first</h2>
        <p className="text-ink-500 text-sm leading-relaxed">
          You're signed in as admin. Go to <strong className="text-ink-900">Tenants</strong>, create a client company
          (or click <strong className="text-ink-900">View</strong> next to an existing one), and the dashboard will scope to it.
        </p>
      </div>
    );
  }

  const summary = useQuery<Summary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.get('/api/dashboard/summary'),
    enabled: !!user && !!status.data?.connected,
  });

  const sync = useMutation({
    mutationFn: () => api.post('/api/xero/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      qc.invalidateQueries({ queryKey: ['xero-status'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const connect = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/xero/connect'),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e: Error) => setErr(e.message),
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('xero') === 'connected') {
      qc.invalidateQueries({ queryKey: ['xero-status'] });
    }
  }, [qc]);

  if (status.isLoading) return <div className="text-ink-400 text-sm">Loading…</div>;
  if (status.error) {
    return (
      <div className="max-w-xl mx-auto card p-6 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616]">
        Failed to load Xero status: {(status.error as Error).message}
      </div>
    );
  }
  if (!status.data) return null;

  if (!status.data.connected) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center">
        <div className="smallcaps mb-3">Getting started</div>
        <h2 className="font-display text-3xl text-ink-900 mb-3 tracking-tight">Connect Xero</h2>
        <p className="text-ink-500 text-sm mb-8 leading-relaxed max-w-md mx-auto">
          Authorize this app to read your Xero organization's books. You'll be redirected to Xero,
          approve access, and return here.
        </p>
        <button
          onClick={() => { track('xero_connect_clicked'); connect.mutate(); }}
          disabled={connect.isPending}
          className="bg-accent-600 hover:bg-accent-700 text-white rounded-md px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {connect.isPending ? 'Redirecting…' : 'Connect Xero'}
        </button>
        {err && <div className="mt-4 text-sm text-negative">{err}</div>}
      </div>
    );
  }

  const s = summary.data;

  return (
    <div className="space-y-10">
      {/* Header strip */}
      <div className="flex items-end justify-between">
        <div>
          <div className="smallcaps mb-2">Organization</div>
          <h1 className="font-display text-[34px] text-ink-900 tracking-tight leading-none">
            {status.data.orgName}
          </h1>
          <p className="text-xs text-ink-400 mt-3">
            Last synced {status.data.lastSyncedAt
              ? new Date(status.data.lastSyncedAt).toLocaleString()
              : 'never'}
            {sync.data ? (() => {
              const d = sync.data as { itemsSynced: number; startedAt: string; finishedAt: string };
              return ` · Synced ${d.itemsSynced} items in ${((new Date(d.finishedAt).getTime() - new Date(d.startedAt).getTime()) / 1000).toFixed(1)}s`;
            })() : null}
          </p>
        </div>
        <button
          onClick={() => { track('manual_refresh_clicked'); sync.mutate(); }}
          disabled={sync.isPending}
          className="bg-accent-600 hover:bg-accent-700 text-white rounded-md px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {sync.isPending ? 'Syncing…' : 'Refresh now'}
        </button>
      </div>

      {summary.isLoading && <div className="text-ink-400 text-sm">Loading dashboard…</div>}

      {s && (
        <>
          {/* Liquidity */}
          <section>
            <SectionHeader title="Liquidity" subtitle="Cash, runway & working capital" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard widgetId="cash" label="Cash on hand" value={fmtMoney(s.kpis.cash)} />
              <KpiCard
                widgetId="runway"
                label="Runway"
                value={s.kpis.runwayMonths === null ? '-' : `${fmtNum(s.kpis.runwayMonths)} mo`}
                tone={s.kpis.runwayMonths !== null && s.kpis.runwayMonths < 3 ? 'bad' : 'default'}
              />
              <KpiCard widgetId="working-capital" label="Working capital" value={fmtMoney(s.kpis.workingCapital)} />
              <KpiCard widgetId="current-ratio" label="Current ratio" value={fmtNum(s.kpis.currentRatio, 2)} sub={`Quick ${fmtNum(s.kpis.quickRatio, 2)}`} />
            </div>
          </section>

          {/* Profitability */}
          <section>
            <SectionHeader title="Profitability" subtitle="Revenue, gross & net margin" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard widgetId="revenue" label="Revenue (TTM)" value={fmtMoney(s.kpis.revenueTTM)} />
              <KpiCard
                widgetId="gross-profit"
                label="Gross profit"
                value={fmtMoney(s.kpis.grossProfit)}
                sub={`${fmtPct(s.kpis.grossMargin)} margin`}
              />
              <KpiCard
                widgetId="net-profit"
                label="Net profit"
                value={fmtMoney(s.kpis.netProfit)}
                sub={s.kpis.netMargin !== null ? `${fmtPct(s.kpis.netMargin)} margin` : undefined}
                tone={s.kpis.netProfit < 0 ? 'bad' : 'good'}
              />
              <KpiCard widgetId="net-margin" label="Net margin" value={fmtPct(s.kpis.netMargin)} />
            </div>
          </section>

          {/* Collections */}
          <section>
            <SectionHeader title="Collections" subtitle="AR, AP & cash conversion" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard widgetId="ar" label="AR outstanding" value={fmtMoney(s.kpis.arOutstanding)} sub={`DSO ${fmtNum(s.kpis.dso, 0)} days`} />
              <KpiCard widgetId="ap" label="AP outstanding" value={fmtMoney(s.kpis.apOutstanding)} sub={`DPO ${fmtNum(s.kpis.dpo, 0)} days`} />
              <KpiCard widgetId="dso" label="DSO" value={s.kpis.dso === null ? '-' : `${fmtNum(s.kpis.dso, 0)} d`} />
              <KpiCard widgetId="dpo" label="DPO" value={s.kpis.dpo === null ? '-' : `${fmtNum(s.kpis.dpo, 0)} d`} />
            </div>
          </section>

          {/* Suggestions */}
          {s.suggestions.length > 0 && (
            <section>
              <SectionHeader title="Working Capital Suggestions" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.suggestions.map((sg, i) => {
                  const st = sevStyles[sg.severity];
                  return (
                    <div key={i} className={`border rounded-card p-5 ${st.wrap}`}>
                      <div className="flex items-start gap-3">
                        <span className={`h-2 w-2 rounded-full mt-1.5 ${st.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-semibold ${st.title}`}>{sg.title}</div>
                          <div className={`text-xs mt-1 leading-relaxed ${st.body}`}>{sg.detail}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Charts grid */}
          <section>
            <SectionHeader title="Trends & breakdowns" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartCard title="Revenue - last 12 months" widgetId="chart-revenue-trend">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={s.revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="month" fontSize={11} stroke={CHART_AXIS} />
                    <YAxis fontSize={11} stroke={CHART_AXIS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8, border: `1px solid ${CHART_GRID}`, fontSize: 12 }} />
                    <Line type="monotone" dataKey="revenue" stroke={CHART_GREEN} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Top customers by revenue" widgetId="chart-top-customers">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={s.topCustomers.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis type="number" fontSize={11} stroke={CHART_AXIS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis dataKey="name" type="category" fontSize={11} stroke={CHART_AXIS} width={120} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8, border: `1px solid ${CHART_GRID}`, fontSize: 12 }} />
                    <Bar dataKey="revenue" fill={CHART_GREEN} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="AR Aging" widgetId="chart-ar-aging">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={[
                      { bucket: 'Current', amount: s.arAging.buckets.current },
                      { bucket: '1-30', amount: s.arAging.buckets.d30 },
                      { bucket: '31-60', amount: s.arAging.buckets.d60 },
                      { bucket: '61-90', amount: s.arAging.buckets.d90 },
                      { bucket: '90+', amount: s.arAging.buckets.d90plus },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="bucket" fontSize={11} stroke={CHART_AXIS} />
                    <YAxis fontSize={11} stroke={CHART_AXIS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 8, border: `1px solid ${CHART_GRID}`, fontSize: 12 }} />
                    <Bar dataKey="amount" fill={CHART_GREEN} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Invoice status" widgetId="chart-invoice-status">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={s.invoiceStatusSplit}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                      label
                    >
                      {s.invoiceStatusSplit.map((_, i) => (
                        <Cell key={i} fill={['#166534', '#2F8F4D', '#5BAE73', '#8FCA9F', '#B9DFC3', '#DCEFE1'][i % 6]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS }} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${CHART_GRID}`, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </section>

          {/* Overdue table */}
          {s.arAging.overdueInvoices.length > 0 && (
            <section>
              <ChartCard title="Top overdue invoices" widgetId="table-overdue">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="smallcaps pb-3 font-medium">Invoice</th>
                      <th className="smallcaps pb-3 font-medium">Contact</th>
                      <th className="smallcaps pb-3 font-medium text-right">Amount Due</th>
                      <th className="smallcaps pb-3 font-medium text-right">Days Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.arAging.overdueInvoices.map((inv) => (
                      <tr key={inv.id} className="border-t hairline">
                        <td className="py-3 text-ink-900">{inv.number}</td>
                        <td className="text-ink-700">{inv.contact}</td>
                        <td className="text-right num text-ink-900">{fmtMoney(inv.amountDue)}</td>
                        <td className="text-right num text-negative font-medium">{inv.daysOverdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ChartCard>
            </section>
          )}
        </>
      )}
    </div>
  );
}
