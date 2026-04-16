import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import { useChartColors } from '../stores/theme';
import PageHeader from '../components/PageHeader';
import PeriodSelector from '../components/PeriodSelector';
import SlotNumber from '../components/SlotNumber';

interface AgingBuckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
}

interface CashFlowData {
  hero: {
    cash: number;
    dso: number | null;
    dpo: number | null;
    ccc: number | null;
    arTotal: number;
    apTotal: number;
    netWorkingCapital: number;
  };
  ar: { buckets: AgingBuckets; totalOutstanding: number; overduePct: number };
  ap: { buckets: AgingBuckets; totalOutstanding: number; overduePct: number };
  collections: {
    id: string;
    number: string | null;
    contact: string | null;
    amountDue: number;
    daysOverdue: number;
    painScore: number;
  }[];
  movement: {
    label: string;
    inflow: number;
    outflow: number;
    net: number;
    series: { date: string; inflow: number; outflow: number; cumulative: number }[];
  };
}


const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtDays = (n: number | null) => (n === null ? '-' : `${Math.round(n)} d`);

const BUCKET_KEYS: { key: keyof AgingBuckets; label: string }[] = [
  { key: 'current',  label: 'Current' },
  { key: 'd30',      label: '1-30' },
  { key: 'd60',      label: '31-60' },
  { key: 'd90',      label: '61-90' },
  { key: 'd90plus',  label: '90+' },
];

// Heat ramp - neutral slate for "not yet due" (it's fine, not good),
// then a clean yellow -> orange -> red escalation so each bucket reads
// as a distinct step rather than five shades of brown.
const BUCKET_TONES: Record<keyof AgingBuckets, string> = {
  current: '#64748B', // slate-500 - neutral, "in flight"
  d30:     '#EAB308', // yellow-500
  d60:     '#F97316', // orange-500
  d90:     '#DC2626', // red-600
  d90plus: '#7F1D1D', // red-900 - deepest, "this hurts"
};

function cccTone(days: number | null): string {
  if (days === null) return 'text-ink-900';
  if (days < 30) return 'text-positive';
  if (days < 60) return 'text-warning';
  return 'text-negative';
}

/**
 * Reads the aging buckets and says, in one line, what's actually happening
 * and what to do about it. Direction ('ar' = money owed to us, 'ap' = money
 * we owe) flips the framing - late AR is bad, late AP is complicated.
 */
function agingRead(
  buckets: AgingBuckets,
  total: number,
  direction: 'ar' | 'ap',
): { tone: 'positive' | 'warning' | 'negative' | 'neutral'; headline: string; body: string } {
  if (total === 0) {
    return { tone: 'neutral', headline: 'Nothing outstanding', body: 'No balance in this bucket right now.' };
  }
  const overdue = buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90plus;
  const serious = buckets.d60 + buckets.d90 + buckets.d90plus;
  const overduePct = (overdue / total) * 100;
  const seriousPct = (serious / total) * 100;

  if (direction === 'ar') {
    if (overduePct < 10) {
      return {
        tone: 'positive',
        headline: 'Customers are paying on time',
        body: `Almost everything outstanding is still inside its due date. Nothing to chase right now.`,
      };
    }
    if (seriousPct > 30) {
      return {
        tone: 'negative',
        headline: `${fmtMoney(serious)} is 60+ days late`,
        body: `This is real stuck cash. Anything past 60 days starts to feel like a collection risk - push hard on these first. Use the queue below to send chase emails.`,
      };
    }
    if (overduePct > 50) {
      return {
        tone: 'warning',
        headline: `${overduePct.toFixed(0)}% of what you're owed is overdue`,
        body: `Most of this is in the 1-30 bucket - a light nudge usually moves it. Start with the biggest invoices in the collections queue below.`,
      };
    }
    return {
      tone: 'warning',
      headline: `${fmtMoney(overdue)} is past due`,
      body: `Not alarming yet, but worth a round of gentle reminders on anything sitting in the 1-30 bucket before it drifts older.`,
    };
  }

  // AP - money we owe
  if (overduePct < 10) {
    return {
      tone: 'positive',
      headline: 'Paying vendors on schedule',
      body: `Nothing meaningful is past due. Vendors stay happy and there's no late-fee exposure.`,
    };
  }
  if (seriousPct > 30) {
    return {
      tone: 'negative',
      headline: `${fmtMoney(serious)} of vendor bills is 60+ days late`,
      body: `This is the kind of overdue that damages supplier relationships and invites late fees or holds on service. Prioritise these before taking on new spend.`,
    };
  }
  if (overduePct > 50) {
    return {
      tone: 'warning',
      headline: `${overduePct.toFixed(0)}% of what you owe is past due`,
      body: `Stretching vendors preserves cash short-term but eventually bites back. If collections below come in, clear the oldest bills first.`,
    };
  }
  return {
    tone: 'warning',
    headline: `${fmtMoney(overdue)} is past due to vendors`,
    body: `A small slip - worth clearing the oldest bills next time cash comes in to avoid late fees.`,
  };
}

function AgingReadout({
  read,
}: {
  read: { tone: 'positive' | 'warning' | 'negative' | 'neutral'; headline: string; body: string };
}) {
  const toneClasses = {
    positive: 'text-positive',
    warning: 'text-warning',
    negative: 'text-negative',
    neutral: 'text-ink-500',
  } as const;
  return (
    <div className="mt-5 border-t hairline pt-4">
      <div className="smallcaps mb-1">What this means</div>
      <div className={`text-sm font-medium ${toneClasses[read.tone]}`}>{read.headline}</div>
      <p className="text-xs text-ink-500 mt-1 leading-relaxed">{read.body}</p>
    </div>
  );
}

type CashMetricKey = 'cash' | 'dso' | 'dpo' | 'ccc';

/**
 * Click-to-explain modal for the four Cash Flow hero cards. Mirrors the
 * Pulse MetricExplainerModal pattern - headline, what it is, how we compute,
 * what's good, and a "your number right now" read that walks through the
 * actual arithmetic with real values.
 */
function CashMetricExplainerModal({
  metric,
  hero,
  onClose,
}: {
  metric: CashMetricKey;
  hero: CashFlowData['hero'];
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  type Section = {
    title: string;
    oneLiner: string;
    whatItIs: string;
    howWeCompute: string;
    whatsGood: string;
    yourRead: { tone: 'positive' | 'warning' | 'negative' | 'neutral'; text: string };
  };

  const { cash, dso, dpo, ccc, arTotal, apTotal } = hero;

  let s: Section;
  if (metric === 'cash') {
    const buffer = apTotal > 0 ? cash / apTotal : null;
    s = {
      title: 'Cash on hand',
      oneLiner: 'Total sitting in your bank accounts right now. The bigger your buffer, the less any single late payment hurts.',
      whatItIs:
        'The sum of every bank account Xero is connected to, as of your last sync. This is real, spendable money - not revenue, not receivables, just cash.',
      howWeCompute:
        'We pull the balance sheet from Xero and read the "Total Bank" row. If that is missing we fall back to the Bank Summary report. Both come straight from your bank feeds.',
      whatsGood:
        'A rough rule of thumb: enough cash to cover at least 2-3 months of operating expenses, and always more than what you owe vendors right now.',
      yourRead:
        apTotal === 0
          ? { tone: 'neutral', text: `You have ${fmtMoney(cash)} across all bank accounts. No vendor bills outstanding right now, so nothing immediate is competing for this cash.` }
          : buffer !== null && buffer >= 2
            ? { tone: 'positive', text: `You have ${fmtMoney(cash)} in the bank and owe vendors ${fmtMoney(apTotal)}. That's ${buffer.toFixed(1)}x coverage - comfortable buffer.` }
            : buffer !== null && buffer >= 1
              ? { tone: 'warning', text: `You have ${fmtMoney(cash)} in the bank and owe vendors ${fmtMoney(apTotal)}. You can cover current bills, but there's almost no slack if a customer pays late.` }
              : { tone: 'negative', text: `You have ${fmtMoney(cash)} in the bank but owe vendors ${fmtMoney(apTotal)}. Cash does not cover what's due - you're relying on collections landing before bills fall due.` },
    };
  } else if (metric === 'dso') {
    s = {
      title: 'DSO - Days Sales Outstanding',
      oneLiner: 'Average days between sending an invoice and getting paid. Lower is better - under 45 is healthy.',
      whatItIs:
        'If DSO is 60, it means on average a dollar of revenue you bill today will hit your bank account 60 days from now. That\'s 60 days of sales you\'ve already delivered but haven\'t been paid for.',
      howWeCompute:
        '(Accounts Receivable ÷ Revenue over the last 12 months) × 365. AR comes from your balance sheet, revenue from the P&L. The result is in days.',
      whatsGood:
        'Under 30 days is excellent. 30-45 is healthy. 45-60 starts to get uncomfortable. Above 60 means customers are effectively financing themselves with your money.',
      yourRead:
        dso === null
          ? { tone: 'neutral', text: 'Not enough data yet to compute DSO.' }
          : dso <= 45
            ? { tone: 'positive', text: `Your DSO is ${Math.round(dso)} days - customers are paying inside a healthy window. Keep doing whatever you're doing on collections.` }
            : dso <= 60
              ? { tone: 'warning', text: `Your DSO is ${Math.round(dso)} days - slightly above comfortable. A gentle nudge on the oldest invoices in the collections queue below usually brings this back under 45.` }
              : { tone: 'negative', text: `Your DSO is ${Math.round(dso)} days. That's nearly ${(dso / 30).toFixed(1)} months of sales sitting in customer pockets instead of yours. Start chasing the largest overdue invoices in the queue below.` },
    };
  } else if (metric === 'dpo') {
    s = {
      title: 'DPO - Days Payable Outstanding',
      oneLiner: 'Average days you take to pay your vendors. Higher means more cash stays with you, but don\'t push supplier patience.',
      whatItIs:
        'If DPO is 45, it means on average you hold a vendor bill for 45 days before paying it. That 45 days is free working capital - your suppliers are effectively lending you that money interest-free.',
      howWeCompute:
        '(Accounts Payable ÷ Total Operating Expenses over the last 12 months) × 365. AP comes from your balance sheet, expenses from the P&L. The result is in days.',
      whatsGood:
        '30-60 days is normal for B2B vendor terms. Under 15 means you\'re paying too fast (missing the float). Over 90 risks late fees, damaged relationships, or losing early-pay discounts.',
      yourRead:
        dpo === null
          ? { tone: 'neutral', text: 'Not enough data yet to compute DPO.' }
          : dpo < 15
            ? { tone: 'warning', text: `Your DPO is ${Math.round(dpo)} days - you're paying vendors almost immediately. If your terms are 30+ days, using them would free up working capital with no downside.` }
            : dpo <= 60
              ? { tone: 'positive', text: `Your DPO is ${Math.round(dpo)} days - inside the normal vendor-terms range. Cash is staying with you as long as it reasonably can without upsetting anyone.` }
              : dpo <= 90
                ? { tone: 'warning', text: `Your DPO is ${Math.round(dpo)} days. That's stretching past typical terms - keep an eye on vendor relationships and any late-fee exposure.` }
                : { tone: 'negative', text: `Your DPO is ${Math.round(dpo)} days - you're holding vendor cash for over three months. Great for your bank balance, but expect pressure from suppliers, late fees, or loss of early-pay discounts.` },
    };
  } else {
    // ccc
    const parts =
      dso !== null && dpo !== null
        ? `We took your DSO of ${Math.round(dso)} days and subtracted your DPO of ${Math.round(dpo)} days. ${Math.round(dso)} - ${Math.round(dpo)} = ${Math.round(dso - dpo)} days.`
        : 'We need both DSO and DPO to compute this.';
    s = {
      title: 'Cash cycle (CCC)',
      oneLiner: 'DSO minus DPO. Negative or low means cash keeps moving. High means cash is trapped in the gap between collecting and paying.',
      whatItIs:
        'The number of days a dollar is stuck inside your working capital. You pay your vendor, then wait, then eventually collect from the customer - the gap in between is the cash cycle. Negative is best (you collect before you pay).',
      howWeCompute:
        'CCC = DSO - DPO (for service businesses with no inventory). The textbook formula is DSO + DIO - DPO, but DIO is zero when you don\'t carry stock.',
      whatsGood:
        'Negative: excellent - customers pay you before vendors are due. 0-30: tight and healthy. 30-60: cash is getting tied up. 60+: you\'re funding growth out of pocket.',
      yourRead:
        ccc === null
          ? { tone: 'neutral', text: 'Not enough data yet to compute your cash cycle.' }
          : ccc < 0
            ? { tone: 'positive', text: `${parts} You collect ${Math.abs(Math.round(ccc))} days BEFORE you pay - best place to be. Suppliers are effectively financing your operations.` }
            : ccc < 30
              ? { tone: 'positive', text: `${parts} Cash moves through the business in a tight ${Math.round(ccc)}-day window. No working-capital pressure.` }
              : ccc < 60
                ? { tone: 'warning', text: `${parts} Every dollar of revenue waits about two months before it funds the next one. Worth tightening.` }
                : { tone: 'negative', text: `${parts} That's a long gap - cash is trapped for ${Math.round(ccc)} days between paying and collecting. Either collect faster, or negotiate longer vendor terms.` },
    };
  }

  const toneClasses = {
    positive: 'text-positive',
    warning: 'text-warning',
    negative: 'text-negative',
    neutral: 'text-ink-500',
  } as const;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card max-w-xl w-full p-7 max-h-[90vh] overflow-y-auto relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-400 hover:text-ink-900 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
        <div className="smallcaps mb-2">Metric explainer</div>
        <h2 className="font-display text-[24px] text-ink-900 tracking-tight leading-tight pr-8">
          {s.title}
        </h2>
        <p className="text-sm text-ink-500 mt-2 leading-relaxed">{s.oneLiner}</p>

        <div className="mt-5 space-y-4">
          <div>
            <div className="smallcaps mb-1">What it is</div>
            <p className="text-sm text-ink-700 leading-relaxed">{s.whatItIs}</p>
          </div>
          <div>
            <div className="smallcaps mb-1">How we compute it</div>
            <p className="text-sm text-ink-700 leading-relaxed">{s.howWeCompute}</p>
          </div>
          <div>
            <div className="smallcaps mb-1">What's a good number</div>
            <p className="text-sm text-ink-700 leading-relaxed">{s.whatsGood}</p>
          </div>
          <div className="border hairline rounded-md p-4 bg-canvas-sunken">
            <div className="smallcaps mb-1">Your number right now</div>
            <p className={`text-sm leading-relaxed ${toneClasses[s.yourRead.tone]}`}>{s.yourRead.text}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgingBar({ buckets, total }: { buckets: AgingBuckets; total: number }) {
  if (total === 0) {
    return <div className="h-6 rounded-md border hairline bg-canvas-sunken flex items-center justify-center text-[11px] text-ink-400">No outstanding balance</div>;
  }
  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full rounded-md overflow-hidden border hairline">
        {BUCKET_KEYS.map(({ key, label }) => {
          const v = buckets[key];
          if (v <= 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={key}
              title={`${label} · ${fmtMoney(v)} (${pct.toFixed(1)}%)`}
              style={{ width: `${pct}%`, background: BUCKET_TONES[key] }}
              className="transition-opacity hover:opacity-80"
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {BUCKET_KEYS.map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1.5 text-ink-500">
            <span className="h-2 w-2 rounded-sm" style={{ background: BUCKET_TONES[key] }} />
            <span className="text-ink-700">{label}</span>
            <span className="num">{fmtMoney(buckets[key])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Reads the four hero metrics and turns them into plain-English interpretation
 * + one or two concrete nudges. Nothing here is hardcoded - verdicts flip as
 * the underlying numbers change. Benchmarks are common-sense B2B rules of
 * thumb (30-45d collections, 30-60d payment terms), not industry-specific.
 */
function WorkingCapitalExplainer({ hero }: { hero: CashFlowData['hero'] }) {
  const { dso, dpo, ccc, cash, arTotal, apTotal } = hero;

  // One-line verdicts. Every string is tight - headline is the punchline,
  // body is one short sentence of context. No paragraphs.
  let cccVerdict: { tone: 'positive' | 'warning' | 'negative' | 'neutral'; headline: string; body: string };
  if (ccc === null) {
    cccVerdict = { tone: 'neutral', headline: 'Not enough data yet', body: 'Need more invoices/bills to compute.' };
  } else if (ccc < 0) {
    cccVerdict = { tone: 'positive', headline: `Collecting ${Math.abs(Math.round(ccc))}d before you pay`, body: 'Best place to be - vendors are financing you.' };
  } else if (ccc < 30) {
    cccVerdict = { tone: 'positive', headline: `Tight cycle (${Math.round(ccc)}d)`, body: 'Cash moves quickly. No pressure.' };
  } else if (ccc < 60) {
    cccVerdict = { tone: 'warning', headline: `Cash tied up ${Math.round(ccc)}d`, body: 'Worth tightening collections.' };
  } else {
    cccVerdict = { tone: 'negative', headline: `Cash tied up ${Math.round(ccc)}d`, body: "You're funding growth out of pocket." };
  }

  // Concrete nudges - one line each, hard limit.
  const suggestions: { label: string; text: string }[] = [];

  if (dso !== null && dso > 60) {
    suggestions.push({ label: 'Collections', text: `DSO of ${Math.round(dso)}d is well past 30-45d healthy. Chase the queue below, ranked by pain.` });
  } else if (dso !== null && dso > 45) {
    suggestions.push({ label: 'Collections', text: `DSO of ${Math.round(dso)}d is slightly high. A gentle nudge on the oldest invoices usually fixes it.` });
  }

  if (dpo !== null && dpo > 90) {
    suggestions.push({ label: 'Payables', text: `DPO of ${Math.round(dpo)}d is stretching vendors past 3 months. Watch for late fees and lost discounts.` });
  } else if (dpo !== null && dpo < 15) {
    suggestions.push({ label: 'Payables', text: `DPO of ${Math.round(dpo)}d is very short. Use your terms - free working capital.` });
  }

  if (arTotal > apTotal * 1.5 && arTotal > 0) {
    suggestions.push({ label: 'Imbalance', text: `AR ${fmtMoney(arTotal)} vs AP ${fmtMoney(apTotal)} - you're extending more credit than you're taking.` });
  }

  if (cash < apTotal && apTotal > 0) {
    suggestions.push({ label: 'Liquidity', text: `Cash ${fmtMoney(cash)} < AP ${fmtMoney(apTotal)}. No buffer if a customer pays late.` });
  }

  if (suggestions.length === 0) {
    suggestions.push({ label: 'All good', text: 'Working capital is healthy. Just watch the collections queue below.' });
  }

  const toneClasses: Record<typeof cccVerdict.tone, string> = {
    positive: 'text-positive',
    warning: 'text-warning',
    negative: 'text-negative',
    neutral: 'text-ink-500',
  };

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="font-display text-[15px] text-ink-900 tracking-tight leading-none">
          What this means for you
        </h2>
        <span className="text-[10px] text-ink-400">Click any card above for details</span>
      </div>

      {/* Tight 1+N grid: verdict on left, stacked mini-rows on right. Each
          suggestion is a single line with tone-coloured label + inline text,
          no padded sub-cards. Reads like a checklist, not a brochure. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className={`lg:col-span-1 border hairline rounded-md p-3 bg-canvas-sunken`}>
          <div className="smallcaps mb-1">Bottom line</div>
          <div className={`text-[13px] font-semibold leading-snug ${toneClasses[cccVerdict.tone]}`}>
            {cccVerdict.headline}
          </div>
          <p className="text-[11px] text-ink-500 mt-1.5 leading-snug">{cccVerdict.body}</p>
        </div>

        <div className="lg:col-span-3 divide-y hairline">
          {suggestions.map((s) => (
            <div key={s.label} className="py-2 first:pt-0 last:pb-0">
              <div className="smallcaps">{s.label}</div>
              <p className="text-[12px] text-ink-700 leading-snug mt-0.5">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function CashFlow() {
  const { user, adminActiveTenantId } = useAuth();
  const chart = useChartColors();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const period = usePrefs((s) => s.period);
  const setPeriod = usePrefs((s) => s.setPeriod);
  const [openMetric, setOpenMetric] = useState<CashMetricKey | null>(null);

  const needsTenantSelection = user?.role === 'admin' && !adminActiveTenantId;

  const q = useQuery<CashFlowData>({
    queryKey: ['cashflow', period, adminActiveTenantId],
    queryFn: () => api.get(`/api/dashboard/cashflow?period=${encodeURIComponent(period)}`),
    enabled: !!user && !needsTenantSelection,
  });

  function copyChase(c: CashFlowData['collections'][number]) {
    const body =
`Hi ${c.contact ?? 'there'},

Just a quick note - invoice ${c.number ?? ''} for ${fmtMoney(c.amountDue)} is now ${c.daysOverdue} days past due.

Could you let me know when we can expect payment? Happy to resend the invoice if useful.

Thanks,`;
    navigator.clipboard.writeText(body).then(() => {
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((x) => (x === c.id ? null : x)), 1800);
    });
  }

  if (needsTenantSelection) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center mt-10">
        <h2 className="font-display text-2xl text-ink-900 mb-3">Pick a tenant first</h2>
      </div>
    );
  }

  const d = q.data;

  return (
    <div className="space-y-8">
      <PageHeader
        tag="Cash Flow · As of today"
        title="Where is the money stuck?"
        meta={
          d ? (
            <>
              Cash <span className="num text-ink-900">{fmtMoney(d.hero.cash)}</span> ·
              AR <span className="num text-ink-900">{fmtMoney(d.hero.arTotal)}</span> ·
              AP <span className="num text-ink-900">{fmtMoney(d.hero.apTotal)}</span>
            </>
          ) : <>Loading cash position…</>
        }
        right={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {q.isLoading && <div className="text-ink-400 text-sm">Loading cash flow…</div>}
      {q.error && (
        <div className="card p-4 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {(q.error as Error).message}
        </div>
      )}

      {d && (
        <>
          {/* HERO: 4 efficiency metrics - click any card for a plain-English explainer */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => setOpenMetric('cash')}
              className="card p-5 text-left hover:border-ink-300 transition-colors cursor-pointer"
            >
              <div className="flex items-baseline justify-between">
                <div className="smallcaps">Cash on hand</div>
                <span className="text-[10px] text-ink-400">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.cash}
                format={fmtMoney}
                className="block mt-2 font-display text-[32px] leading-none tracking-tight num text-ink-900"
              />
              <div className="text-xs text-ink-400 mt-3">Across all bank accounts</div>
            </button>
            <button
              type="button"
              onClick={() => setOpenMetric('dso')}
              className="card p-5 text-left hover:border-ink-300 transition-colors cursor-pointer"
            >
              <div className="flex items-baseline justify-between">
                <div className="smallcaps">DSO</div>
                <span className="text-[10px] text-ink-400">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.dso}
                format={(n) => `${Math.round(n)} d`}
                className="block mt-2 font-display text-[32px] leading-none tracking-tight num text-ink-900"
              />
              <div className="text-xs text-ink-400 mt-3">Days sales outstanding</div>
            </button>
            <button
              type="button"
              onClick={() => setOpenMetric('dpo')}
              className="card p-5 text-left hover:border-ink-300 transition-colors cursor-pointer"
            >
              <div className="flex items-baseline justify-between">
                <div className="smallcaps">DPO</div>
                <span className="text-[10px] text-ink-400">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.dpo}
                format={(n) => `${Math.round(n)} d`}
                className="block mt-2 font-display text-[32px] leading-none tracking-tight num text-ink-900"
              />
              <div className="text-xs text-ink-400 mt-3">Days payable outstanding</div>
            </button>
            <button
              type="button"
              onClick={() => setOpenMetric('ccc')}
              className="card p-5 text-left hover:border-ink-300 transition-colors cursor-pointer"
            >
              <div className="flex items-baseline justify-between">
                <div className="smallcaps">Cash cycle</div>
                <span className="text-[10px] text-ink-400">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.ccc}
                format={(n) => `${Math.round(n)} d`}
                className={`block mt-2 font-display text-[32px] leading-none tracking-tight num ${cccTone(d.hero.ccc)}`}
              />
              <div className="text-xs text-ink-400 mt-3">DSO - DPO</div>
            </button>
          </section>

          {openMetric && (
            <CashMetricExplainerModal
              metric={openMetric}
              hero={d.hero}
              onClose={() => setOpenMetric(null)}
            />
          )}

          <WorkingCapitalExplainer hero={d.hero} />

          {/* 90-day cash movement */}
          <section className="card p-6">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
              <div>
                <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                  Cash movement - {d.movement.label.toLowerCase()}
                </h2>
                <div className="smallcaps mt-2">Running net of receipts and payments</div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <div className="smallcaps">In</div>
                  <div className="font-display text-[20px] num text-positive mt-1">{fmtMoney(d.movement.inflow)}</div>
                </div>
                <div>
                  <div className="smallcaps">Out</div>
                  <div className="font-display text-[20px] num text-negative mt-1">{fmtMoney(d.movement.outflow)}</div>
                </div>
                <div>
                  <div className="smallcaps">Net</div>
                  <div className={`font-display text-[20px] num mt-1 ${d.movement.net >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {d.movement.net >= 0 ? '+' : '-'}{fmtMoney(Math.abs(d.movement.net))}
                  </div>
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.movement.series}>
                <defs>
                  <linearGradient id="cashMoveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.green} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={chart.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis
                  dataKey="date"
                  fontSize={11}
                  stroke={chart.axis}
                  interval={Math.max(1, Math.floor(d.movement.series.length / 6))}
                />
                <YAxis fontSize={11} stroke={chart.axis} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
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
                <Area type="monotone" dataKey="cumulative" stroke={chart.green} strokeWidth={2} fill="url(#cashMoveFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          {/* AR & AP aging side-by-side */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-6">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-display text-[18px] text-ink-900 tracking-tight leading-none">Money owed to us</h3>
                <span className="smallcaps">AR aging</span>
              </div>
              <div className="text-xs text-ink-400 mt-1 mb-5">
                <span className="num text-ink-900">{fmtMoney(d.ar.totalOutstanding)}</span> outstanding ·{' '}
                <span className={d.ar.overduePct > 30 ? 'text-negative' : d.ar.overduePct > 10 ? 'text-warning' : 'text-ink-500'}>
                  {d.ar.overduePct.toFixed(0)}% overdue
                </span>
              </div>
              <AgingBar buckets={d.ar.buckets} total={d.ar.totalOutstanding} />
              <AgingReadout read={agingRead(d.ar.buckets, d.ar.totalOutstanding, 'ar')} />
            </div>
            <div className="card p-6">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-display text-[18px] text-ink-900 tracking-tight leading-none">What we owe</h3>
                <span className="smallcaps">AP aging</span>
              </div>
              <div className="text-xs text-ink-400 mt-1 mb-5">
                <span className="num text-ink-900">{fmtMoney(d.ap.totalOutstanding)}</span> outstanding ·{' '}
                <span className={d.ap.overduePct > 30 ? 'text-negative' : d.ap.overduePct > 10 ? 'text-warning' : 'text-ink-500'}>
                  {d.ap.overduePct.toFixed(0)}% overdue
                </span>
              </div>
              <AgingBar buckets={d.ap.buckets} total={d.ap.totalOutstanding} />
              <AgingReadout read={agingRead(d.ap.buckets, d.ap.totalOutstanding, 'ap')} />
            </div>
          </section>

          {/* Collections - ranked by pain */}
          <section className="card p-0 overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b hairline">
              <h2 className="font-display text-[20px] text-ink-900 tracking-tight leading-none">
                Collections queue
              </h2>
              <div className="smallcaps mt-2">Ranked by pain (amount × days overdue)</div>
            </div>
            {d.collections.length === 0 ? (
              <div className="p-10 text-center text-ink-400 text-sm">
                Nothing overdue - nice.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b hairline">
                    <th className="smallcaps font-medium text-left py-3 px-5">Customer</th>
                    <th className="smallcaps font-medium text-left py-3 px-5">Invoice</th>
                    <th className="smallcaps font-medium text-right py-3 px-5">Amount</th>
                    <th className="smallcaps font-medium text-right py-3 px-5">Days past</th>
                    <th className="py-3 px-5"></th>
                  </tr>
                </thead>
                <tbody>
                  {d.collections.map((c) => {
                    const tone =
                      c.daysOverdue > 90 ? 'text-negative'
                      : c.daysOverdue > 30 ? 'text-warning'
                      : 'text-ink-700';
                    return (
                      <tr key={c.id} className="border-b hairline last:border-0 hover:bg-canvas-sunken transition-colors">
                        <td className="px-5 py-3 text-ink-900 font-medium">{c.contact ?? 'Unknown'}</td>
                        <td className="px-5 py-3 text-ink-500 text-xs num">{c.number ?? '-'}</td>
                        <td className="px-5 py-3 text-right num text-ink-900">{fmtMoney(c.amountDue)}</td>
                        <td className={`px-5 py-3 text-right num ${tone}`}>{c.daysOverdue} d</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => copyChase(c)}
                            className="border hairline rounded-md bg-canvas-raised hover:border-ink-300 hover:bg-canvas-sunken px-3 py-1 text-[11px] font-medium text-ink-700 transition-colors"
                          >
                            {copiedId === c.id ? 'Copied ✓' : 'Copy chase email'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
