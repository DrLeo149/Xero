import { getArAging, getHeadlineKpis, getTopCustomers } from './calculators.js';

export interface Suggestion {
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  metric?: number;
}

/**
 * Rule engine: looks at KPIs and flags working-capital / collection issues.
 * All rules are pure functions of the cached data - no Xero calls.
 */
export async function getSuggestions(tenantId: string): Promise<Suggestion[]> {
  const [kpis, ar, topCustomers] = await Promise.all([
    getHeadlineKpis(tenantId),
    getArAging(tenantId),
    getTopCustomers(tenantId, 10),
  ]);

  const s: Suggestion[] = [];

  // Cash runway
  if (kpis.runwayMonths !== null && kpis.runwayMonths < 3) {
    s.push({
      severity: 'critical',
      title: 'Cash runway below 3 months',
      detail: `At the current burn rate you have roughly ${kpis.runwayMonths.toFixed(1)} months of cash left. Review expenses and accelerate collections.`,
      metric: kpis.runwayMonths,
    });
  } else if (kpis.runwayMonths !== null && kpis.runwayMonths < 6) {
    s.push({
      severity: 'warn',
      title: 'Cash runway under 6 months',
      detail: `Runway is ${kpis.runwayMonths.toFixed(1)} months. Consider a funding conversation or cost review soon.`,
      metric: kpis.runwayMonths,
    });
  }

  // Current ratio
  if (kpis.currentRatio !== null && kpis.currentRatio < 1) {
    s.push({
      severity: 'critical',
      title: 'Current ratio below 1.0',
      detail: `Short-term liabilities exceed short-term assets (ratio ${kpis.currentRatio.toFixed(2)}). Liquidity risk - expect difficulty meeting near-term obligations.`,
      metric: kpis.currentRatio,
    });
  } else if (kpis.currentRatio !== null && kpis.currentRatio < 1.5) {
    s.push({
      severity: 'warn',
      title: 'Thin current ratio',
      detail: `Current ratio is ${kpis.currentRatio.toFixed(2)}. Healthy service businesses typically run 1.5-3.0.`,
      metric: kpis.currentRatio,
    });
  }

  // Overdue AR
  if (ar.buckets.d90plus > 0) {
    s.push({
      severity: 'critical',
      title: `${formatMoney(ar.buckets.d90plus)} stuck in 90+ day receivables`,
      detail: `This AR is unlikely to be collected without active intervention. Consider write-offs or a collections partner.`,
      metric: ar.buckets.d90plus,
    });
  }
  if (ar.buckets.d60 + ar.buckets.d90 > 0) {
    s.push({
      severity: 'warn',
      title: `${formatMoney(ar.buckets.d60 + ar.buckets.d90)} in 31-90 day overdue`,
      detail: `Schedule collections follow-up. Every day past due reduces probability of collection.`,
    });
  }

  // Customer concentration
  if (topCustomers.length > 0) {
    const total = topCustomers.reduce((s, c) => s + c.revenue, 0);
    const topShare = total > 0 ? topCustomers[0].revenue / total : 0;
    if (topShare > 0.4) {
      s.push({
        severity: 'warn',
        title: 'Customer concentration risk',
        detail: `Top client (${topCustomers[0].name}) represents ${(topShare * 100).toFixed(0)}% of revenue. Diversify the client base to reduce single-client exposure.`,
        metric: topShare,
      });
    }
  }

  // DSO
  if (kpis.dso !== null && kpis.dso > 60) {
    s.push({
      severity: 'warn',
      title: `High DSO (${kpis.dso.toFixed(0)} days)`,
      detail: `Cash conversion cycle is slow. Consider stricter payment terms, earlier follow-up, or deposits on new engagements.`,
      metric: kpis.dso,
    });
  }

  // Margins
  if (kpis.netMargin !== null && kpis.netMargin < 0) {
    s.push({
      severity: 'critical',
      title: 'Operating at a loss',
      detail: `Net margin is ${kpis.netMargin.toFixed(1)}%. Review highest-cost expense categories and pricing.`,
      metric: kpis.netMargin,
    });
  } else if (kpis.netMargin !== null && kpis.netMargin < 10) {
    s.push({
      severity: 'info',
      title: 'Thin net margin',
      detail: `Net margin is ${kpis.netMargin.toFixed(1)}%. Healthy service businesses typically target 15-25%.`,
      metric: kpis.netMargin,
    });
  }

  return s;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
