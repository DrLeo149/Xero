import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { usePrefs } from '../stores/prefs';
import PeriodSelector from '../components/PeriodSelector';
import PageHeader, { useTzFormatter } from '../components/PageHeader';
import SlotNumber from '../components/SlotNumber';
import { DEFAULT_PERIOD } from '../lib/period';
import { track } from '../lib/telemetry';
import { useChartColors } from '../stores/theme';

interface PulseData {
  period: { start: string; end: string; label: string };
  hero: {
    runwayMonths: number | null;
    runwayStatus: 'burning' | 'profitable' | 'unknown';
    cash: number;
    netProfitPeriod: number;
    revenuePeriod: number;
    expensesPeriod: number;
    revenueDeltaPct: number | null;
    profitDeltaPct: number | null;
  };
  alerts: {
    severity: 'critical' | 'warn' | 'info' | 'ok';
    title: string;
    detail: string;
    link?: string;
  }[];
  series: { label: string; revenue: number; expenses: number }[];
  cashTrend: { date: string; cumulative: number }[];
}

interface XeroStatus {
  connected: boolean;
  orgName: string | null;
  lastSyncedAt: string | null;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtMoneySigned = (n: number) => (n >= 0 ? '+' : '-') + fmtMoney(Math.abs(n)).replace('-', '');

/**
 * Plain-English explanation modal for a hero metric. Founders land on Pulse
 * and see Runway / Cash / Net burn - we don't assume they know what any of
 * those mean. Clicking a card opens this overlay with: what it is, how we
 * compute it, what a good/bad value looks like, and a live read of their
 * current number.
 */
type MetricKey = 'runway' | 'cash' | 'netburn';

function MetricExplainerModal({
  metric,
  hero,
  onClose,
}: {
  metric: MetricKey;
  hero: PulseData['hero'];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compute the "your number right now" read based on actual values.
  let title = '';
  let oneLiner = '';
  let whatItIs = '';
  let howWeCompute = '';
  let whatsGood = '';
  let yourRead = '';
  let yourTone: 'positive' | 'warning' | 'negative' | 'neutral' = 'neutral';

  if (metric === 'runway') {
    title = 'Runway';
    oneLiner = 'How many months you can keep going before you run out of cash.';
    whatItIs =
      'Runway is the single most important number for any business that spends more than it earns. It answers the only question that actually matters when things get tight: "how long do I have?" If you\'re losing money every month, runway tells you when the lights go out if nothing changes.';
    howWeCompute =
      'We look at your actual bank movement over the last 90 days. We add up all the money that came in (RECEIVE transactions), subtract everything that went out (SPEND), and divide that by 3 to get an average monthly burn. Then we divide your current cash by that burn. So if you have $10k in the bank and you\'re burning $2k/month on average, you have 5 months of runway.';
    whatsGood =
      'Rule of thumb for a small business: under 3 months is a crisis, 3 to 6 months is tight (start a funding or cost conversation now), 6 to 12 months is healthy, over 12 months is comfortable. If you\'re cash-flow positive, runway is technically infinite and we show "Profitable" instead of a number.';
    if (hero.runwayStatus === 'profitable') {
      yourTone = 'positive';
      yourRead = `Over the last 90 days, more cash came into your bank accounts than went out. That means there's no monthly burn to divide your cash by, so runway is effectively unlimited and we show "Profitable" instead of a number. Your job is to keep it that way - watch the net profit card for any periods where you slip back into burning.`;
    } else if (hero.runwayStatus === 'unknown' || hero.runwayMonths === null) {
      yourTone = 'neutral';
      yourRead = `We don't have enough recent bank transactions yet to measure how fast you're burning cash, so we can't yet compute ${fmtMoney(hero.cash)} / monthly burn = runway. Give it a few more days of synced data and this number will appear.`;
    } else {
      // Back-compute the monthly burn we used so the founder sees the full
      // arithmetic with their own numbers, not an abstract formula.
      const monthlyBurn = hero.cash / hero.runwayMonths;
      const mathLine = `We took your cash of ${fmtMoney(hero.cash)} and divided it by your average monthly burn of ${fmtMoney(monthlyBurn)} (the net cash that left your bank accounts over the last 90 days, divided by 3). ${fmtMoney(hero.cash)} / ${fmtMoney(monthlyBurn)} per month = ${hero.runwayMonths.toFixed(1)} months.`;
      if (hero.runwayMonths < 3) {
        yourTone = 'negative';
        yourRead = `${mathLine} That's inside the danger zone - urgent action needed on either revenue, costs, or funding.`;
      } else if (hero.runwayMonths < 9) {
        yourTone = 'warning';
        yourRead = `${mathLine} That's tight but not panic - it's the right moment to have the "do we raise, or do we cut" conversation while you still have leverage.`;
      } else {
        yourTone = 'positive';
        yourRead = `${mathLine} Comfortable - you have time to think clearly and act from strength, not fear.`;
      }
    }
  } else if (metric === 'cash') {
    title = 'Cash on hand';
    oneLiner = 'Every dollar sitting in your bank accounts right now.';
    whatItIs =
      'Cash is the only thing a business actually pays its bills with. Revenue, profit, and accounts receivable are all promises of cash - cash on hand is the real thing. When people say "cash is king", this is the number they mean. You can be highly profitable on paper and still go out of business if this number hits zero.';
    howWeCompute =
      'We read the total balance across every bank account connected to your Xero file, as of the most recent sync. That means if you have a main operating account, a tax savings account, and a USD holding account, we add all three together. Note: this does not include undeposited funds or Stripe/PayPal balances that haven\'t hit your bank yet - only what Xero says is actually in the bank.';
    whatsGood =
      'There\'s no universal "good" number - it depends on your burn. A healthier way to think about it: "how many months of expenses does this cover?" That\'s what Runway above is actually showing. On its own, watch the direction - is it trending up, flat, or down? A steadily falling cash balance is the earliest warning sign that something needs to change.';
    if (hero.cash < Math.abs(hero.netProfitPeriod) && hero.netProfitPeriod < 0) {
      yourTone = 'negative';
      yourRead = `${fmtMoney(hero.cash)} is the total we pulled from every bank account connected to your Xero file on the last sync. That's less than one period of burn (you lost ${fmtMoney(Math.abs(hero.netProfitPeriod))} this period), meaning the next month or so is going to be tight unless collections or revenue pick up.`;
    } else {
      yourTone = 'neutral';
      yourRead = `${fmtMoney(hero.cash)} is the total we pulled from every bank account connected to your Xero file on the last sync - main operating, savings, FX, whatever you have. Use the runway card to see how long that lasts at your current burn, and watch the cash trend chart below to see the direction of travel.`;
    }
  } else {
    // netburn
    title = hero.netProfitPeriod >= 0 ? 'Net profit' : 'Net burn';
    oneLiner =
      hero.netProfitPeriod >= 0
        ? 'What you made after paying for everything this period.'
        : 'What you lost after paying for everything this period.';
    whatItIs =
      'This is the simplest question in business: did you make money this period, or did you lose it? Revenue is what you billed. Expenses are what it cost you to run the place. The difference is what actually lands in (or leaves) your pocket. Positive = profit, negative = burn.';
    howWeCompute =
      'We add up every sales invoice you issued in the period (authorised or paid, not drafts), then subtract every supplier bill dated in the same period. The difference is net profit. We use invoice dates so it lines up with your accountant\'s view - not when the money actually moved, but when the economic activity happened. Change the period dropdown at the top to see any month, quarter, year, or custom range.';
    whatsGood =
      'Profitable (positive) is always better than burning (negative), but early-stage businesses deliberately burn to grow. What matters is the trend and the size of the number relative to your cash. A small burn you can sustain for years is fine. A huge burn with thin cash is a five-alarm fire.';
    if (hero.netProfitPeriod >= 0) {
      yourTone = 'positive';
      yourRead = `We added up every sales invoice dated in this period (${fmtMoney(hero.revenuePeriod)} of revenue) and subtracted every supplier bill dated in the same period (${fmtMoney(hero.expensesPeriod)} of expenses). ${fmtMoney(hero.revenuePeriod)} - ${fmtMoney(hero.expensesPeriod)} = ${fmtMoney(hero.netProfitPeriod)} profit. Keep that gap positive and your runway grows instead of shrinks.`;
    } else {
      yourTone = 'negative';
      yourRead = `We added up every sales invoice dated in this period (${fmtMoney(hero.revenuePeriod)} of revenue) and subtracted every supplier bill dated in the same period (${fmtMoney(hero.expensesPeriod)} of expenses). ${fmtMoney(hero.revenuePeriod)} - ${fmtMoney(hero.expensesPeriod)} = ${fmtMoney(hero.netProfitPeriod)}, so you lost ${fmtMoney(Math.abs(hero.netProfitPeriod))} this period. Either revenue needs to come up or costs need to come down - see the alerts below for the biggest levers.`;
    }
  }

  const toneClass: Record<typeof yourTone, string> = {
    positive: 'text-positive',
    warning: 'text-warning',
    negative: 'text-negative',
    neutral: 'text-ink-900',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-7 shadow-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="smallcaps mb-1">What this means</div>
            <h2 className="font-display text-[28px] text-ink-900 tracking-tight leading-none">{title}</h2>
            <p className="text-sm text-ink-500 mt-2 leading-relaxed">{oneLiner}</p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-900 transition-colors rounded-md border hairline px-2 py-1 text-xs"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <div className="smallcaps mb-2">What it is</div>
            <p className="text-sm text-ink-700 leading-relaxed">{whatItIs}</p>
          </div>
          <div>
            <div className="smallcaps mb-2">How we calculate it</div>
            <p className="text-sm text-ink-700 leading-relaxed">{howWeCompute}</p>
          </div>
          <div>
            <div className="smallcaps mb-2">What's healthy</div>
            <p className="text-sm text-ink-700 leading-relaxed">{whatsGood}</p>
          </div>
          <div className="border hairline rounded-md p-4 bg-canvas-sunken">
            <div className="smallcaps mb-2">Your number right now</div>
            <p className={`text-sm leading-relaxed ${toneClass[yourTone]}`}>{yourRead}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function runwayTone(
  months: number | null,
  status: 'burning' | 'profitable' | 'unknown',
): { color: string; label: string } {
  if (status === 'profitable') return { color: 'text-positive', label: 'cash-flow positive' };
  if (status === 'unknown' || months === null) return { color: 'text-ink-900', label: 'no recent bank activity' };
  if (months < 4) return { color: 'text-negative', label: 'critical' };
  if (months < 9) return { color: 'text-warning', label: 'tight' };
  return { color: 'text-positive', label: 'healthy' };
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const pos = pct >= 0;
  const cls = pos ? 'text-positive' : 'text-negative';
  return (
    <span className={`text-xs font-medium num ${cls}`}>
      {pos ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Alert cards use the canvas-raised background with a left accent rail -
// matches the rest of the app's quiet, paper-like weight instead of solid
// colored blocks.
const alertStyles = {
  critical: {
    rail:  'bg-negative',
    dot:   'bg-negative',
    title: 'text-ink-900',
    body:  'text-ink-500',
    badgeWrap: 'bg-[#FBEEEE] text-[#7A1616] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]',
    badge: 'Critical',
  },
  warn: {
    rail:  'bg-warning',
    dot:   'bg-warning',
    title: 'text-ink-900',
    body:  'text-ink-500',
    badgeWrap: 'bg-[#FBF5EA] text-[#7A4C08] dark:bg-[#2A220A] dark:text-[#FCD34D]',
    badge: 'Attention',
  },
  info: {
    rail:  'bg-ink-200',
    dot:   'bg-ink-300',
    title: 'text-ink-900',
    body:  'text-ink-500',
    badgeWrap: 'bg-canvas-sunken text-ink-500',
    badge: 'Info',
  },
  ok: {
    rail:  'bg-positive',
    dot:   'bg-positive',
    title: 'text-ink-900',
    body:  'text-ink-500',
    badgeWrap: 'bg-[#F1F8F3] text-[#0D3E20] dark:bg-[#132C1D] dark:text-[#86EFAC]',
    badge: 'OK',
  },
} as const;

export default function Pulse() {
  const { user, adminActiveTenantId } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const period = usePrefs((s) => s.period);
  const setPeriod = usePrefs((s) => s.setPeriod);
  const [err, setErr] = useState<string | null>(null);
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);
  const chart = useChartColors();
  const fmtTime = useTzFormatter();

  const needsTenantSelection = user?.role === 'admin' && !adminActiveTenantId;

  const status = useQuery<XeroStatus>({
    queryKey: ['xero-status', adminActiveTenantId],
    queryFn: () => api.get('/api/xero/status'),
    enabled: !!user && !needsTenantSelection,
    retry: false,
  });

  const pulse = useQuery<PulseData>({
    queryKey: ['pulse', adminActiveTenantId, period],
    queryFn: () => api.get(`/api/dashboard/pulse?period=${encodeURIComponent(period)}`),
    enabled: !!user && !!status.data?.connected,
  });

  const sync = useMutation({
    mutationFn: () => api.post<{ status: string; errorMsg?: string | null; itemsSynced?: number }>('/api/xero/sync'),
    onSuccess: (log) => {
      // runSync resolves even on failure (it writes the error to the log row).
      // Surface that to the user instead of silently pretending it worked.
      if (log?.status === 'error') {
        setErr(`Sync failed: ${log.errorMsg ?? 'Unknown error'}`);
      } else {
        setErr(null);
      }
      qc.invalidateQueries({ queryKey: ['pulse'] });
      qc.invalidateQueries({ queryKey: ['xero-status'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const connect = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/xero/connect'),
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e: Error) => setErr(e.message),
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('xero') === 'connected') {
      qc.invalidateQueries({ queryKey: ['xero-status'] });
    }
  }, [qc]);

  useEffect(() => {
    track('period_changed', { period });
  }, [period]);

  if (needsTenantSelection) {
    return (
      <div className="max-w-xl mx-auto card p-10 text-center">
        <h2 className="font-display text-2xl text-ink-900 mb-3">Pick a tenant first</h2>
        <p className="text-ink-500 text-sm leading-relaxed">
          Go to <strong className="text-ink-900">Tenants</strong>, create a client company
          (or click <strong className="text-ink-900">View</strong> next to an existing one).
        </p>
      </div>
    );
  }

  if (status.isLoading) return <div className="text-ink-400 text-sm">Loading…</div>;
  if (status.error) {
    return (
      <div className="max-w-xl mx-auto card p-6 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
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
          Authorize this app to read your Xero organization's books.
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

  const d = pulse.data;
  const runway = d ? runwayTone(d.hero.runwayMonths, d.hero.runwayStatus) : { color: '', label: '' };

  return (
    <div className="space-y-8">
      <PageHeader
        tag={`Pulse · ${status.data.orgName}`}
        title={d?.period.label ?? '…'}
        meta={<>Last synced {fmtTime(status.data.lastSyncedAt)}</>}
        right={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {err && (
        <div className="card p-3 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5] flex items-start justify-between gap-3">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="text-xs opacity-70 hover:opacity-100 shrink-0">dismiss</button>
        </div>
      )}
      {pulse.isLoading && <div className="text-ink-400 text-sm">Loading pulse…</div>}
      {pulse.error && (
        <div className="card p-4 text-sm border-[#F2C9C9] bg-[#FBEEEE] text-[#7A1616] dark:border-[#5A1E1E] dark:bg-[#2A0E0E] dark:text-[#FCA5A5]">
          {(pulse.error as Error).message}
        </div>
      )}

      {d && (
        <>
          {/* HERO STRIP - three huge numbers. Each card is a button that
              opens a plain-English explainer modal - founders are not
              assumed to know what runway/burn/cash-on-hand mean. */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Runway */}
            <button
              type="button"
              onClick={() => setOpenMetric('runway')}
              className="card p-6 text-left hover:border-ink-300 hover:shadow-raised transition-all cursor-pointer group"
            >
              <div className="smallcaps flex items-center justify-between">
                <span>Runway</span>
                <span className="text-ink-400 group-hover:text-ink-700 transition-colors text-[10px]">What's this?</span>
              </div>
              <div className={`mt-3 font-display font-medium tracking-tight text-[56px] leading-none num ${runway.color}`}>
                {d.hero.runwayStatus === 'profitable' ? (
                  <span className="text-[36px]">Profitable</span>
                ) : d.hero.runwayStatus === 'unknown' || d.hero.runwayMonths === null ? (
                  <span className="text-ink-400">-</span>
                ) : (
                  <>
                    <SlotNumber
                      value={d.hero.runwayMonths}
                      format={(n) => n.toFixed(1)}
                    />
                    <span className="text-[24px] text-ink-400 ml-2">mo</span>
                  </>
                )}
              </div>
              <div className="smallcaps mt-3">{runway.label}</div>
            </button>

            {/* Cash */}
            <button
              type="button"
              onClick={() => setOpenMetric('cash')}
              className="card p-6 text-left hover:border-ink-300 hover:shadow-raised transition-all cursor-pointer group"
            >
              <div className="smallcaps flex items-center justify-between">
                <span>Cash on hand</span>
                <span className="text-ink-400 group-hover:text-ink-700 transition-colors text-[10px]">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.cash}
                format={fmtMoney}
                className="block mt-3 font-display font-medium tracking-tight text-[44px] leading-none num text-ink-900"
              />
              <div className="text-xs text-ink-400 mt-3">Current bank total</div>
            </button>

            {/* Period profit */}
            <button
              type="button"
              onClick={() => setOpenMetric('netburn')}
              className="card p-6 text-left hover:border-ink-300 hover:shadow-raised transition-all cursor-pointer group"
            >
              <div className="smallcaps flex items-center justify-between">
                <span>{d.hero.netProfitPeriod >= 0 ? 'Net profit' : 'Net burn'}</span>
                <span className="text-ink-400 group-hover:text-ink-700 transition-colors text-[10px]">What's this?</span>
              </div>
              <SlotNumber
                value={d.hero.netProfitPeriod}
                format={fmtMoneySigned}
                className={`block mt-3 font-display font-medium tracking-tight text-[44px] leading-none num ${d.hero.netProfitPeriod >= 0 ? 'text-positive' : 'text-negative'}`}
              />
              <div className="text-xs text-ink-400 mt-3 num">
                Rev {fmtMoney(d.hero.revenuePeriod)} · Exp {fmtMoney(d.hero.expensesPeriod)}
              </div>
            </button>
          </section>

          {openMetric && (
            <MetricExplainerModal
              metric={openMetric}
              hero={d.hero}
              onClose={() => setOpenMetric(null)}
            />
          )}

          {/* NEEDS YOUR ATTENTION */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-[18px] text-ink-900 tracking-tight leading-none">
                Needs your attention
              </h2>
              <div className="smallcaps">{d.alerts.length} items</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {d.alerts.map((a, i) => {
                const st = alertStyles[a.severity];
                const clickable = !!a.link;
                return (
                  <div
                    key={i}
                    onClick={clickable ? () => nav(a.link!) : undefined}
                    className={`card relative overflow-hidden py-3 pl-4 pr-4 ${clickable ? 'cursor-pointer card-hover' : ''}`}
                  >
                    <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${st.rail}`} />
                    <div className="flex items-start justify-between gap-3">
                      <div className={`text-[13px] font-semibold leading-snug ${st.title}`}>{a.title}</div>
                      <span className={`text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${st.badgeWrap}`}>
                        {st.badge}
                      </span>
                    </div>
                    <div className={`text-[11px] mt-1 leading-snug ${st.body}`}>{a.detail}</div>
                    {clickable && (
                      <div className="smallcaps mt-2 text-accent-700">Take action →</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* TWO CHARTS */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-6">
              <h3 className="font-display text-lg text-ink-900 tracking-tight">Cash - last 90 days</h3>
              <div className="smallcaps mt-2 mb-4">Running bank-transaction delta</div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={d.cashTrend}>
                  <defs>
                    <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chart.green} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={chart.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="date" fontSize={11} stroke={chart.axis} interval={Math.floor((d.cashTrend.length || 1) / 6)} />
                  <YAxis fontSize={11} stroke={chart.axis} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(v)}
                    contentStyle={{ borderRadius: 8, border: `1px solid ${chart.tooltipBorder}`, fontSize: 12, background: chart.tooltipBg, color: chart.tooltipText }}
                    labelStyle={{ color: chart.tooltipText }}
                  />
                  <Area type="monotone" dataKey="cumulative" stroke={chart.green} strokeWidth={2} fill="url(#cashFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-6">
              <h3 className="font-display text-lg text-ink-900 tracking-tight">Revenue vs expenses</h3>
              <div className="smallcaps mt-2 mb-4">{d.period.label}</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={d.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="label" fontSize={11} stroke={chart.axis} interval={Math.floor((d.series.length || 1) / 6)} />
                  <YAxis fontSize={11} stroke={chart.axis} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(v)}
                    contentStyle={{ borderRadius: 8, border: `1px solid ${chart.tooltipBorder}`, fontSize: 12, background: chart.tooltipBg, color: chart.tooltipText }}
                    labelStyle={{ color: chart.tooltipText }}
                  />
                  <Line type="monotone" dataKey="revenue" stroke={chart.green} strokeWidth={2} dot={false} name="Revenue" />
                  <Line type="monotone" dataKey="expenses" stroke={chart.grey} strokeWidth={2} dot={false} name="Expenses" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-5 mt-4 text-xs">
                <span className="flex items-center gap-2 text-ink-500">
                  <span className="h-2 w-4 rounded" style={{ background: chart.green }} /> Revenue
                </span>
                <span className="flex items-center gap-2 text-ink-500">
                  <span className="h-2 w-4 rounded" style={{ background: chart.grey }} /> Expenses
                </span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
