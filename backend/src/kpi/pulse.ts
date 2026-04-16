import { prisma } from '../db/client.js';
import { getHeadlineKpis, getArAging, getTopCustomers } from './calculators.js';
import { Period, bucketStarts, bucketKey, bucketLabel, priorPeriod } from './period.js';

/**
 * Pulse page data - the "how's the business doing RIGHT NOW" view.
 *
 * Period affects:
 *   - The in-period net profit hero number
 *   - The revenue-vs-expenses chart window + bucketing
 *   - Alerts that compare period vs prior period
 *
 * Point-in-time numbers (cash, runway, AR outstanding) are NOT period-dependent.
 */

export interface PulseAlert {
  severity: 'critical' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
  /** Ranking score - higher = more urgent. */
  rank: number;
  /** Optional deep-link hint for the frontend. */
  link?: string;
}

async function sumInvoices(
  tenantId: string,
  type: 'ACCREC' | 'ACCPAY',
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type,
      status: { in: ['AUTHORISED', 'PAID'] },
      date: { gte: start, lt: end },
    },
    select: { total: true },
  });
  return rows.reduce((s, r) => s + r.total, 0);
}

async function timeSeriesInvoices(
  tenantId: string,
  type: 'ACCREC' | 'ACCPAY',
  period: Period,
) {
  const rows = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type,
      status: { in: ['AUTHORISED', 'PAID'] },
      date: { gte: period.start, lt: period.end },
    },
    select: { date: true, total: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = bucketKey(r.date, period.granularity);
    map.set(k, (map.get(k) ?? 0) + r.total);
  }
  return map;
}

/** Cash trend: 90 days of bank-transaction running balance. */
async function cashTrend(tenantId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const txns = await prisma.xeroBankTransaction.findMany({
    where: { tenantId, date: { gte: since }, status: 'AUTHORISED' },
    orderBy: { date: 'asc' },
    select: { date: true, total: true, type: true },
  });
  // Running cash delta - not an absolute balance, but the shape is what matters.
  const byDay = new Map<string, number>();
  for (const t of txns) {
    const k = bucketKey(t.date, 'day');
    const signed = t.type === 'RECEIVE' ? t.total : -t.total;
    byDay.set(k, (byDay.get(k) ?? 0) + signed);
  }
  // Fill in last 90 days
  const out: { date: string; delta: number; cumulative: number }[] = [];
  let cum = 0;
  const cur = new Date(since);
  while (cur <= new Date()) {
    const k = bucketKey(cur, 'day');
    const delta = byDay.get(k) ?? 0;
    cum += delta;
    out.push({
      date: bucketLabel(cur, 'day'),
      delta,
      cumulative: cum,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function getPulseData(tenantId: string, period: Period) {
  const [kpis, ar, topCustomers] = await Promise.all([
    getHeadlineKpis(tenantId),
    getArAging(tenantId),
    getTopCustomers(tenantId, 10),
  ]);

  // In-period revenue + expenses
  const [revenueThis, expensesThis, revenueMap, expenseMap, cash] = await Promise.all([
    sumInvoices(tenantId, 'ACCREC', period.start, period.end),
    sumInvoices(tenantId, 'ACCPAY', period.start, period.end),
    timeSeriesInvoices(tenantId, 'ACCREC', period),
    timeSeriesInvoices(tenantId, 'ACCPAY', period),
    cashTrend(tenantId),
  ]);

  // Prior period for deltas
  const prior = priorPeriod(period);
  const [revenuePrior, expensesPrior] = await Promise.all([
    sumInvoices(tenantId, 'ACCREC', prior.start, prior.end),
    sumInvoices(tenantId, 'ACCPAY', prior.start, prior.end),
  ]);

  const netProfitThis = revenueThis - expensesThis;
  const netProfitPrior = revenuePrior - expensesPrior;
  const revenueDeltaPct = revenuePrior > 0 ? ((revenueThis - revenuePrior) / revenuePrior) * 100 : null;
  const profitDeltaPct = netProfitPrior !== 0 ? ((netProfitThis - netProfitPrior) / Math.abs(netProfitPrior)) * 100 : null;

  // Revenue vs expenses series
  const starts = bucketStarts(period);
  const series = starts.map((d) => {
    const k = bucketKey(d, period.granularity);
    return {
      label: bucketLabel(d, period.granularity),
      revenue: revenueMap.get(k) ?? 0,
      expenses: expenseMap.get(k) ?? 0,
    };
  });

  // ---------- Alerts (ranked) ----------
  const alerts: PulseAlert[] = [];

  if (kpis.runwayMonths !== null) {
    if (kpis.runwayMonths < 4) {
      alerts.push({
        severity: 'critical',
        title: `Runway below 4 months`,
        detail: `At current burn (~${fmtMoney(kpis.cash / Math.max(1, kpis.runwayMonths))}/mo), cash lasts ${kpis.runwayMonths.toFixed(1)} months.`,
        rank: 1000 + (4 - kpis.runwayMonths) * 100,
        link: '/cash',
      });
    } else if (kpis.runwayMonths < 9) {
      alerts.push({
        severity: 'warn',
        title: `Runway under 9 months`,
        detail: `${kpis.runwayMonths.toFixed(1)} months of cash at current burn. Plan a funding or cost conversation.`,
        rank: 500 + (9 - kpis.runwayMonths) * 20,
        link: '/cash',
      });
    }
  }

  if (ar.buckets.d90plus > 0) {
    alerts.push({
      severity: 'critical',
      title: `${fmtMoney(ar.buckets.d90plus)} stuck in 90+ day receivables`,
      detail: `These invoices are unlikely to collect without active intervention.`,
      rank: 900 + Math.min(90, ar.buckets.d90plus / 1000),
      link: '/cash',
    });
  }
  if (ar.buckets.d60 > 0) {
    alerts.push({
      severity: 'warn',
      title: `${fmtMoney(ar.buckets.d60)} overdue 31-60 days`,
      detail: `${ar.overdueInvoices.filter((i) => i.daysOverdue > 30 && i.daysOverdue <= 60).length} invoices. Every day reduces collection probability.`,
      rank: 400 + Math.min(90, ar.buckets.d60 / 2000),
      link: '/cash',
    });
  }

  // Customer concentration
  if (topCustomers.length > 0) {
    const total = topCustomers.reduce((s, c) => s + c.revenue, 0);
    const topShare = total > 0 ? topCustomers[0].revenue / total : 0;
    if (topShare > 0.4) {
      alerts.push({
        severity: 'critical',
        title: `${topCustomers[0].name} is ${(topShare * 100).toFixed(0)}% of revenue`,
        detail: `Single-client concentration risk. Losing this client would be an extinction event.`,
        rank: 800 + topShare * 100,
        link: '/customers',
      });
    } else if (topShare > 0.25) {
      alerts.push({
        severity: 'warn',
        title: `${topCustomers[0].name} is ${(topShare * 100).toFixed(0)}% of revenue`,
        detail: `Concentration risk. Consider how exposed you'd be if this client left.`,
        rank: 300 + topShare * 100,
        link: '/customers',
      });
    }
  }

  // Profit trend
  if (netProfitThis < 0) {
    alerts.push({
      severity: 'critical',
      title: `Losing ${fmtMoney(-netProfitThis)} this period`,
      detail: `Expenses (${fmtMoney(expensesThis)}) exceed revenue (${fmtMoney(revenueThis)}) for ${period.label}.`,
      rank: 700,
      link: '/profit',
    });
  } else if (profitDeltaPct !== null && profitDeltaPct < -25 && netProfitPrior > 0) {
    alerts.push({
      severity: 'warn',
      title: `Profit down ${Math.abs(profitDeltaPct).toFixed(0)}% vs prior period`,
      detail: `Net profit fell from ${fmtMoney(netProfitPrior)} to ${fmtMoney(netProfitThis)}.`,
      rank: 350,
      link: '/profit',
    });
  }

  // DSO
  if (kpis.dso !== null && kpis.dso > 60) {
    alerts.push({
      severity: 'warn',
      title: `DSO is ${kpis.dso.toFixed(0)} days`,
      detail: `Cash conversion is slow. Tighter terms or earlier chase cycles would free up cash.`,
      rank: 200 + kpis.dso,
      link: '/cash',
    });
  }

  // If nothing wrong, surface an OK state so the panel isn't empty.
  if (alerts.length === 0) {
    alerts.push({
      severity: 'ok',
      title: 'All clear',
      detail: 'No risk flags on runway, collections, concentration or profitability. Keep going.',
      rank: 0,
    });
  }

  alerts.sort((a, b) => b.rank - a.rank);

  return {
    period: { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label },
    hero: {
      runwayMonths: kpis.runwayMonths,
      runwayStatus: kpis.runwayStatus,
      cash: kpis.cash,
      netProfitPeriod: netProfitThis,
      revenuePeriod: revenueThis,
      expensesPeriod: expensesThis,
      revenueDeltaPct,
      profitDeltaPct,
    },
    alerts: alerts.slice(0, 8),
    series,
    cashTrend: cash,
  };
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
