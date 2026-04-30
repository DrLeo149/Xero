import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import RefreshButton from './RefreshButton';
import { usePrefs, effectiveTz } from '../stores/prefs';
import { track } from '../lib/telemetry';

const DATA_TABS = ['/', '/profit', '/cash', '/customers'];

/**
 * Top-right soft CTA that routes to /tailor. Appears on the four data tabs
 * only - hidden on /tailor itself (where you'd already be) and on config /
 * admin surfaces where an advisor pitch feels out of place.
 */
function ExpertReviewChip() {
  const loc = useLocation();
  if (!DATA_TABS.includes(loc.pathname)) return null;
  return (
    <Link
      to="/tailor"
      onClick={() => track('expert_review_clicked', { from: loc.pathname })}
      className="chip-glare hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-3 py-1.5 hover:opacity-85 transition-opacity shadow-sm"
      // Inline styles so the inversion is guaranteed: background = ink-900
      // (near-black in light mode, near-white in dark mode), text = canvas
      // (the opposite). Using CSS variables directly avoids any Tailwind JIT
      // quirks with `text-canvas`.
      style={{
        backgroundColor: 'var(--ink-900)',
        color: 'var(--canvas)',
        border: '1px solid var(--ink-900)',
      }}
      title="Get a free 30-min review of your numbers from a senior advisor"
    >
      <span aria-hidden>✦</span>
      <span>Free expert review</span>
    </Link>
  );
}

export default function PageHeader({
  tag,
  title,
  meta,
  right,
}: {
  tag?: string;
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
}) {
  const loc = useLocation();
  const showRefresh = DATA_TABS.includes(loc.pathname);
  return (
    <div
      className="sticky top-14 lg:top-0 z-30 -mx-4 lg:-mx-10 px-4 lg:px-10 pt-5 pb-4 border-b hairline mb-6 lg:mb-8"
      style={{ backgroundColor: 'var(--canvas)' }}
    >
      <div className="flex items-start justify-between gap-3 lg:gap-6 flex-wrap">
        <div className="min-w-0">
          {tag && <div className="smallcaps mb-1.5">{tag}</div>}
          <h1 className="font-display text-[20px] lg:text-[24px] text-ink-900 tracking-tight leading-none">
            {title}
          </h1>
          {meta && <div className="text-xs text-ink-400 mt-1.5">{meta}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <ExpertReviewChip />
          {right}
          {showRefresh && <RefreshButton />}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/** Hook that returns a formatter respecting the user's timezone preference. */
export function useTzFormatter() {
  const tz = usePrefs((s) => s.tz);
  return (iso: string | Date | null | undefined): string => {
    if (!iso) return 'never';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: effectiveTz(tz),
    }).format(d);
  };
}

/** Non-hook variant for one-offs; uses browser default. */
export function formatLocalWithTz(iso: string | Date | null | undefined): string {
  if (!iso) return 'never';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}
