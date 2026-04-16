import { prisma } from '../db/client.js';

/**
 * KPI calculators. Pure functions over cached Xero data.
 * Each function queries the local DB (via Prisma) scoped to a tenantId
 * and returns plain JSON - no Xero API calls happen here.
 */

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthsAgo(n: number, from = new Date()) {
  return new Date(from.getFullYear(), from.getMonth() - n, 1);
}
function daysBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

export async function getRevenueTrend(tenantId: string, months = 12) {
  const since = monthsAgo(months - 1);
  const invoices = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCREC',
      status: { in: ['AUTHORISED', 'PAID'] },
      date: { gte: since },
    },
    select: { date: true, total: true },
  });
  const buckets = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = monthsAgo(i);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }
  for (const inv of invoices) {
    const key = `${inv.date.getFullYear()}-${String(inv.date.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) ?? 0) + inv.total);
  }
  return Array.from(buckets, ([month, revenue]) => ({ month, revenue }));
}

export async function getTopCustomers(tenantId: string, limit = 10) {
  const since = monthsAgo(11);
  const invoices = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCREC',
      status: { in: ['AUTHORISED', 'PAID'] },
      date: { gte: since },
      contactId: { not: null },
    },
    select: { contactId: true, contactName: true, total: true, amountDue: true },
  });
  const agg = new Map<string, { name: string; revenue: number; outstanding: number }>();
  for (const inv of invoices) {
    const k = inv.contactId!;
    const existing = agg.get(k) ?? { name: inv.contactName ?? 'Unknown', revenue: 0, outstanding: 0 };
    existing.revenue += inv.total;
    existing.outstanding += inv.amountDue;
    agg.set(k, existing);
  }
  return Array.from(agg, ([contactId, v]) => ({ contactId, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export async function getArAging(tenantId: string) {
  const now = new Date();
  const overdue = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCREC',
      status: 'AUTHORISED',
      amountDue: { gt: 0 },
    },
    select: { dueDate: true, amountDue: true, contactName: true, invoiceNumber: true, id: true, date: true },
  });
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const inv of overdue) {
    const due = inv.dueDate ?? inv.date;
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
    if (daysOverdue <= 0) buckets.current += inv.amountDue;
    else if (daysOverdue <= 30) buckets.d30 += inv.amountDue;
    else if (daysOverdue <= 60) buckets.d60 += inv.amountDue;
    else if (daysOverdue <= 90) buckets.d90 += inv.amountDue;
    else buckets.d90plus += inv.amountDue;
  }
  return {
    buckets,
    totalOutstanding: Object.values(buckets).reduce((a, b) => a + b, 0),
    overdueInvoices: overdue
      .map((i) => ({
        id: i.id,
        number: i.invoiceNumber,
        contact: i.contactName,
        amountDue: i.amountDue,
        daysOverdue: Math.floor((now.getTime() - (i.dueDate ?? i.date).getTime()) / 86_400_000),
      }))
      .filter((i) => i.daysOverdue > 0)
      .sort((a, b) => b.amountDue - a.amountDue)
      .slice(0, 10),
  };
}

export async function getApAging(tenantId: string) {
  const now = new Date();
  const bills = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCPAY',
      status: 'AUTHORISED',
      amountDue: { gt: 0 },
    },
    select: { dueDate: true, amountDue: true, date: true },
  });
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const b of bills) {
    const due = b.dueDate ?? b.date;
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
    if (daysOverdue <= 0) buckets.current += b.amountDue;
    else if (daysOverdue <= 30) buckets.d30 += b.amountDue;
    else if (daysOverdue <= 60) buckets.d60 += b.amountDue;
    else if (daysOverdue <= 90) buckets.d90 += b.amountDue;
    else buckets.d90plus += b.amountDue;
  }
  return {
    buckets,
    totalOutstanding: Object.values(buckets).reduce((a, b) => a + b, 0),
  };
}

export async function getInvoiceStatusSplit(tenantId: string) {
  const rows = await prisma.xeroInvoice.groupBy({
    by: ['status'],
    where: { tenantId, type: 'ACCREC' },
    _count: true,
    _sum: { total: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count, total: r._sum.total ?? 0 }));
}

/** Pull the most recent report snapshot of a given type. */
async function latestReport(tenantId: string, reportType: string) {
  const snap = await prisma.xeroReportSnapshot.findFirst({
    where: { tenantId, reportType },
    orderBy: { fetchedAt: 'desc' },
  });
  return snap ? JSON.parse(snap.payload) : null;
}

/**
 * Extract a headline value from a Xero Report JSON payload by row title.
 * Xero reports have a tree of rows; this walks them looking for a matching label.
 */
function findReportValue(payload: any, titleIncludes: string): number | null {
  if (!payload) return null;
  const reports = payload.reports ?? payload.Reports;
  if (!reports?.[0]) return null;
  const rows = reports[0].rows ?? reports[0].Rows ?? [];
  function walk(rs: any[]): number | null {
    for (const r of rs) {
      const children = r.rows ?? r.Rows;
      if (children) {
        const found = walk(children);
        if (found !== null) return found;
      }
      const cells = r.cells ?? r.Cells;
      if (cells?.length) {
        const label = String(cells[0]?.value ?? cells[0]?.Value ?? '').toLowerCase();
        if (label.includes(titleIncludes.toLowerCase())) {
          // Xero reports put the current period in cell[1] and (when a
          // comparison is requested) the prior period in cell[2]. We always
          // want the current period, so read index 1 - NOT the last cell,
          // which silently returns 0 on year-one tenants.
          const val = cells[1]?.value ?? cells[1]?.Value;
          const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
          if (!isNaN(n)) return n;
        }
      }
    }
    return null;
  }
  return walk(rows);
}

export async function getHeadlineKpis(tenantId: string) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const [pnl, bs, bank, recentBankTxns] = await Promise.all([
    latestReport(tenantId, 'ProfitAndLoss'),
    latestReport(tenantId, 'BalanceSheet'),
    latestReport(tenantId, 'BankSummary'),
    prisma.xeroBankTransaction.findMany({
      where: { tenantId, date: { gte: ninetyDaysAgo } },
      select: { total: true, type: true },
    }),
  ]);

  const totalRevenue = findReportValue(pnl, 'total income') ?? findReportValue(pnl, 'total revenue') ?? 0;
  const grossProfit = findReportValue(pnl, 'gross profit') ?? 0;
  const netProfit = findReportValue(pnl, 'net profit') ?? findReportValue(pnl, 'profit for the') ?? 0;
  // Xero's P&L uses "Total Operating Expenses" (not "Total Expenses") on
  // the standard layout; fall back to plain "total expenses" for layouts
  // that use it, and finally to revenue - net profit as a last resort.
  const totalExpenses =
    findReportValue(pnl, 'total operating expenses') ??
    findReportValue(pnl, 'total expenses') ??
    0;

  const cash = findReportValue(bs, 'total bank') ?? findReportValue(bank, 'total') ?? 0;
  const currentAssets = findReportValue(bs, 'total current assets') ?? 0;
  const currentLiabilities = findReportValue(bs, 'total current liabilities') ?? 0;
  const inventory = findReportValue(bs, 'inventory') ?? 0;

  const workingCapital = currentAssets - currentLiabilities;
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : null;
  const quickRatio = currentLiabilities > 0 ? (currentAssets - inventory) / currentLiabilities : null;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : null;
  const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : null;

  // DSO: (AR / Revenue) * days in period (assume 365 for TTM)
  const arOutstanding = findReportValue(bs, 'accounts receivable') ?? 0;
  const apOutstanding = findReportValue(bs, 'accounts payable') ?? 0;
  const dso = totalRevenue > 0 ? (arOutstanding / totalRevenue) * 365 : null;
  const dpo = totalExpenses > 0 ? (apOutstanding / totalExpenses) * 365 : null;

  // Runway: based on *actual* cash movement over the last 90 days, not P&L.
  // RECEIVE inflows minus SPEND outflows -> net cash change. If negative,
  // that's real burn and we compute months of runway. If zero or positive,
  // runwayStatus='profitable' tells the UI to show "Profitable" instead of
  // a blank dash.
  let netCash90 = 0;
  for (const t of recentBankTxns) {
    if (t.type === 'RECEIVE') netCash90 += t.total;
    else if (t.type === 'SPEND') netCash90 -= t.total;
  }
  const monthlyBurn = netCash90 < 0 ? Math.abs(netCash90) / 3 : 0;
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : null;
  const runwayStatus: 'burning' | 'profitable' | 'unknown' =
    recentBankTxns.length === 0 ? 'unknown' : monthlyBurn > 0 ? 'burning' : 'profitable';

  return {
    cash,
    revenueTTM: totalRevenue,
    grossProfit,
    grossMargin,
    netProfit,
    netMargin,
    workingCapital,
    currentRatio,
    quickRatio,
    arOutstanding,
    apOutstanding,
    dso,
    dpo,
    runwayMonths,
    runwayStatus,
  };
}
