import { prisma } from '../db/client.js';
import { getHeadlineKpis } from './calculators.js';
import { Period, priorPeriod } from './period.js';

/**
 * Profit page data - "are we making money, and is it getting better?"
 *
 * Period-aware:
 *   - Hero margin % and delta vs prior period of equal length
 *   - "The gap" chart: 12 months of revenue vs expenses vs net profit
 *   - Top vendors by spend in period
 *   - Biggest expense movers: per-vendor delta vs prior period
 *
 * All numbers come from cached ACCREC / ACCPAY invoices. Gross profit
 * comes from the latest P&L snapshot (point-in-time) because we don't
 * store per-invoice COGS breakdown.
 */

function monthsAgo(n: number, from = new Date()) {
  return new Date(from.getFullYear(), from.getMonth() - n, 1);
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date) {
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

async function sumInvoicesInRange(
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

/** 12-month revenue, expense, net profit series. */
async function twelveMonthTrend(tenantId: string) {
  const since = monthsAgo(11);
  const [revRows, expRows] = await Promise.all([
    prisma.xeroInvoice.findMany({
      where: {
        tenantId,
        type: 'ACCREC',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: since },
      },
      select: { date: true, total: true },
    }),
    prisma.xeroInvoice.findMany({
      where: {
        tenantId,
        type: 'ACCPAY',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: since },
      },
      select: { date: true, total: true },
    }),
  ]);

  const buckets = new Map<string, { month: string; revenue: number; expenses: number; net: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = monthsAgo(i);
    buckets.set(monthKey(d), { month: monthLabel(d), revenue: 0, expenses: 0, net: 0 });
  }
  for (const inv of revRows) {
    const b = buckets.get(monthKey(inv.date));
    if (b) b.revenue += inv.total;
  }
  for (const inv of expRows) {
    const b = buckets.get(monthKey(inv.date));
    if (b) b.expenses += inv.total;
  }
  for (const b of buckets.values()) b.net = b.revenue - b.expenses;
  return Array.from(buckets.values());
}

/** Per-vendor spend in a period, with prior-period delta. */
async function vendorBreakdown(tenantId: string, period: Period) {
  const prior = priorPeriod(period);
  const [current, previous] = await Promise.all([
    prisma.xeroInvoice.findMany({
      where: {
        tenantId,
        type: 'ACCPAY',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: period.start, lt: period.end },
      },
      select: { contactId: true, contactName: true, total: true },
    }),
    prisma.xeroInvoice.findMany({
      where: {
        tenantId,
        type: 'ACCPAY',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: prior.start, lt: prior.end },
      },
      select: { contactId: true, total: true },
    }),
  ]);

  const curMap = new Map<string, { name: string; amount: number }>();
  for (const inv of current) {
    const k = inv.contactId ?? 'unknown';
    const existing = curMap.get(k) ?? { name: inv.contactName ?? 'Unknown vendor', amount: 0 };
    existing.amount += inv.total;
    curMap.set(k, existing);
  }
  const priorMap = new Map<string, number>();
  for (const inv of previous) {
    const k = inv.contactId ?? 'unknown';
    priorMap.set(k, (priorMap.get(k) ?? 0) + inv.total);
  }

  const totalCurrent = Array.from(curMap.values()).reduce((s, v) => s + v.amount, 0);
  const rows = Array.from(curMap, ([contactId, v]) => {
    const priorAmount = priorMap.get(contactId) ?? 0;
    const delta = v.amount - priorAmount;
    const deltaPct = priorAmount > 0 ? (delta / priorAmount) * 100 : null;
    return {
      contactId,
      name: v.name,
      amount: v.amount,
      pctOfTotal: totalCurrent > 0 ? (v.amount / totalCurrent) * 100 : 0,
      priorAmount,
      delta,
      deltaPct,
    };
  }).sort((a, b) => b.amount - a.amount);

  return { totalCurrent, rows };
}

export async function getProfitData(tenantId: string, period: Period) {
  const prior = priorPeriod(period);
  const [
    revenuePeriod,
    expensesPeriod,
    revenuePrior,
    expensesPrior,
    trend,
    vendors,
    kpis,
  ] = await Promise.all([
    sumInvoicesInRange(tenantId, 'ACCREC', period.start, period.end),
    sumInvoicesInRange(tenantId, 'ACCPAY', period.start, period.end),
    sumInvoicesInRange(tenantId, 'ACCREC', prior.start, prior.end),
    sumInvoicesInRange(tenantId, 'ACCPAY', prior.start, prior.end),
    twelveMonthTrend(tenantId),
    vendorBreakdown(tenantId, period),
    getHeadlineKpis(tenantId),
  ]);

  const netProfitPeriod = revenuePeriod - expensesPeriod;
  const netProfitPrior = revenuePrior - expensesPrior;

  const netMarginPct = revenuePeriod > 0 ? (netProfitPeriod / revenuePeriod) * 100 : null;
  const netMarginPriorPct = revenuePrior > 0 ? (netProfitPrior / revenuePrior) * 100 : null;
  const marginDeltaPts =
    netMarginPct !== null && netMarginPriorPct !== null ? netMarginPct - netMarginPriorPct : null;

  const revenueDeltaPct = revenuePrior > 0 ? ((revenuePeriod - revenuePrior) / revenuePrior) * 100 : null;
  const profitDeltaPct =
    netProfitPrior !== 0 ? ((netProfitPeriod - netProfitPrior) / Math.abs(netProfitPrior)) * 100 : null;

  // 12-month trend direction: compare avg net profit of first 6 months vs last 6
  const first6 = trend.slice(0, 6).reduce((s, t) => s + t.net, 0) / 6;
  const last6 = trend.slice(6).reduce((s, t) => s + t.net, 0) / 6;
  const trendDirection: 'up' | 'down' | 'flat' =
    Math.abs(last6 - first6) < Math.abs(first6) * 0.05 ? 'flat' : last6 > first6 ? 'up' : 'down';

  // Biggest movers - vendors whose spend changed the most vs prior period
  const biggestMovers = [...vendors.rows]
    .filter((r) => r.priorAmount > 0 || r.amount > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  return {
    period: { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label },
    hero: {
      revenuePeriod,
      expensesPeriod,
      netProfitPeriod,
      netMarginPct,
      marginDeltaPts,
      revenueDeltaPct,
      profitDeltaPct,
      trendDirection,
      grossMargin: kpis.grossMargin,
    },
    trend,
    vendors: vendors.rows.slice(0, 12),
    biggestMovers,
  };
}
