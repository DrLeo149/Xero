import { prisma } from '../db/client.js';
import type { Period } from './period.js';

/**
 * Customer analysis over a user-chosen period (defaults to trailing 12 months).
 * Concentration %, revenue, slow-pay averages are all computed on the period
 * window. "Slipping" (H1 vs H2) only applies when the period is at least
 * 60 days wide - otherwise halves are too short to be meaningful.
 */

export type RiskFlag = 'concentration' | 'slow-pay' | 'slipping' | 'overdue' | 'healthy';

export interface CustomerRow {
  contactId: string;
  name: string;
  revenueTTM: number;
  pctOfTotal: number;
  outstanding: number;
  avgDaysToPay: number | null;
  lastInvoiceDate: string | null;
  risks: RiskFlag[];
}

const DAY = 86_400_000;

export async function getCustomerAnalysis(tenantId: string, period: Period) {
  const now = new Date();
  const windowStart = period.start;
  const windowEnd = period.end;
  const spanDays = Math.round((windowEnd.getTime() - windowStart.getTime()) / DAY);
  const canSplitHalves = spanDays >= 60;
  const halfStart = canSplitHalves
    ? new Date(windowStart.getTime() + (windowEnd.getTime() - windowStart.getTime()) / 2)
    : windowEnd; // degenerate - nothing falls in H1

  // Pull everything we'll need in one query - ACCREC only, period window.
  const invoices = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCREC',
      status: { in: ['AUTHORISED', 'PAID'] },
      date: { gte: windowStart, lt: windowEnd },
      contactId: { not: null },
    },
    select: {
      contactId: true,
      contactName: true,
      date: true,
      dueDate: true,
      total: true,
      amountDue: true,
      status: true,
      fullyPaidOnDate: true,
      updatedDateUtc: true,
    },
  });

  // Also pull currently-outstanding (any age) so outstanding column is accurate
  // even for customers whose last invoice was >12mo ago.
  const outstandingRows = await prisma.xeroInvoice.findMany({
    where: {
      tenantId,
      type: 'ACCREC',
      status: 'AUTHORISED',
      amountDue: { gt: 0 },
      contactId: { not: null },
    },
    select: {
      contactId: true,
      contactName: true,
      amountDue: true,
      dueDate: true,
      date: true,
    },
  });

  type Bucket = {
    name: string;
    revenueTTM: number;   // revenue in the selected period (name kept for back-compat)
    revenueH1: number;    // recent half of period
    revenueH2: number;    // prior half of period
    payDaysSum: number;
    payDaysCount: number;
    lastInvoiceDate: Date | null;
  };
  const byContact = new Map<string, Bucket>();

  function bucket(id: string, name: string): Bucket {
    let b = byContact.get(id);
    if (!b) {
      b = { name, revenueTTM: 0, revenueH1: 0, revenueH2: 0, payDaysSum: 0, payDaysCount: 0, lastInvoiceDate: null };
      byContact.set(id, b);
    }
    return b;
  }

  for (const inv of invoices) {
    if (!inv.contactId) continue;
    const b = bucket(inv.contactId, inv.contactName ?? 'Unknown');
    b.revenueTTM += inv.total;
    if (inv.date >= halfStart) b.revenueH1 += inv.total;
    else b.revenueH2 += inv.total;

    if (!b.lastInvoiceDate || inv.date > b.lastInvoiceDate) b.lastInvoiceDate = inv.date;

    // Avg days to pay: prefer Xero's authoritative FullyPaidOnDate. Fall back to
    // updatedDateUtc only if FullyPaidOnDate is missing (older rows pre-schema-change).
    if (inv.status === 'PAID' && inv.amountDue === 0) {
      const paidOn = inv.fullyPaidOnDate ?? inv.updatedDateUtc;
      const days = Math.round((paidOn.getTime() - inv.date.getTime()) / DAY);
      if (days >= 0 && days < 365) {
        b.payDaysSum += days;
        b.payDaysCount += 1;
      }
    }
  }

  // Outstanding per contact (all-time, not just TTM)
  const outstandingMap = new Map<string, { total: number; hasOverdue60: boolean; name: string }>();
  for (const r of outstandingRows) {
    if (!r.contactId) continue;
    const existing = outstandingMap.get(r.contactId) ?? { total: 0, hasOverdue60: false, name: r.contactName ?? 'Unknown' };
    existing.total += r.amountDue;
    const due = r.dueDate ?? r.date;
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / DAY);
    if (daysOverdue > 60) existing.hasOverdue60 = true;
    outstandingMap.set(r.contactId, existing);
  }

  // Merge outstanding-only contacts into byContact (so they show in the table)
  for (const [id, o] of outstandingMap) {
    if (!byContact.has(id)) {
      bucket(id, o.name);
    }
  }

  const totalRevenue = Array.from(byContact.values()).reduce((s, b) => s + b.revenueTTM, 0);

  const rows: CustomerRow[] = Array.from(byContact, ([contactId, b]) => {
    const outstanding = outstandingMap.get(contactId);
    const pctOfTotal = totalRevenue > 0 ? (b.revenueTTM / totalRevenue) * 100 : 0;
    const avgDaysToPay = b.payDaysCount > 0 ? b.payDaysSum / b.payDaysCount : null;

    const risks: RiskFlag[] = [];
    if (pctOfTotal >= 20) risks.push('concentration');
    if (avgDaysToPay !== null && avgDaysToPay > 60) risks.push('slow-pay');
    if (canSplitHalves && b.revenueH2 > 0 && b.revenueH1 < b.revenueH2 * 0.7) risks.push('slipping');
    if (outstanding?.hasOverdue60) risks.push('overdue');
    if (risks.length === 0) risks.push('healthy');

    return {
      contactId,
      name: b.name,
      revenueTTM: b.revenueTTM,
      pctOfTotal,
      outstanding: outstanding?.total ?? 0,
      avgDaysToPay,
      lastInvoiceDate: b.lastInvoiceDate ? b.lastInvoiceDate.toISOString() : null,
      risks,
    };
  }).sort((a, b) => b.revenueTTM - a.revenueTTM);

  // Top 10 for the concentration chart + Others bucket
  const top10 = rows.slice(0, 10);
  const othersRevenue = rows.slice(10).reduce((s, r) => s + r.revenueTTM, 0);
  const othersPct = totalRevenue > 0 ? (othersRevenue / totalRevenue) * 100 : 0;

  const topCustomer = rows[0] ?? null;
  const concentrationTone: 'healthy' | 'warn' | 'critical' =
    !topCustomer ? 'healthy'
    : topCustomer.pctOfTotal >= 30 ? 'critical'
    : topCustomer.pctOfTotal >= 15 ? 'warn'
    : 'healthy';

  return {
    totalRevenueTTM: totalRevenue,
    customerCount: rows.length,
    topCustomerName: topCustomer?.name ?? null,
    topCustomerPct: topCustomer?.pctOfTotal ?? 0,
    concentrationTone,
    concentrationBar: [
      ...top10.map((r) => ({ name: r.name, pct: r.pctOfTotal, revenue: r.revenueTTM })),
      ...(othersRevenue > 0 ? [{ name: 'Others', pct: othersPct, revenue: othersRevenue }] : []),
    ],
    rows,
  };
}
