import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'mynumbers.theme';

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  setTheme: (t) => {
    localStorage.setItem(KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));

// Apply on module load so there's no flash.
if (typeof window !== 'undefined') {
  applyTheme(useTheme.getState().theme);
}

/** Theme-aware palette for Recharts and other JS-side consumers. */
export function useChartColors() {
  const theme = useTheme((s) => s.theme);
  if (theme === 'dark') {
    return {
      green:   '#5BAE73',
      greenDeep: '#2F8F4D',
      grey:    '#5D6B62',
      axis:    '#7D8A81',
      grid:    '#26302B',
      tooltipBg: '#131D17',
      tooltipBorder: '#26302B',
      tooltipText: '#F1F5F2',
      ramp: ['#166534', '#2F8F4D', '#5BAE73', '#8FCA9F', '#B9DFC3', '#DCEFE1'],
      // Categorical palette - distinct hues for per-entity charts (one colour per customer, etc.)
      // Muted/desaturated so it still reads "professional finance", not a kids' app.
      categorical: [
        '#2F6FB5', // steel blue
        '#2F8F4D', // green
        '#B45309', // amber
        '#7C4DBF', // muted purple
        '#0F9BA3', // teal
        '#C2410C', // rust
        '#9E8B1F', // olive gold
        '#B83B6E', // raspberry
        '#4B6E8A', // slate
        '#2A7F62', // jade
      ],
    };
  }
  return {
    green:   '#166534',
    greenDeep: '#0D3E20',
    grey:    '#94A396',
    axis:    '#6B7A6F',
    grid:    '#E6EAE5',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#E6EAE5',
    tooltipText: '#0B0F0C',
    ramp: ['#166534', '#2F8F4D', '#5BAE73', '#8FCA9F', '#B9DFC3', '#DCEFE1'],
    categorical: [
      '#1E5A99', // steel blue
      '#1F7A3A', // green
      '#92510A', // amber
      '#6B3FA0', // muted purple
      '#0B7F86', // teal
      '#A8390C', // rust
      '#7F7017', // olive gold
      '#9E2F5C', // raspberry
      '#3A5970', // slate
      '#22664F', // jade
    ],
  };
}
