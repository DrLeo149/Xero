import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import { useChartColors } from '../stores/theme';
import PageHeader from '../components/PageHeader';
import PeriodSelector from '../components/PeriodSelector';
import SlotNumber from '../components/SlotNumber';

interface ProfitData {
  period: { start: string; end: string; label: string };
  hero: {
    revenuePeriod: number;
    expensesPeriod: number;
    netProfitPeriod: number;
    netMarginPct: number | null;
    marginDeltaPts: number | null;
    revenueDeltaPct: number | null;
    profitDeltaPct: number | null;
    trendDirection: 'up' | 'down' | 'flat';
    grossMargin: number | null;
  };
  trend: { month: string; revenue: number; expenses: number; net: number }[];
  vendors: {
    contactId: string;
    name: string;
    amount: number;
    pctOfTotal: number;
    priorAmount: number;
    delta: number;
    deltaPct: number | null;
  }[];
  biggestMovers: ProfitData['vendors'];
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtMoneySigned = (n: number) => (n >= 0 ? '+' : '-') + fmtMoney(Math.abs(n)).replace('-', '');
const fmtPct = (n: number | null, digits = 1) => (n === null ? '-' : `${n.toFixed(digits)}%`);

function marginTone(pct: number | null): string {
  if (pct === null) return 'text-ink-900';
  if (pct < 0) return 'text-negative';
  if (pct < 10) return 'text-warning';
  return 'text-positive';
}

/**
 * Plain-English read of the profit hero. Turns the -245% / "Improving" /
 * "profit delta -200%" pile into one sentence a founder can actually parse,
 * plus two or three concrete nudges based on the underlying numbers.
 */
function ProfitExplainer({
  hero,
  periodLabel,
}: {
  hero: ProfitData['hero'];
  periodLabel: string;
}) {
  const {
    revenuePeriod,
    expensesPeriod,
    netProfitPeriod,
    netMarginPct,
    grossMargin,
    trendDirection,
  } = hero;

  // Bottom line - one sentence, no jargon.
  let verdict: { tone: 'positive' | 'warning' | 'negative' | 'neutral'; headline: string; body: string };

  if (revenuePeriod === 0) {
    verdict = {
      tone: 'neutral',
      headline: 'No revenue booked in this period',
      body: `There are no paid or authorised sales invoices dated in ${periodLabel}. Pick a different period to see profit numbers.`,
    };
  } else if (netProfitPeriod >= 0 && netMarginPct !== null && netMarginPct >= 15) {
    verdict = {
      tone: 'positive',
      headline: `You kept ${fmtMoney(netProfitPeriod)} out of every ${fmtMoney(revenuePeriod)} in sales`,
      body: `That's a healthy ${netMarginPct.toFixed(1)}% net margin. Revenue covered expenses comfortably in ${periodLabel}.`,
    };
  } else if (netProfitPeriod >= 0) {
    verdict = {
      tone: 'warning',
      headline: `You made ${fmtMoney(netProfitPeriod)} in ${periodLabel}`,
      body: `Margin is thin (${netMarginPct !== null ? netMarginPct.toFixed(1) + '%' : 'low'}). Small cost bumps would push you into a loss.`,
    };
  } else {
    // Loss - explain it in dollars, not in a -245% scream.
    const ratio = expensesPeriod / (revenuePeriod || 1);
    verdict = {
      tone: 'negative',
      headline: `You spent ${fmtMoney(expensesPeriod)} to earn ${fmtMoney(revenuePeriod)} - a loss of ${fmtMoney(Math.abs(netProfitPeriod))}`,
      body: `Expenses were about ${ratio.toFixed(1)}x revenue in ${periodLabel}. Either the period is too early to have billed much yet, or costs are outrunning sales.`,
    };
  }

  // Concrete reads based on the numbers.
  const suggestions: { label: string; text: string }[] = [];

  if (grossMargin !== null && grossMargin >= 60 && netProfitPeriod < 0) {
    suggestions.push({
      label: 'The shape of the loss',
      text: `Gross margin is ${grossMargin.toFixed(0)}% - the work itself is very profitable. The loss is coming from overhead (rent, salaries, tools, fees), not from the jobs you're delivering. Look at the vendor table below to see where fixed costs are landing.`,
    });
  } else if (grossMargin !== null && grossMargin < 30 && revenuePeriod > 0) {
    suggestions.push({
      label: 'Pricing pressure',
      text: `Gross margin of ${grossMargin.toFixed(0)}% means most of every dollar you bill is going straight back out as cost-of-sale. Before trimming overhead, check whether your pricing leaves enough room for overhead and profit.`,
    });
  }

  if (trendDirection === 'up' && netProfitPeriod < 0) {
    suggestions.push({
      label: 'Why "Improving" still shows a loss',
      text: `The 12-month direction compares the last six months to the six before that on a rolling average. "Improving" means the trend is getting less bad, not that this specific period is profitable. You can still be losing money while the trajectory points up.`,
    });
  } else if (trendDirection === 'down' && netProfitPeriod >= 0) {
    suggestions.push({
      label: 'Profitable but slowing',
      text: `You made money in ${periodLabel}, but the six-month rolling trend is pointing down. Worth looking at the monthly chart below to see where the slope changed.`,
    });
  }

  if (revenuePeriod > 0 && revenuePeriod < expensesPeriod * 0.25) {
    suggestions.push({
      label: 'Period timing',
      text: `Revenue of ${fmtMoney(revenuePeriod)} is very small relative to ${fmtMoney(expensesPeriod)} of costs. If ${periodLabel} is still early (few days in), the picture will change as invoices get raised. Try switching to "Last quarter" or "Last 12 months" for a fuller view.`,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      label: 'Keep going',
      text: 'The numbers this period are inside a reasonable range. Use the chart below to watch for any month where the expense bar starts catching up to revenue.',
    });
  }

  const toneClasses: Record<typeof verdict.tone, string> = {
    positive: 'text-positive',
    warning: 'text-warning',
    negative: 'text-negative',
    neutral: 'text-ink-500',
  };

  return (
    <section className="card p-6">
      <div className="mb-4">
        <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
          What this screen is telling you
        </h2>
        <div className="smallcaps mt-2">Plain-English read of the numbers above</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 border hairline rounded-md p-4 bg-canvas-sunken">
          <div className="smallcaps mb-2">Bottom line</div>
          <div className={`font-display text-[18px] leading-tight tracking-tight ${toneClasses[verdict.tone]}`}>
            {verdict.headline}
          </div>
          <p className="text-xs text-ink-500 mt-3 leading-relaxed">{verdict.body}</p>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {suggestions.map((s) => (
            <div key={s.label} className="border hairline rounded-md p-4">
              <div className="smallcaps mb-1">{s.label}</div>
              <p className="text-sm text-ink-700 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Glossary footer - definitions for the four numbers in the hero */}
      <div className="mt-5 pt-4 border-t hairline grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="smallcaps mb-1">Net margin</div>
          <p className="text-ink-500 leading-relaxed">What's left of every dollar of revenue after ALL costs. 10%+ is healthy, negative means you lost money.</p>
        </div>
        <div>
          <div className="smallcaps mb-1">Gross margin</div>
          <p className="text-ink-500 leading-relaxed">What's left after direct cost-of-sale only (before rent, salaries, tools). Shows how profitable the work itself is.</p>
        </div>
        <div>
          <div className="smallcaps mb-1">Revenue / profit delta</div>
          <p className="text-ink-500 leading-relaxed">How this period compares to the one right before it. -91% revenue means you billed about a tenth of last period.</p>
        </div>
        <div>
          <div className="smallcaps mb-1">12-month direction</div>
          <p className="text-ink-500 leading-relaxed">Rolling 6-month average vs the 6 before it. "Improving" = trend getting better, not that this period is profitable.</p>
        </div>
      </div>
    </section>
  );
}

function TrendArrow({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'flat') {
    return <span className="text-ink-400 text-[20px]" aria-label="flat">-</span>;
  }
  const up = direction === 'up';
  return (
    <svg
      className={up ? 'text-positive' : 'text-negative'}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={up ? 'trending up' : 'trending down'}
    >
      {up ? (
        <>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </>
      ) : (
        <>
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </>
      )}
    </svg>
  );
}

export default function Profit() {
  const { user, adminActiveTenantId } = useAuth();
  const chart = useChartColors();
  const period = usePrefs((s) => s.period);
  const setPeriod = usePrefs((s) => s.setPeriod);

  const needsTenantSelection = user?.role === 'admin' && !adminActiveTenantId;

  const q = useQuery<ProfitData>({
    queryKey: ['profit', period, adminActiveTenantId],
    queryFn: () => api.get(`/api/dashboard/profit?period=${encodeURIComponent(period)}`),
    enabled: !!user && !needsTenantSelection,
  });

  if (needsTenantSelection) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center mt-10">
        <h2 className="font-display text-2xl text-ink-900 mb-3">Pick a tenant first</h2>
      </div>
    );
  }

  const d = q.data;
  const h = d?.hero;

  return (
    <div className="space-y-8">
      <PageHeader
        tag="Profit"
        title={d?.period.label ? `Are we making money? · ${d.period.label}` : 'Are we making money?'}
        meta={
          h ? (
            <>
              Revenue <span className="num text-ink-900">{fmtMoney(h.revenuePeriod)}</span> ·
              Expenses <span className="num text-ink-900">{fmtMoney(h.expensesPeriod)}</span> ·
              Net <span className={`num ${h.netProfitPeriod >= 0 ? 'text-positive' : 'text-negative'}`}>
                {fmtMoneySigned(h.netProfitPeriod)}
              </span>
            </>
          ) : (
            <>Loading profit...</>
          )
        }
        right={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {q.isLoading && <div className="text-ink-400 text-sm">Loading profit...</div>}
      {q.error && (
        <div className="card p-4 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {(q.error as Error).message}
        </div>
      )}

      {d && h && (
        <>
          {/* HERO - big margin number + delta + 12mo trend arrow */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-6 lg:col-span-2">
              <div className="smallcaps">Net margin this period</div>
              {h.revenuePeriod === 0 ? (
                <div className="mt-4">
                  <div className="font-display text-[32px] text-ink-400 leading-none">No revenue in period</div>
                  <div className="text-xs text-ink-400 mt-3">
                    There are no authorised or paid sales invoices dated in {d.period.label}. Pick a different period.
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-4 mt-3">
                  <SlotNumber
                    value={h.netMarginPct}
                    format={(n) => `${n.toFixed(1)}%`}
                    className={`font-display font-medium tracking-tight text-[72px] leading-none num ${marginTone(h.netMarginPct)}`}
                  />
                  {h.marginDeltaPts !== null && (
                    <div
                      className={`pb-3 flex items-center gap-1 text-sm font-medium ${
                        h.marginDeltaPts >= 0 ? 'text-positive' : 'text-negative'
                      }`}
                    >
                      <span>{h.marginDeltaPts >= 0 ? '+' : ''}{h.marginDeltaPts.toFixed(1)} pts</span>
                      <span className="text-ink-400 font-normal">vs prior</span>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-5 flex gap-6 text-xs text-ink-500">
                <div>
                  <div className="smallcaps">Gross margin</div>
                  <div className="num text-ink-900 text-base mt-1">{fmtPct(h.grossMargin)}</div>
                </div>
                <div>
                  <div className="smallcaps">Revenue delta</div>
                  <div className={`num text-base mt-1 ${h.revenueDeltaPct === null ? 'text-ink-900' : h.revenueDeltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {h.revenueDeltaPct === null ? '-' : `${h.revenueDeltaPct >= 0 ? '+' : ''}${h.revenueDeltaPct.toFixed(0)}%`}
                  </div>
                </div>
                <div>
                  <div className="smallcaps">Profit delta</div>
                  <div className={`num text-base mt-1 ${h.profitDeltaPct === null ? 'text-ink-900' : h.profitDeltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {h.profitDeltaPct === null ? '-' : `${h.profitDeltaPct >= 0 ? '+' : ''}${h.profitDeltaPct.toFixed(0)}%`}
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-6 flex flex-col">
              <div className="smallcaps">12-month direction</div>
              <div className="flex items-center gap-4 mt-4">
                <TrendArrow direction={h.trendDirection} />
                <div
                  className={`font-display text-[28px] leading-none tracking-tight ${
                    h.trendDirection === 'up'
                      ? 'text-positive'
                      : h.trendDirection === 'down'
                        ? 'text-negative'
                        : 'text-ink-900'
                  }`}
                >
                  {h.trendDirection === 'up'
                    ? 'Improving'
                    : h.trendDirection === 'down'
                      ? 'Declining'
                      : 'Flat'}
                </div>
              </div>
              <div className="text-xs text-ink-400 mt-4 leading-relaxed">
                Average monthly net profit over the last six months compared to the six months before that.
              </div>
            </div>
          </section>

          <ProfitExplainer hero={h} periodLabel={d.period.label} />

          {/* THE GAP CHART */}
          <section className="card p-6">
            <div className="mb-4">
              <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                The gap
              </h2>
              <div className="smallcaps mt-2">Revenue vs expenses, with net profit line - last 12 months</div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="month" fontSize={11} stroke={chart.axis} />
                <YAxis
                  fontSize={11}
                  stroke={chart.axis}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => fmtMoney(v)}
                  contentStyle={{
                    borderRadius: 8,
                    border: `1px solid ${chart.tooltipBorder}`,
                    fontSize: 12,
                    background: chart.tooltipBg,
                    color: chart.tooltipText,
                  }}
                  labelStyle={{ color: chart.tooltipText }}
                />
                <ReferenceLine y={0} stroke={chart.axis} />
                <Bar dataKey="revenue" fill={chart.green} name="Revenue" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" fill="#B45309" name="Expenses" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="net" stroke={chart.tooltipText} strokeWidth={2.5} dot={false} name="Net profit" />
              </ComposedChart>
            </ResponsiveContainer>
          </section>

          {/* BIGGEST MOVERS */}
          {d.biggestMovers.length > 0 && (
            <section className="card p-0 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b hairline">
                <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                  Biggest expense movers
                </h2>
                <div className="smallcaps mt-2">Vendors whose spend changed the most vs prior period</div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline">
                    <th className="smallcaps font-medium text-left py-3 px-6">Vendor</th>
                    <th className="smallcaps font-medium text-right py-3 px-6">This period</th>
                    <th className="smallcaps font-medium text-right py-3 px-6">Prior</th>
                    <th className="smallcaps font-medium text-right py-3 px-6">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {d.biggestMovers.map((v) => (
                    <tr key={v.contactId} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                      <td className="px-6 py-3 text-ink-900 font-medium">{v.name}</td>
                      <td className="px-6 py-3 text-right num text-ink-900">{fmtMoney(v.amount)}</td>
                      <td className="px-6 py-3 text-right num text-ink-500">{fmtMoney(v.priorAmount)}</td>
                      <td className={`px-6 py-3 text-right num font-medium ${v.delta >= 0 ? 'text-negative' : 'text-positive'}`}>
                        {v.delta >= 0 ? '+' : '-'}{fmtMoney(Math.abs(v.delta))}
                        {v.deltaPct !== null && (
                          <span className="text-ink-400 text-xs ml-2">({v.deltaPct >= 0 ? '+' : ''}{v.deltaPct.toFixed(0)}%)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* VENDOR BREAKDOWN */}
          {d.vendors.length > 0 && (
            <section className="card p-0 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b hairline">
                <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                  Where the money went
                </h2>
                <div className="smallcaps mt-2">Top vendors by spend this period</div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline">
                    <th className="smallcaps font-medium text-left py-3 px-6">Vendor</th>
                    <th className="smallcaps font-medium text-right py-3 px-6">Amount</th>
                    <th className="smallcaps font-medium text-right py-3 px-6">% of total</th>
                    <th className="py-3 px-6 w-[35%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {d.vendors.map((v) => (
                    <tr key={v.contactId} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                      <td className="px-6 py-3 text-ink-900 font-medium">{v.name}</td>
                      <td className="px-6 py-3 text-right num text-ink-900">{fmtMoney(v.amount)}</td>
                      <td className="px-6 py-3 text-right num text-ink-700">{v.pctOfTotal.toFixed(0)}%</td>
                      <td className="px-6 py-3">
                        <div className="h-1.5 w-full rounded-full bg-canvas-sunken overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(2, v.pctOfTotal)}%`,
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
        </>
      )}
    </div>
  );
}
