/**
 * Period options for the top-of-page selector. Keys match the backend's
 * parsePeriod() expectations.
 */

export interface PeriodOption {
  key: string;
  label: string;
  group: 'current' | 'quick' | 'year' | 'month';
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Build the full dropdown option set. */
export function buildPeriodOptions(now = new Date()): PeriodOption[] {
  const year = now.getFullYear();
  const options: PeriodOption[] = [
    { key: 'this-month', label: 'This month', group: 'current' },
    { key: 'last-month', label: 'Last month', group: 'current' },
    { key: 'this-quarter', label: 'This quarter', group: 'quick' },
    { key: 'last-quarter', label: 'Last quarter', group: 'quick' },
    { key: 'this-year', label: `${year} YTD`, group: 'quick' },
    { key: 'last-year', label: `${year - 1}`, group: 'quick' },
    { key: 'ttm', label: 'Last 12 months', group: 'quick' },
  ];

  // Historical years - back to 2020
  for (let y = year - 2; y >= 2020; y--) {
    options.push({ key: `year:${y}`, label: String(y), group: 'year' });
  }

  // Historical months - last 18 full months (excl. the two already in "current")
  for (let i = 2; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      key: `month:${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      group: 'month',
    });
  }

  return options;
}

export function labelForKey(key: string, now = new Date()): string {
  const opt = buildPeriodOptions(now).find((o) => o.key === key);
  return opt?.label ?? key;
}

export const DEFAULT_PERIOD = 'this-month';
