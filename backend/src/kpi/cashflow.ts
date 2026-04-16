import { prisma } from '../db/client.js';
import { getHeadlineKpis, getArAging, getApAging } from './calculators.js';
import { Period } from './period.js';

/**
 * Cash Flow page data. Composes existing AR/AP calculators with a
 * 90-day cash movement waterfall built from bank transactions.
 *
 * Hero metrics are point-in-time (now): cash on hand, DSO, DPO, CCC.
 * Aging buckets are point-in-time too - aging only makes sense "as of now".
 * Collections list is sorted by pain = amount × days overdue.
 */

const DAY = 86_400_000;

export interface AgingBuckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
}

export interface CashFlowData {
  hero: {
    cash: number;
    dso: number | null;
    dpo: number | null;
    ccc: number | null; // cash conversion cycle
    arTotal: number;
    apTotal: number;
    netWorkingCapital: number; // AR − AP, quick proxy
  };
  ar: {
    buckets: AgingBuckets;
    totalOutstanding: number;
    overduePct: number; // % of AR that's past due
  };
  ap: {
    buckets: AgingBuckets;
    totalOutstanding: number;
    overduePct: number;
  };
  collections: {
    id: string;
    number: string | null;
    contact: string | null;
    amountDue: number;
    daysOverdue: number;
    painScore: number; // amountDue × daysOverdue, used for sorting
  }[];
  movement: {
    label: string;
    inflow: number;
    outflow: number;
    net: number;
    series: { date: string; inflow: number; outflow: number; cumulative: number }[];
  };
}

export async function getCashFlowData(tenantId: string, period?: Period): Promise<CashFlowData> {
  const [kpis, ar, ap] = await Promise.all([
    getHeadlineKpis(tenantId),
    getArAging(tenantId),
    getApAging(tenantId),
  ]);

  // DSO/DPO must respond to the period picker. getHeadlineKpis gives us
  // trailing-12-month numbers which never change when the user switches
  // periods - so we recompute here using revenue/expenses from invoices
  // actually dated inside the selected window. AR/AP are still point-in-time
  // (aging only makes sense "as of now"), but the ratio of those balances to
  // period activity is what actually shifts with the picker.
  const now = new Date();
  const heroStart = period ? period.start : new Date(now.getTime() - 90 * DAY);
  const heroEnd = period ? period.end : now;
  const heroDays = Math.max(1, Math.round((heroEnd.getTime() - heroStart.getTime()) / DAY));

  const [periodSales, periodBills] = await Promise.all([
    prisma.xeroInvoice.aggregate({
      where: {
        tenantId,
        type: 'ACCREC',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: heroStart, lt: heroEnd },
      },
      _sum: { total: true },
    }),
    prisma.xeroInvoice.aggregate({
      where: {
        tenantId,
        type: 'ACCPAY',
        status: { in: ['AUTHORISED', 'PAID'] },
        date: { gte: heroStart, lt: heroEnd },
      },
      _sum: { total: true },
    }),
  ]);

  const periodRevenue = periodSales._sum.total ?? 0;
  const periodExpenses = periodBills._sum.total ?? 0;
  const dso = periodRevenue > 0 ? (ar.totalOutstanding / periodRevenue) * heroDays : null;
  const dpo = periodExpenses > 0 ? (ap.totalOutstanding / periodExpenses) * heroDays : null;

  // Cash conversion cycle = DSO + DIO − DPO. We don't have inventory days,
  // so approximate CCC = DSO − DPO (operating cycle for a service business).
  const ccc = dso !== null && dpo !== null ? dso - dpo : null;

  const arOverdueTotal = ar.buckets.d30 + ar.buckets.d60 + ar.buckets.d90 + ar.buckets.d90plus;
  const apOverdueTotal = ap.buckets.d30 + ap.buckets.d60 + ap.buckets.d90 + ap.buckets.d90plus;

  // Cash movement from bank transactions. Default window is trailing 90
  // days (good for "how's the tank right now"), but when the caller passes
  // a period we honour it so the chart follows the tab's picker.
  const rangeStart = heroStart;
  const rangeEnd = heroEnd;
  const rangeDays = heroDays;
  const movementLabel = period ? period.label : 'Last 90 days';
  const txns = await prisma.xeroBankTransaction.findMany({
    where: {
      tenantId,
      status: 'AUTHORISED',
      date: { gte: rangeStart, lt: rangeEnd },
    },
    select: { date: true, total: true, type: true },
    orderBy: { date: 'asc' },
  });

  const byDay = new Map<string, { inflow: number; outflow: number }>();
  let inflow = 0;
  let outflow = 0;
  for (const t of txns) {
    const key = t.date.toISOString().slice(0, 10);
    const cell = byDay.get(key) ?? { inflow: 0, outflow: 0 };
    if (t.type === 'RECEIVE') {
      cell.inflow += t.total;
      inflow += t.total;
    } else if (t.type === 'SPEND') {
      cell.outflow += t.total;
      outflow += t.total;
    }
    byDay.set(key, cell);
  }
  // Dense daily series with cumulative running net across the chosen window.
  const series: { date: string; inflow: number; outflow: number; cumulative: number }[] = [];
  let cum = 0;
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(rangeStart.getTime() + i * DAY);
    const key = d.toISOString().slice(0, 10);
    const cell = byDay.get(key) ?? { inflow: 0, outflow: 0 };
    cum += cell.inflow - cell.outflow;
    series.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      inflow: cell.inflow,
      outflow: cell.outflow,
      cumulative: cum,
    });
  }

  // Rank collections by pain = amount × days overdue
  const collections = ar.overdueInvoices
    .map((inv) => ({
      ...inv,
      painScore: inv.amountDue * Math.max(1, inv.daysOverdue),
    }))
    .sort((a, b) => b.painScore - a.painScore)
    .slice(0, 10);

  return {
    hero: {
      cash: kpis.cash,
      dso,
      dpo,
      ccc,
      arTotal: ar.totalOutstanding,
      apTotal: ap.totalOutstanding,
      netWorkingCapital: ar.totalOutstanding - ap.totalOutstanding,
    },
    ar: {
      buckets: ar.buckets,
      totalOutstanding: ar.totalOutstanding,
      overduePct: ar.totalOutstanding > 0 ? (arOverdueTotal / ar.totalOutstanding) * 100 : 0,
    },
    ap: {
      buckets: ap.buckets,
      totalOutstanding: ap.totalOutstanding,
      overduePct: ap.totalOutstanding > 0 ? (apOverdueTotal / ap.totalOutstanding) * 100 : 0,
    },
    collections,
    movement: {
      label: movementLabel,
      inflow,
      outflow,
      net: inflow - outflow,
      series,
    },
  };
}
