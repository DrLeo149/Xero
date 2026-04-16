import { create } from 'zustand';

/**
 * User display preferences. Persisted to localStorage, not the server -
 * these are per-device (a client's admin and the client viewing from
 * different timezones each keep their own).
 */

const TZ_KEY = 'mynumbers.tz';
const PERIOD_KEY = 'mynumbers.period';
const DEFAULT_PERIOD = 'this-quarter';

/** 'auto' means use the browser's timezone. Otherwise a valid IANA TZ name. */
export type TzPref = 'auto' | string;

function initialTz(): TzPref {
  if (typeof window === 'undefined') return 'auto';
  const v = localStorage.getItem(TZ_KEY);
  return (v as TzPref) || 'auto';
}

function initialPeriod(): string {
  if (typeof window === 'undefined') return DEFAULT_PERIOD;
  return localStorage.getItem(PERIOD_KEY) || DEFAULT_PERIOD;
}

interface PrefsState {
  tz: TzPref;
  setTz: (tz: TzPref) => void;
  /** Period key (e.g. 'this-quarter', 'last-month', 'last-12-months').
   *  Shared across every data tab so the picker stays in sync and survives
   *  page reloads via localStorage. */
  period: string;
  setPeriod: (p: string) => void;
}

export const usePrefs = create<PrefsState>((set) => ({
  tz: initialTz(),
  setTz: (tz) => {
    if (tz === 'auto') localStorage.removeItem(TZ_KEY);
    else localStorage.setItem(TZ_KEY, tz);
    set({ tz });
  },
  period: initialPeriod(),
  setPeriod: (p) => {
    localStorage.setItem(PERIOD_KEY, p);
    set({ period: p });
  },
}));

/** Resolve the effective timezone - undefined means "use browser default". */
export function effectiveTz(pref: TzPref): string | undefined {
  return pref === 'auto' ? undefined : pref;
}

/** A curated list of common IANA timezones. Users can stick with 'auto' by default. */
export const COMMON_TIMEZONES: { value: TzPref; label: string }[] = [
  { value: 'auto', label: 'Auto (browser default)' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
  { value: 'America/Anchorage', label: 'Anchorage (AKT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Kolkata (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AET)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZT)' },
];
