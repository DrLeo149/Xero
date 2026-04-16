import { useTheme } from '../stores/theme';

export default function ThemeToggle({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const isDark = theme === 'dark';
  const dim = size === 'sm' ? 14 : 16;
  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="border hairline rounded-md bg-canvas-raised text-ink-500 hover:text-ink-900 hover:border-ink-300 p-2 transition-colors"
    >
      {isDark ? (
        <svg width={dim} height={dim} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" />
        </svg>
      ) : (
        <svg width={dim} height={dim} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" />
        </svg>
      )}
    </button>
  );
}
