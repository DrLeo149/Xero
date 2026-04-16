import { Router } from 'express';
import { requireAuth, resolveTenant } from '../middleware/auth.js';
import {
  getHeadlineKpis,
  getRevenueTrend,
  getTopCustomers,
  getArAging,
  getApAging,
  getInvoiceStatusSplit,
} from '../kpi/calculators.js';
import { getSuggestions } from '../kpi/suggestions.js';
import { parsePeriod } from '../kpi/period.js';
import { getPulseData } from '../kpi/pulse.js';
import { getCustomerAnalysis } from '../kpi/customers.js';
import { getCashFlowData } from '../kpi/cashflow.js';
import { getProfitData } from '../kpi/profit.js';
import { prisma } from '../db/client.js';

export const dashboardRouter = Router();

dashboardRouter.get('/pulse', requireAuth, resolveTenant(true), async (req, res) => {
  try {
    const period = parsePeriod(req.query as Record<string, any>);
    const data = await getPulseData(req.tenantId!, period);
    res.json(data);
  } catch (e: any) {
    console.error('[dashboard/pulse]', e);
    res.status(500).json({ error: e.message });
  }
});

dashboardRouter.get('/profit', requireAuth, resolveTenant(true), async (req, res) => {
  try {
    const period = parsePeriod(req.query as Record<string, any>);
    const data = await getProfitData(req.tenantId!, period);
    res.json(data);
  } catch (e: any) {
    console.error('[dashboard/profit]', e);
    res.status(500).json({ error: e.message });
  }
});

dashboardRouter.get('/cashflow', requireAuth, resolveTenant(true), async (req, res) => {
  try {
    const raw = req.query as Record<string, any>;
    // Period is optional on cashflow - defaults inside the calculator to
    // trailing 90 days when not provided.
    const period = raw.period || raw.start ? parsePeriod(raw) : undefined;
    const data = await getCashFlowData(req.tenantId!, period);
    res.json(data);
  } catch (e: any) {
    console.error('[dashboard/cashflow]', e);
    res.status(500).json({ error: e.message });
  }
});

dashboardRouter.get('/customers', requireAuth, resolveTenant(true), async (req, res) => {
  try {
    const raw = req.query as Record<string, any>;
    const period = parsePeriod({ ...raw, period: raw.period ?? 'ttm' });
    const data = await getCustomerAnalysis(req.tenantId!, period);
    res.json(data);
  } catch (e: any) {
    console.error('[dashboard/customers]', e);
    res.status(500).json({ error: e.message });
  }
});

dashboardRouter.get('/summary', requireAuth, resolveTenant(true), async (req, res) => {
  const tenantId = req.tenantId!;
  try {
    const [kpis, revenueTrend, topCustomers, ar, ap, invoiceSplit, suggestions, recent] =
      await Promise.all([
        getHeadlineKpis(tenantId),
        getRevenueTrend(tenantId, 12),
        getTopCustomers(tenantId, 10),
        getArAging(tenantId),
        getApAging(tenantId),
        getInvoiceStatusSplit(tenantId),
        getSuggestions(tenantId),
        prisma.xeroInvoice.findMany({
          where: { tenantId },
          orderBy: { date: 'desc' },
          take: 15,
          select: {
            id: true, invoiceNumber: true, contactName: true, date: true,
            total: true, amountDue: true, status: true, type: true,
          },
        }),
      ]);

    res.json({
      kpis,
      revenueTrend,
      topCustomers,
      arAging: ar,
      apAging: ap,
      invoiceStatusSplit: invoiceSplit,
      suggestions,
      recentInvoices: recent,
    });
  } catch (e: any) {
    console.error('[dashboard/summary]', e);
    res.status(500).json({ error: e.message });
  }
});

dashboardRouter.get('/sync-logs', requireAuth, resolveTenant(true), async (req, res) => {
  const logs = await prisma.syncLog.findMany({
    where: { tenantId: req.tenantId! },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  res.json(logs);
});
