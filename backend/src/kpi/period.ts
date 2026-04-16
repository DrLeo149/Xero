/**
 * Period utilities. A "period" is any [start, end) window used to slice
 * revenue/expense/profit data. The frontend picks the period; every
 * period-aware calculator takes {start, end} and filters cached rows.
 *
 * Query params accepted:
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD   (explicit)
 *   ?period=this-month | last-month | this-quarter | last-quarter
 *          | this-year  | last-year  | ttm | year:2025 | month:2025-03
 *
 * Default when nothing is passed: current calendar month.
 */

export interface Period {
  start: Date;
  end: Date;      // exclusive
  label: string;
  /** How to bucket time-series inside this period. */
  granularity: 'day' | 'week' | 'month';
}

function startOfMonth(y: number, m: number) {
  return new Date(y, m, 1);
}
function startOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function pickGranularity(start: Date, end: Date): 'day' | 'week' | 'month' {
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days <= 35) return 'day';
  if (days <= 100) return 'week';
  return 'month';
}

export function parsePeriod(query: Record<string, any>): Period {
  const now = new Date();

  // Explicit start/end
  if (query.start && query.end) {
    const start = new Date(String(query.start));
    const end = new Date(String(query.end));
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
        granularity: pickGranularity(start, end),
      };
    }
  }

  const key = String(query.period ?? 'this-month');

  // year:2025
  const yearMatch = key.match(/^year:(\d{4})$/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    return {
      start: startOfMonth(y, 0),
      end: startOfMonth(y + 1, 0),
      label: String(y),
      granularity: 'month',
    };
  }

  // month:2025-03
  const monthMatch = key.match(/^month:(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const y = parseInt(monthMatch[1], 10);
    const m = parseInt(monthMatch[2], 10) - 1;
    const start = startOfMonth(y, m);
    const end = startOfMonth(y, m + 1);
    return {
      start,
      end,
      label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      granularity: 'day',
    };
  }

  switch (key) {
    case 'last-month': {
      const start = startOfMonth(now.getFullYear(), now.getMonth() - 1);
      const end = startOfMonth(now.getFullYear(), now.getMonth());
      return { start, end, label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }), granularity: 'day' };
    }
    case 'this-quarter': {
      const start = startOfQuarter(now);
      const end = addMonths(start, 3);
      const q = Math.floor(now.getMonth() / 3) + 1;
      return { start, end, label: `Q${q} ${now.getFullYear()}`, granularity: 'week' };
    }
    case 'last-quarter': {
      const start = addMonths(startOfQuarter(now), -3);
      const end = addMonths(start, 3);
      const q = Math.floor(start.getMonth() / 3) + 1;
      return { start, end, label: `Q${q} ${start.getFullYear()}`, granularity: 'week' };
    }
    case 'this-year': {
      const start = startOfMonth(now.getFullYear(), 0);
      const end = startOfMonth(now.getFullYear() + 1, 0);
      return { start, end, label: `${now.getFullYear()} YTD`, granularity: 'month' };
    }
    case 'last-year': {
      const start = startOfMonth(now.getFullYear() - 1, 0);
      const end = startOfMonth(now.getFullYear(), 0);
      return { start, end, label: String(now.getFullYear() - 1), granularity: 'month' };
    }
    case 'ttm': {
      const end = startOfMonth(now.getFullYear(), now.getMonth() + 1);
      const start = addMonths(end, -12);
      return { start, end, label: 'Last 12 months', granularity: 'month' };
    }
    case 'this-month':
    default: {
      const start = startOfMonth(now.getFullYear(), now.getMonth());
      const end = startOfMonth(now.getFullYear(), now.getMonth() + 1);
      return { start, end, label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }), granularity: 'day' };
    }
  }
}

/** Previous period of equal length - used for delta comparisons. */
export function priorPeriod(p: Period): Period {
  const lenMs = p.end.getTime() - p.start.getTime();
  return {
    start: new Date(p.start.getTime() - lenMs),
    end: new Date(p.start.getTime()),
    label: 'prior',
    granularity: p.granularity,
  };
}

/** Bucket boundaries for a time-series chart. Returns an array of bucket starts. */
export function bucketStarts(p: Period): Date[] {
  const out: Date[] = [];
  if (p.granularity === 'month') {
    const cur = new Date(p.start.getFullYear(), p.start.getMonth(), 1);
    while (cur < p.end) {
      out.push(new Date(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
  } else if (p.granularity === 'week') {
    const cur = new Date(p.start);
    // align to Monday
    const dow = (cur.getDay() + 6) % 7;
    cur.setDate(cur.getDate() - dow);
    while (cur < p.end) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    const cur = new Date(p.start);
    while (cur < p.end) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  return out;
}

export function bucketKey(d: Date, g: 'day' | 'week' | 'month'): string {
  if (g === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (g === 'day') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // week: ISO-ish key by Monday date
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
}

export function bucketLabel(d: Date, g: 'day' | 'week' | 'month'): string {
  if (g === 'month') return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
  if (g === 'day') return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}
