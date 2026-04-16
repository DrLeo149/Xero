/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      fontFeatureSettings: {
        tnum: '"tnum", "cv11"',
      },
      colors: {
        canvas: {
          DEFAULT: 'var(--canvas)',
          raised:  'var(--canvas-raised)',
          sunken:  'var(--canvas-sunken)',
        },
        ink: {
          900: 'var(--ink-900)',
          800: 'var(--ink-800)',
          700: 'var(--ink-700)',
          500: 'var(--ink-500)',
          400: 'var(--ink-400)',
          300: 'var(--ink-300)',
          200: 'var(--ink-200)',
          100: 'var(--ink-100)',
          50:  'var(--ink-50)',
        },
        accent: {
          50:  'var(--accent-50)',
          100: 'var(--accent-100)',
          200: 'var(--accent-200)',
          300: 'var(--accent-300)',
          400: 'var(--accent-400)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
          700: 'var(--accent-700)',
          800: 'var(--accent-800)',
          900: 'var(--accent-900)',
        },
        positive: 'var(--positive)',
        warning:  'var(--warning)',
        negative: 'var(--negative)',
        brand: {
          50:  'var(--accent-50)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
          700: 'var(--accent-700)',
        },
      },
      boxShadow: {
        card:   'var(--card-shadow)',
        raised: 'var(--card-shadow-raised)',
      },
      borderRadius: {
        card: '10px',
      },
      letterSpacing: {
        smallcaps: '0.08em',
      },
    },
  },
  plugins: [],
};
